from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal
from app.db.models import HostedSubdomainAddress, HostedSubdomainPortal, HostedSubdomainEvent, Organization, utc_now
from app.modules.hosted_subdomains.context import ROOT_DOMAIN, entitled
from app.modules.hosted_subdomains.service import audit, ensure_satellite, lock_hosted_addresses, normalize_slug, portal_record, reserved_address
from app.modules.platform_admin import require_platform_admin_full_access

router = APIRouter(prefix="/admin/hosted-subdomains", tags=["platform-admin"])


class LifecycleChange(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["suspend", "resume", "retire"]
    revision: int = Field(ge=1, strict=True)
    confirmation: Literal["CHANGE PORTAL STATUS"]
    reason: str = Field(min_length=1, max_length=500)


class AddressChange(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    slug: str = Field(min_length=3, max_length=40)
    revision: int = Field(ge=1, strict=True)
    reason: str = Field(min_length=1, max_length=350)

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value):
        return normalize_slug(value)


def address_edit_portal(db, portal_id, revision):
    row = db.get(HostedSubdomainPortal, portal_id, with_for_update=True)
    if not row or row.application_id != "decisionate-ca":
        raise HTTPException(404, "Hosted portal not found.")
    if row.status == "retired":
        raise HTTPException(409, "Retired portals cannot change address.")
    if row.revision != revision:
        raise HTTPException(409, "The portal changed. Refresh before editing its address.")
    return row


@router.post("/{portal_id}/address")
def change_address(portal_id: str, request: Request, payload: AddressChange):
    auth = require_platform_admin_full_access(request)
    hostname = f"{payload.slug}.{ROOT_DOMAIN}"
    try:
        with SessionLocal() as db:
            lock_hosted_addresses(db)
            row = address_edit_portal(db, portal_id, payload.revision)
            if row.hostname == hostname:
                return portal_record(row)
            address = reserved_address(db, payload.slug)
            if address and (not isinstance(address, HostedSubdomainAddress) or address.portal_id != row.id):
                raise HTTPException(409, "This address is already reserved. Choose another name.")
            if not address:
                db.add(HostedSubdomainAddress(hostname=hostname, portal_id=row.id))
            published = bool(row.published_configuration)
            db.commit()

        # The reservation serves only Clerk's bootstrap, while users keep the
        # previous live address until the replacement has been provisioned.
        domain_id = ensure_satellite(hostname) if published else None

        with SessionLocal() as db:
            lock_hosted_addresses(db)
            row = address_edit_portal(db, portal_id, payload.revision)
            address = db.get(HostedSubdomainAddress, hostname, with_for_update=True)
            if not address or address.portal_id != row.id:
                raise HTTPException(409, "The address reservation changed. Refresh and try again.")
            previous = row.hostname
            db.delete(address)
            db.add(HostedSubdomainAddress(hostname=previous, portal_id=row.id, forwards=published))
            row.slug = payload.slug
            row.hostname = hostname
            row.clerk_domain_id = domain_id
            row.last_error = None
            row.revision += 1
            audit(db, row, auth.user_id, "address_changed", f"{previous} -> {hostname}: {payload.reason}")
            db.commit()
            return portal_record(row)
    except IntegrityError:
        raise HTTPException(409, "This address was reserved while you were editing. Refresh and choose another name.") from None


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
