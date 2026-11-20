"""Prevent a new invitation or workspace from reusing an assigned email."""

from fastapi import HTTPException
from sqlalchemy import func, literal, or_, select, union

from app.application_context import get_application
from app.db.models import AppUser, AuthIdentity, Organization, OrganizationInvite, OrganizationMember, WorkspaceApplication


WORKSPACE_EMAIL_CONFLICT = (
    "This email is already associated with another workspace. "
    "If you own that workspace and want to replace it, delete the existing workspace first. "
    "Otherwise, use a different email address."
)


def require_unassigned_workspace_email(db, email: str | None, *, organization_id: int | None = None, user_id: str | None = None) -> None:
    # Writers hold the application's email lock until their invitation or workspace commits.
    email = str(email or "").strip().lower()
    user_queries = []
    if email:
        user_queries.extend([
            select(AppUser.id).where(func.lower(func.trim(AppUser.email)) == email, AppUser.access_paused_at.is_(None)),
            select(AuthIdentity.user_id).outerjoin(AppUser, AppUser.id == AuthIdentity.user_id).where(
                AuthIdentity.revoked_at.is_(None),
                AppUser.access_paused_at.is_(None),
                func.lower(func.trim(AuthIdentity.email)) == email,
            ),
        ])
    if user_id:
        user_queries.append(select(literal(user_id)))
    if not user_queries:
        return

    users = union(*user_queries) if len(user_queries) > 1 else user_queries[0]
    associations = [
        Organization.owner_user_id.in_(users),
        Organization.id.in_(select(OrganizationMember.organization_id).where(OrganizationMember.clerk_user_id.in_(users))),
    ]
    if email:
        associations.append(Organization.id.in_(select(OrganizationInvite.organization_id).where(
            OrganizationInvite.status == "pending",
            func.lower(func.trim(OrganizationInvite.email)) == email,
        )))

    application = get_application()
    scope = WorkspaceApplication.application_id == application.id
    if application.is_default:
        scope = or_(scope, WorkspaceApplication.workspace_id.is_(None))
    assigned = db.query(Organization.id).outerjoin(
        WorkspaceApplication, WorkspaceApplication.workspace_id == Organization.owner_user_id,
    ).filter(scope, or_(*associations))
    if organization_id is not None:
        assigned = assigned.filter(Organization.id != organization_id)
    if assigned.first():
        raise HTTPException(409, WORKSPACE_EMAIL_CONFLICT)
