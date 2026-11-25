"""Request/worker presentation context. Never changes issuer or workspace ownership."""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import re
from urllib.parse import urlsplit

ROOT_DOMAIN = "decisionate.app"
PRIMARY_ORIGIN = "https://app.decisionate.ca"
_portal = ContextVar("hosted_subdomain_portal", default=None)


@dataclass(frozen=True)
class PortalContext:
    id: str
    owner_workspace_id: str
    hostname: str
    branding: dict
    includes_client_workspaces: bool = False

    @property
    def origin(self):
        return "https://" + self.hostname


def current_portal():
    return _portal.get()


@contextmanager
def portal_scope(portal):
    token = _portal.set(portal)
    try:
        yield portal
    finally:
        _portal.reset(token)


def hosted_hostname(value):
    return bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?\.decisionate\.app", value or ""))


def hostname_from_origin(origin):
    try:
        parsed = urlsplit(origin)
        if parsed.scheme == "https" and origin == "https://" + (parsed.hostname or "") and hosted_hostname(parsed.hostname):
            return parsed.hostname
    except ValueError:
        pass
    return None


def eligible_hosted_plan(organization, subscription):
    from app.modules.billing.service import AGENCY_SUBDOMAIN_PLAN, AGENCY_CUSTOM_DOMAIN_PLAN, PROFESSIONAL_PLAN, normalize_billing_plan
    from app.modules.organizations.ownership import independent_client, managing_agency_workspace_id

    if not organization or not subscription or managing_agency_workspace_id(organization):
        return None
    plan = normalize_billing_plan(subscription.plan)
    if independent_client(organization) and plan != PROFESSIONAL_PLAN:
        return None
    return plan if plan in {PROFESSIONAL_PLAN, AGENCY_SUBDOMAIN_PLAN, AGENCY_CUSTOM_DOMAIN_PLAN} else None


def active_hosted_plan(db, organization):
    from app.db.models import WorkspaceSubscription
    from app.modules.billing.lifecycle import build_subscription_access_state

    if not organization or organization.is_paused:
        return None
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=organization.owner_user_id).first()
    plan = eligible_hosted_plan(organization, subscription)
    return plan if plan and build_subscription_access_state(subscription).access_allowed else None


def entitled(db, organization):
    return active_hosted_plan(db, organization) is not None


def resolve_portal(db, hostname):
    from app.db.models import HostedSubdomainPortal, Organization
    from app.modules.billing.service import is_agency_plan
    from app.modules.hosted_subdomains.service import public_branding
    if not hosted_hostname(hostname):
        return None
    row = db.query(HostedSubdomainPortal).filter_by(hostname=hostname, status="active", application_id="decisionate-ca").first()
    if not row or not row.published_configuration:
        return None
    organization = db.get(Organization, row.organization_id)
    plan = active_hosted_plan(db, organization)
    if not plan:
        return None
    return PortalContext(row.id, organization.owner_user_id, row.hostname, public_branding(row),
                         includes_client_workspaces=is_agency_plan(plan))


def workspace_in_portal(db, workspace_id):
    portal = current_portal()
    if not portal:
        return True
    from app.db.models import Organization
    from app.modules.organizations.ownership import managing_agency_workspace_id
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    return bool(organization and (workspace_id == portal.owner_workspace_id
                or (portal.includes_client_workspaces and managing_agency_workspace_id(organization) == portal.owner_workspace_id)))


def portal_for_workspace(db, workspace_id):
    from app.db.models import HostedSubdomainPortal, Organization
    from app.modules.organizations.ownership import managing_agency_workspace_id
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    if not organization:
        return None
    agency_id = managing_agency_workspace_id(organization)
    owner = db.query(Organization).filter_by(owner_user_id=agency_id).first() if agency_id else organization
    row = db.query(HostedSubdomainPortal).filter_by(organization_id=owner.id, status="active").first() if owner else None
    portal = resolve_portal(db, row.hostname) if row else None
    return portal if portal and (not agency_id or portal.includes_client_workspaces) else None


def save_oauth_return(db, state):
    from app.db.models import HostedSubdomainOAuthReturn
    portal = current_portal()
    if portal:
        db.flush()
        db.add(HostedSubdomainOAuthReturn(state_id=state.id, portal_id=portal.id))


@contextmanager
def oauth_application_scope(state, db):
    from app.db.models import HostedSubdomainOAuthReturn
    from app.modules.applications import workspace_application_scope
    saved = db.get(HostedSubdomainOAuthReturn, state.id)
    with workspace_application_scope(state.workspace_id, db, include_portal=False):
        portal = portal_for_workspace(db, state.workspace_id) if saved else None
        if portal and portal.id != saved.portal_id:
            portal = None
        with portal_scope(portal):
            yield
