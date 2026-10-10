from app.db.models import Organization


def get_managing_agency(db, organization: Organization) -> Organization | None:
    workspace_id = str(organization.owner_user_id or "").strip()
    if ":client:" not in workspace_id:
        return None

    agency_owner_id = workspace_id.split(":client:", 1)[0]
    if not agency_owner_id:
        return None

    return (
        db.query(Organization)
        .filter(Organization.owner_user_id == agency_owner_id)
        .first()
    )
