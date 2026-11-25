"""Workspace-owned hosted setup. Existing workspace permissions remain authoritative."""

import base64
import json
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.application_context import get_application
from app.db.database import SessionLocal
from app.db.models import HostedSubdomainAddress, HostedSubdomainPortal, Organization, WorkspaceSubscription, utc_now
from app.modules.auth_context import get_auth_context
from app.modules.hosted_subdomains.context import ROOT_DOMAIN, current_portal, eligible_hosted_plan, entitled, resolve_portal, hosted_hostname
from app.modules.hosted_subdomains.service import Branding, TRANSPARENT_DECISIONATE_LOGO, audit, canonical_branding, ensure_satellite, launch_blockers, lock_hosted_addresses, normalize_slug, portal_record, public_configuration, reserved_address
from app.modules.white_label_availability import availability

router = APIRouter(prefix="/api/v2/hosted-subdomains", tags=["hosted-subdomains"])


class SavePortal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    configuration: Branding
    revision: int = Field(default=0, ge=0, strict=True)

    @field_validator("slug")
    @classmethod
    def slug_valid(cls, value):
        return normalize_slug(value)


class PublishPortal(BaseModel):
    revision: int = Field(ge=1, strict=True)
    confirmation: str = Field(pattern=r"^PUBLISH PORTAL$")


def require_portal_owner(request, db):
    auth = get_auth_context(request)
    portal = current_portal()
    if not get_application().is_default or auth.workspace_role not in {"owner", "admin"}:
        raise HTTPException(403, "Only workspace owners can manage hosted portal settings.")
    # A hosted portal can manage only the workspace that owns its address.
    if portal and auth.workspace_id != portal.owner_workspace_id:
        raise HTTPException(403, "Only the workspace that owns this portal can manage it.")
    organization = db.query(Organization).filter_by(owner_user_id=auth.workspace_id).first()
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.workspace_id).first()
    if not eligible_hosted_plan(organization, subscription):
        raise HTTPException(403, "A Professional or Agency subscription is required for hosted portal settings.")
    return auth, organization, subscription


def require_sales(db):
    if not availability(db, lock=True)["hosted_subdomain_enabled"]:
        raise HTTPException(403, "New hosted portal setup is currently unavailable.")


def require_entitlement(db, organization):
    if not entitled(db, organization):
        raise HTTPException(403, "An active Professional or Agency subscription is required for your hosted portal.")


@router.get("/availability")
def check_availability(request: Request, response: Response, slug: str = Query(min_length=1, max_length=80)):
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        _, organization, _ = require_portal_owner(request, db)
        require_entitlement(db, organization)
        try:
            slug = normalize_slug(slug)
        except ValueError as error:
            return {"available": False, "status": "invalid", "message": str(error)}
        row = reserved_address(db, slug)
        if row:
            owned = isinstance(row, HostedSubdomainPortal) and row.organization_id == organization.id
            return {"available": False, "status": "reserved" if owned else "taken",
                    "message": "This is your reserved address." if owned else "This address is already taken. Choose another name."}
        return {"available": True, "status": "available", "message": "This address is available. Save your draft to reserve it."}


@router.get("/resolve")
def resolve(hostname: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if not hosted_hostname(hostname):
        raise HTTPException(404, "Portal unavailable.")
    with SessionLocal() as db:
        row = db.query(HostedSubdomainPortal).filter_by(hostname=hostname, application_id="decisionate-ca").first()
        if not row:
            address = db.get(HostedSubdomainAddress, hostname)
            row = db.get(HostedSubdomainPortal, address.portal_id) if address and address.portal_id else None
            if not row or row.application_id != "decisionate-ca" or row.status == "retired":
                raise HTTPException(404, "Portal unavailable.")
            result = {**public_configuration(row, active=False), "hostname": hostname, "origin": "https://" + hostname}
            if address.forwards and resolve_portal(db, row.hostname):
                result["redirect_origin"] = "https://" + row.hostname
            return result
        if row.status == "retired":
            raise HTTPException(404, "Portal unavailable.")
        # Reserved hosts may proxy Clerk while registration is verified; no branding/data is exposed.
        return public_configuration(row, active=bool(resolve_portal(db, hostname)))


@router.get("/assets/{hostname}/{field}")
def published_asset(hostname: str, field: str):
    if field not in {"logo_url", "favicon_url", "background_url"}:
        raise HTTPException(404, "Image unavailable.")
    with SessionLocal() as db:
        portal = resolve_portal(db, hostname)
        if not portal:
            address = db.get(HostedSubdomainAddress, hostname)
            current = db.get(HostedSubdomainPortal, address.portal_id) if address and address.forwards and address.portal_id else None
            portal = resolve_portal(db, current.hostname) if current else None
        row = db.get(HostedSubdomainPortal, portal.id) if portal else None
        brand = canonical_branding(json.loads(row.published_configuration)) if row else {}
        value = brand.get("logo_url" if field == "favicon_url" else field, "")
        if field in {"logo_url", "favicon_url"} and value == TRANSPARENT_DECISIONATE_LOGO:
            return Response(status_code=307, headers={"Location": value, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        if not value.startswith("data:image/"):
            raise HTTPException(404, "Image unavailable.")
        header, encoded = value.split(",", 1)
        return Response(base64.b64decode(encoded, validate=True), media_type=header[5:].split(";")[0],
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("")
def read(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        _, organization, subscription = require_portal_owner(request, db)
        row = db.query(HostedSubdomainPortal).filter_by(organization_id=organization.id).first()
        plan = eligible_hosted_plan(organization, subscription)
        return {"portal": portal_record(row) if row else None, "entitled": entitled(db, organization), "plan": plan,
                "commercially_available": availability(db)["hosted_subdomain_enabled"], "blockers": launch_blockers(),
                "billing_interval": subscription.billing_interval,
                "defaults": {"name": organization.report_display_name or organization.name, "primary_color": organization.primary_color or "#2563EB",
                             "accent_color": organization.accent_color or "#059669"}}


@router.put("")
def save(request: Request, payload: SavePortal):
    with SessionLocal() as db:
        auth, organization, _ = require_portal_owner(request, db)
        require_entitlement(db, organization)
        row = db.query(HostedSubdomainPortal).filter_by(organization_id=organization.id).first()
        if not row or not row.activated_at:
            require_sales(db)
        if row:
            if row.slug != payload.slug:
                raise HTTPException(409, "Your reserved address cannot be changed. Contact support.")
            if row.status == "retired":
                raise HTTPException(409, "This portal is retired.")
            result = db.execute(update(HostedSubdomainPortal).where(HostedSubdomainPortal.id == row.id,
                HostedSubdomainPortal.revision == payload.revision).values(
                    configuration=payload.configuration.model_dump_json(), revision=payload.revision + 1, last_error=None))
            if result.rowcount != 1:
                raise HTTPException(409, "This portal changed. Refresh before saving.")
            db.refresh(row)
        else:
            if payload.revision:
                raise HTTPException(409, "This portal changed. Refresh before saving.")
            lock_hosted_addresses(db)
            if reserved_address(db, payload.slug):
                raise HTTPException(409, "This address is already taken. Choose another name.")
            row = HostedSubdomainPortal(id=uuid4().hex, organization_id=organization.id, slug=payload.slug,
                hostname=payload.slug + "." + ROOT_DOMAIN, configuration=payload.configuration.model_dump_json())
            db.add(row)
        try:
            db.flush()
            audit(db, row, auth.user_id, "draft_saved")
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "The portal or address was reserved while you were editing. Refresh or choose another name.") from None
        return portal_record(row)


@router.post("/activate")
def activate(request: Request, payload: PublishPortal):
    with SessionLocal() as db:
        auth, organization, _ = require_portal_owner(request, db)
        require_entitlement(db, organization)
        row = db.query(HostedSubdomainPortal).filter_by(organization_id=organization.id).first()
        if not row or row.revision != payload.revision or row.status in {"suspended", "retired"}:
            raise HTTPException(409, "Refresh the portal before publishing. Suspended portals require platform support.")
        if not row.activated_at:
            require_sales(db)
        if launch_blockers():
            raise HTTPException(503, "Shared sign-in setup is not configured.")
        hostname, portal_id = row.hostname, row.id
    try:
        domain_id = ensure_satellite(hostname)
    except HTTPException as error:
        with SessionLocal() as db:
            db.execute(update(HostedSubdomainPortal).where(
                HostedSubdomainPortal.id == portal_id, HostedSubdomainPortal.revision == payload.revision,
            ).values(last_error=error.detail))
            db.commit()
        raise
    with SessionLocal() as db:
        # Recheck access, revision and commercial state after the provider call.
        auth, organization, _ = require_portal_owner(request, db)
        require_entitlement(db, organization)
        row = db.get(HostedSubdomainPortal, portal_id, with_for_update=True)
        if not row or row.organization_id != organization.id or row.revision != payload.revision or row.status in {"suspended", "retired"}:
            raise HTTPException(409, "This portal changed. Refresh before publishing.")
        if not row.activated_at:
            require_sales(db)
        row.published_configuration = row.configuration
        row.clerk_domain_id = domain_id
        row.status = "active"
        row.activated_at = row.activated_at or utc_now()
        row.last_error = None
        row.revision += 1
        audit(db, row, auth.user_id, "published")
        db.commit()
        return portal_record(row)
