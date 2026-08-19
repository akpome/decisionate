from __future__ import annotations

from datetime import timedelta
from math import ceil

from app.db.database import SessionLocal
from app.db.models import AIUsageEvent
from app.db.models import WorkspaceSubscription
from app.db.models import utc_now
from app.configuration import get_runtime_configuration
from app.modules.billing.service import (
    FREE_PLAN,
    get_billing_plan_definition,
    get_ai_credit_allocations,
    get_ai_credit_pack_size,
    get_billing_config,
    normalize_billing_plan,
)
from app.modules.billing.lifecycle import (
    build_subscription_access_state,
    subscription_access_error,
)


AI_CREDITS_PER_1000_TOKENS = 1
AI_TRIAL_PERIOD_DAYS = 30


class AICreditLimitExceeded(RuntimeError):
    pass


def credits_for_tokens(
    total_tokens: int | None,
) -> int:
    try:
        clean_tokens = int(total_tokens or 0)
    except (TypeError, ValueError):
        clean_tokens = 0

    if clean_tokens <= 0:
        return 1

    return max(
        1,
        ceil(
            clean_tokens
            * AI_CREDITS_PER_1000_TOKENS
            / 1000
        ),
    )


def _get_or_create_subscription(
    db,
    workspace_id: str,
):
    now = utc_now()
    subscription = (
        db.query(WorkspaceSubscription)
        .filter(
            WorkspaceSubscription.workspace_id == workspace_id,
        )
        .first()
    )

    if not subscription:
        subscription = WorkspaceSubscription(
            workspace_id=workspace_id,
            provider=get_billing_config()["provider"],
            plan=FREE_PLAN,
            status="trialing",
            current_period_start=now,
            current_period_end=(
                now + timedelta(days=AI_TRIAL_PERIOD_DAYS)
            ),
        )
        db.add(subscription)
        db.flush()
        return subscription

    if not subscription.current_period_start:
        subscription.current_period_start = (
            subscription.created_at or now
        )

    if (
        subscription.plan == FREE_PLAN
        and not subscription.current_period_end
    ):
        subscription.current_period_end = (
            subscription.current_period_start
            + timedelta(days=AI_TRIAL_PERIOD_DAYS)
        )

    return subscription


def _rollover_period_if_needed(
    subscription,
):
    now = utc_now()
    period_start = subscription.current_period_start
    period_end = subscription.current_period_end

    if not period_start or not period_end or now < period_end:
        return

    if subscription.plan == FREE_PLAN:
        raise AICreditLimitExceeded(
            "Your 30-day AI trial has ended. Choose a paid plan to continue using AI analysis."
        )

    period_length = period_end - period_start
    if period_length <= timedelta(0):
        period_length = timedelta(days=30)

    while now >= period_end:
        period_start = period_end
        period_end = period_end + period_length

    subscription.current_period_start = period_start
    subscription.current_period_end = period_end
    subscription.ai_credits_used = 0


def _get_credit_limit(
    subscription,
) -> int | None:
    plan = normalize_billing_plan(subscription.plan)
    if ":client:" in str(subscription.workspace_id or ""):
        plan_limit = int(
            get_ai_credit_allocations().get(
                "agency_client",
                0,
            )
        )
    else:
        plan_limit = int(
            get_billing_plan_definition(plan)["ai_credit_limit"]
        )
    additional_packs = max(
        int(subscription.additional_ai_credit_packs or 0),
        0,
    )
    additional_workspaces = max(
        int(subscription.additional_client_workspaces or 0),
        0,
    )
    additional_workspace_credits = get_ai_credit_allocations().get(
        "additional_client_workspace",
        0,
    )
    return (
        plan_limit
        + additional_workspaces * additional_workspace_credits
        + additional_packs * get_ai_credit_pack_size()
    )


def _ensure_usable_subscription(
    db,
    workspace_id: str,
):
    subscription = _get_or_create_subscription(
        db,
        workspace_id,
    )

    access_state = build_subscription_access_state(subscription)
    if not access_state.access_allowed:
        raise AICreditLimitExceeded(
            subscription_access_error(access_state)
        )

    return subscription


def reserve_ai_credits(
    *,
    workspace_id: str,
    operation: str,
    estimated_tokens: int,
    actor_user_id: str | None = None,
):
    clean_workspace_id = str(workspace_id or "").strip()
    if not clean_workspace_id:
        return None

    estimated_credits = credits_for_tokens(
        estimated_tokens,
    )
    db = SessionLocal()

    try:
        subscription = _ensure_usable_subscription(
            db,
            clean_workspace_id,
        )
        credit_limit = _get_credit_limit(subscription)
        current_usage = max(
            int(subscription.ai_credits_used or 0),
            0,
        )

        if (
            credit_limit is not None
            and current_usage + estimated_credits > credit_limit
        ):
            raise AICreditLimitExceeded(
                "This workspace has reached its AI credit limit. Add AI credit packs or upgrade the plan to continue."
            )

        subscription.ai_credits_used = (
            current_usage + estimated_credits
        )
        usage_event = AIUsageEvent(
            workspace_id=clean_workspace_id,
            actor_user_id=(
                str(actor_user_id or "").strip() or None
            ),
            operation=str(operation or "analysis").strip()[:120],
            provider=get_runtime_configuration().ai_provider,
            status="reserved",
            period_start=subscription.current_period_start,
            estimated_tokens=max(int(estimated_tokens or 0), 0),
            estimated_credits=estimated_credits,
            credits=estimated_credits,
        )
        db.add(usage_event)
        db.commit()
        db.refresh(usage_event)

        return {
            "id": usage_event.id,
            "estimated_credits": estimated_credits,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def settle_ai_credits(
    reservation_id: int | None,
    usage: dict | None,
):
    if not reservation_id:
        return

    db = SessionLocal()

    try:
        usage_event = (
            db.query(AIUsageEvent)
            .filter(AIUsageEvent.id == reservation_id)
            .first()
        )
        if not usage_event or usage_event.status != "reserved":
            return

        usage = usage if isinstance(usage, dict) else {}
        prompt_tokens = _clean_token_value(
            usage.get("prompt_tokens")
        )
        completion_tokens = _clean_token_value(
            usage.get("completion_tokens")
        )
        total_tokens = _clean_token_value(
            usage.get("total_tokens")
        )
        if total_tokens is None:
            total_tokens = (
                (prompt_tokens or 0) + (completion_tokens or 0)
                if prompt_tokens is not None or completion_tokens is not None
                else None
            )

        actual_credits = credits_for_tokens(
            total_tokens
            if total_tokens is not None
            else usage_event.estimated_tokens,
        )
        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.workspace_id
                == usage_event.workspace_id,
            )
            .first()
        )
        if subscription:
            subscription.ai_credits_used = max(
                int(subscription.ai_credits_used or 0)
                - int(usage_event.estimated_credits or 0)
                + actual_credits,
                0,
            )

        usage_event.status = "completed"
        usage_event.prompt_tokens = prompt_tokens
        usage_event.completion_tokens = completion_tokens
        usage_event.total_tokens = total_tokens
        usage_event.credits = actual_credits
        db.commit()
    finally:
        db.close()


def release_ai_credits(
    reservation_id: int | None,
):
    if not reservation_id:
        return

    db = SessionLocal()

    try:
        usage_event = (
            db.query(AIUsageEvent)
            .filter(AIUsageEvent.id == reservation_id)
            .first()
        )
        if not usage_event or usage_event.status != "reserved":
            return

        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.workspace_id
                == usage_event.workspace_id,
            )
            .first()
        )
        if subscription:
            subscription.ai_credits_used = max(
                int(subscription.ai_credits_used or 0)
                - int(usage_event.estimated_credits or 0),
                0,
            )

        usage_event.status = "failed"
        usage_event.credits = 0
        db.commit()
    finally:
        db.close()


def _clean_token_value(value) -> int | None:
    try:
        clean_value = int(value)
    except (TypeError, ValueError):
        return None

    return max(clean_value, 0)
