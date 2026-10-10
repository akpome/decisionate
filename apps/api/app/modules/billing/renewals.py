"""Verified renewal periods, payment deadlines and missed-webhook recovery."""

from datetime import datetime, timedelta

from app.db.models import WorkspaceSubscription, utc_now
from app.modules.billing.lifecycle import (
    billing_enforcement_enabled,
    build_subscription_access_state,
)
from app.modules.billing.service import (
    BillingProviderUnavailable,
    timestamp_to_datetime,
)


def apply_renewal_period(
    subscription, remote, base_item, *, deleted=False, previous_credit_limit=None,
):
    now = utc_now()
    previous_start = subscription.current_period_start
    start = timestamp_to_datetime(
        remote.get("current_period_start") or base_item.get("current_period_start")
    )
    end = timestamp_to_datetime(
        remote.get("current_period_end") or base_item.get("current_period_end")
    )
    status = "canceled" if deleted else str(remote.get("status") or "unknown")
    invoice = remote.get("latest_invoice")
    invoice = invoice if isinstance(invoice, dict) else None
    renewal_unpaid = bool(
        status == "active"
        and invoice
        and invoice.get("billing_reason") in {
            "subscription_cycle", "subscription_create", "subscription_update",
        }
        and invoice.get("status") in {"draft", "open", "uncollectible"}
    )
    if renewal_unpaid:
        status = "past_due"

    if status == "past_due":
        if subscription.ai_grace_credit_limit is None:
            subscription.ai_grace_credit_limit = previous_credit_limit
        invoice_due = (
            timestamp_to_datetime(invoice.get("created"))
            if invoice and invoice.get("status") != "paid" else None
        )
        if not invoice_due or invoice_due > now:
            invoice_due = next(
                (
                    date for date in (
                        start if start != previous_start else None,
                        subscription.current_period_end,
                    ) if date and date <= now
                ),
                now,
            )
        # Preserve the first deadline across payment retries and later periods.
        subscription.payment_due_at = (
            min(subscription.payment_due_at, invoice_due)
            if subscription.payment_due_at else invoice_due
        )
    elif status in {"active", "trialing"}:
        subscription.payment_due_at = None
        subscription.ai_grace_credit_limit = None

    # Unpaid periods must not grant a fresh recurring credit allocation.
    credit_start = subscription.ai_credit_period_start or previous_start
    settled = status == "trialing" or (
        status == "active" and (not invoice or invoice.get("status") == "paid")
    )
    if settled and start:
        if credit_start and start > credit_start:
            subscription.ai_credits_used = 0
            subscription.ai_recurring_credits_used = 0
            subscription.ai_credit_low_notice_key = None
        subscription.ai_credit_period_start = (
            max(start, credit_start) if credit_start else start
        )
    elif not subscription.ai_credit_period_start:
        subscription.ai_credit_period_start = previous_start

    canceling = int(bool(remote.get("cancel_at_period_end")))
    if (status, end, canceling) != (
        subscription.status, subscription.current_period_end,
        subscription.cancel_at_period_end,
    ):
        subscription.lifecycle_notice_key = None
        subscription.lifecycle_notice_at = None
    if end != subscription.current_period_end or settled:
        subscription.data_purged_at = None

    subscription.current_period_start = start
    subscription.current_period_end = end
    subscription.status = status
    subscription.cancel_at_period_end = canceling
    # canceled_at can be the earlier request date; ended_at is actual loss of access.
    if status == "canceled":
        subscription.canceled_at = (
            timestamp_to_datetime(remote.get("ended_at") or remote.get("canceled_at"))
            or subscription.canceled_at or now
        )
    else:
        subscription.canceled_at = None
    subscription.provider_checked_at = now


def reconcile_subscription_if_needed(
    db,
    subscription: WorkspaceSubscription | None,
    *,
    now: datetime | None = None,
    force: bool = False,
) -> bool:
    if (
        not billing_enforcement_enabled() or not subscription
        or not subscription.provider_subscription_id
    ):
        return False
    current_time = now or utc_now()
    state = build_subscription_access_state(subscription, current_time)
    if not force and state.access_allowed and state.status != "grace_period":
        return False
    boundary = state.grace_period_end or state.current_period_end
    if not force and subscription.provider_checked_at and (
        current_time - subscription.provider_checked_at < timedelta(seconds=60)
        and (
            not boundary or current_time < boundary
            or subscription.provider_checked_at >= boundary
        )
    ):
        return False

    # Import here because the router also uses this recovery path for billing reads.
    from app.modules.billing.router import (
        apply_stripe_billing_event,
        retrieve_stripe_subscription,
    )

    remote = retrieve_stripe_subscription(subscription.provider_subscription_id)
    if remote.get("id") != subscription.provider_subscription_id:
        raise BillingProviderUnavailable("Stripe returned a different subscription")
    apply_stripe_billing_event(db, "customer.subscription.updated", remote)
    db.commit()
    return True
