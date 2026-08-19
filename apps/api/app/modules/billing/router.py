from __future__ import annotations

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal
from app.db.models import BillingWebhookEvent
from app.db.models import Organization
from app.db.models import WorkspaceSubscription
from app.modules.auth_context import get_auth_context
from app.modules.billing.schemas import BillingCheckoutResponse
from app.modules.billing.schemas import BillingCheckoutRequest
from app.modules.billing.schemas import BillingPortalResponse
from app.modules.billing.schemas import BillingStatusResponse
from app.modules.billing.schemas import BillingAccessResponse
from app.modules.billing.schemas import BillingLifecycleSchedulerResponse
from app.modules.billing.lifecycle import (
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
    BillingWebhookSignatureError,
    create_checkout_session,
    create_customer_portal_session,
    get_billing_config,
    is_billing_configured,
    FREE_PLAN,
    PROFESSIONAL_PLAN,
    ADDITIONAL_CLIENT_WORKSPACE_PRICE_CENTS,
    ADDITIONAL_CLIENT_WORKSPACE_ANNUAL_PRICE_CENTS,
    get_ai_credit_allocations,
    get_ai_credit_pack_size,
    normalize_billing_plan,
    PUBLIC_BILLING_PLANS,
    get_billing_plan_definition,
    get_billing_plan_options,
    get_client_workspace_limit,
    normalize_billing_interval,
    timestamp_to_datetime,
    verify_stripe_webhook,
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
        state = build_subscription_access_state(subscription)
        return BillingAccessResponse(
            workspace_id=auth_context.workspace_id,
            billing_workspace_id=resolve_billing_workspace_id(
                auth_context.workspace_id,
            ),
            plan=state.plan,
            status=state.status,
            access_allowed=state.access_allowed,
            requires_billing_action=state.requires_billing_action,
            current_period_end=state.current_period_end,
            grace_period_end=state.grace_period_end,
            days_remaining=state.days_remaining,
            reason=state.reason,
        )
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
    config = get_billing_config()
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
        access_state = build_subscription_access_state(subscription)
        plan = normalize_billing_plan(
            subscription.plan if subscription else FREE_PLAN
        )
        plan_definition = get_billing_plan_definition(plan)
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
        ai_credit_allocations = get_ai_credit_allocations()
        included_ai_credits = int(
            ai_credit_allocations["agency_client"]
            if ":client:" in auth_context.workspace_id
            else plan_definition["ai_credit_limit"]
        )
        additional_client_workspace_ai_credits = int(
            ai_credit_allocations[
                "additional_client_workspace"
            ]
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
        total_ai_credit_limit = (
            included_ai_credits
            + additional_client_workspaces
            * additional_client_workspace_ai_credits
            + additional_ai_credit_packs
            * get_ai_credit_pack_size()
        )
        return BillingStatusResponse(
            configured=is_billing_configured(),
            provider=config["provider"],
            workspace_id=auth_context.workspace_id,
            plan=plan,
            status=access_state.status,
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
            monthly_price_cents=plan_definition["monthly_price_cents"],
            included_client_workspaces=plan_definition[
                "included_client_workspaces"
            ],
            client_workspace_limit=client_workspace_limit,
            client_workspaces_used=client_workspaces_used,
            additional_client_workspaces=additional_client_workspaces,
            additional_client_workspace_price_cents=(
                ADDITIONAL_CLIENT_WORKSPACE_PRICE_CENTS
            ),
            additional_client_workspace_annual_price_cents=(
                ADDITIONAL_CLIENT_WORKSPACE_ANNUAL_PRICE_CENTS
            ),
            additional_ai_credit_packs=additional_ai_credit_packs,
            ai_credit_pack_size=get_ai_credit_pack_size(),
            ai_credit_pack_configured=bool(
                config.get("ai_credit_pack_price_id")
            ),
            additional_client_workspace_ai_credits=(
                additional_client_workspace_ai_credits
            ),
            included_ai_credits=included_ai_credits,
            ai_credits_used=ai_credits_used,
            ai_credits_remaining=max(
                total_ai_credit_limit - ai_credits_used,
                0,
            ),
            access_status=access_state.status,
            access_allowed=access_state.access_allowed,
            requires_billing_action=access_state.requires_billing_action,
            grace_period_end=access_state.grace_period_end,
            days_remaining=access_state.days_remaining,
            access_reason=access_state.reason,
            plan_options=get_billing_plan_options(),
        )
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
    if payload.additional_ai_credit_packs < 0:
        raise HTTPException(
            status_code=400,
            detail="Additional AI credit packs cannot be negative",
        )
    if payload.additional_ai_credit_packs > 100:
        raise HTTPException(
            status_code=400,
            detail="Additional AI credit packs cannot exceed 100",
        )
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
        access_state = build_subscription_access_state(subscription)
        if (
            subscription
            and subscription.plan != FREE_PLAN
            and access_state.access_allowed
        ):
            raise HTTPException(
                status_code=409,
                detail="This workspace already has a billing subscription",
            )

        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id
                == auth_context.workspace_id,
            )
            .first()
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
        apply_stripe_billing_event(
            db,
            event_type,
            event_object,
        )
        db.commit()
        return {
            "received": True,
            "duplicate": False,
        }
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
    if event_type == "checkout.session.completed":
        metadata = event_object.get("metadata") or {}
        workspace_id = str(
            metadata.get("workspace_id") or ""
        ).strip()
        if not workspace_id:
            return
        subscription_id = str(
            event_object.get("subscription") or ""
        ).strip() or None
        customer_id = str(
            event_object.get("customer") or ""
        ).strip() or None
        subscription = get_or_create_subscription(
            db,
            workspace_id,
        )
        subscription.provider_customer_id = customer_id
        subscription.provider_subscription_id = subscription_id
        subscription.plan = normalize_billing_plan(
            metadata.get("plan") or PROFESSIONAL_PLAN
        )
        subscription.billing_interval = normalize_billing_interval(
            metadata.get("billing_interval")
        )
        subscription.additional_client_workspaces = parse_nonnegative_int(
            metadata.get("additional_client_workspaces")
        )
        subscription.additional_ai_credit_packs = parse_nonnegative_int(
            metadata.get("additional_ai_credit_packs")
        )
        subscription.status = "checkout_completed"
        subscription.current_period_start = None
        subscription.current_period_end = None
        subscription.lifecycle_notice_key = None
        subscription.lifecycle_notice_at = None
        subscription.data_purged_at = None
        subscription.canceled_at = None
        return

    if event_type in {
        "invoice.payment_failed",
        "invoice.paid",
    }:
        subscription_id = str(
            event_object.get("subscription") or ""
        ).strip()
        if not subscription_id:
            return
        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.provider_subscription_id
                == subscription_id,
            )
            .first()
        )
        if not subscription:
            return
        if event_type == "invoice.payment_failed":
            subscription.status = "past_due"
        elif subscription.status == "past_due":
            subscription.status = "active"
            subscription.lifecycle_notice_key = None
            subscription.lifecycle_notice_at = None
            subscription.data_purged_at = None
            subscription.canceled_at = None
        return

    if not event_type.startswith("customer.subscription."):
        return

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
            .first()
        )
    if not subscription and workspace_id:
        subscription = get_or_create_subscription(
            db,
            workspace_id,
        )
    if not subscription:
        return

    items = event_object.get("items") or {}
    item_data = items.get("data") if isinstance(items, dict) else []
    configured = get_billing_config()
    addon_price_ids = {
        value
        for value in (
            configured.get("client_workspace_addon_price_id"),
            configured.get("client_workspace_addon_annual_price_id"),
        )
        if value
    }
    base_item = next(
        (
            item
            for item in item_data
            if isinstance(item, dict)
            and str(
                (item.get("price") or {}).get("id") or ""
            ).strip()
            not in addon_price_ids
        ),
        {},
    )
    first_item = base_item or (item_data[0] if item_data else {})
    price = first_item.get("price") or {}
    subscription.provider_customer_id = customer_id
    subscription.provider_subscription_id = subscription_id
    subscription.price_id = str(price.get("id") or "").strip() or None
    subscription.billing_interval = normalize_billing_interval(
        metadata.get("billing_interval")
        or (price.get("recurring") or {}).get("interval")
    )
    subscription.plan = normalize_billing_plan(
        metadata.get("plan") or subscription.plan or PROFESSIONAL_PLAN
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
    incoming_period_start = timestamp_to_datetime(
        event_object.get("current_period_start")
    )
    if (
        incoming_period_start
        and subscription.current_period_start
        and incoming_period_start != subscription.current_period_start
    ):
        subscription.ai_credits_used = 0
        subscription.lifecycle_notice_key = None
        subscription.lifecycle_notice_at = None

    incoming_period_end = timestamp_to_datetime(
        event_object.get("current_period_end")
    )
    if incoming_period_end != subscription.current_period_end:
        subscription.data_purged_at = None

    subscription.current_period_start = incoming_period_start
    subscription.status = (
        "canceled"
        if event_type == "customer.subscription.deleted"
        else str(event_object.get("status") or "unknown")
    )
    subscription.current_period_end = incoming_period_end
    subscription.cancel_at_period_end = int(
        bool(event_object.get("cancel_at_period_end"))
    )
    is_canceled = (
        event_type == "customer.subscription.deleted"
        or subscription.status == "canceled"
    )
    incoming_canceled_at = (
        timestamp_to_datetime(
            event_object.get("canceled_at")
            or event_object.get("ended_at")
        )
        if is_canceled
        else None
    )
    if is_canceled and incoming_canceled_at is None:
        incoming_canceled_at = subscription.canceled_at or utc_now()
    if incoming_canceled_at != subscription.canceled_at:
        subscription.data_purged_at = None
    subscription.canceled_at = incoming_canceled_at


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
