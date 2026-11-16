from app.db.models import Organization
from app.modules.organizations.ownership import managing_agency_workspace_id


def get_managing_agency(db, organization: Organization) -> Organization | None:
    agency_owner_id = managing_agency_workspace_id(organization)
    if not agency_owner_id:
        return None

    return (
        db.query(Organization)
        .filter(Organization.owner_user_id == agency_owner_id)
        .first()
    )


def get_client_email_branding(db, organization: Organization) -> dict | None:
    from app.modules.hosted_subdomains.context import current_portal
    portal = current_portal()
    if portal:
        return {"is_managed_client": True, "agency_name": portal.branding["name"],
                "brand_name": portal.branding["name"], "brand_logo_url": portal.branding["logo_url"]}
    if not managing_agency_workspace_id(organization):
        return None
    agency = get_managing_agency(db, organization)
    agency_name = " ".join(str(agency.name or "").split()) if agency else ""
    return {
        "is_managed_client": True,
        "agency_name": agency_name,
        "brand_name": (str(agency.report_display_name or "").strip() or agency_name) if agency else organization.name,
        "brand_logo_url": agency.logo_url if agency else None,
    }
