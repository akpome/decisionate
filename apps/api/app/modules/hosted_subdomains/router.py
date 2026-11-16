"""Agency-owned hosted setup. Existing workspace permissions remain authoritative."""

import base64
import json
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.application_context import get_application
from app.db.database import SessionLocal
from app.db.models import HostedSubdomainPortal, Organization, WorkspaceSubscription, utc_now
from app.modules.auth_context import get_auth_context
from app.modules.hosted_subdomains.context import ROOT_DOMAIN, current_portal, entitled, resolve_portal, hosted_hostname
from app.modules.hosted_subdomains.service import Branding, audit, ensure_satellite, launch_blockers, normalize_slug, portal_record, public_configuration
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


def require_agency(request, db):
    auth = get_auth_context(request)
    if current_portal() or not get_application().is_default or auth.workspace_role not in {"owner", "admin"}:
        raise HTTPException(403, "Manage your hosted portal from the agency settings in Decisionate.")
    agency = db.query(Organization).filter_by(owner_user_id=auth.workspace_id).first()
    from app.modules.organizations.ownership import managing_agency_workspace_id, independent_client
    from app.modules.billing.service import is_agency_plan
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.workspace_id).first()
    if not agency or managing_agency_workspace_id(agency) or independent_client(agency) or not subscription or not is_agency_plan(subscription.plan):
        raise HTTPException(403, "An Agency workspace is required.")
    return auth, agency, subscription


def require_sales(db):
    if not availability(db, lock=True)["hosted_subdomain_enabled"]:
        raise HTTPException(403, "New hosted portal setup is currently unavailable.")


def require_entitlement(db, agency):
    if not entitled(db, agency):
        raise HTTPException(403, "A White Label Subdomain Agency subscription is required for your hosted portal.")


@router.get("/resolve")
def resolve(hostname: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if not hosted_hostname(hostname):
        raise HTTPException(404, "Portal unavailable.")
    with SessionLocal() as db:
        row = db.query(HostedSubdomainPortal).filter_by(hostname=hostname, application_id="decisionate-ca").first()
        if not row or row.status == "retired":
            raise HTTPException(404, "Portal unavailable.")
        # Reserved hosts may proxy Clerk while registration is verified; no branding/data is exposed.
        return public_configuration(row, active=bool(resolve_portal(db, hostname)))


@router.get("/assets/{hostname}/{field}")
def published_asset(hostname: str, field: str):
    if field not in {"logo_url", "favicon_url", "background_url"}:
        raise HTTPException(404, "Image unavailable.")
    with SessionLocal() as db:
        portal = resolve_portal(db, hostname)
        row = db.get(HostedSubdomainPortal, portal.id) if portal else None
        value = json.loads(row.published_configuration).get(field, "") if row else ""
        if not value.startswith("data:image/"):
            raise HTTPException(404, "Image unavailable.")
        header, encoded = value.split(",", 1)
        return Response(base64.b64decode(encoded, validate=True), media_type=header[5:].split(";")[0],
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("")
def read(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        _, agency, subscription = require_agency(request, db)
        row = db.query(HostedSubdomainPortal).filter_by(organization_id=agency.id).first()
        return {"portal": portal_record(row) if row else None, "entitled": entitled(db, agency),
                "commercially_available": availability(db)["hosted_subdomain_enabled"], "blockers": launch_blockers(),
                "billing_interval": subscription.billing_interval,
                "defaults": {"name": agency.report_display_name or agency.name, "primary_color": agency.primary_color or "#2563EB",
                             "accent_color": agency.accent_color or "#059669"}}


@router.put("")
def save(request: Request, payload: SavePortal):
    with SessionLocal() as db:
        auth, agency, _ = require_agency(request, db)
        require_entitlement(db, agency)
        row = db.query(HostedSubdomainPortal).filter_by(organization_id=agency.id).first()
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
            row = HostedSubdomainPortal(id=uuid4().hex, organization_id=agency.id, slug=payload.slug,
                hostname=payload.slug + "." + ROOT_DOMAIN, configuration=payload.configuration.model_dump_json())
            db.add(row)
        try:
            db.flush()
            audit(db, row, auth.user_id, "draft_saved")
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "This address is already reserved. Choose another.") from None
        return portal_record(row)


@router.post("/activate")
def activate(request: Request, payload: PublishPortal):
    with SessionLocal() as db:
        auth, agency, _ = require_agency(request, db)
        require_entitlement(db, agency)
        row = db.query(HostedSubdomainPortal).filter_by(organization_id=agency.id).first()
        if not row or row.revision != payload.revision or row.status in {"suspended", "retired"}:
            raise HTTPException(409, "Refresh the portal before publishing. Suspended portals require platform support.")
        if not row.activated_at:
            require_sales(db)
        if launch_blockers():
            raise HTTPException(503, "Hosted launch checks are not complete.")
        hostname, portal_id = row.hostname, row.id
    try:
        domain_id = ensure_satellite(hostname)
    except HTTPException as error:
        with SessionLocal() as db:
            db.execute(update(HostedSubdomainPortal).where(HostedSubdomainPortal.id == portal_id).values(last_error=error.detail))
            db.commit()
        raise
    with SessionLocal() as db:
        # Recheck Agency access, revision and commercial state after the provider call.
        auth, agency, _ = require_agency(request, db)
        require_entitlement(db, agency)
        row = db.get(HostedSubdomainPortal, portal_id, with_for_update=True)
        if not row or row.revision != payload.revision or row.status in {"suspended", "retired"}:
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
