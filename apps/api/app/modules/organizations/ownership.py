"""Workspace identity stays stable when its agency relationship changes."""

from sqlalchemy import and_, or_

from app.db.models import Organization, OrganizationMember


def managing_agency_workspace_id(organization):
    if organization is None:
        return None
    if getattr(organization, "managing_agency_workspace_id", None):
        return organization.managing_agency_workspace_id
    if getattr(organization, "agency_detached_at", None) is not None:
        return None
    workspace = str(organization.owner_user_id or "")
    return workspace.split(":client:", 1)[0] if ":client:" in workspace else None


def managed_client_filter(agency_workspace_id):
    return or_(
        Organization.managing_agency_workspace_id == agency_workspace_id,
        and_(Organization.managing_agency_workspace_id.is_(None), Organization.agency_detached_at.is_(None),
             Organization.owner_user_id.startswith(str(agency_workspace_id) + ":client:", autoescape=True)),
    )


def client_owner_member(db, organization):
    return db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == organization.id,
        OrganizationMember.role.in_({"client", "client_owner"}),
    ).order_by(OrganizationMember.id).first()


def is_workspace_owner(db, organization, user_id):
    if organization.owner_user_id == user_id:
        return True
    member = client_owner_member(db, organization)
    return bool(member and member.clerk_user_id == user_id)


def has_accepted_owner(db, organization):
    if getattr(organization, "client_owner_accepted_at", None):
        return True
    if ":client:" not in organization.owner_user_id:
        return True
    return client_owner_member(db, organization) is not None


def independent_client(organization):
    return bool(organization and getattr(organization, "agency_detached_at", None) is not None and not managing_agency_workspace_id(organization))
