from app.db.models import HostedSubdomainPortal, HostedSubdomainEvent, HostedSubdomainEntitlement, HostedSubdomainOAuthReturn, WorkspaceSubscription, OAuthConnectionState


def delete_hosted_workspace(db, workspace_id, organization_id):
    state_ids = db.query(OAuthConnectionState.id).filter_by(workspace_id=workspace_id)
    db.query(HostedSubdomainOAuthReturn).filter(HostedSubdomainOAuthReturn.state_id.in_(state_ids)).delete(synchronize_session=False)
    if organization_id is not None:
        ids = [row.id for row in db.query(HostedSubdomainPortal).filter_by(organization_id=organization_id)]
        if ids:
            db.query(HostedSubdomainEvent).filter(HostedSubdomainEvent.portal_id.in_(ids)).delete(synchronize_session=False)
            db.query(HostedSubdomainOAuthReturn).filter(HostedSubdomainOAuthReturn.portal_id.in_(ids)).delete(synchronize_session=False)
            db.query(HostedSubdomainPortal).filter(HostedSubdomainPortal.id.in_(ids)).delete(synchronize_session=False)
    subscription = db.query(WorkspaceSubscription).filter_by(workspace_id=workspace_id).first()
    if subscription:
        db.query(HostedSubdomainEntitlement).filter_by(subscription_id=subscription.id).delete(synchronize_session=False)
