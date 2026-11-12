"""Transactional invitations; database membership still requires verified identity."""

import logging
from urllib.parse import urlencode

from fastapi import HTTPException

from app.configuration import get_runtime_configuration
from app.db.models import OrganizationInvite, utc_now
from app.modules.alerts.email_delivery import send_platform_system_email
from app.modules.organizations.branding import get_client_email_branding


logger = logging.getLogger(__name__)
INVITATION_RESEND_SECONDS = 60


def send_invitation_email(db, organization, invite, *, resend=False):
    invite = db.query(OrganizationInvite).populate_existing().filter_by(
        id=invite.id, organization_id=organization.id,
    ).with_for_update().first()
    if invite is None:
        raise HTTPException(404, "Invitation not found.")
    if invite.status != "pending":
        raise HTTPException(409, "This invitation is no longer pending.")
    if organization.is_paused:
        raise HTTPException(403, "Resume the client account before sending an invitation.")
    now = utc_now()
    if invite.email_attempted_at and (now - invite.email_attempted_at).total_seconds() < INVITATION_RESEND_SECONDS:
        if not resend:
            return invite
        raise HTTPException(429, "Please wait a minute before sending this invitation again.", headers={"Retry-After": "60"})

    workspace = "/dashboard?" + urlencode({"workspace_id": organization.owner_user_id})
    url = get_runtime_configuration().web_url.rstrip("/") + "/sign-in?" + urlencode({"redirect_url": workspace})
    name = " ".join(organization.name.split())
    branding = get_client_email_branding(db, organization)
    agency_name = " ".join(str((branding or {}).get("agency_name") or "Decisionate").split())
    subject = f"{agency_name} invited you to {name}"
    body = (f"You have been invited to {name}.\n\n"
            f"Open your workspace: {url}\n\n"
            f"Sign in or create an account using {invite.email}. Verify that email address to access the workspace. "
            "If you already have an account, use that account.\n\n"
            "This invitation grants access only to this workspace. If you were not expecting it, you can ignore this email.")

    # Commit the attempt before contacting the provider. Never repeat a send
    # automatically after a timeout; the provider may already have accepted it.
    invite.email_attempted_at = now
    invite.email_status = "sending"
    invite.email_error = None
    db.commit()
    try:
        send_platform_system_email(
            invite.email, subject, body,
            sender_name=f"{agency_name} via Decisionate" if branding else None,
            branding=branding,
            idempotency_key=f"workspace-invite-{invite.id}-{now.strftime('%Y%m%d%H%M%S%f')}",
        )
    except Exception as error:
        invite.email_status = "failed" if isinstance(error, HTTPException) and error.status_code == 503 else "unknown"
        invite.email_error = "Invitation email could not be confirmed. Check the recipient's inbox before resending."
        logger.warning(
            "Workspace invitation email was not confirmed: invite_id=%s organization_id=%s email_status=%s status=%s error_type=%s",
            invite.id, organization.id, invite.email_status,
            error.status_code if isinstance(error, HTTPException) else None, type(error).__name__,
        )
    else:
        invite.email_status = "sent"
        invite.email_sent_at = utc_now()
        logger.info(
            "Workspace invitation email accepted by provider: invite_id=%s organization_id=%s role=%s",
            invite.id, organization.id, invite.role,
        )
    db.commit()
    db.refresh(invite)
    return invite
