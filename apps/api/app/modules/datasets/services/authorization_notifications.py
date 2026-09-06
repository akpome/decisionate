from __future__ import annotations

import logging

from app.configuration import get_runtime_configuration
from app.db.models import Organization
from app.db.models import utc_now
from app.modules.billing.notifications import get_workspace_owner_email
from app.modules.alerts.email_delivery import send_platform_system_email
from app.modules.datasets.services.connectors import connector_display_name


logger = logging.getLogger(__name__)


def notify_workspace_owner_of_authorization_failure(
    db,
    connection,
) -> bool:
    """Email the workspace owner once for each distinct OAuth failure."""
    authorization_error = str(
        getattr(connection, "authorization_error", "") or ""
    ).strip()
    if not authorization_error:
        return False

    if (
        getattr(connection, "authorization_notification_error", None)
        == authorization_error
    ):
        return False

    workspace_reference = str(
        getattr(connection, "workspace_id", None)
        or getattr(connection, "user_id", None)
        or ""
    ).strip()
    if not workspace_reference:
        logger.warning(
            "Could not notify workspace owner about connector authorization failure",
            extra={"connection_id": getattr(connection, "id", None)},
        )
        return False

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.owner_user_id == workspace_reference)
            .first()
        )
        if not organization:
            logger.warning(
                "Could not find workspace for connector authorization notification",
                extra={
                    "connection_id": getattr(connection, "id", None),
                    "workspace_id": workspace_reference,
                },
            )
            return False

        recipient = get_workspace_owner_email(db, organization)
        if not recipient:
            logger.warning(
                "Workspace owner has no email for connector authorization notification",
                extra={
                    "connection_id": getattr(connection, "id", None),
                    "workspace_id": workspace_reference,
                },
            )
            return False

        source_label = connector_display_name(
            str(getattr(connection, "source_type", "") or "")
        )
        web_url = get_runtime_configuration().web_url.rstrip("/")
        connections_url = f"{web_url}/dashboard/connections"
        display_name = str(
            getattr(connection, "display_name", source_label) or source_label
        ).strip()
        subject = f"Action required: reauthorize {source_label} in Decisionate"
        body = (
            f"Hello,\n\n"
            f"Decisionate could no longer access the {source_label} connection "
            f'"{display_name}" in the {organization.name} workspace.\n\n'
            "Scheduled data ingestion for this connection is paused. "
            "Please reauthorize it in Decisionate:\n"
            f"{connections_url}\n\n"
            f"Reason: {authorization_error}\n\n"
            "After reauthorization, scheduled ingestion will resume.\n"
        )
    except Exception:
        logger.warning(
            "Connector authorization notification could not resolve its recipient",
            extra={
                "connection_id": getattr(connection, "id", None),
                "workspace_id": workspace_reference,
            },
            exc_info=True,
        )
        return False

    try:
        send_platform_system_email(
            recipient,
            subject,
            body,
        )
    except Exception:
        logger.warning(
            "Connector authorization notification email could not be sent",
            extra={
                "connection_id": getattr(connection, "id", None),
                "workspace_id": workspace_reference,
            },
            exc_info=True,
        )
        return False

    try:
        connection.authorization_notification_error = authorization_error
        connection.authorization_notification_sent_at = utc_now()
        db.commit()
    except Exception:
        logger.warning(
            "Connector authorization notification status could not be saved",
            extra={
                "connection_id": getattr(connection, "id", None),
                "workspace_id": workspace_reference,
            },
            exc_info=True,
        )
    return True
