"""Client ownership and consent-based agency relationships."""

import logging
from datetime import timedelta
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request

from app.db.database import SessionLocal
from app.application_context import get_application
from app.modules.applications import require_workspace_application, workspace_belongs_to_application
from app.db.models import AgencyClientInvitation, Organization, WorkspaceSubscription, utc_now
from app.modules.alerts.email_delivery import send_platform_system_email
from app.modules.auth_context import get_auth_context, get_auth_jwks_url
from app.modules.billing.lifecycle import build_subscription_access_state
from app.modules.billing.service import PROFESSIONAL_PLAN, TRIAL_PERIOD_DAYS, get_client_workspace_limit, is_agency_plan
from app.modules.identity.clerk import get_verified_clerk_primary_email
from app.modules.organizations.invitations import build_invitation_sign_in_url
from app.modules.organizations.ownership import independent_client, is_workspace_owner, managed_client_filter, managing_agency_workspace_id
from app.modules.organizations.schemas import AgencyInvitationCreate, WorkspaceDeleteConfirmation

router = APIRouter()
logger = logging.getLogger(__name__)


def owned_workspace(db, auth):
    organization = db.query(Organization).filter_by(owner_user_id=auth.workspace_id).with_for_update().first()
    if organization is None or not is_workspace_owner(db, organization, auth.user_id):
        raise HTTPException(403, "Only the workspace owner can make this change.")
    return organization


def verified_email(auth):
    email = auth.email if auth.email_verified else None
    if not email and auth.auth_provider == "clerk" and auth.external_user_id and get_auth_jwks_url():
        email = get_verified_clerk_primary_email(auth.external_user_id)
    if not email:
        raise HTTPException(403, "Verify your sign-in email before managing agency invitations.")
    return email.strip().lower()


def detach_workspace(db, organization):
    from app.modules.organizations.router import ensure_client_workspace_idle
    ensure_client_workspace_idle(db, organization.owner_user_id)
    organization.managing_agency_workspace_id = None
    organization.agency_detached_at = utc_now()
    organization.agency_owner_access_enabled = False
    organization.logo_url = organization.primary_color = organization.accent_color = organization.report_display_name = None
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=organization.owner_user_id).first()
    if subscription is None:
        subscription = WorkspaceSubscription(workspace_id=organization.owner_user_id, plan=PROFESSIONAL_PLAN, status="inactive")
        db.add(subscription)
    organization.is_paused = not build_subscription_access_state(subscription).access_allowed


@router.post("/leave-agency")
def leave_agency(request: Request):
    auth = get_auth_context(request)
    with SessionLocal() as db:
        organization = owned_workspace(db, auth)
        if not independent_client(organization):
            if not managing_agency_workspace_id(organization):
                raise HTTPException(409, "This workspace is not linked to an agency.")
            detach_workspace(db, organization)
            db.commit()
        return {"removed": True, "workspace_id": organization.owner_user_id}


@router.post("/independent-trial")
def start_independent_trial(request: Request):
    auth = get_auth_context(request)
    with SessionLocal() as db:
        organization = owned_workspace(db, auth)
        if not independent_client(organization):
            raise HTTPException(409, "A trial is available after the workspace leaves its agency.")
        if organization.independent_trial_started_at:
            raise HTTPException(409, "This workspace has already used its independent trial. Choose a plan in Billing.")
        subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.workspace_id).with_for_update().first()
        if subscription and subscription.provider_subscription_id:
            raise HTTPException(409, "Manage the existing subscription in Billing.")
        now = utc_now()
        if subscription is None:
            subscription = WorkspaceSubscription(workspace_id=auth.workspace_id)
            db.add(subscription)
        subscription.plan, subscription.status = PROFESSIONAL_PLAN, "trialing"
        subscription.current_period_start = now
        subscription.current_period_end = now + timedelta(days=TRIAL_PERIOD_DAYS)
        organization.independent_trial_started_at = now
        organization.is_paused = False
        db.commit()
        return {"started": True, "trial_days": TRIAL_PERIOD_DAYS, "workspace_id": auth.workspace_id}


@router.delete("/workspace")
def delete_owned_workspace(payload: WorkspaceDeleteConfirmation, request: Request):
    from app.modules.organizations.router import ensure_client_workspace_idle
    from app.modules.platform_admin import delete_workspace_records
    auth = get_auth_context(request)
    with SessionLocal() as db:
        organization = owned_workspace(db, auth)
        if managing_agency_workspace_id(organization):
            raise HTTPException(409, "Unlink this workspace from its agency before deleting it.")
        if payload.confirmation.strip() != organization.name:
            raise HTTPException(400, "Type the workspace name to confirm deletion.")
        subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.workspace_id).first()
        if subscription and subscription.provider_subscription_id and subscription.status not in {"canceled", "incomplete_expired"}:
            raise HTTPException(409, "Cancel the workspace subscription in Billing before deleting the workspace.")
        # Queued jobs are deleted in the same locked transaction, not left waiting
        # for an agency-paused workspace to be resumed.
        ensure_client_workspace_idle(db, auth.workspace_id, include_queued=False)
        db.query(AgencyClientInvitation).filter_by(organization_id=organization.id).delete(synchronize_session=False)
        summary = delete_workspace_records(db, auth.workspace_id, organization.id)
        db.commit()
        request.state.workspace_deleted = True
        return {"deleted": True, "summary": summary}


@router.post("/agency-invitations")
def invite_existing_client(payload: AgencyInvitationCreate, request: Request):
    from app.modules.organizations.router import clean_invite_email, get_owned_organization_or_404
    auth = get_auth_context(request)
    if auth.workspace_id != auth.user_id or auth.workspace_role != "owner":
        raise HTTPException(403, "Invite clients from the agency owner's workspace.")
    email = clean_invite_email(payload.email)
    with SessionLocal() as db:
        agency = get_owned_organization_or_404(db, auth.user_id)
        subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.user_id).first()
        if not subscription or not is_agency_plan(subscription.plan) or not build_subscription_access_state(subscription).access_allowed:
            raise HTTPException(403, "An active Agency plan is required.")
        invitation = db.query(AgencyClientInvitation).filter_by(agency_workspace_id=auth.user_id, email=email).with_for_update().first()
        now = utc_now()
        if invitation and invitation.email_attempted_at and (now - invitation.email_attempted_at).total_seconds() < 60:
            raise HTTPException(429, "Please wait a minute before sending this invitation again.")
        if invitation is None:
            invitation = AgencyClientInvitation(id=uuid4().hex, agency_workspace_id=auth.user_id, email=email)
            db.add(invitation)
        invitation.status, invitation.email_status = "pending", "sending"
        invitation.email_attempted_at, invitation.email_error = now, None
        db.commit()
        try:
            url = urlsplit(build_invitation_sign_in_url(""))._replace(query=urlencode({"redirect_url": "/dashboard/settings"})).geturl()
            agency_name = " ".join(agency.name.split())
            send_platform_system_email(email, f"{agency_name} invited your workspace to their agency",
                f"{agency_name} would like to manage your existing {get_application().name} workspace.\n\nSign in using {email}: {url}\n\n"
                "Open Settings in the workspace you own to accept or decline. Your data stays in the same workspace. "
                "Accepting does not give the agency access to your data; you control that separately.",
                sender_name=f"{agency_name} via {get_application().name}",
                branding={"is_managed_client": True, "brand_name": agency_name, "brand_logo_url": agency.logo_url},
                idempotency_key=f"agency-invitation-{invitation.id}-{now.strftime('%Y%m%d%H%M%S%f')}")
        except Exception as error:
            invitation.email_status = "unknown"
            invitation.email_error = "Invitation saved, but email delivery was not confirmed. Check the inbox before resending."
            logger.warning("Agency invitation email was not confirmed: invitation_id=%s error_type=%s", invitation.id, type(error).__name__)
        else:
            invitation.email_status = "sent"
        db.commit()
        return {"id": invitation.id, "email_status": invitation.email_status, "email_error": invitation.email_error}


@router.get("/agency-invitations")
def list_agency_invitations(request: Request):
    auth = get_auth_context(request)
    with SessionLocal() as db:
        owned_workspace(db, auth)
        invitations = db.query(AgencyClientInvitation, Organization).join(
            Organization, Organization.owner_user_id == AgencyClientInvitation.agency_workspace_id,
        ).filter(AgencyClientInvitation.email == verified_email(auth), AgencyClientInvitation.status == "pending").all()
        return [{"id": invite.id, "agency_name": agency.name} for invite, agency in invitations
                if workspace_belongs_to_application(db, agency.owner_user_id)]


@router.post("/agency-invitations/{invitation_id}/accept")
def accept_agency_invitation(invitation_id: str, request: Request):
    from app.modules.organizations.router import ensure_client_workspace_idle
    auth = get_auth_context(request)
    with SessionLocal() as db:
        organization = owned_workspace(db, auth)
        invitation = db.query(AgencyClientInvitation).filter_by(id=invitation_id, email=verified_email(auth)).with_for_update().first()
        if invitation is None:
            raise HTTPException(404, "Agency invitation not found.")
        require_workspace_application(db, invitation.agency_workspace_id)
        if invitation.status != "pending" or not independent_client(organization):
            raise HTTPException(409, "The workspace already belongs to an agency, or the invitation is no longer pending.")
        subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.workspace_id).first()
        if subscription and subscription.provider_subscription_id and subscription.status not in {"canceled", "incomplete_expired"}:
            raise HTTPException(409, "Cancel the independent subscription in Billing before joining an agency.")
        agency = db.query(Organization).filter_by(owner_user_id=invitation.agency_workspace_id).with_for_update().first()
        agency_subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=invitation.agency_workspace_id).first()
        if not agency or not agency_subscription or not is_agency_plan(agency_subscription.plan) or not build_subscription_access_state(agency_subscription).access_allowed:
            raise HTTPException(409, "The agency needs an active Agency plan before this invitation can be accepted.")
        limit = get_client_workspace_limit(agency_subscription.plan, agency_subscription.additional_client_workspaces or 0)
        count = db.query(Organization).filter(managed_client_filter(invitation.agency_workspace_id)).count()
        if limit is not None and count >= limit:
            raise HTTPException(409, "The agency needs another client workspace slot before you can join.")
        ensure_client_workspace_idle(db, auth.workspace_id)
        organization.managing_agency_workspace_id = agency.owner_user_id
        organization.agency_owner_access_enabled = False
        organization.is_paused = False
        organization.logo_url, organization.primary_color = agency.logo_url, agency.primary_color
        organization.accent_color, organization.report_display_name = agency.accent_color, agency.report_display_name
        invitation.organization_id, invitation.status = organization.id, "accepted"
        db.commit()
        return {"accepted": True, "workspace_id": organization.owner_user_id}


@router.post("/agency-invitations/{invitation_id}/decline")
def decline_agency_invitation(invitation_id: str, request: Request):
    auth = get_auth_context(request)
    with SessionLocal() as db:
        owned_workspace(db, auth)
        invitation = db.query(AgencyClientInvitation).filter_by(id=invitation_id, email=verified_email(auth), status="pending").with_for_update().first()
        if invitation is None:
            raise HTTPException(404, "Agency invitation not found.")
        require_workspace_application(db, invitation.agency_workspace_id)
        invitation.status = "declined"
        db.commit()
        return {"declined": True}
