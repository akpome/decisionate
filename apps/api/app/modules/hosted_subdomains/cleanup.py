from app.db.models import (
    HostedSubdomainEntitlement, HostedSubdomainEvent, HostedSubdomainOAuthReturn,
    HostedSubdomainPortal, OAuthConnectionState, Organization, WorkspaceSubscription,
)
from app.modules.hosted_subdomains.service import lock_hosted_addresses
from app.modules.organizations.ownership import managing_agency_workspace_id


def _delete_portals(db, ids):
    db.query(HostedSubdomainEvent).filter(HostedSubdomainEvent.portal_id.in_(ids)).delete(synchronize_session=False)
    db.query(HostedSubdomainOAuthReturn).filter(HostedSubdomainOAuthReturn.portal_id.in_(ids)).delete(synchronize_session=False)
    db.query(HostedSubdomainPortal).filter(HostedSubdomainPortal.id.in_(ids)).delete(synchronize_session=False)


def release_trial_portal(db, workspace_id):
    """Release the current address without modifying the workspace or its data."""
    organization = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    if not organization or managing_agency_workspace_id(organization):
        return None
    lock_hosted_addresses(db)
    portal = (
        db.query(HostedSubdomainPortal)
        .filter_by(organization_id=organization.id, application_id="decisionate-ca")
        .with_for_update()
        .first()
    )
    if not portal or portal.status == "retired":
        return None
    # Former addresses stay reserved so old links cannot lead to a different owner.
    hostname = portal.hostname
    _delete_portals(db, [portal.id])
    return hostname


def delete_hosted_workspace(db, workspace_id, organization_id):
    state_ids = db.query(OAuthConnectionState.id).filter_by(workspace_id=workspace_id)
    db.query(HostedSubdomainOAuthReturn).filter(HostedSubdomainOAuthReturn.state_id.in_(state_ids)).delete(synchronize_session=False)
    if organization_id is not None:
        ids = [row.id for row in db.query(HostedSubdomainPortal).filter_by(organization_id=organization_id)]
        if ids:
            _delete_portals(db, ids)
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=workspace_id).first()
    if subscription:
        db.query(HostedSubdomainEntitlement).filter_by(subscription_id=subscription.id).delete(synchronize_session=False)
