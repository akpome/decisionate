from __future__ import annotations

import logging
from datetime import timedelta
from math import ceil
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal
from app.db.models import AIUsageEvent
from app.db.models import WorkspaceSubscription
from app.db.models import utc_now
from app.configuration import get_runtime_configuration
from app.modules.billing.service import (
    FREE_PLAN,
    get_billing_plan_definition,
    get_billing_period_ai_credit_limit,
    get_ai_credit_allocations,
    get_ai_credit_pack_size,
    get_billing_config,
    normalize_billing_plan,
)
from app.modules.billing.lifecycle import (
    build_subscription_access_state,
    resolve_billing_workspace_id,
    subscription_access_error,
)
from app.modules.billing.notifications import (
    send_ai_credit_low_balance_notification,
)


AI_CREDITS_PER_1000_TOKENS = 1
AI_TRIAL_PERIOD_DAYS = 30
AI_CREDIT_LOW_BALANCE_RATIO = 0.20

logger = logging.getLogger(__name__)


def _begin_credit_transaction(db):
    # SQLite has no SELECT FOR UPDATE; reserve its writer before reading a
    # balance. PostgreSQL uses the row locks on subscriptions and events.
    if db.get_bind().dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))


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
        .with_for_update()
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
        try:
            with db.begin_nested():
                db.add(subscription)
                db.flush()
        except IntegrityError:
            subscription = db.query(WorkspaceSubscription).filter(
                WorkspaceSubscription.workspace_id == workspace_id,
            ).with_for_update().one()
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

    # Only verified billing events renew provider periods; using AI cannot renew a trial.
    if subscription.provider_subscription_id or subscription.status != "active":
        return

    period_length = period_end - period_start
    if period_length <= timedelta(0):
        period_length = timedelta(days=30)

    while now >= period_end:
        period_start = period_end
        period_end = period_end + period_length

    subscription.current_period_start = period_start
    subscription.current_period_end = period_end
    subscription.ai_credits_used = 0
    subscription.ai_recurring_credits_used = 0
    subscription.ai_credit_low_notice_key = None


def _get_recurring_credit_limit(
    subscription,
    db=None,
) -> int | None:
    if subscription.status == "past_due" and subscription.ai_grace_credit_limit is not None:
        return max(int(subscription.ai_grace_credit_limit), 0)
    plan = normalize_billing_plan(subscription.plan)
    monthly_plan_limit = int(
        get_billing_plan_definition(plan, db)["ai_credit_limit"]
    )
    plan_limit = get_billing_period_ai_credit_limit(
        monthly_plan_limit,
        subscription.billing_interval,
    )
    additional_packs = max(
        int(subscription.additional_ai_credit_packs or 0),
        0,
    )
    additional_workspaces = max(
        int(subscription.additional_client_workspaces or 0),
        0,
    )
    monthly_additional_workspace_credits = get_ai_credit_allocations(db).get(
        "additional_client_workspace",
        0,
    )
    additional_workspace_credits = get_billing_period_ai_credit_limit(
        monthly_additional_workspace_credits,
        subscription.billing_interval,
    )
    return (
        plan_limit
        + additional_workspaces * additional_workspace_credits
        + additional_packs * get_ai_credit_pack_size(db)
    )


def _get_credit_limit(
    subscription,
    db=None,
) -> int | None:
    recurring_limit = _get_recurring_credit_limit(subscription, db)
    purchased_credits = max(
        int(subscription.ai_credit_topup_credits or 0),
        0,
    )
    return recurring_limit + purchased_credits


def get_recurring_ai_credit_limit(
    subscription,
    db=None,
) -> int | None:
    return _get_recurring_credit_limit(subscription, db)


def get_ai_credit_remaining(
    subscription,
    db=None,
) -> int:
    recurring_remaining = max(
        int(_get_recurring_credit_limit(subscription, db) or 0)
        - max(int(subscription.ai_recurring_credits_used or 0), 0),
        0,
    )
    topup_remaining = max(
        int(subscription.ai_credit_topup_credits or 0),
        0,
    )
    return recurring_remaining + topup_remaining


def get_ai_credit_low_balance_threshold(
    credit_limit: int | None,
) -> int:
    clean_limit = max(int(credit_limit or 0), 0)
    if clean_limit <= 0:
        return 0
    return max(1, ceil(clean_limit * AI_CREDIT_LOW_BALANCE_RATIO))


def _maybe_notify_low_balance(
    db,
    subscription,
    remaining_credits: int,
    credit_limit: int | None,
):
    clean_limit = max(int(credit_limit or 0), 0)
    threshold = get_ai_credit_low_balance_threshold(clean_limit)
    if not threshold or remaining_credits > threshold:
        return

    credit_start = _credit_period_start(subscription)
    period_key = (
        credit_start.isoformat()
        if credit_start
        else "current"
    )
    notice_key = f"{period_key}:{clean_limit}"
    if subscription.ai_credit_low_notice_key == notice_key:
        return

    try:
        sent = send_ai_credit_low_balance_notification(
            db,
            subscription,
            remaining_credits,
            clean_limit,
        )
        if sent:
            subscription.ai_credit_low_notice_key = notice_key
            db.commit()
    except Exception as error:
        db.rollback()
        logger.warning(
            "AI credit low-balance notification failed for %s: %s",
            subscription.workspace_id,
            error,
        )


def _credit_period_start(subscription):
    if subscription.provider_subscription_id:
        return subscription.ai_credit_period_start or subscription.current_period_start
    return subscription.current_period_start


def _usage_event_matches_current_period(
    subscription,
    usage_event,
) -> bool:
    credit_start = _credit_period_start(subscription)
    if not credit_start or not usage_event.period_start:
        return True
    return credit_start == usage_event.period_start


def _ensure_usable_subscription(
    db,
    workspace_id: str,
):
    subscription = _get_or_create_subscription(
        db,
        workspace_id,
    )

    _rollover_period_if_needed(subscription)

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
        _begin_credit_transaction(db)
        billing_workspace_id = resolve_billing_workspace_id(
            clean_workspace_id,
        )
        subscription = _ensure_usable_subscription(
            db,
            billing_workspace_id,
        )
        recurring_credit_limit = _get_recurring_credit_limit(subscription, db)
        current_recurring_usage = max(
            int(subscription.ai_recurring_credits_used or 0),
            0,
        )
        recurring_remaining = max(
            recurring_credit_limit - current_recurring_usage,
            0,
        )
        topup_balance = max(
            int(subscription.ai_credit_topup_credits or 0),
            0,
        )
        credit_limit = recurring_credit_limit + topup_balance
        current_usage = max(
            int(subscription.ai_credits_used or 0),
            0,
        )

        if (
            credit_limit is not None
            and estimated_credits > recurring_remaining + topup_balance
        ):
            limit_message = (
                "The agency's shared AI credit pool has been exhausted. "
                "Top up AI credits to continue."
                if ":client:" in clean_workspace_id
                else "This workspace has reached its AI credit limit. "
                "Add AI credits or upgrade the plan to continue."
            )
            raise AICreditLimitExceeded(
                limit_message
            )

        recurring_reserved = min(
            estimated_credits,
            recurring_remaining,
        )
        topup_reserved = estimated_credits - recurring_reserved
        subscription.ai_credits_used = current_usage + estimated_credits
        subscription.ai_recurring_credits_used = (
            current_recurring_usage + recurring_reserved
        )
        subscription.ai_credit_topup_credits = (
            topup_balance - topup_reserved
        )
        usage_event = AIUsageEvent(
            workspace_id=clean_workspace_id,
            actor_user_id=(
                str(actor_user_id or "").strip() or None
            ),
            operation=str(operation or "analysis").strip()[:120],
            provider=get_runtime_configuration().ai_provider,
            status="reserved",
            period_start=_credit_period_start(subscription),
            estimated_tokens=max(int(estimated_tokens or 0), 0),
            estimated_credits=estimated_credits,
            topup_credits_reserved=topup_reserved,
            credits=estimated_credits,
        )
        db.add(usage_event)
        db.commit()
        db.refresh(usage_event)

        _maybe_notify_low_balance(
            db,
            subscription,
            get_ai_credit_remaining(subscription, db),
            credit_limit,
        )

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
        _begin_credit_transaction(db)
        usage_event = (
            db.query(AIUsageEvent)
            .filter(AIUsageEvent.id == reservation_id)
            .with_for_update()
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
                == resolve_billing_workspace_id(usage_event.workspace_id),
            )
            .with_for_update()
            .first()
        )
        if subscription:
            same_period = _usage_event_matches_current_period(
                subscription,
                usage_event,
            )
            estimated_credits = max(
                int(usage_event.estimated_credits or 0),
                0,
            )
            reserved_topup_credits = max(
                int(usage_event.topup_credits_reserved or 0),
                0,
            )
            reserved_recurring_credits = max(
                estimated_credits - reserved_topup_credits,
                0,
            )
            actual_recurring_credits = min(
                actual_credits,
                reserved_recurring_credits,
            )
            actual_topup_credits = max(
                actual_credits - actual_recurring_credits,
                0,
            )
            if same_period:
                subscription.ai_credits_used = max(
                    int(subscription.ai_credits_used or 0)
                    - estimated_credits
                    + actual_credits,
                    0,
                )
                subscription.ai_recurring_credits_used = max(
                    int(subscription.ai_recurring_credits_used or 0)
                    - reserved_recurring_credits
                    + actual_recurring_credits,
                    0,
                )
            subscription.ai_credit_topup_credits = max(
                int(subscription.ai_credit_topup_credits or 0)
                + reserved_topup_credits
                - actual_topup_credits,
                0,
            )
            _maybe_notify_low_balance(
                db,
                subscription,
                get_ai_credit_remaining(subscription, db),
                _get_credit_limit(subscription, db),
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
        _begin_credit_transaction(db)
        usage_event = (
            db.query(AIUsageEvent)
            .filter(AIUsageEvent.id == reservation_id)
            .with_for_update()
            .first()
        )
        if not usage_event or usage_event.status != "reserved":
            return

        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.workspace_id
                == resolve_billing_workspace_id(usage_event.workspace_id),
            )
            .with_for_update()
            .first()
        )
        if subscription:
            same_period = _usage_event_matches_current_period(
                subscription,
                usage_event,
            )
            if same_period:
                subscription.ai_credits_used = max(
                    int(subscription.ai_credits_used or 0)
                    - int(usage_event.estimated_credits or 0),
                    0,
                )
            reserved_topup_credits = max(
                int(usage_event.topup_credits_reserved or 0),
                0,
            )
            reserved_recurring_credits = max(
                int(usage_event.estimated_credits or 0)
                - reserved_topup_credits,
                0,
            )
            if same_period:
                subscription.ai_recurring_credits_used = max(
                    int(subscription.ai_recurring_credits_used or 0)
                    - reserved_recurring_credits,
                    0,
                )
            subscription.ai_credit_topup_credits = max(
                int(subscription.ai_credit_topup_credits or 0)
                + reserved_topup_credits,
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
