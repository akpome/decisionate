"""Explicit, bounded email sharing; URLs and sender identity are server-owned."""

from datetime import timedelta
from hashlib import sha256
import json
from secrets import token_urlsafe
from typing import Literal
from urllib.parse import urlencode, urlsplit, urlunsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Column, DateTime, String, Text

from app.db.database import Base, SessionLocal
from app.db.models import Organization, utc_now
from app.infrastructure.ingestion_jobs import lock_workspace_queue
from app.modules.alerts.email_delivery import require_email_delivery_configured, send_platform_system_email
from app.modules.alerts.router import clean_recipient_emails, get_weekly_report_branding
from app.modules.auth_context import get_auth_context
from app.modules.applications import workspace_scoped
from app.modules.datasets.services.auth import require_workspace_data_manager


class ShareEmailDelivery(Base):
    __tablename__ = "share_email_deliveries"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    request_key = Column(String, nullable=False, unique=True)
    payload_hash = Column(String, nullable=False)
    target = Column(String, nullable=False)
    recipients = Column(Text, nullable=False)
    accepted = Column(Text, nullable=False, default="[]")
    status = Column(String, nullable=False, default="sending")
    created_at = Column(DateTime, nullable=False, default=utc_now, index=True)


class ShareEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["dashboard", "report"]
    recipients: list[str] = Field(min_length=1, max_length=10)
    dataset_id: int | None = Field(default=None, gt=0)
    dashboard: str | None = Field(default=None, max_length=100)
    template: Literal["executive", "performance", "comparison"] | None = None
    report_id: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_target(self):
        self.recipients = clean_recipient_emails(self.recipients)
        if not self.recipients:
            raise ValueError("Add at least one email address.")
        if self.kind == "dashboard":
            if not self.dataset_id or not self.dashboard or not self.template or self.report_id:
                raise ValueError("Choose a dashboard to share.")
        elif not self.report_id or self.dataset_id or self.dashboard or self.template:
            raise ValueError("Choose a saved report to share.")
        return self


router = APIRouter(prefix="/api/v2/share-emails", tags=["sharing"])


def database():
    with SessionLocal() as db:
        yield db


def shared_url(path, parameters):
    from app.configuration import get_runtime_configuration

    parsed = urlsplit(get_runtime_configuration().web_url)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(503, "The sharing address is not configured. Please contact support.")
    return urlunsplit((parsed.scheme, parsed.netloc, path, urlencode(parameters), ""))


def delivery_result(delivery):
    accepted = len(json.loads(delivery.accepted))
    requested = len(json.loads(delivery.recipients))
    return {"status": delivery.status, "sent_count": accepted, "recipient_count": requested,
            "share_enabled": True,
            "message": (f"Link emailed to {accepted} recipient{'s' if accepted != 1 else ''}." if delivery.status == "sent"
                        else f"Email confirmed for {accepted} of {requested} recipients. Check the other recipients' inboxes before sending again.")}


@router.post("")
def email_share(request: Request, payload: ShareEmailRequest, db=Depends(database)):
    auth = get_auth_context(request)
    require_workspace_data_manager(request)
    return send_share_email(db, auth, payload, request.headers.get("Idempotency-Key", ""), request)


@workspace_scoped("auth", "workspace_id")
def send_share_email(db, auth, payload, key, request):
    from app.modules.workspace_lifecycle import require_workspace_active
    require_workspace_active(auth.workspace_id, db)
    # Authorize again on replays; an old request key must never bypass revoked access.
    if payload.kind == "dashboard":
        from app.modules.datasets.router import load_dataset, verify_dataset_owner, clean_dashboard_share_key
        target = load_dataset(db, payload.dataset_id)
        verify_dataset_owner(target, auth.user_id, auth.workspace_id)
        dashboard = clean_dashboard_share_key(payload.dashboard)
        title = target.file_name
    else:
        from app.modules.reports.router import allowed_report, require_report_writer
        target = allowed_report(db, payload.report_id, auth.user_id, auth.workspace_id)
        require_report_writer(request)
        definition = json.loads(target.definition)
        if definition.get("impact") or json.loads(target.snapshot).get("weekly_report"):
            raise HTTPException(400, "Email sharing is available for single-dataset and multi-dataset analysis reports.")
        title = target.name
    if not 8 <= len(key) <= 120:
        raise HTTPException(400, "A sharing request identifier is required.")
    encoded = payload.model_dump_json()
    fingerprint = sha256(encoded.encode()).hexdigest()
    request_key = sha256(json.dumps([auth.workspace_id, auth.user_id, key]).encode()).hexdigest()
    lock_workspace_queue(db, "share-email:" + auth.workspace_id)
    previous = db.query(ShareEmailDelivery).filter_by(request_key=request_key).first()
    if previous:
        if previous.payload_hash != fingerprint:
            raise HTTPException(409, "This email request was already used with different recipients or content.")
        result = delivery_result(previous)
        if payload.kind == "report":
            from app.modules.reports.models import ReportShare
            active = db.get(ReportShare, target.id) is not None
        else:
            from app.db.models import DashboardShare
            active = db.query(DashboardShare).filter_by(dataset_id=target.id, dashboard_key=dashboard).first() is not None
        if not active:
            result.update(share_enabled=False, message="This link was emailed previously, but sharing has been stopped. Close this dialog and share again for a new link.")
        return result
    recent = db.query(ShareEmailDelivery).filter(ShareEmailDelivery.workspace_id == auth.workspace_id,
                                               ShareEmailDelivery.created_at > utc_now() - timedelta(minutes=10)).count()
    if recent >= 10:
        raise HTTPException(429, "Too many sharing emails. Please try again in ten minutes.", headers={"Retry-After": "600"})
    require_email_delivery_configured()
    if payload.kind == "dashboard":
        from app.db.models import DashboardShare
        share = db.query(DashboardShare).filter_by(dataset_id=target.id, dashboard_key=dashboard).first()
        if share is None:
            share = DashboardShare(dataset_id=target.id, dashboard_key=dashboard, share_token=token_urlsafe(32))
            db.add(share)
        url = shared_url("/share/dashboard", {"dataset": target.id, "dashboard": dashboard,
                                             "template": payload.template, "token": share.share_token})
    else:
        from app.modules.reports.models import ReportShare
        share = db.get(ReportShare, target.id)
        if share is None:
            share = ReportShare(report_id=target.id, token=token_urlsafe(32))
            db.add(share)
        url = shared_url("/share/report", {"token": share.token})
    branding = get_weekly_report_branding(db, auth.workspace_id)
    organization = db.query(Organization).filter_by(owner_user_id=auth.workspace_id).first()
    workspace_name = " ".join(str(organization.name if organization else branding["brand_name"]).split())
    title = " ".join(title.split())[:150]
    delivery = ShareEmailDelivery(workspace_id=auth.workspace_id, user_id=auth.user_id, request_key=request_key,
                                  payload_hash=fingerprint, target=f"{payload.kind}:{target.id}",
                                  recipients=json.dumps(payload.recipients), accepted="[]", status="sending")
    db.add(delivery)
    # Persist before contacting the provider. Unknown outcomes are never automatically replayed.
    db.commit()
    accepted = []
    for recipient in payload.recipients:
        try:
            send_platform_system_email(recipient, f"{workspace_name} shared a {payload.kind} with you",
                                       f"{workspace_name} shared {title} with you.\n\nView the {payload.kind}: {url}\n\n"
                                       "This link gives read-only access. Anyone you forward it to can also view it. "
                                       "The sender can stop sharing at any time.",
                                       branding=branding,
                                       idempotency_key=f"share-{delivery.id}-{sha256(recipient.encode()).hexdigest()[:24]}")
        except Exception:
            delivery.status = "partial" if accepted else "unknown"
            db.commit()
            return delivery_result(delivery)
        accepted.append(recipient)
        delivery.accepted = json.dumps(accepted)
        db.commit()
    delivery.status = "sent"
    db.commit()
    return delivery_result(delivery)
