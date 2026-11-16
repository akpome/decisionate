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
    agency_workspace_id: str
    hostname: str
    branding: dict

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


def entitled(db, agency):
    from app.db.models import WorkspaceSubscription
    from app.modules.billing.lifecycle import build_subscription_access_state
    from app.modules.billing.service import is_agency_plan

    if not agency or agency.is_paused:
        return False
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=agency.owner_user_id).first()
    return bool(subscription and is_agency_plan(subscription.plan)
                and build_subscription_access_state(subscription).access_allowed)


def resolve_portal(db, hostname):
    from app.db.models import HostedSubdomainPortal, Organization
    from app.modules.hosted_subdomains.service import public_branding
    if not hosted_hostname(hostname):
        return None
    row = db.query(HostedSubdomainPortal).filter_by(hostname=hostname, status="active", application_id="decisionate-ca").first()
    agency = db.get(Organization, row.organization_id) if row else None
    if not row or not row.published_configuration or not entitled(db, agency):
        return None
    return PortalContext(row.id, agency.owner_user_id, row.hostname, public_branding(row))


def workspace_in_portal(db, workspace_id):
    portal = current_portal()
    if not portal:
        return True
    from app.db.models import Organization
    from app.modules.organizations.ownership import managing_agency_workspace_id
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    return bool(organization and (workspace_id == portal.agency_workspace_id
                or managing_agency_workspace_id(organization) == portal.agency_workspace_id))


def portal_for_workspace(db, workspace_id):
    from app.db.models import HostedSubdomainPortal, Organization
    from app.modules.organizations.ownership import managing_agency_workspace_id
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    if not organization:
        return None
    agency_id = managing_agency_workspace_id(organization) or organization.owner_user_id
    agency = db.query(Organization).filter_by(owner_user_id=agency_id).first()
    row = db.query(HostedSubdomainPortal).filter_by(organization_id=agency.id, status="active").first() if agency else None
    return resolve_portal(db, row.hostname) if row else None


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
