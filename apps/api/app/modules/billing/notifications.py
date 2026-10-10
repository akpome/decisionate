from __future__ import annotations

import os
from datetime import datetime
from urllib.parse import quote

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
from app.modules.billing.renewals import reconcile_subscription_if_needed
from app.modules.billing.service import (
    get_billing_plan_definition,
    normalize_billing_plan,
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

    if ":client:" in owner_id:
        # Client workspace owner keys are synthetic, not account identifiers.
        member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == organization.id,
                OrganizationMember.role.in_(["client_owner", "client"]),
            )
            .order_by(OrganizationMember.id.asc())
            .first()
        )
        if not member:
            return None
        owner_id = str(member.clerk_user_id or "").strip()
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


def send_ai_credit_low_balance_notification(
    db,
    subscription: WorkspaceSubscription,
    remaining_credits: int,
    credit_limit: int,
) -> bool:
    """Email the owner of the subscription's shared AI credit pool."""
    organization = (
        db.query(Organization)
        .filter(
            Organization.owner_user_id == subscription.workspace_id,
        )
        .first()
    )
    if not organization:
        return False

    recipient = get_workspace_owner_email(db, organization)
    if not recipient:
        return False

    plan = normalize_billing_plan(subscription.plan)
    plan_name = get_billing_plan_definition(plan)["name"]
    billing_url = (
        get_runtime_configuration().web_url.rstrip("/")
        + "/dashboard/billing"
    )
    subject = "Your Decisionate AI credits are running low"
    message = (
        f"Your {plan_name} workspace has {max(int(remaining_credits), 0):,} "
        f"AI credits remaining out of {max(int(credit_limit), 0):,}. "
        "Top up your AI credit pool to keep analysis available."
    )
    if plan == "agency":
        message += " This balance is shared by your agency and client workspaces."

    body = (
        f"Hello,\n\n{message}\n\n"
        f"Open billing: {billing_url}\n\n"
        "Decisionate"
    )
    send_platform_system_email(
        recipient,
        subject,
        body,
    )
    return True


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

    deadline = state.grace_period_end or subscription.current_period_end
    period_key = (
        deadline.isoformat()
        if deadline
        else "unknown"
    )
    if state.status == "expired":
        stage = "expired"
        if state.raw_status == "trialing":
            subject = "Your Decisionate trial has ended"
            message = "Your trial has ended and workspace access is paused. Choose a paid plan to resume using your workspace."
        else:
            subject = "Your Decisionate subscription needs attention"
            message = "Workspace access is paused. Review your subscription and payment details to restore access."
    elif state.status == "grace_period":
        stage = "past_due"
        subject = "Action required: update your Decisionate billing"
        message = (
            "A payment for your Decisionate subscription needs attention. "
            "Your workspace is temporarily available during the billing grace "
            "period. Update your billing details before the grace period ends."
        )
        message += f" Grace period ends: {state.grace_period_end.isoformat()} UTC."
    elif state.raw_status != "trialing" and not subscription.cancel_at_period_end:
        # Annual customers get advance notice, not a false expiry warning.
        if subscription.billing_interval != "year" or state.days_remaining is None or state.days_remaining > 30:
            return None
        stage = "annual_renewal"
        subject = "Your annual Decisionate subscription renews soon"
        message = (
            "Your annual subscription is scheduled to renew automatically on "
            f"{subscription.current_period_end.isoformat()} UTC. "
            "Review your plan, invoices and payment method in billing. "
            "You can turn off auto-renewal before this date to avoid the next renewal charge."
        )
    elif state.days_remaining is not None and state.days_remaining <= 1:
        stage = "ending_1"
        subject = "Your Decisionate subscription ends soon"
        message = (
            "Your Decisionate subscription period ends within one day. "
            "Auto-renewal is off. Resume your subscription in billing before it ends to keep the workspace active."
        )
    elif state.days_remaining is not None and state.days_remaining <= 7:
        stage = "ending_7"
        subject = "Your Decisionate subscription ends soon"
        message = (
            "Your Decisionate subscription period ends within seven days. "
            "Auto-renewal is off. Resume your subscription in billing before access is paused."
        )
    else:
        return None

    if state.raw_status == "trialing" and state.status != "expired":
        subject = "Your Decisionate trial ends soon"
        message = (
            "Your trial ends soon. Auto-renewal is off and access will end with the trial. Resume your subscription in billing to keep access."
            if subscription.cancel_at_period_end else
            "Your trial ends soon. Your subscription will start billing automatically at the end of the trial. Review billing to manage your subscription."
            if subscription.provider_subscription_id else
            "Your trial ends soon. Choose a paid plan to keep workspace access. Your remaining trial time is preserved when you add payment details."
        )

    notice_key = f"{stage}:{period_key}"

    billing_url = (
        get_runtime_configuration().web_url.rstrip("/")
        + "/dashboard/billing"
        + "?workspace_id=" + quote(subscription.workspace_id, safe="")
    )
    body = (
        f"Hello,\n\n{message}\n\n"
        f"{'Renewal date' if stage == 'annual_renewal' else 'Access deadline'}: "
        f"{deadline.isoformat() + ' UTC' if deadline else 'Not provided'}\n"
        f"Open billing: {billing_url}\n\n"
        "Decisionate"
    )
    return notice_key, subject, body


def send_due_billing_lifecycle_notifications(
    db,
    now: datetime | None = None,
) -> dict:
    from app.modules.billing.lifecycle import billing_enforcement_enabled
    if not billing_enforcement_enabled():
        return {
            "processed": 0, "notified": 0, "skipped": 0, "failed": 0,
            "data_purged": 0, "data_purge_failed": 0, "results": [],
        }
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
        local_state = build_subscription_access_state(subscription, current_time)
        local_notice = build_lifecycle_notice(subscription, local_state)
        needs_verification = (
            not local_state.access_allowed or local_state.status == "grace_period"
            or (local_notice and local_notice[0] != subscription.lifecycle_notice_key)
        )
        try:
            if needs_verification:
                reconcile_subscription_if_needed(db, subscription, now=current_time, force=True)
        except Exception:
            db.rollback()
            failed += 1
            results.append({
                "workspace_id": subscription.workspace_id,
                "status": "verification_failed",
                "detail": "Provider verification failed; notices and data deletion were skipped.",
            })
            continue
        state = build_subscription_access_state(subscription, current_time)
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
                state.grace_period_end or subscription.current_period_end,
                current_time,
                subscription.data_purged_at,
                subscription.canceled_at,
            ) if not state.access_allowed else None
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
