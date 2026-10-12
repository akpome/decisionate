import hashlib
import json
import secrets
from typing import Literal
from html import escape

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from svix.webhooks import Webhook, WebhookVerificationError

from app.db.database import SessionLocal
from app.db.models import utc_now
from app.modules.auth_context import get_auth_context, get_auth_jwks_url
from app.modules.identity.clerk import get_verified_clerk_primary_email
from app.modules.identity.service import DEFAULT_AUTH_PROVIDER
from app.modules.alerts.email_delivery import clean_env_value
from app.modules.marketing.config import public_settings, settings
from app.modules.marketing.models import MarketingContact, MarketingEmail, MarketingJob, MarketingSettings, MarketingWebhook, MarketingLinkVisit
from app.modules.marketing.service import (
    capture_identity, enqueue, record_meaningful_activity, set_preference, withdraw, workspace_facts,
)
from app.modules.marketing.worker import process_webhook, reconcile_page

router = APIRouter(prefix="/marketing", tags=["marketing"])


class PreferenceUpdate(BaseModel):
    subscribed: bool
    consent_version: str | None = None
    language: Literal["en", "fr"] = "en"
    source: str = Field(default="account_preferences", pattern="^(signup|account_preferences)$")


class SenderUpdate(BaseModel):
    sender_identity: str = Field(min_length=1, max_length=200)
    mailing_address: str = Field(min_length=1, max_length=1000)
    reply_to: str = Field(min_length=3, max_length=254)
    from_email: str = Field(min_length=3, max_length=254)
    from_name: str = Field(default="Decisionate", min_length=1, max_length=200)


class ActivityUpdate(BaseModel):
    event: Literal["dashboard_view", "insight_review", "decision_review", "link_visit"] = "dashboard_view"
    message_id: int | None = Field(default=None, ge=1)


def admin(request):
    from app.modules.platform_admin import require_platform_admin_full_access
    return require_platform_admin_full_access(request)


def current_contact(db, request):
    auth = get_auth_context(request)
    email, verified = auth.email, auth.email_verified
    # Only preferences need this lookup; ordinary product requests stay JWT-only.
    if (not (email and verified) and getattr(auth, "auth_provider", None) == DEFAULT_AUTH_PROVIDER
            and getattr(auth, "external_user_id", None) and get_auth_jwks_url()):
        email = get_verified_clerk_primary_email(auth.external_user_id)
        verified = bool(email)
    contact = capture_identity(db, auth.user_id, email, verified=verified)
    if not contact:
        raise HTTPException(409, "Your current email address is unavailable. Verify your address before changing email preferences.")
    from app.modules.marketing.service import refresh_memberships
    refresh_memberships(db, contact)
    return contact, auth


def serialize_contact(db, contact):
    facts = workspace_facts(db, contact.primary_workspace_id) if contact.primary_workspace_id else None
    return {"id": contact.id, "email": contact.email, "marketing_status": contact.marketing_status,
            "email_verified": bool(contact.email_verified_at), "suppression_reason": contact.suppression_reason,
            "consent_at": contact.consent_at, "consent_text_version": contact.consent_text_version,
            "primary_workspace_id": contact.primary_workspace_id, "lifecycle": facts,
            "synced_revision": contact.synced_revision, "revision": contact.revision,
            "last_successful_sync_at": contact.last_successful_sync_at, "sync_error": contact.sync_error}


@router.get("/consent")
def consent_request(language: Literal["en", "fr"] = "en"):
    return public_settings(language)


@router.get("/preferences")
def preferences(request: Request):
    with SessionLocal() as db:
        contact, _ = current_contact(db, request)
        result = serialize_contact(db, contact)
        db.commit()
        return result


@router.put("/preferences")
def update_preferences(payload: PreferenceUpdate, request: Request):
    with SessionLocal() as db:
        contact, auth = current_contact(db, request)
        contact = db.query(MarketingContact).filter_by(id=contact.id).populate_existing().with_for_update().one()
        try:
            set_preference(db, contact, payload.subscribed, source=payload.source,
                           actor=auth.user_id, version=payload.consent_version, language=payload.language)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        result = serialize_contact(db, contact)
        db.commit()
        return result


@router.post("/activity")
def product_activity(request: Request, payload: ActivityUpdate = ActivityUpdate()):
    auth = get_auth_context(request)
    from app.modules.platform_admin import get_platform_admin_user_ids
    if auth.user_id not in get_platform_admin_user_ids():
        with SessionLocal() as db:
            if payload.event != "link_visit":
                record_meaningful_activity(db, auth.workspace_id)
            if payload.message_id:
                message = db.query(MarketingEmail).join(MarketingContact, MarketingContact.id == MarketingEmail.contact_id).filter(
                    MarketingContact.user_id == auth.user_id, MarketingEmail.id == payload.message_id,
                    MarketingEmail.workspace_id == auth.workspace_id,
                ).first()
                if message and not db.get(MarketingLinkVisit, message.id):
                    db.add(MarketingLinkVisit(message_id=message.id, contact_id=message.contact_id, workspace_id=message.workspace_id))
            db.commit()
    return {"status": "recorded"}


def token_contact(db, token):
    secret = clean_env_value("MARKETING_UNSUBSCRIBE_SECRET")
    if len(secret) < 32:
        raise HTTPException(503, "Unsubscribe verification is not configured.")
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"],
                             options={"require": ["purpose", "contact_id", "email_hash"]})
        if payload["purpose"] != "marketing_unsubscribe":
            raise ValueError()
        contact = db.get(MarketingContact, payload["contact_id"])
        if not contact or not secrets.compare_digest(payload["email_hash"], hashlib.sha256(contact.email.encode()).hexdigest()):
            raise ValueError()
        return contact
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(400, "This unsubscribe link is invalid.") from None


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_confirmation(token: str):
    with SessionLocal() as db:
        token_contact(db, token)
    return HTMLResponse(f"""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Decisionate email preferences</title></head>
<body style="font-family:Arial,sans-serif;margin:40px auto;padding:20px;max-width:480px"><h1>Unsubscribe from Decisionate marketing</h1>
<p>Account notices and your configured reports will not be changed.</p><form method="post" action="?token={escape(token, quote=True)}">
<button style="padding:12px 20px;background:#0047ff;color:white;border:0;border-radius:6px" type="submit">Unsubscribe</button></form></body></html>""",
                        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.post("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(token: str):
    with SessionLocal() as db:
        contact = token_contact(db, token)
        withdraw(db, contact, "unsubscribe_link")
        db.commit()
    return HTMLResponse("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font-family:Arial;padding:24px'><h1>Marketing emails stopped</h1><p>Your account notices and configured reports are unchanged.</p></body></html>", headers={"Cache-Control": "no-store"})


@router.post("/webhook")
async def webhook(request: Request):
    secret = clean_env_value("RESEND_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Marketing webhook is not configured.")
    body = await request.body()
    try:
        Webhook(secret).verify(body, dict(request.headers))
        payload = json.loads(body)
    except (WebhookVerificationError, ValueError):
        raise HTTPException(400, "Invalid webhook signature.") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise HTTPException(400, "Invalid webhook payload.")
    event_id = request.headers.get("svix-id")
    kind, data = payload.get("type", ""), payload["data"]
    # Retain only operational identifiers and preference/delivery fields.
    fields = {key: data[key] for key in ("id", "email", "unsubscribed", "email_id", "to", "tags", "origin") if key in data}
    minimal = {"type": kind, "data": fields}
    with SessionLocal() as db:
        if db.get(MarketingWebhook, event_id):
            return {"status": "duplicate"}
        receipt = MarketingWebhook(event_id=event_id, event_type=kind, payload=json.dumps(minimal))
        db.add(receipt)
        # Explicit opt-outs/suppressions take effect before acknowledgement,
        # even while marketing processing/sending is disabled.
        if fields.get("unsubscribed") is True or kind in {"contact.deleted", "email.bounced", "email.complained", "email.suppressed", "suppression.added"}:
            process_webhook(db, receipt, None)
        else:
            enqueue(db, "webhook", event_id, key="webhook:" + event_id)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if not db.get(MarketingWebhook, event_id):
                raise
    return {"status": "received"}


@router.post("/reconcile")
def reconcile(request: Request, limit: int = 100):
    configured = clean_env_value("MARKETING_SCHEDULER_SECRET")
    supplied = request.headers.get("X-Marketing-Scheduler-Secret", "")
    if not configured or not secrets.compare_digest(configured, supplied):
        raise HTTPException(403, "Marketing scheduler authorization required.")
    with SessionLocal() as db:
        saved = db.get(MarketingSettings, 1) or MarketingSettings(id=1)
        result = reconcile_page(saved.reconciliation_contact_cursor or 0, saved.reconciliation_user_cursor or "", max(1, min(limit, 100)))
        saved.reconciliation_contact_cursor = result["next_contact_id"] or 0
        saved.reconciliation_user_cursor = result["next_user_id"] or ""
        db.add(saved)
        db.commit()
        return result


@router.get("/admin")
def marketing_support(request: Request, after: int = 0):
    admin(request)
    with SessionLocal() as db:
        contacts = db.query(MarketingContact).filter(MarketingContact.id > after).order_by(MarketingContact.id).limit(50).all()
        history = db.query(MarketingEmail).order_by(MarketingEmail.id.desc()).limit(50).all()
        config = settings()
        return {"configuration": {**public_settings(), "enabled": config["enabled"], "sending": config["sending"],
            "automation": config["automation"], "from_email": config["from_email"], "from_name": config["from_name"],
            "segments_configured": {key: bool(value) for key, value in config["segments"].items()}},
            "contacts": [serialize_contact(db, contact) for contact in contacts],
            "next_contact_id": contacts[-1].id if len(contacts) == 50 else None,
            "emails": [{"id": entry.id, "contact_id": entry.contact_id, "message_type": entry.message_type,
                "workspace_id": entry.workspace_id, "status": entry.status, "due_at": entry.due_at,
                "reason": entry.reason, "provider_message_id": entry.provider_message_id,
                "authenticated_link_visit_at": (visit.visited_at if (visit := db.get(MarketingLinkVisit, entry.id)) else None)} for entry in history],
            "failed_jobs": [{"id": job.id, "job_type": job.job_type, "error": job.error, "attempts": job.attempts}
                            for job in db.query(MarketingJob).filter_by(status="failed").order_by(MarketingJob.id.desc()).limit(50)]}


@router.put("/admin/settings")
def update_sender(payload: SenderUpdate, request: Request):
    auth = admin(request)
    from app.modules.platform_admin import clean_platform_admin_email
    with SessionLocal() as db:
        saved = db.get(MarketingSettings, 1) or MarketingSettings(id=1)
        for key, value in payload.model_dump().items():
            value = value.strip()
            if not value or (key in {"from_email", "from_name", "reply_to", "sender_identity"} and any(char in value for char in "\r\n")):
                raise HTTPException(400, "Enter valid sender details.")
            setattr(saved, key, clean_platform_admin_email(value) if key in {"from_email", "reply_to"} else value)
        db.add(saved)
        from app.modules.platform_admin import record_platform_admin_audit
        record_platform_admin_audit(db, admin_user_id=auth.user_id, action="marketing_sender_updated")
        db.commit()
    return public_settings()


@router.post("/admin/jobs/{job_id}/retry")
def retry_job(job_id: int, request: Request):
    admin(request)
    with SessionLocal() as db:
        job = db.get(MarketingJob, job_id)
        if not job or job.status != "failed":
            raise HTTPException(409, "Only a failed sync job can be retried.")
        job.status, job.attempts, job.next_attempt_at = "queued", 0, utc_now()
        db.commit()
    return {"status": "queued"}


@router.get("/admin/emails/{message_id}/preview", response_class=HTMLResponse)
def email_preview(message_id: int, request: Request):
    admin(request)
    from app.modules.marketing.templates import render_message
    with SessionLocal() as db:
        message = db.get(MarketingEmail, message_id)
        contact = db.get(MarketingContact, message.contact_id) if message else None
        if not contact:
            raise HTTPException(404, "Message not found.")
        html = json.loads(message.payload)["html"] if message.payload else render_message(db, contact, message)["html"]
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@router.post("/admin/contacts/{contact_id}/test")
def queue_internal_test(contact_id: int, request: Request):
    admin(request)
    from app.modules.marketing.service import eligible, refresh_memberships
    with SessionLocal() as db:
        contact = db.get(MarketingContact, contact_id)
        if not eligible(contact) or contact.email not in settings()["test_recipients"]:
            raise HTTPException(409, "Test sends require a verified, opted-in internal test recipient.")
        allowed = refresh_memberships(db, contact)
        facts = workspace_facts(db, allowed[0]) if allowed else None
        if not facts or facts["subscription_status"] != "trial":
            raise HTTPException(409, "Use an internal trial workspace for this lifecycle test.")
        message = MarketingEmail(contact_id=contact.id, workspace_id=allowed[0], is_test=True,
                                 sequence_instance="test:" + secrets.token_hex(16), message_type="welcome", due_at=utc_now())
        db.add(message)
        db.commit()
        return {"status": "queued", "message_id": message.id}
