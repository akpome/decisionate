from sqlalchemy import case, func, text, update
from sqlalchemy.exc import IntegrityError

from app.db.models import AICreditPurchase, WorkspaceSubscription
from app.modules.billing.lifecycle import (
    billing_enforcement_enabled,
    build_subscription_access_state,
    resolve_billing_workspace_id,
)
from app.modules.billing.service import (
    BillingProviderUnavailable,
    PUBLIC_BILLING_PLANS,
)


def credit_purchase_blocker(subscription, config, *, ai_configured, pack_size=1) -> str:
    if not billing_enforcement_enabled():
        return "Billing is not enabled. No payment is required."
    if not ai_configured:
        return "AI is not available yet. Credit purchases are disabled."
    if pack_size < 1:
        return "AI credit payments are not available. Please contact support."
    plan_configured = any(
        config.get(key)
        for key in (
            "professional_price_id", "professional_annual_price_id",
            "agency_price_id", "agency_annual_price_id",
        )
    )
    if (
        config.get("provider") != "stripe"
        or not config.get("secret_key")
        or not config.get("ai_credit_topup_price_id")
        or not plan_configured
    ):
        return "AI credit payments are not available. Please contact support."
    if (
        not subscription
        or subscription.plan not in PUBLIC_BILLING_PLANS
        or not subscription.provider_subscription_id
    ):
        return "Choose a Professional or Agency subscription before purchasing AI credits."
    state = build_subscription_access_state(subscription)
    if not state.access_allowed or state.raw_status not in {"active", "trialing"}:
        return "Restore your subscription before purchasing AI credits."
    return ""


def _positive_integer(value):
    try:
        return int(value) if str(value).isdigit() and int(value) > 0 else 0
    except (ValueError, TypeError):
        return 0


def fulfill_credit_purchase(db, checkout: dict) -> AICreditPurchase | None:
    """Apply a verified Stripe payment exactly once, in the caller's transaction."""
    if (
        db.get_bind().dialect.name == "sqlite"
        and not db.connection().connection.driver_connection.in_transaction
    ):
        # Legacy sqlite transactions do not BEGIN on SELECT or SAVEPOINT.
        db.execute(text("BEGIN IMMEDIATE"))
    metadata = checkout.get("metadata") or {}
    session_id = str(checkout.get("id") or "")
    workspace_id = resolve_billing_workspace_id(metadata.get("workspace_id"))
    if (
        not session_id.startswith("cs_")
        or not workspace_id
        or checkout.get("mode") != "payment"
        or metadata.get("purchase_type") != "ai_credit_topup"
    ):
        raise BillingProviderUnavailable("Invalid AI credit checkout")
    if (
        checkout.get("client_reference_id")
        and resolve_billing_workspace_id(checkout["client_reference_id"]) != workspace_id
    ):
        raise BillingProviderUnavailable("AI credit checkout workspace does not match")

    purchase = (
        db.query(AICreditPurchase)
        .filter_by(provider_session_id=session_id)
        .first()
    )
    if purchase:
        if purchase.workspace_id != workspace_id:
            raise BillingProviderUnavailable("AI credit purchase workspace does not match")
        return purchase
    # Neither a redirect nor a completed-but-unpaid checkout is proof of payment.
    if (
        checkout.get("status") != "complete"
        or checkout.get("payment_status") not in {"paid", "no_payment_required"}
    ):
        return None

    subscription = (
        db.query(WorkspaceSubscription)
        .filter_by(workspace_id=workspace_id)
        .first()
    )
    if not subscription:
        raise BillingProviderUnavailable("The paid AI credit purchase has no workspace balance. Please contact support.")
    if (
        subscription.provider_customer_id
        and checkout.get("customer") != subscription.provider_customer_id
    ):
        raise BillingProviderUnavailable("AI credit checkout customer does not match")

    packs = _positive_integer(metadata.get("credit_packs"))
    credits = _positive_integer(metadata.get("credits"))
    pack_size = _positive_integer(metadata.get("credit_pack_size"))
    if (
        not packs or not credits or credits % packs
        or ("credit_pack_size" in metadata and credits != packs * pack_size)
    ):
        raise BillingProviderUnavailable("Invalid AI credit purchase quantity")
    # Snapshot metadata and Stripe's actual line item survive later pricing changes.
    if metadata.get("topup_price_id"):
        items = (checkout.get("line_items") or {}).get("data") or []
        if (
            len(items) != 1
            or items[0].get("quantity") != packs
            or (items[0].get("price") or {}).get("id") != metadata["topup_price_id"]
        ):
            raise BillingProviderUnavailable("AI credit purchase does not match its paid line item")

    purchase = AICreditPurchase(
        provider_session_id=session_id,
        workspace_id=workspace_id,
        credit_packs=packs,
        credits=credits,
        amount_total=checkout.get("amount_total"),
        currency=checkout.get("currency"),
    )
    try:
        with db.begin_nested():
            db.add(purchase)
            db.flush()
    except IntegrityError:
        if not db.is_active:
            # Pending webhook-event deduplication can fail before the savepoint.
            # The webhook handler must roll back that outer transaction.
            raise
        # A concurrent webhook or return-page request already fulfilled this session.
        purchase = (
            db.query(AICreditPurchase)
            .filter_by(provider_session_id=session_id)
            .one()
        )
        if purchase.workspace_id != workspace_id:
            raise BillingProviderUnavailable("AI credit purchase workspace does not match")
        return purchase

    # An atomic increment cannot overwrite concurrent AI reservations or purchases.
    balance = func.coalesce(WorkspaceSubscription.ai_credit_topup_credits, 0)
    db.execute(
        update(WorkspaceSubscription)
        .where(WorkspaceSubscription.workspace_id == workspace_id)
        .values(
            ai_credit_topup_credits=case((balance < 0, 0), else_=balance) + credits,
            ai_credit_low_notice_key=None,
        ),
        execution_options={"synchronize_session": False},
    )
    db.expire(subscription)
    return purchase
