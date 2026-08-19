from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import ceil

from app.db.models import WorkspaceSubscription, utc_now
from app.modules.billing.service import (
    FREE_PLAN,
    normalize_billing_plan,
)


DEFAULT_GRACE_PERIOD_DAYS = 7


@dataclass(frozen=True)
class SubscriptionAccessState:
    plan: str
    raw_status: str
    status: str
    access_allowed: bool
    requires_billing_action: bool
    current_period_end: datetime | None
    grace_period_end: datetime | None
    days_remaining: int | None
    reason: str


def get_billing_grace_period_days() -> int:
    try:
        return max(
            int(
                str(
                    os.getenv(
                        "BILLING_GRACE_PERIOD_DAYS",
                        str(DEFAULT_GRACE_PERIOD_DAYS),
                    )
                    or DEFAULT_GRACE_PERIOD_DAYS
                ).strip()
            ),
            0,
        )
    except (TypeError, ValueError):
        return DEFAULT_GRACE_PERIOD_DAYS


def resolve_billing_workspace_id(workspace_id: str) -> str:
    clean_workspace_id = str(workspace_id or "").strip()
    if ":client:" in clean_workspace_id:
        return clean_workspace_id.split(":client:", 1)[0]
    return clean_workspace_id


def get_subscription_for_workspace(db, workspace_id: str):
    billing_workspace_id = resolve_billing_workspace_id(workspace_id)
    if not billing_workspace_id:
        return None

    return (
        db.query(WorkspaceSubscription)
        .filter(
            WorkspaceSubscription.workspace_id == billing_workspace_id,
        )
        .first()
    )


def build_subscription_access_state(
    subscription: WorkspaceSubscription | None,
    now: datetime | None = None,
) -> SubscriptionAccessState:
    current_time = now or utc_now()

    if subscription is None:
        return SubscriptionAccessState(
            plan=FREE_PLAN,
            raw_status="untracked",
            status="untracked",
            access_allowed=True,
            requires_billing_action=False,
            current_period_end=None,
            grace_period_end=None,
            days_remaining=None,
            reason="No subscription record is present for this legacy workspace.",
        )

    plan = normalize_billing_plan(subscription.plan)
    raw_status = str(subscription.status or "inactive").strip().lower()
    period_end = subscription.current_period_end
    grace_period_end = None
    days_remaining = None

    if period_end:
        seconds_remaining = (period_end - current_time).total_seconds()
        days_remaining = max(0, ceil(seconds_remaining / 86400))

    if plan == FREE_PLAN and raw_status == "trialing":
        if period_end and current_time >= period_end:
            return SubscriptionAccessState(
                plan=plan,
                raw_status=raw_status,
                status="expired",
                access_allowed=False,
                requires_billing_action=True,
                current_period_end=period_end,
                grace_period_end=None,
                days_remaining=0,
                reason="The free trial has ended.",
            )

        return SubscriptionAccessState(
            plan=plan,
            raw_status=raw_status,
            status="trialing",
            access_allowed=True,
            requires_billing_action=False,
            current_period_end=period_end,
            grace_period_end=None,
            days_remaining=days_remaining,
            reason="The free trial is active.",
        )

    if plan == FREE_PLAN:
        return SubscriptionAccessState(
            plan=plan,
            raw_status=raw_status,
            status="active",
            access_allowed=True,
            requires_billing_action=False,
            current_period_end=period_end,
            grace_period_end=None,
            days_remaining=days_remaining,
            reason="The free plan is active.",
        )

    if raw_status in {"active", "trialing", "checkout_completed"}:
        if period_end and current_time >= period_end:
            return _expired_state(
                plan,
                raw_status,
                period_end,
                "The subscription period has ended.",
            )

        status = "canceling" if subscription.cancel_at_period_end else raw_status
        return SubscriptionAccessState(
            plan=plan,
            raw_status=raw_status,
            status=status,
            access_allowed=True,
            requires_billing_action=bool(subscription.cancel_at_period_end),
            current_period_end=period_end,
            grace_period_end=None,
            days_remaining=days_remaining,
            reason=(
                "The subscription is scheduled to end at the current period end."
                if subscription.cancel_at_period_end
                else "The subscription is active."
            ),
        )

    if raw_status == "past_due" and period_end:
        grace_period_end = period_end + timedelta(
            days=get_billing_grace_period_days(),
        )
        if current_time < grace_period_end:
            return SubscriptionAccessState(
                plan=plan,
                raw_status=raw_status,
                status="grace_period",
                access_allowed=True,
                requires_billing_action=True,
                current_period_end=period_end,
                grace_period_end=grace_period_end,
                days_remaining=max(
                    0,
                    ceil((grace_period_end - current_time).total_seconds() / 86400),
                ),
                reason="Payment needs attention during the billing grace period.",
            )

    return _expired_state(
        plan,
        raw_status,
        period_end,
        "An active subscription is required to use this workspace.",
    )


def _expired_state(
    plan: str,
    raw_status: str,
    period_end: datetime | None,
    reason: str,
) -> SubscriptionAccessState:
    return SubscriptionAccessState(
        plan=plan,
        raw_status=raw_status,
        status="expired",
        access_allowed=False,
        requires_billing_action=True,
        current_period_end=period_end,
        grace_period_end=None,
        days_remaining=0,
        reason=reason,
    )


def subscription_access_error(state: SubscriptionAccessState) -> str:
    if state.status == "grace_period":
        return (
            "Payment needs attention. Update your billing details to keep this "
            "workspace active."
        )
    if state.plan == FREE_PLAN and state.raw_status == "trialing":
        return "Your free trial has ended. Choose a plan to continue."
    return "Your subscription has expired. Renew your plan to continue."


def is_subscription_exempt_path(path: str) -> bool:
    clean_path = str(path or "").rstrip("/") or "/"
    return clean_path.startswith(
        (
            "/billing",
            "/organizations",
            "/support",
            "/admin",
        )
    )

