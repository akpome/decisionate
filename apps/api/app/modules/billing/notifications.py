from __future__ import annotations

import os
from datetime import datetime

from app.db.models import (
    AppUser,
    AuthIdentity,
    Organization,
    OrganizationMember,
    WorkspaceSubscription,
    utc_now,
)
from app.modules.alerts.email_delivery import send_platform_system_email
from app.modules.billing.lifecycle import (
    build_subscription_access_state,
)
from app.modules.billing.data_retention import (
    purge_workspace_data_after_expiry,
)
from app.configuration import get_runtime_configuration


def get_billing_scheduler_secret() -> str:
    return str(
        os.getenv(
            "BILLING_SCHEDULER_SECRET",
            "",
        )
        or ""
    ).strip()


def get_workspace_owner_email(db, organization: Organization) -> str | None:
    owner_id = str(organization.owner_user_id or "").strip()
    if not owner_id:
        return None

    user = db.query(AppUser).filter(AppUser.id == owner_id).first()
    if user and user.email:
        return str(user.email).strip() or None

    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.user_id == owner_id,
            AuthIdentity.email.isnot(None),
        )
        .order_by(AuthIdentity.id.asc())
        .first()
    )
    if identity and identity.email:
        return str(identity.email).strip() or None

    member = (
        db.query(OrganizationMember)
        .filter(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.clerk_user_id == owner_id,
        )
        .first()
    )
    if member:
        member_identity = (
            db.query(AuthIdentity)
            .filter(
                AuthIdentity.user_id == member.clerk_user_id,
                AuthIdentity.email.isnot(None),
            )
            .order_by(AuthIdentity.id.asc())
            .first()
        )
        if member_identity and member_identity.email:
            return str(member_identity.email).strip() or None

    return None


def build_lifecycle_notice(
    subscription: WorkspaceSubscription,
    state,
) -> tuple[str, str, str] | None:
    if (
        not subscription.current_period_end
        and state.raw_status
        not in {"canceled", "unpaid", "incomplete_expired"}
    ):
        return None

    period_key = (
        subscription.current_period_end.isoformat()
        if subscription.current_period_end
        else "unknown"
    )
    if state.status == "expired":
        stage = "expired"
        subject = "Your Decisionate subscription has expired"
        message = (
            "Your Decisionate subscription has expired and workspace analysis "
            "is paused. Renew your plan to restore access."
        )
    elif state.status == "grace_period":
        stage = "past_due"
        subject = "Action required: update your Decisionate billing"
        message = (
            "A payment for your Decisionate subscription needs attention. "
            "Your workspace is temporarily available during the billing grace "
            "period. Update your billing details before the grace period ends."
        )
    elif state.days_remaining is not None and state.days_remaining <= 1:
        stage = "ending_1"
        subject = "Your Decisionate subscription ends soon"
        message = (
            "Your Decisionate subscription period ends within one day. "
            "Renew or update your billing details to keep the workspace active."
        )
    elif state.days_remaining is not None and state.days_remaining <= 7:
        stage = "ending_7"
        subject = "Your Decisionate subscription ends in seven days"
        message = (
            "Your Decisionate subscription period ends within seven days. "
            "Review billing before access is paused."
        )
    else:
        return None

    notice_key = f"{stage}:{period_key}"

    billing_url = (
        get_runtime_configuration().web_url.rstrip("/")
        + "/dashboard/billing"
    )
    body = (
        f"Hello,\n\n{message}\n\n"
        "Current period end: "
        f"{subscription.current_period_end.isoformat() if subscription.current_period_end else 'Not provided'}\n"
        f"Open billing: {billing_url}\n\n"
        "Decisionate"
    )
    return notice_key, subject, body


def send_due_billing_lifecycle_notifications(
    db,
    now: datetime | None = None,
) -> dict:
    current_time = now or utc_now()
    subscriptions = (
        db.query(WorkspaceSubscription)
        .filter(
            ~WorkspaceSubscription.workspace_id.like("%:client:%"),
        )
        .all()
    )
    results = []
    notified = 0
    skipped = 0
    failed = 0
    data_purged = 0
    data_purge_failed = 0

    for subscription in subscriptions:
        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == subscription.workspace_id,
            )
            .first()
        )

        workspace_ids = [subscription.workspace_id]
        if organization:
            child_workspace_ids = (
                db.query(Organization.owner_user_id)
                .filter(
                    Organization.owner_user_id.like(
                        f"{subscription.workspace_id}:client:%"
                    ),
                )
                .all()
            )
            workspace_ids.extend(
                str(row[0]).strip()
                for row in child_workspace_ids
                if str(row[0] or "").strip()
            )

        try:
            purge_result = purge_workspace_data_after_expiry(
                db,
                workspace_ids,
                subscription.current_period_end,
                current_time,
                subscription.data_purged_at,
                subscription.canceled_at,
            )
            if purge_result:
                subscription.data_purged_at = purge_result["purged_at"]
                db.commit()
                data_purged += 1
                results.append({
                    "workspace_id": subscription.workspace_id,
                    "status": "data_purged",
                    **purge_result,
                })
        except Exception as error:
            db.rollback()
            data_purge_failed += 1
            failed += 1
            results.append({
                "workspace_id": subscription.workspace_id,
                "status": "data_purge_failed",
                "detail": str(error),
            })

        if not organization:
            skipped += 1
            continue

        state = build_subscription_access_state(
            subscription,
            current_time,
        )
        notice = build_lifecycle_notice(
            subscription,
            state,
        )
        if notice is None:
            skipped += 1
            continue

        notice_key, subject, body = notice
        if subscription.lifecycle_notice_key == notice_key:
            skipped += 1
            continue

        recipient = get_workspace_owner_email(db, organization)
        if not recipient:
            skipped += 1
            results.append({
                "workspace_id": subscription.workspace_id,
                "status": "skipped",
                "detail": "Workspace owner email is unavailable",
            })
            continue

        try:
            send_platform_system_email(
                recipient,
                subject,
                body,
            )
            subscription.lifecycle_notice_key = notice_key
            subscription.lifecycle_notice_at = current_time
            db.commit()
            notified += 1
            results.append({
                "workspace_id": subscription.workspace_id,
                "status": "sent",
                "stage": notice_key.split(":", 1)[0],
                "recipient": recipient,
            })
        except Exception as error:
            db.rollback()
            failed += 1
            results.append({
                "workspace_id": subscription.workspace_id,
                "status": "failed",
                "detail": str(error),
            })

    return {
        "processed": len(subscriptions),
        "notified": notified,
        "skipped": skipped,
        "failed": failed,
        "data_purged": data_purged,
        "data_purge_failed": data_purge_failed,
        "results": results,
    }
