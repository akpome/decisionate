"""A single add-on on the agency's existing subscription; webhook-authoritative access."""

import hashlib
import json
import os
from urllib.parse import quote, urlsplit

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from app.application_context import get_application
from app.db.database import SessionLocal
from app.db.models import HostedSubdomainEntitlement, WorkspaceSubscription
from app.modules.billing.service import BillingProviderUnavailable, get_billing_config, stripe_request
from app.modules.hosted_subdomains.router import router, require_agency, require_sales
from app.modules.hosted_subdomains.service import price_ids


def sync_entitlement(db, subscription, items):
    if not get_application().is_default:
        return
    item = next((item for item in items if isinstance(item, dict) and item.get("id")
                 and (item.get("price") or {}).get("id") in price_ids() and item.get("quantity", 0) == 1), None)
    existing = db.get(HostedSubdomainEntitlement, subscription.id)
    if not item or subscription.status not in {"active", "trialing", "past_due"}:
        if existing:
            db.delete(existing)
    elif existing:
        existing.stripe_item_id = item["id"]
        existing.price_id = item["price"]["id"]
    else:
        db.add(HostedSubdomainEntitlement(subscription_id=subscription.id,
            stripe_item_id=item["id"], price_id=item["price"]["id"]))


def price_for(subscription, secret):
    price_id = os.getenv("STRIPE_HOSTED_SUBDOMAIN_ANNUAL_PRICE_ID" if subscription.billing_interval == "year"
                         else "STRIPE_HOSTED_SUBDOMAIN_PRICE_ID", "").strip()
    if not price_id:
        raise HTTPException(503, "The hosted add-on price is not configured for your billing interval.")
    price = stripe_request("/prices/" + quote(price_id, safe=""), {}, secret, method="GET")
    recurring = price.get("recurring") or {}
    if (not price.get("active") or not isinstance(price.get("unit_amount"), int)
            or recurring.get("interval") != subscription.billing_interval or recurring.get("interval_count") != 1
            or recurring.get("usage_type") != "licensed" or price.get("billing_scheme") != "per_unit"):
        raise HTTPException(503, "The hosted add-on needs a fixed recurring price matching your subscription.")
    return {"price_id": price_id, "amount": price["unit_amount"], "currency": price["currency"], "interval": recurring["interval"]}


class Purchase(BaseModel):
    price_id: str
    amount: int = Field(ge=0, strict=True)
    currency: str
    interval: str
    confirmation: str = Field(pattern=r"^ADD HOSTED WHITE LABEL$")


def subscription_path(subscription):
    return "/subscriptions/" + quote(subscription.provider_subscription_id, safe="")


def reconcile(db, remote):
    from app.modules.billing.router import apply_stripe_billing_event
    apply_stripe_billing_event(db, "customer.subscription.updated", remote)
    db.commit()


@router.get("/subscription-offer")
def subscription_offer(request: Request):
    with SessionLocal() as db:
        auth, _, subscription = require_agency(request, db)
        if auth.workspace_role != "owner":
            raise HTTPException(403, "Only the agency owner can change billing.")
        require_sales(db)
        try:
            return price_for(subscription, get_billing_config(db)["secret_key"])
        except BillingProviderUnavailable:
            raise HTTPException(503, "Billing is temporarily unavailable.") from None


@router.post("/subscription")
def subscribe(request: Request, payload: Purchase):
    with SessionLocal() as db:
        auth, _, subscription = require_agency(request, db)
        if auth.workspace_role != "owner":
            raise HTTPException(403, "Only the agency owner can change billing.")
        require_sales(db)
        subscription = db.get(WorkspaceSubscription, subscription.id, with_for_update=True, populate_existing=True)
        if not subscription.provider_subscription_id or not subscription.provider_customer_id or subscription.status not in {"active", "trialing"}:
            raise HTTPException(409, "Activate your Agency subscription in Billing first.")
        config = get_billing_config(db)
        try:
            offer = price_for(subscription, config["secret_key"])
            if offer != payload.model_dump(exclude={"confirmation"}):
                raise HTTPException(409, "The price changed. Review the price before continuing.")
            path = subscription_path(subscription)
            remote = stripe_request(path, {"expand[]": "latest_invoice"}, config["secret_key"], method="GET")
            if remote.get("customer") != subscription.provider_customer_id or remote.get("currency") != offer["currency"]:
                raise HTTPException(409, "The subscription or currency does not match.")
            if remote.get("id") != subscription.provider_subscription_id or remote.get("status") not in {"active", "trialing"}:
                raise HTTPException(409, "Activate your Agency subscription in Billing first.")
            if remote.get("collection_method") != "charge_automatically":
                raise HTTPException(409, "Automatic subscription payments must be configured in Billing first.")
            already_added = any((item.get("price") or {}).get("id") in price_ids() for item in (remote.get("items") or {}).get("data", []))
            if not already_added and not remote.get("pending_update"):
                invoice = remote.get("latest_invoice")
                version = hashlib.sha256(json.dumps({"invoice": invoice.get("id") if isinstance(invoice, dict) else invoice,
                    "invoice_status": invoice.get("status") if isinstance(invoice, dict) else None,
                    "items": sorted(item["id"] for item in (remote.get("items") or {}).get("data", []))}, sort_keys=True).encode()).hexdigest()[:24]
                stripe_request(path, {"items[0][price]": offer["price_id"], "items[0][quantity]": "1",
                    "payment_behavior": "pending_if_incomplete", "proration_behavior": "always_invoice", "expand[]": "latest_invoice"},
                    config["secret_key"], idempotency_key=f"hosted-addon:{subscription.provider_subscription_id}:{offer['price_id']}:{version}")
                remote = stripe_request(path, {"expand[]": "latest_invoice"}, config["secret_key"], method="GET")
            # Reconcile only a server-retrieved subscription, through the existing verified billing handler.
            reconcile(db, remote)
            if not remote.get("pending_update") and not db.get(HostedSubdomainEntitlement, subscription.id):
                raise HTTPException(409, "The add-on has not been confirmed. Check Billing before trying again.")
            invoice = remote.get("latest_invoice")
            invoice_url = invoice.get("hosted_invoice_url") if isinstance(invoice, dict) and remote.get("pending_update") else None
            if invoice_url and (urlsplit(invoice_url).scheme != "https" or urlsplit(invoice_url).hostname != "invoice.stripe.com"):
                invoice_url = None
            return {"pending": bool(remote.get("pending_update")), "invoice_url": invoice_url}
        except BillingProviderUnavailable:
            raise HTTPException(503, "The billing update could not be confirmed. Check Billing before trying again.") from None


class Cancel(BaseModel):
    confirmation: str = Field(pattern=r"^CANCEL HOSTED WHITE LABEL$")


@router.delete("/subscription")
def cancel_subscription(request: Request, payload: Cancel):
    with SessionLocal() as db:
        auth, _, subscription = require_agency(request, db)
        if auth.workspace_role != "owner":
            raise HTTPException(403, "Only the agency owner can change billing.")
        subscription = db.get(WorkspaceSubscription, subscription.id, with_for_update=True, populate_existing=True)
        if not subscription.provider_subscription_id:
            raise HTTPException(409, "No hosted subscription was found.")
        config = get_billing_config(db)
        path = subscription_path(subscription)
        try:
            remote = stripe_request(path, {}, config["secret_key"], method="GET")
            if remote.get("customer") != subscription.provider_customer_id:
                raise HTTPException(409, "The subscription does not match.")
            if remote.get("pending_update"):
                raise HTTPException(409, "A payment update is pending. Resolve it in Billing before canceling the add-on.")
            items = [item for item in (remote.get("items") or {}).get("data", []) if (item.get("price") or {}).get("id") in price_ids()]
            if items:
                fields = {"proration_behavior": "none"}
                for index, item in enumerate(items):
                    fields[f"items[{index}][id]"] = item["id"]
                    fields[f"items[{index}][deleted]"] = "true"
                key = hashlib.sha256(json.dumps(sorted(item["id"] for item in items)).encode()).hexdigest()[:24]
                stripe_request(path, fields, config["secret_key"], idempotency_key=f"hosted-cancel:{subscription.provider_subscription_id}:{key}")
                remote = stripe_request(path, {}, config["secret_key"], method="GET")
            reconcile(db, remote)
            if db.get(HostedSubdomainEntitlement, subscription.id):
                raise HTTPException(409, "Cancellation has not been confirmed. Check Billing before retrying.")
            return {"canceled": True}
        except BillingProviderUnavailable:
            raise HTTPException(503, "Cancellation could not be confirmed. Check Billing before retrying.") from None
