"""Client workspace availability, independent of subscription billing."""

from fastapi import HTTPException

from app.db.database import SessionLocal
from app.db.models import Organization


PAUSED_MESSAGE = "This client workspace is paused. Contact your agency to resume access."


def workspace_is_paused(db, workspace_id: str) -> bool:
    if ":client:" not in str(workspace_id or ""):
        return False
    return bool(db.query(Organization.is_paused).filter(Organization.owner_user_id == workspace_id).scalar())


def require_workspace_active(workspace_id: str, db=None):
    if ":client:" not in str(workspace_id or ""):
        return
    if db is None:
        with SessionLocal() as session:
            require_workspace_active(workspace_id, session)
        return
    if workspace_is_paused(db, workspace_id):
        raise HTTPException(403, PAUSED_MESSAGE)
