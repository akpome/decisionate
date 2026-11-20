"""Retire the former agency tier without changing workspace or payment ownership."""

import logging

from sqlalchemy import column, exists, func, inspect, select, table, update

from app.application_context import DEFAULT_APPLICATION_ID
from app.db.models import WorkspaceApplication, WorkspaceSubscription
from app.modules.billing.service import AGENCY_PLAN, AGENCY_SUBDOMAIN_PLAN, LEGACY_PLAN_ALIASES


logger = logging.getLogger(__name__)


def upgrade_agency_subscriptions(connection):
    schema = inspect(connection)
    if not schema.has_table(WorkspaceSubscription.__tablename__):
        return 0
    # Bypass ORM on-update defaults: only the historical plan key changes.
    subscriptions = table(WorkspaceSubscription.__tablename__, column("workspace_id"), column("plan"))
    statement = update(subscriptions).where(
        func.lower(func.trim(subscriptions.c.plan)).in_((AGENCY_PLAN, *LEGACY_PLAN_ALIASES)),
    )
    if schema.has_table(WorkspaceApplication.__tablename__):
        applications = WorkspaceApplication.__table__
        statement = statement.where(~exists(select(applications.c.workspace_id).where(
            applications.c.workspace_id == subscriptions.c.workspace_id,
            applications.c.application_id != DEFAULT_APPLICATION_ID,
        )))
    result = connection.execute(statement.values(plan=AGENCY_SUBDOMAIN_PLAN))
    if result.rowcount:
        logger.info("Moved %s existing Agency subscriptions to the hosted Agency plan; workspace data and Stripe prices are unchanged.", result.rowcount)
    return result.rowcount
