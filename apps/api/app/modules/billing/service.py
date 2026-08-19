from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from datetime import UTC, datetime
from email.utils import parseaddr
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.db.database import SessionLocal
from app.db.models import PlatformBillingSettings
from app.configuration import get_runtime_configuration


DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300
FREE_PLAN = "free"
PROFESSIONAL_PLAN = "professional"
AGENCY_PLAN = "agency"
LEGACY_PLAN_ALIASES = {
    "agency_starter": AGENCY_PLAN,
    "agency_growth": AGENCY_PLAN,
    "agency_pro": AGENCY_PLAN,
    "enterprise": AGENCY_PLAN,
}
BILLING_INTERVAL_MONTH = "month"
BILLING_INTERVAL_YEAR = "year"
TRIAL_PERIOD_DAYS = 30
ANNUAL_TRIAL_PERIOD_DAYS = 60
ADDITIONAL_CLIENT_WORKSPACE_PRICE_CENTS = 2000
ADDITIONAL_CLIENT_WORKSPACE_ANNUAL_PRICE_CENTS = 20000
AI_CREDIT_PACK_SIZE = 5000
DEFAULT_ADDITIONAL_CLIENT_WORKSPACE_AI_CREDITS = 2500
DEFAULT_AGENCY_CLIENT_AI_CREDITS = 2500
AI_CREDIT_ALLOCATION_COLUMNS = {
    FREE_PLAN: "free_ai_credits",
    PROFESSIONAL_PLAN: "professional_ai_credits",
    AGENCY_PLAN: "agency_ai_credits",
    "agency_client": "agency_client_ai_credits",
    "additional_client_workspace": "additional_client_workspace_ai_credits",
}
PUBLIC_BILLING_PLANS = (
    PROFESSIONAL_PLAN,
    AGENCY_PLAN,
)
ACTIVE_SUBSCRIPTION_STATUSES = {
    "active",
    "trialing",
    "past_due",
    "checkout_completed",
}

BILLING_PLAN_DEFINITIONS = {
    FREE_PLAN: {
        "name": "Free",
        "billing_model": "direct",
        "monthly_price_cents": 0,
        "included_client_workspaces": 1,
        "ai_credit_limit": 1000,
        "price_config_key": "price_id",
    },
    PROFESSIONAL_PLAN: {
        "name": "Professional",
        "billing_model": "direct",
        "monthly_price_cents": 7900,
        "annual_price_cents": 79000,
        "included_client_workspaces": 1,
        "ai_credit_limit": 5000,
        "price_config_key": "professional_price_id",
        "annual_price_config_key": "professional_annual_price_id",
    },
    AGENCY_PLAN: {
        "name": "Agency",
        "billing_model": "agency",
        "monthly_price_cents": 19900,
        "annual_price_cents": 199000,
        "included_client_workspaces": 10,
        "ai_credit_limit": 25000,
        "price_config_key": "agency_price_id",
        "annual_price_config_key": "agency_annual_price_id",
    },
}


class BillingProviderUnavailable(RuntimeError):
    pass


class BillingWebhookSignatureError(ValueError):
    pass


def clean_env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def clean_nonnegative_int(
    name: str,
    default: int,
) -> int:
    try:
        return max(
            int(clean_env(name, str(default))),
            0,
        )
    except (TypeError, ValueError):
        return default


def get_ai_credit_allocations() -> dict[str, int]:
    """Read persisted allocations, falling back to environment defaults."""
    allocations = {
        FREE_PLAN: clean_nonnegative_int(
            "DECISIONATE_FREE_AI_CREDITS",
            1000,
        ),
        PROFESSIONAL_PLAN: clean_nonnegative_int(
            "DECISIONATE_PROFESSIONAL_AI_CREDITS",
            5000,
        ),
        AGENCY_PLAN: clean_nonnegative_int(
            "DECISIONATE_AGENCY_AI_CREDITS",
            25000,
        ),
        "agency_client": clean_nonnegative_int(
            "DECISIONATE_AGENCY_CLIENT_AI_CREDITS",
            DEFAULT_AGENCY_CLIENT_AI_CREDITS,
        ),
        "additional_client_workspace": clean_nonnegative_int(
            "DECISIONATE_ADDITIONAL_CLIENT_WORKSPACE_AI_CREDITS",
            DEFAULT_ADDITIONAL_CLIENT_WORKSPACE_AI_CREDITS,
        ),
    }

    db = SessionLocal()
    try:
        settings = (
            db.query(PlatformBillingSettings)
            .filter(PlatformBillingSettings.id == 1)
            .first()
        )
        if settings:
            for plan, column_name in AI_CREDIT_ALLOCATION_COLUMNS.items():
                value = getattr(settings, column_name, None)
                if value is not None:
                    allocations[plan] = max(int(value), 0)
    except Exception:
        pass
    finally:
        db.close()

    return allocations


def get_ai_credit_pack_size() -> int:
    pack_size = clean_nonnegative_int(
        "DECISIONATE_AI_CREDIT_PACK_SIZE",
        AI_CREDIT_PACK_SIZE,
    )

    db = SessionLocal()
    try:
        settings = (
            db.query(PlatformBillingSettings)
            .filter(PlatformBillingSettings.id == 1)
            .first()
        )
        if settings and settings.ai_credit_pack_size is not None:
            return max(int(settings.ai_credit_pack_size), 0)
    except Exception:
        pass
    finally:
        db.close()

    return pack_size


def get_billing_config() -> dict[str, str]:
    return {
        "provider": clean_env("BILLING_PROVIDER").lower(),
        "secret_key": clean_env("STRIPE_SECRET_KEY"),
        "professional_price_id": clean_env(
            "STRIPE_PROFESSIONAL_PRICE_ID",
            clean_env("STRIPE_PRICE_ID"),
        ),
        "professional_annual_price_id": clean_env(
            "STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID"
        ),
        "agency_price_id": clean_env(
            "STRIPE_AGENCY_PRICE_ID",
            clean_env("STRIPE_AGENCY_STARTER_PRICE_ID"),
        ),
        "agency_annual_price_id": clean_env(
            "STRIPE_AGENCY_ANNUAL_PRICE_ID"
        ),
        "client_workspace_addon_price_id": clean_env(
            "STRIPE_CLIENT_WORKSPACE_ADDON_PRICE_ID"
        ),
        "client_workspace_addon_annual_price_id": clean_env(
            "STRIPE_CLIENT_WORKSPACE_ADDON_ANNUAL_PRICE_ID"
        ),
        "ai_credit_pack_price_id": clean_env(
            "STRIPE_AI_CREDIT_PACK_PRICE_ID"
        ),
        "webhook_secret": clean_env("STRIPE_WEBHOOK_SECRET"),
        "web_app_url": clean_env(
            "DECISIONATE_WEB_APP_URL",
            get_runtime_configuration().web_url,
        ).rstrip("/"),
    }


def is_billing_configured() -> bool:
    config = get_billing_config()
    return bool(
        config["provider"] == "stripe"
        and config["secret_key"]
        and any(
            config.get(price_key)
            for price_key in (
                "professional_price_id",
                "professional_annual_price_id",
                "agency_price_id",
                "agency_annual_price_id",
            )
        )
    )


def get_billing_plan_definition(plan: str | None) -> dict:
    normalized_plan = normalize_billing_plan(plan)
    definition = dict(
        BILLING_PLAN_DEFINITIONS[normalized_plan]
    )
    definition["ai_credit_limit"] = get_ai_credit_allocations().get(
        normalized_plan,
        definition["ai_credit_limit"],
    )
    return definition


def get_billing_plan_options() -> list[dict]:
    config = get_billing_config()
    options = []
    for plan in PUBLIC_BILLING_PLANS:
        definition = BILLING_PLAN_DEFINITIONS[plan]
        if plan == FREE_PLAN:
            continue
        price_key = definition["price_config_key"]
        options.append({
            "plan": plan,
            **get_billing_plan_definition(plan),
            "configured": bool(
                config.get(price_key)
                or config.get(
                    definition["annual_price_config_key"]
                )
            ),
            "monthly_configured": bool(config.get(price_key)),
            "annual_configured": bool(
                config.get(definition["annual_price_config_key"])
            ),
        })
    return options


def get_client_workspace_limit(
    plan: str | None,
    additional_client_workspaces: int = 0,
) -> int | None:
    included = get_billing_plan_definition(plan)[
        "included_client_workspaces"
    ]
    if included is None:
        return None
    return int(included) + max(int(additional_client_workspaces or 0), 0)


def is_agency_plan(plan: str | None) -> bool:
    return get_billing_plan_definition(plan)["billing_model"] == "agency"


def is_subscription_active(status: str | None) -> bool:
    return str(status or "").strip().lower() in ACTIVE_SUBSCRIPTION_STATUSES


def validate_email(value: str | None) -> str | None:
    clean_value = str(value or "").strip()
    if not clean_value:
        return None

    _name, address = parseaddr(clean_value)
    if "@" not in address:
        return None
    return address


def create_checkout_session(
    *,
    workspace_id: str,
    owner_user_id: str,
    owner_email: str | None,
    organization_name: str | None,
    customer_id: str | None = None,
    plan: str = PROFESSIONAL_PLAN,
    billing_interval: str = BILLING_INTERVAL_MONTH,
    additional_client_workspaces: int = 0,
    additional_ai_credit_packs: int = 0,
) -> dict:
    config = require_billing_config()
    normalized_plan = normalize_billing_plan(plan)
    normalized_interval = normalize_billing_interval(
        billing_interval
    )
    plan_definition = get_billing_plan_definition(normalized_plan)
    price_config_key = (
        plan_definition["annual_price_config_key"]
        if normalized_interval == BILLING_INTERVAL_YEAR
        else plan_definition["price_config_key"]
    )
    price_id = config.get(price_config_key)
    if not price_id:
        raise BillingProviderUnavailable(
            f"Billing price is not configured for {plan_definition['name']}"
        )
    additional_count = max(int(additional_client_workspaces or 0), 0)
    if not is_agency_plan(normalized_plan) and additional_count:
        raise BillingProviderUnavailable(
            "Additional client workspaces are available only on Agency plans"
        )
    addon_price_id = config.get(
        "client_workspace_addon_annual_price_id"
        if normalized_interval == BILLING_INTERVAL_YEAR
        else "client_workspace_addon_price_id"
    )
    if additional_count and not addon_price_id:
        raise BillingProviderUnavailable(
            "The client workspace add-on price is not configured"
        )
    ai_credit_pack_count = max(
        int(additional_ai_credit_packs or 0),
        0,
    )
    ai_credit_pack_price_id = config.get("ai_credit_pack_price_id")
    if ai_credit_pack_count and not ai_credit_pack_price_id:
        raise BillingProviderUnavailable(
            "The AI credit pack price is not configured"
        )
    metadata = {
        "workspace_id": workspace_id,
        "owner_user_id": owner_user_id,
        "plan": normalized_plan,
        "billing_interval": normalized_interval,
        "additional_client_workspaces": str(additional_count),
        "additional_ai_credit_packs": str(ai_credit_pack_count),
    }
    params = {
        "mode": "subscription",
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "success_url": (
            f"{config['web_app_url']}/dashboard/billing?checkout=success"
        ),
        "cancel_url": (
            f"{config['web_app_url']}/dashboard/billing?checkout=cancelled"
        ),
        "client_reference_id": workspace_id,
        "subscription_data[metadata][workspace_id]": workspace_id,
        "subscription_data[metadata][owner_user_id]": owner_user_id,
        "subscription_data[metadata][plan]": normalized_plan,
        "subscription_data[metadata][billing_interval]": normalized_interval,
        "subscription_data[metadata][additional_client_workspaces]": str(
            additional_count
        ),
        "subscription_data[metadata][additional_ai_credit_packs]": str(
            ai_credit_pack_count
        ),
        "subscription_data[trial_period_days]": str(
            ANNUAL_TRIAL_PERIOD_DAYS
            if normalized_interval == BILLING_INTERVAL_YEAR
            else TRIAL_PERIOD_DAYS
        ),
        "metadata[workspace_id]": workspace_id,
        "metadata[owner_user_id]": owner_user_id,
        "metadata[plan]": normalized_plan,
        "metadata[billing_interval]": normalized_interval,
        "metadata[additional_client_workspaces]": str(additional_count),
        "metadata[additional_ai_credit_packs]": str(ai_credit_pack_count),
    }
    next_line_item_index = 1
    if additional_count:
        params[f"line_items[{next_line_item_index}][price]"] = addon_price_id
        params[f"line_items[{next_line_item_index}][quantity]"] = str(
            additional_count
        )
        next_line_item_index += 1
    if ai_credit_pack_count:
        params[f"line_items[{next_line_item_index}][price]"] = (
            ai_credit_pack_price_id
        )
        params[f"line_items[{next_line_item_index}][quantity]"] = str(
            ai_credit_pack_count
        )
    if customer_id:
        params["customer"] = customer_id
    else:
        email = validate_email(owner_email)
        if email:
            params["customer_email"] = email

    if organization_name:
        params["metadata[organization_name]"] = organization_name[:500]

    response = stripe_request(
        "/checkout/sessions",
        params,
        config["secret_key"],
    )
    checkout_url = str(response.get("url") or "").strip()
    session_id = str(response.get("id") or "").strip()
    if not checkout_url or not session_id:
        raise BillingProviderUnavailable(
            "Stripe returned an incomplete checkout session"
        )
    return {
        "checkout_url": checkout_url,
        "session_id": session_id,
    }


def add_deferred_client_workspace_capacity(
    *,
    provider_subscription_id: str | None,
    current_additional_client_workspaces: int = 0,
) -> tuple[int, str]:
    """Add one client-workspace unit without invoicing until renewal."""
    config = require_billing_config()
    subscription_id = str(
        provider_subscription_id or ""
    ).strip()
    if not subscription_id:
        raise BillingProviderUnavailable(
            "An active Stripe subscription is required to add client capacity"
        )

    subscription = stripe_request(
        f"/subscriptions/{quote(subscription_id, safe='')}",
        {},
        config["secret_key"],
        method="GET",
    )
    item_data = (
        subscription.get("items", {}).get("data", [])
        if isinstance(subscription.get("items"), dict)
        else []
    )
    if not isinstance(item_data, list):
        item_data = []

    addon_price_ids = {
        value
        for value in (
            config.get("client_workspace_addon_price_id"),
            config.get("client_workspace_addon_annual_price_id"),
        )
        if value
    }
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
    remote_quantity = max(
        int(
            (addon_item or {}).get(
                "quantity",
                current_additional_client_workspaces,
            )
            or 0
        ),
        0,
    )
    new_quantity = remote_quantity + 1

    if addon_item:
        item_id = str(addon_item.get("id") or "").strip()
        if not item_id:
            raise BillingProviderUnavailable(
                "Stripe returned an incomplete client workspace add-on"
            )
        stripe_request(
            f"/subscription_items/{quote(item_id, safe='')}",
            {
                "quantity": str(new_quantity),
                "proration_behavior": "create_prorations",
            },
            config["secret_key"],
        )
    else:
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
            None,
        )
        recurring_interval = str(
            ((base_item or {}).get("price") or {})
            .get("recurring", {})
            .get("interval")
            or BILLING_INTERVAL_MONTH
        ).strip().lower()
        addon_price_id = config.get(
            "client_workspace_addon_annual_price_id"
            if recurring_interval == BILLING_INTERVAL_YEAR
            else "client_workspace_addon_price_id"
        )
        if not addon_price_id:
            raise BillingProviderUnavailable(
                "The client workspace add-on price is not configured"
            )
        created_item = stripe_request(
            "/subscription_items",
            {
                "subscription": subscription_id,
                "price": addon_price_id,
                "quantity": str(new_quantity),
                "proration_behavior": "create_prorations",
            },
            config["secret_key"],
        )
        item_id = str(created_item.get("id") or "").strip()
        if not item_id:
            raise BillingProviderUnavailable(
                "Stripe returned an incomplete client workspace add-on"
            )

    try:
        stripe_request(
            f"/subscriptions/{quote(subscription_id, safe='')}",
            {
                "metadata[additional_client_workspaces]": str(
                    new_quantity
                ),
            },
            config["secret_key"],
        )
    except BillingProviderUnavailable:
        # The subscription item quantity is authoritative and will be
        # reconciled by the next subscription webhook.
        pass

    return new_quantity, item_id


def normalize_billing_plan(value: str | None) -> str:
    clean_value = str(value or "").strip().lower()
    if clean_value == "standard":
        return PROFESSIONAL_PLAN
    if clean_value in LEGACY_PLAN_ALIASES:
        return LEGACY_PLAN_ALIASES[clean_value]
    if clean_value in BILLING_PLAN_DEFINITIONS:
        return clean_value
    return FREE_PLAN


def normalize_billing_interval(value: str | None) -> str:
    clean_value = str(value or "").strip().lower()
    if clean_value in {"year", "annual", "yearly"}:
        return BILLING_INTERVAL_YEAR
    return BILLING_INTERVAL_MONTH


def create_customer_portal_session(
    *,
    customer_id: str,
) -> str:
    config = require_billing_config()
    response = stripe_request(
        "/billing_portal/sessions",
        {
            "customer": customer_id,
            "return_url": f"{config['web_app_url']}/dashboard/billing",
        },
        config["secret_key"],
    )
    portal_url = str(response.get("url") or "").strip()
    if not portal_url:
        raise BillingProviderUnavailable(
            "Stripe returned an incomplete customer portal session"
        )
    return portal_url


def require_billing_config() -> dict[str, str]:
    config = get_billing_config()
    if config["provider"] != "stripe":
        raise BillingProviderUnavailable(
            "Unsupported billing provider"
        )
    if not config["secret_key"] or not any(
        config.get(price_key)
        for price_key in (
            "professional_price_id",
            "professional_annual_price_id",
            "agency_price_id",
            "agency_annual_price_id",
        )
    ):
        raise BillingProviderUnavailable(
            "Billing is not configured. Set STRIPE_SECRET_KEY and at least one Stripe plan price."
        )
    return config


def stripe_request(
    path: str,
    params: dict[str, str],
    secret_key: str,
    method: str = "POST",
) -> dict:
    auth = base64.b64encode(
        f"{secret_key}:".encode("utf-8")
    ).decode("ascii")
    api_url = get_runtime_configuration().stripe_api_url
    if not api_url:
        raise BillingProviderUnavailable(
            "Stripe API URL is not configured. Set STRIPE_API_URL."
        )
    request_method = str(method or "POST").strip().upper()
    request_url = f"{api_url}{path}"
    request_data = None
    if request_method == "GET":
        if params:
            request_url = f"{request_url}?{urlencode(params)}"
    else:
        request_data = urlencode(params).encode("utf-8")
    request = Request(
        request_url,
        data=request_data,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method=request_method,
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode(
            "utf-8",
            errors="replace",
        )
        raise BillingProviderUnavailable(
            f"Stripe request failed with HTTP {error.code}: {detail[:240]}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise BillingProviderUnavailable(
            "Stripe service is unavailable"
        ) from error

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise BillingProviderUnavailable(
            "Stripe returned an invalid response"
        ) from error

    if not isinstance(payload, dict):
        raise BillingProviderUnavailable(
            "Stripe returned an invalid response"
        )
    return payload


def verify_stripe_webhook(
    payload: bytes,
    signature_header: str | None,
    webhook_secret: str | None = None,
    now: int | None = None,
) -> dict:
    secret = str(
        webhook_secret or get_billing_config()["webhook_secret"]
    ).strip()
    if not secret:
        raise BillingWebhookSignatureError(
            "Stripe webhook secret is not configured"
        )

    parsed_signature = parse_stripe_signature(
        signature_header or ""
    )
    timestamp = parsed_signature["timestamp"]
    current_time = int(now or time.time())
    if abs(current_time - timestamp) > DEFAULT_WEBHOOK_TOLERANCE_SECONDS:
        raise BillingWebhookSignatureError(
            "Stripe webhook signature timestamp is outside the tolerance window"
        )

    signed_payload = (
        f"{timestamp}.".encode("utf-8") + payload
    )
    expected_signature = hmac.new(
        secret.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    if not any(
        hmac.compare_digest(expected_signature, signature)
        for signature in parsed_signature["signatures"]
    ):
        raise BillingWebhookSignatureError(
            "Invalid Stripe webhook signature"
        )

    try:
        event = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BillingWebhookSignatureError(
            "Stripe webhook payload is invalid"
        ) from error

    if not isinstance(event, dict):
        raise BillingWebhookSignatureError(
            "Stripe webhook payload is invalid"
        )
    return event


def parse_stripe_signature(value: str) -> dict[str, int | list[str]]:
    timestamp = None
    signatures = []
    for item in value.split(","):
        key, separator, part = item.partition("=")
        if not separator:
            continue
        if key == "t":
            try:
                timestamp = int(part)
            except ValueError as error:
                raise BillingWebhookSignatureError(
                    "Invalid Stripe webhook timestamp"
                ) from error
        elif key == "v1" and part:
            signatures.append(part)

    if timestamp is None or not signatures:
        raise BillingWebhookSignatureError(
            "Stripe webhook signature is missing required values"
        )
    return {
        "timestamp": timestamp,
        "signatures": signatures,
    }


def timestamp_to_datetime(value) -> datetime | None:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(
        timestamp,
        tz=UTC,
    ).replace(tzinfo=None)
