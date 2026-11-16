from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.db.database import SessionLocal
from app.db.models import HostedSubdomainPortal, HostedSubdomainEvent, Organization, utc_now
from app.modules.hosted_subdomains.context import entitled
from app.modules.hosted_subdomains.service import audit, portal_record
from app.modules.platform_admin import require_platform_admin_full_access

router = APIRouter(prefix="/admin/hosted-subdomains", tags=["platform-admin"])


class LifecycleChange(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["suspend", "resume", "retire"]
    revision: int = Field(ge=1, strict=True)
    confirmation: Literal["CHANGE PORTAL STATUS"]
    reason: str = Field(min_length=1, max_length=500)


@router.post("/{portal_id}/status")
def change_status(portal_id: str, request: Request, payload: LifecycleChange):
    auth = require_platform_admin_full_access(request)
    with SessionLocal() as db:
        row = db.get(HostedSubdomainPortal, portal_id, with_for_update=True)
        if not row or row.revision != payload.revision:
            raise HTTPException(409, "Refresh the portal before changing its status.")
        if row.status == "retired":
            raise HTTPException(409, "Retired portal addresses cannot be reused.")
        if payload.action == "resume" and (not row.published_configuration or not row.clerk_domain_id or not entitled(db, db.get(Organization, row.organization_id))):
            raise HTTPException(409, "A published portal with an active subscription is required.")
        row.status = {"suspend": "suspended", "resume": "active", "retire": "retired"}[payload.action]
        row.suspended_at = None if payload.action == "resume" else utc_now()
        row.revision += 1
        audit(db, row, auth.user_id, payload.action, payload.reason.strip())
        db.commit()
        return portal_record(row)


@router.get("/{portal_id}/events")
def events(portal_id: str, request: Request):
    require_platform_admin_full_access(request)
    with SessionLocal() as db:
        return [{"action": row.action, "actor": row.user_id, "revision": row.revision,
                 "reason": row.reason, "created_at": row.created_at.isoformat()}
                for row in db.query(HostedSubdomainEvent).filter_by(portal_id=portal_id).order_by(HostedSubdomainEvent.id.desc()).limit(100)]
