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


def get_client_email_branding(db, organization: Organization) -> dict | None:
    if ":client:" not in str(organization.owner_user_id or ""):
        return None
    agency = get_managing_agency(db, organization)
    agency_name = " ".join(str(agency.name or "").split()) if agency else ""
    return {
        "is_managed_client": True,
        "agency_name": agency_name,
        "brand_name": (str(agency.report_display_name or "").strip() or agency_name) if agency else organization.name,
        "brand_logo_url": agency.logo_url if agency else None,
    }
