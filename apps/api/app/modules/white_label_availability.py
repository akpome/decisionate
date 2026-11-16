"""Commercial availability must never be used to revoke an existing portal."""

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.orm import load_only
from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal
from app.db.models import HostedPortal, WhiteLabelAvailability
from app.modules.platform_admin import record_platform_admin_audit, require_platform_admin_full_access

router = APIRouter(prefix="/admin/white-label-availability", tags=["platform-admin"])


def availability(db, *, lock=False) -> dict:
    row = db.get(WhiteLabelAvailability, 1, with_for_update=True, populate_existing=True) if lock else db.get(WhiteLabelAvailability, 1)
    return {
        "hosted_subdomain_enabled": bool(row and row.hosted_subdomain_enabled),
        "custom_domain_enabled": bool(row and row.custom_domain_enabled),
        "revision": row.revision if row else 0,
        "updated_at": row.updated_at.isoformat() if row else None,
    }


def require_custom_domain_sales(db, *, lock=False):
    if not availability(db, lock=lock)["custom_domain_enabled"]:
        raise HTTPException(403, "New custom-domain portal setup is currently unavailable. Existing portals are unchanged.")


def admin_listing(db):
    from app.modules.hosted_portals import platform_blockers
    from app.modules.hosted_subdomains.service import launch_blockers
    from app.db.models import HostedSubdomainPortal

    return {
        **availability(db),
        "custom_domain_blockers": platform_blockers(),
        "hosted_subdomain_blockers": launch_blockers(),
        "hosted_subdomain_portal_count": db.query(HostedSubdomainPortal).count(),
        "hosted_subdomain_active_count": db.query(HostedSubdomainPortal).filter_by(status="active").count(),
        "hosted_subdomain_portals": [
            {"id": row.id, "hostname": row.hostname, "status": row.status, "revision": row.revision, "last_error": row.last_error}
            for row in db.query(HostedSubdomainPortal).options(load_only(HostedSubdomainPortal.id, HostedSubdomainPortal.hostname,
                HostedSubdomainPortal.status, HostedSubdomainPortal.revision, HostedSubdomainPortal.last_error))
            .order_by(HostedSubdomainPortal.created_at.desc()).limit(200)],
        "custom_domain_portal_count": db.query(HostedPortal).count(),
        "custom_domain_live_count": db.query(HostedPortal).filter_by(status="live").count(),
        "custom_domain_portals": [
            {"id": row.id, "hostname": row.domain, "status": row.status,
             "owner_workspace_id": row.owner_workspace_id, "updated_at": row.updated_at.isoformat()}
            for row in db.query(HostedPortal).order_by(HostedPortal.created_at.desc()).limit(200).all()
        ],
    }


class AvailabilityChange(BaseModel):
    offering: Literal["hosted_subdomain", "custom_domain"]
    enabled: bool
    revision: int = Field(ge=0)
    confirmation: Literal["CHANGE AVAILABILITY"]
    reason: str = Field(default="", max_length=500)


@router.get("")
def get_availability(request: Request, response: Response):
    require_platform_admin_full_access(request)
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        return admin_listing(db)


@router.put("")
def change_availability(request: Request, response: Response, payload: AvailabilityChange):
    auth = require_platform_admin_full_access(request)
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        before = availability(db)
        if payload.revision != before["revision"]:
            raise HTTPException(409, "Availability changed. Refresh before saving.")
        if payload.enabled and payload.offering == "hosted_subdomain" and admin_listing(db)["hosted_subdomain_blockers"]:
            raise HTTPException(409, "Complete hosted-subdomain launch checks before opening subscriptions.")
        field = payload.offering + "_enabled"
        values = {field: payload.enabled, "revision": payload.revision + 1, "updated_by_user_id": auth.user_id}
        if payload.revision == 0:
            db.add(WhiteLabelAvailability(id=1, **values))
        else:
            result = db.execute(update(WhiteLabelAvailability).where(
                WhiteLabelAvailability.id == 1, WhiteLabelAvailability.revision == payload.revision,
            ).values(**values))
            if result.rowcount != 1:
                raise HTTPException(409, "Availability changed. Refresh before saving.")
        record_platform_admin_audit(db, admin_user_id=auth.user_id, action="white_label_availability_changed",
            details=json.dumps({"offering": payload.offering, "previous": before[field], "enabled": payload.enabled,
                                "reason": payload.reason.strip()}))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Availability changed. Refresh before saving.") from None
        return admin_listing(db)
