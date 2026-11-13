"""Client workspace availability, independent of subscription billing."""

from fastapi import HTTPException

from app.db.database import SessionLocal
from app.db.models import Organization
from app.modules.organizations.ownership import independent_client
from app.modules.applications import workspace_application_scope


PAUSED_MESSAGE = "This client workspace is paused. Contact your agency to resume access."


def workspace_is_paused(db, workspace_id: str) -> bool:
    if ":client:" not in str(workspace_id or ""):
        return False
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    if independent_client(organization):
        from app.modules.billing.lifecycle import build_subscription_access_state, get_subscription_for_workspace
        subscription = get_subscription_for_workspace(db, workspace_id)
        with workspace_application_scope(workspace_id, db):
            return subscription is None or not build_subscription_access_state(subscription).access_allowed
    return bool(organization and organization.is_paused)


def require_workspace_active(workspace_id: str, db=None):
    if ":client:" not in str(workspace_id or ""):
        return
    if db is None:
        with SessionLocal() as session:
            require_workspace_active(workspace_id, session)
        return
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    if independent_client(organization):
        from app.modules.billing.lifecycle import build_subscription_access_state, get_subscription_for_workspace
        subscription = get_subscription_for_workspace(db, workspace_id)
        if subscription is None or not build_subscription_access_state(subscription).access_allowed:
            raise HTTPException(402, "This workspace has left its agency. Start its trial, choose a plan, or accept an agency invitation in Settings.")
    elif organization and organization.is_paused:
        raise HTTPException(403, PAUSED_MESSAGE)
