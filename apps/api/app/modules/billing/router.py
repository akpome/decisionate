from __future__ import annotations

from datetime import UTC

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from app.db.database import SessionLocal
from app.db.models import BillingWebhookEvent
from app.db.models import Organization
from app.db.models import WorkspaceSubscription
from app.db.models import utc_now
from app.modules.auth_context import get_auth_context
from app.modules.billing.schemas import BillingCheckoutResponse
from app.modules.billing.schemas import BillingCheckoutRequest
from app.modules.billing.schemas import BillingCheckoutConfirmationRequest
from app.modules.billing.schemas import BillingCheckoutConfirmationResponse
from app.modules.billing.schemas import BillingPortalResponse
from app.modules.billing.schemas import BillingStatusResponse
from app.modules.billing.schemas import BillingAccessResponse
from app.modules.billing.schemas import BillingLifecycleSchedulerResponse
from app.modules.billing.schemas import AICreditTopupRequest
from app.modules.billing.schemas import AICreditTopupResponse
from app.modules.billing.schemas import AICreditTopupConfirmationResponse
from app.modules.billing.ai_credit_purchases import credit_purchase_blocker, fulfill_credit_purchase
from app.modules.billing.renewals import apply_renewal_period, reconcile_subscription_if_needed
from app.modules.ai.service import build_ai_status
from app.modules.ai.credits import get_ai_credit_low_balance_threshold
from app.modules.ai.credits import get_ai_credit_remaining
from app.modules.ai.credits import get_recurring_ai_credit_limit
from app.modules.billing.lifecycle import (
    billing_enforcement_enabled,
    build_subscription_access_state,
    get_subscription_for_workspace,
    resolve_billing_workspace_id,
)
from app.modules.billing.notifications import (
    get_billing_scheduler_secret,
    send_due_billing_lifecycle_notifications,
)
from app.modules.billing.service import (
    BillingProviderUnavailable,
    BillingQuoteChanged,
    BillingWebhookSignatureError,
    create_ai_credit_topup_session,
    create_checkout_session,
    create_customer_portal_session,
    get_billing_config,
    get_billing_pricing,
    is_billing_configured,
    AGENCY_PLAN,
    FREE_PLAN,
    PROFESSIONAL_PLAN,
    ANNUAL_AI_CREDIT_MULTIPLIER,
    get_ai_credit_allocations,
    get_ai_credit_pack_size,
    get_billing_period_ai_credit_limit,
    normalize_billing_plan,
    PUBLIC_BILLING_PLANS,
    TRIAL_PERIOD_DAYS,
    get_billing_plan_definition,
    get_billing_plan_options,
    get_client_workspace_limit,
    normalize_billing_interval,
    verify_stripe_webhook,
    retrieve_stripe_checkout,
    retrieve_stripe_subscription,
)


router = APIRouter()


def require_billing_owner(request: Request):
    auth_context = get_auth_context(request)
    if auth_context.workspace_role != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can manage billing",
        )
    if ":client:" in auth_context.workspace_id:
        raise HTTPException(
            status_code=403,
            detail="Agency billing must be managed from the agency workspace",
        )
    return auth_context


def require_payments_enabled():
    if not billing_enforcement_enabled():
        raise HTTPException(status_code=409, detail="Billing is not enabled. No payment is required.")


def subscription_requires_management(subscription) -> bool:
    return bool(
        subscription and subscription.provider_subscription_id
        and subscription.status not in {"canceled", "incomplete_expired"}
    )


def count_client_workspaces(db, workspace_id: str) -> int:
    return (
        db.query(Organization)
        .filter(
            Organization.owner_user_id.like(
                f"{workspace_id}:client:%"
            )
        )
        .count()
    )


def parse_nonnegative_int(value) -> int:
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def require_billing_scheduler_secret(request: Request):
    expected_secret = get_billing_scheduler_secret()
    if not expected_secret:
        raise HTTPException(
            status_code=503,
            detail="Billing lifecycle scheduler secret is not configured",
        )

    provided_secret = str(
        request.headers.get(
            "X-Billing-Scheduler-Secret",
            "",
        )
        or ""
    ).strip()
    if provided_secret != expected_secret:
        raise HTTPException(
            status_code=401,
            detail="Invalid billing lifecycle scheduler secret",
        )


@router.get(
    "/access",
    response_model=BillingAccessResponse,
)
async def get_billing_access(
    request: Request,
):
    auth_context = get_auth_context(request)
    db = SessionLocal()
    try:
        subscription = get_subscription_for_workspace(
            db,
            auth_context.workspace_id,
        )
        await run_in_threadpool(reconcile_subscription_if_needed, db, subscription)
        state = build_subscription_access_state(subscription)
        return BillingAccessResponse(
            billing_enabled=billing_enforcement_enabled(),
            workspace_id=auth_context.workspace_id,
            billing_workspace_id=resolve_billing_workspace_id(
                auth_context.workspace_id,
            ),
            plan=state.plan,
            status=state.status,
            raw_status=state.raw_status,
            access_allowed=state.access_allowed,
            requires_billing_action=state.requires_billing_action,
            current_period_end=state.current_period_end,
            grace_period_end=state.grace_period_end,
            days_remaining=state.days_remaining,
            reason=state.reason,
        )
    except BillingProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail="Subscription status could not be verified. Please retry shortly.") from error
    finally:
        db.close()


@router.get(
    "",
    response_model=BillingStatusResponse,
)
async def get_billing_status(
    request: Request,
):
    auth_context = require_billing_owner(request)
    db = SessionLocal()
    try:
        config = get_billing_config(db)
        subscription = get_subscription_for_workspace(
            db,
            auth_context.workspace_id,
        )
        await run_in_threadpool(reconcile_subscription_if_needed, db, subscription)
        access_state = build_subscription_access_state(subscription)
        plan = normalize_billing_plan(
            subscription.plan if subscription else FREE_PLAN
        )
        plan_definition = get_billing_plan_definition(plan, db)
        billing_pricing = get_billing_pricing(db)
        billing_interval = normalize_billing_interval(
            subscription.billing_interval
            if subscription
            else None
        )
        additional_client_workspaces = int(
            subscription.additional_client_workspaces
            if subscription
            else 0
        )
        client_workspaces_used = count_client_workspaces(
            db,
            auth_context.workspace_id,
        )
        client_workspace_limit = get_client_workspace_limit(
            plan,
            additional_client_workspaces,
        )
        ai_credit_allocations = get_ai_credit_allocations(db)
        monthly_included_ai_credits = int(
            plan_definition["ai_credit_limit"]
        )
        annual_ai_credit_limit = (
            monthly_included_ai_credits
            * ANNUAL_AI_CREDIT_MULTIPLIER
        )
        included_ai_credits = get_billing_period_ai_credit_limit(
            monthly_included_ai_credits,
            billing_interval,
        )
        additional_client_workspace_ai_credits = int(
            ai_credit_allocations[
                "additional_client_workspace"
            ]
        )
        effective_additional_client_workspace_ai_credits = (
            get_billing_period_ai_credit_limit(
                additional_client_workspace_ai_credits,
                billing_interval,
            )
        )
        annual_additional_client_workspace_ai_credits = (
            additional_client_workspace_ai_credits
            * ANNUAL_AI_CREDIT_MULTIPLIER
        )
        ai_credits_used = int(
            subscription.ai_credits_used
            if subscription
            else 0
        )
        additional_ai_credit_packs = int(
            subscription.additional_ai_credit_packs
            if subscription
            else 0
        )
        ai_credit_topup_credits = int(
            subscription.ai_credit_topup_credits
            if subscription
            else 0
        )
        total_ai_credit_limit = (
            included_ai_credits
            + additional_client_workspaces
            * effective_additional_client_workspace_ai_credits
            + additional_ai_credit_packs
            * get_ai_credit_pack_size()
            + max(ai_credit_topup_credits, 0)
        )
        ai_credits_remaining = (
            get_ai_credit_remaining(subscription, db)
            if subscription
            else max(total_ai_credit_limit - ai_credits_used, 0)
        )
        ai_credit_low_balance_threshold = (
            get_ai_credit_low_balance_threshold(total_ai_credit_limit)
        )
        ai_configured = build_ai_status()["configured"]
        purchase_reason = credit_purchase_blocker(
            subscription, config,
            ai_configured=ai_configured, pack_size=get_ai_credit_pack_size(db),
        )
        return BillingStatusResponse(
            configured=billing_enforcement_enabled() and is_billing_configured(),
            billing_enabled=billing_enforcement_enabled(),
            provider=config["provider"],
            workspace_id=auth_context.workspace_id,
            plan=plan,
            status=access_state.status,
            raw_status=access_state.raw_status,
            trial_started=bool(subscription and (
                subscription.current_period_start or subscription.current_period_end
                or subscription.provider_subscription_id
            )),
            subscription_management_required=subscription_requires_management(subscription),
            price_id=subscription.price_id if subscription else None,
            current_period_end=(
                subscription.current_period_end
                if subscription
                else None
            ),
            cancel_at_period_end=bool(
                subscription.cancel_at_period_end
                if subscription
                else False
            ),
            customer_portal_available=bool(
                subscription
                and subscription.provider_customer_id
            ),
            plan_name=plan_definition["name"],
            billing_model=plan_definition["billing_model"],
            billing_interval=billing_interval,
            monthly_price_cents=plan_definition["monthly_price_cents"],
            included_client_workspaces=plan_definition[
                "included_client_workspaces"
            ],
            client_workspace_limit=client_workspace_limit,
            client_workspaces_used=client_workspaces_used,
            additional_client_workspaces=additional_client_workspaces,
            additional_client_workspace_price_cents=(
                billing_pricing[
                    "additional_client_workspace_monthly_price_cents"
                ]
            ),
            additional_client_workspace_annual_price_cents=(
                billing_pricing[
                    "additional_client_workspace_annual_price_cents"
                ]
            ),
            additional_ai_credit_packs=additional_ai_credit_packs,
            ai_credit_pack_size=get_ai_credit_pack_size(db),
            ai_credit_pack_price_cents=billing_pricing[
                "ai_credit_pack_price_cents"
            ],
            ai_credit_topup_price_cents=billing_pricing[
                "ai_credit_topup_price_cents"
            ],
            ai_credit_pack_configured=bool(
                config.get("ai_credit_pack_price_id") and get_ai_credit_pack_size(db) > 0
            ),
            additional_client_workspace_ai_credits=(
                effective_additional_client_workspace_ai_credits
            ),
            annual_additional_client_workspace_ai_credits=(
                annual_additional_client_workspace_ai_credits
            ),
            included_ai_credits=included_ai_credits,
            annual_ai_credit_limit=annual_ai_credit_limit,
            ai_credits_used=ai_credits_used,
            ai_credits_remaining=ai_credits_remaining,
            ai_credit_pool_workspace_id=resolve_billing_workspace_id(
                auth_context.workspace_id,
            ),
            ai_credit_topup_credits=max(ai_credit_topup_credits, 0),
            ai_credit_low_balance=(
                bool(ai_credit_low_balance_threshold)
                and ai_credits_remaining <= ai_credit_low_balance_threshold
            ),
            ai_credit_low_balance_threshold=ai_credit_low_balance_threshold,
            ai_credit_topup_configured=bool(
                config.get("ai_credit_topup_price_id")
            ),
            ai_configured=ai_configured,
            ai_credit_purchase_allowed=not purchase_reason,
            ai_credit_purchase_reason=purchase_reason,
            access_status=access_state.status,
            access_allowed=access_state.access_allowed,
            requires_billing_action=access_state.requires_billing_action,
            grace_period_end=access_state.grace_period_end,
            days_remaining=access_state.days_remaining,
            access_reason=access_state.reason,
            plan_options=get_billing_plan_options(db),
        )
    except BillingProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail="Subscription status could not be verified. Please retry shortly.") from error
    finally:
        db.close()


@router.post(
    "/ai-credits/topup",
    response_model=AICreditTopupResponse,
)
async def create_ai_credit_topup(
    payload: AICreditTopupRequest,
    request: Request,
):
    auth_context = require_billing_owner(request)
    require_payments_enabled()
    if payload.credit_packs < 1:
        raise HTTPException(
            status_code=400,
            detail="Purchase at least one AI credit pack",
        )

    db = SessionLocal()
    try:
        subscription = get_subscription_for_workspace(
            db,
            auth_context.workspace_id,
        )
        config = get_billing_config(db)
        ai_configured = build_ai_status()["configured"]
        if ai_configured and config.get("secret_key") and config.get("ai_credit_topup_price_id") and subscription and subscription.provider_subscription_id:
            try:
                remote = await run_in_threadpool(retrieve_stripe_subscription, subscription.provider_subscription_id)
                apply_stripe_billing_event(db, "customer.subscription.updated", remote)
                db.commit()
            except BillingProviderUnavailable as error:
                raise HTTPException(status_code=503, detail=str(error)) from error
        reason = credit_purchase_blocker(
            subscription, config,
            ai_configured=ai_configured, pack_size=get_ai_credit_pack_size(db),
        )
        if reason:
            raise HTTPException(status_code=409, detail=reason)

        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id
                == resolve_billing_workspace_id(auth_context.workspace_id),
            )
            .first()
        )
        try:
            result = await run_in_threadpool(
                create_ai_credit_topup_session,
                workspace_id=resolve_billing_workspace_id(
                    auth_context.workspace_id,
                ),
                owner_user_id=auth_context.user_id,
                owner_email=auth_context.email,
                organization_name=(
                    organization.name if organization else None
                ),
                customer_id=subscription.provider_customer_id,
                credit_packs=payload.credit_packs,
                expected_pack_size=payload.expected_pack_size,
                expected_price_cents=payload.expected_price_cents,
            )
        except BillingQuoteChanged as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except BillingProviderUnavailable as error:
            raise HTTPException(
                status_code=503,
                detail=str(error),
            ) from error
        return AICreditTopupResponse(**result)
    finally:
        db.close()


@router.post("/ai-credits/topup/confirm", response_model=AICreditTopupConfirmationResponse)
async def confirm_ai_credit_topup(
    payload: BillingCheckoutConfirmationRequest,
    request: Request,
):
    auth_context = require_billing_owner(request)
    require_payments_enabled()
    session_id = payload.session_id.strip()
    if not session_id.startswith("cs_") or len(session_id) > 255:
        raise HTTPException(status_code=400, detail="Invalid checkout session")
    db = SessionLocal()
    try:
        checkout = await run_in_threadpool(retrieve_stripe_checkout, session_id)
        metadata = checkout.get("metadata") or {}
        if (
            checkout.get("id") != session_id
            or resolve_billing_workspace_id(metadata.get("workspace_id")) != auth_context.workspace_id
            or checkout.get("mode") != "payment"
            or metadata.get("purchase_type") != "ai_credit_topup"
        ):
            raise HTTPException(status_code=403, detail="This AI credit checkout does not belong to this workspace")
        purchase = fulfill_credit_purchase(db, checkout)
        db.commit()
        if purchase:
            subscription = get_subscription_for_workspace(db, auth_context.workspace_id)
            return AICreditTopupConfirmationResponse(
                status="confirmed",
                credits=purchase.credits,
                credits_remaining=get_ai_credit_remaining(subscription, db),
                purchased_credits_remaining=max(0, int(subscription.ai_credit_topup_credits or 0)),
            )
        intent = checkout.get("payment_intent")
        failed = isinstance(intent, dict) and intent.get("status") in {
            "canceled", "requires_payment_method",
        }
        status = (
            "expired" if checkout.get("status") == "expired"
            else "failed" if failed and checkout.get("status") == "complete"
            else "pending"
        )
        return AICreditTopupConfirmationResponse(status=status)
    except BillingProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        db.close()


@router.post(
    "/lifecycle/send-due",
    response_model=BillingLifecycleSchedulerResponse,
)
async def send_due_billing_lifecycle_notifications_route(
    request: Request,
):
    require_billing_scheduler_secret(request)
    return await run_in_threadpool(_send_due_billing_notifications)


def _send_due_billing_notifications():
    db = SessionLocal()
    try:
        return send_due_billing_lifecycle_notifications(db)
    finally:
        db.close()


@router.post(
    "/checkout",
    response_model=BillingCheckoutResponse,
)
async def create_billing_checkout(
    payload: BillingCheckoutRequest,
    request: Request,
):
    auth_context = require_billing_owner(request)
    require_payments_enabled()
    if payload.billing_interval not in {"month", "year"}:
        raise HTTPException(status_code=400, detail="Choose monthly or annual billing")
    plan = normalize_billing_plan(payload.plan)
    billing_interval = normalize_billing_interval(
        payload.billing_interval
    )
    if plan not in PUBLIC_BILLING_PLANS:
        raise HTTPException(
            status_code=400,
            detail="Choose Professional or Agency",
        )
    if payload.additional_client_workspaces < 0:
        raise HTTPException(
            status_code=400,
            detail="Additional client workspaces cannot be negative",
        )
    if payload.additional_client_workspaces > 1000:
        raise HTTPException(
            status_code=400,
            detail="Additional client workspaces cannot exceed 1000",
        )
    if (
        plan != AGENCY_PLAN
        and payload.additional_client_workspaces
    ):
        raise HTTPException(
            status_code=400,
            detail="Additional client workspaces are available only on Agency plans",
        )
    if payload.additional_ai_credit_packs < 0:
        raise HTTPException(
            status_code=400,
            detail="Additional AI credit packs cannot be negative",
        )
    if payload.additional_ai_credit_packs and not build_ai_status()["configured"]:
        raise HTTPException(status_code=409, detail="AI is not available yet. Credit purchases are disabled.")
    if payload.additional_ai_credit_packs and get_ai_credit_pack_size() < 1:
        raise HTTPException(status_code=409, detail="AI credit payments are not available. Please contact support.")
    if (
        billing_interval == "year"
        and payload.additional_ai_credit_packs
    ):
        raise HTTPException(
            status_code=400,
            detail="Additional AI credit packs require monthly billing",
        )
    db = SessionLocal()
    try:
        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.workspace_id
                == auth_context.workspace_id,
            )
            .first()
        )
        if subscription and subscription.provider_subscription_id:
            try:
                remote = await run_in_threadpool(retrieve_stripe_subscription, subscription.provider_subscription_id)
                apply_stripe_billing_event(db, "customer.subscription.updated", remote)
                db.commit()
            except BillingProviderUnavailable as error:
                raise HTTPException(status_code=503, detail=str(error)) from error
        if subscription_requires_management(subscription):
            raise HTTPException(
                status_code=409,
                detail="This workspace already has a subscription. Manage billing to update or recover payment.",
            )

        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id
                == auth_context.workspace_id,
            )
            .first()
        )
        trial_already_started = bool(
            subscription
            and (
                subscription.current_period_start
                or subscription.current_period_end
                or subscription.provider_subscription_id
            )
        )
        try:
            result = create_checkout_session(
                workspace_id=auth_context.workspace_id,
                owner_user_id=auth_context.user_id,
                owner_email=auth_context.email,
                organization_name=(
                    organization.name if organization else None
                ),
                customer_id=(
                    subscription.provider_customer_id
                    if subscription
                    else None
                ),
                plan=plan,
                billing_interval=billing_interval,
                additional_client_workspaces=(
                    payload.additional_client_workspaces
                ),
                additional_ai_credit_packs=(
                    payload.additional_ai_credit_packs
                ),
                trial_period_days=(
                    None
                    if trial_already_started
                    else TRIAL_PERIOD_DAYS
                ),
                trial_end=(
                    int(subscription.current_period_end.replace(tzinfo=UTC).timestamp())
                    if subscription and subscription.status == "trialing"
                    and subscription.current_period_end
                    and subscription.current_period_end > utc_now()
                    else None
                ),
            )
        except BillingProviderUnavailable as error:
            raise HTTPException(
                status_code=503,
                detail=str(error),
            ) from error
        return BillingCheckoutResponse(
            checkout_url=result["checkout_url"],
            session_id=result["session_id"],
        )
    finally:
        db.close()


@router.post(
    "/portal",
    response_model=BillingPortalResponse,
)
async def create_billing_portal(
    request: Request,
):
    auth_context = require_billing_owner(request)
    require_payments_enabled()
    db = SessionLocal()
    try:
        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.workspace_id
                == auth_context.workspace_id,
            )
            .first()
        )
        customer_id = (
            subscription.provider_customer_id
            if subscription
            else None
        )
        if not customer_id:
            raise HTTPException(
                status_code=404,
                detail="No billing customer is associated with this workspace",
            )
        try:
            portal_url = create_customer_portal_session(
                customer_id=customer_id,
                workspace_id=auth_context.workspace_id,
            )
        except BillingProviderUnavailable as error:
            raise HTTPException(
                status_code=503,
                detail=str(error),
            ) from error
        return BillingPortalResponse(
            portal_url=portal_url,
        )
    finally:
        db.close()


@router.post("/refresh", response_model=BillingStatusResponse)
async def refresh_billing_subscription(request: Request):
    auth_context = require_billing_owner(request)
    require_payments_enabled()
    db = SessionLocal()
    try:
        subscription = get_subscription_for_workspace(db, auth_context.workspace_id)
        if subscription and subscription.provider_subscription_id:
            remote = await run_in_threadpool(retrieve_stripe_subscription, subscription.provider_subscription_id)
            apply_stripe_billing_event(db, "customer.subscription.updated", remote)
            db.commit()
    except BillingProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        db.close()
    return await get_billing_status(request)


@router.post("/checkout/confirm", response_model=BillingCheckoutConfirmationResponse)
async def confirm_billing_checkout(payload: BillingCheckoutConfirmationRequest, request: Request):
    auth_context = require_billing_owner(request)
    require_payments_enabled()
    session_id = payload.session_id.strip()
    if not session_id.startswith("cs_") or len(session_id) > 255:
        raise HTTPException(status_code=400, detail="Invalid checkout session")
    db = SessionLocal()
    try:
        checkout = retrieve_stripe_checkout(session_id)
        metadata = checkout.get("metadata") or {}
        if metadata.get("workspace_id") != auth_context.workspace_id or checkout.get("mode") != "subscription":
            raise HTTPException(status_code=403, detail="This checkout does not belong to this workspace")
        if checkout.get("status") == "expired":
            return BillingCheckoutConfirmationResponse(status="expired")
        if checkout.get("status") != "complete" or checkout.get("payment_status") not in {"paid", "no_payment_required"}:
            return BillingCheckoutConfirmationResponse(status="pending")
        apply_stripe_billing_event(db, "checkout.session.completed", checkout)
        db.commit()
        subscription = get_subscription_for_workspace(db, auth_context.workspace_id)
        state = build_subscription_access_state(subscription)
        matches = subscription and subscription.provider_subscription_id == checkout.get("subscription")
        confirmed = bool(matches and state.access_allowed and state.raw_status in {"active", "trialing"})
        needs_attention = bool(matches and state.raw_status in {
            "incomplete", "past_due", "unpaid", "paused", "canceled", "incomplete_expired",
        })
        return BillingCheckoutConfirmationResponse(
            status="confirmed" if confirmed else "requires_action" if needs_attention else "pending",
            access_allowed=confirmed,
        )
    except BillingProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        db.close()


@router.post("/webhook")
async def billing_webhook(
    request: Request,
):
    payload = await request.body()
    try:
        event = verify_stripe_webhook(
            payload,
            request.headers.get("Stripe-Signature"),
        )
    except BillingWebhookSignatureError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    event_id = str(event.get("id") or "").strip()
    event_type = str(event.get("type") or "").strip()
    if not event_id or not event_type:
        raise HTTPException(
            status_code=400,
            detail="Stripe webhook event is missing id or type",
        )

    db = SessionLocal()
    try:
        existing_event = (
            db.query(BillingWebhookEvent)
            .filter(
                BillingWebhookEvent.provider_event_id == event_id,
            )
            .first()
        )
        if existing_event:
            return {
                "received": True,
                "duplicate": True,
            }

        db.add(
            BillingWebhookEvent(
                provider=get_billing_config()["provider"],
                provider_event_id=event_id,
                event_type=event_type,
            )
        )
        db.flush()
        event_object = (
            event.get("data", {}).get("object", {})
            if isinstance(event.get("data"), dict)
            else {}
        )
        # Stripe may deliver old events after new ones; use its current state.
        if event_type.startswith("customer.subscription.") and event_object.get("id"):
            event_object = await run_in_threadpool(retrieve_stripe_subscription, event_object["id"])
            event_type = "customer.subscription.updated"
        elif event_type in {
            "invoice.payment_failed", "invoice.paid", "invoice.payment_action_required",
            "invoice.finalization_failed", "invoice.updated",
        }:
            subscription_id = event_object.get("subscription") or (
                ((event_object.get("parent") or {}).get("subscription_details") or {}).get("subscription")
            )
            if subscription_id:
                event_object = await run_in_threadpool(retrieve_stripe_subscription, subscription_id)
                event_type = "customer.subscription.updated"
        apply_stripe_billing_event(db, event_type, event_object)
        db.commit()
        return {
            "received": True,
            "duplicate": False,
        }
    except BillingProviderUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(error)) from error
    except IntegrityError:
        db.rollback()
        return {
            "received": True,
            "duplicate": True,
        }
    finally:
        db.close()


def apply_stripe_billing_event(
    db,
    event_type: str,
    event_object: dict,
):
    if event_type in {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    }:
        metadata = event_object.get("metadata") or {}
        if metadata.get("purchase_type") == "ai_credit_topup":
            session_id = str(event_object.get("id") or "")
            if not session_id.startswith("cs_"):
                raise BillingProviderUnavailable("Invalid AI credit checkout session")
            checkout = retrieve_stripe_checkout(session_id)
            if checkout.get("id") != session_id:
                raise BillingProviderUnavailable("AI credit checkout session does not match")
            fulfill_credit_purchase(db, checkout)
            return

        workspace_id = str(
            metadata.get("workspace_id") or ""
        ).strip()
        if not workspace_id:
            return
        subscription_id = str(
            event_object.get("subscription") or ""
        ).strip() or None
        if not subscription_id or event_object.get("payment_status") not in {"paid", "no_payment_required"}:
            return
        customer_id = str(
            event_object.get("customer") or ""
        ).strip() or None
        remote = retrieve_stripe_subscription(subscription_id)
        if (remote.get("metadata") or {}).get("workspace_id") != workspace_id or remote.get("customer") != customer_id:
            raise BillingProviderUnavailable("Stripe subscription does not match checkout")
        apply_stripe_billing_event(db, "customer.subscription.updated", remote)
        return

    if event_type in {
        "invoice.payment_failed", "invoice.paid", "invoice.payment_action_required",
        "invoice.finalization_failed", "invoice.updated",
    }:
        subscription_id = event_object.get("subscription") or (
            ((event_object.get("parent") or {}).get("subscription_details") or {}).get("subscription")
        )
        if subscription_id:
            remote = retrieve_stripe_subscription(subscription_id)
            apply_stripe_billing_event(db, "customer.subscription.updated", remote)
        return

    if not event_type.startswith("customer.subscription."):
        return

    if db.get_bind().dialect.name == "sqlite":
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")

    metadata = event_object.get("metadata") or {}
    subscription_id = str(
        event_object.get("id") or ""
    ).strip() or None
    customer_id = str(
        event_object.get("customer") or ""
    ).strip() or None
    workspace_id = str(
        metadata.get("workspace_id") or ""
    ).strip() or None
    subscription = None
    if subscription_id:
        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.provider_subscription_id
                == subscription_id,
            )
            .first()
        )
    if not subscription and customer_id:
        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.provider_customer_id
                == customer_id,
            )
            .populate_existing()
            .with_for_update()
            .first()
        )
    if not subscription and workspace_id:
        subscription = get_or_create_subscription(
            db,
            workspace_id,
        )
    if not subscription:
        return

    subscription = db.query(WorkspaceSubscription).filter(
        WorkspaceSubscription.id == subscription.id,
    ).populate_existing().with_for_update().one()

    if (
        subscription.provider_subscription_id
        and subscription.provider_subscription_id != subscription_id
        and (
            subscription_requires_management(subscription)
            or event_object.get("status") in {"canceled", "incomplete_expired"}
        )
    ):
        return

    items = event_object.get("items") or {}
    item_data = (items.get("data") or []) if isinstance(items, dict) else []
    configured = get_billing_config(db)
    addon_price_ids = {
        value
        for value in (
            configured.get("client_workspace_addon_price_id"),
            configured.get("client_workspace_addon_annual_price_id"),
        )
        if value
    }
    supplementary_price_ids = addon_price_ids | {configured.get("ai_credit_pack_price_id")}
    base_item = next(
        (
            item
            for item in item_data
            if isinstance(item, dict)
            and str(
                (item.get("price") or {}).get("id") or ""
            ).strip()
            not in supplementary_price_ids
        ),
        {},
    )
    first_item = base_item or (item_data[0] if item_data else {})
    price = first_item.get("price") or {}
    previous_credit_limit = get_recurring_ai_credit_limit(subscription, db)
    subscription.provider_customer_id = customer_id
    subscription.provider_subscription_id = subscription_id
    subscription.price_id = str(price.get("id") or "").strip() or None
    subscription.billing_interval = normalize_billing_interval(
        (price.get("recurring") or {}).get("interval")
        or metadata.get("billing_interval")
    )
    configured_plan = next(
        (plan for plan in (PROFESSIONAL_PLAN, AGENCY_PLAN)
         if subscription.price_id and subscription.price_id in {
             configured.get(f"{plan}_price_id"), configured.get(f"{plan}_annual_price_id"),
         }),
        None,
    )
    subscription.plan = normalize_billing_plan(
        configured_plan or metadata.get("plan") or subscription.plan or PROFESSIONAL_PLAN
    )
    addon_item = next(
        (
            item
            for item in item_data
            if isinstance(item, dict)
            and str(
                (item.get("price") or {}).get("id") or ""
            ).strip()
            in addon_price_ids
        ),
        None,
    )
    if addon_item:
        subscription.provider_addon_subscription_item_id = str(
            addon_item.get("id") or ""
        ).strip() or None
        subscription.additional_client_workspaces = parse_nonnegative_int(
            addon_item.get("quantity")
        )
    else:
        subscription.provider_addon_subscription_item_id = None
        subscription.additional_client_workspaces = parse_nonnegative_int(
            metadata.get("additional_client_workspaces")
        )
    subscription.additional_ai_credit_packs = parse_nonnegative_int(
        metadata.get("additional_ai_credit_packs")
    )
    apply_renewal_period(
        subscription, event_object, first_item,
        deleted=event_type == "customer.subscription.deleted",
        previous_credit_limit=previous_credit_limit,
    )


def get_or_create_subscription(
    db,
    workspace_id: str,
) -> WorkspaceSubscription:
    subscription = (
        db.query(WorkspaceSubscription)
        .filter(
            WorkspaceSubscription.workspace_id == workspace_id,
        )
        .first()
    )
    if subscription:
        return subscription
    subscription = WorkspaceSubscription(
        workspace_id=workspace_id,
        provider=get_billing_config()["provider"],
        plan=FREE_PLAN,
        status="inactive",
    )
    db.add(subscription)
    db.flush()
    return subscription
