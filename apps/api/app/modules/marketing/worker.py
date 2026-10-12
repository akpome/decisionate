import json
import logging
import random
from datetime import timedelta
from email.utils import formataddr

from sqlalchemy import case, or_

from app.db.database import SessionLocal
from app.db.models import AppUser, Organization, OrganizationMember, utc_now
from app.modules.marketing.config import settings
from app.modules.marketing.models import MarketingContact, MarketingEmail, MarketingJob, MarketingWebhook
from app.modules.marketing.provider import ProviderError, ResendMarketing
from app.modules.marketing.service import (
    capture_identity, desired_segments, eligible, enqueue, message_blocker,
    schedule_messages, touch_contact, withdraw,
)
from app.modules.marketing.templates import render_message

logger = logging.getLogger(__name__)


def sync_contact(db, contact, provider):
    if contact.deleted_at:
        if contact.provider_contact_id:
            provider.request("DELETE", f"/contacts/{contact.provider_contact_id}", missing_ok=True)
            contact.provider_contact_id = None
        contact.last_successful_sync_at = utc_now()
        contact.synced_revision = contact.revision
        contact.sync_error = None
        return
    user = db.get(AppUser, contact.user_id) if contact.user_id else None
    if user:
        contact.first_name = user.first_name
    desired = desired_segments(db, contact)
    if not eligible(contact) and not contact.provider_contact_id:
        contact.synced_revision = contact.revision
        contact.sync_error = None
        return
    config = settings()
    mapping = {name: segment_id for name, segment_id in config["segments"].items() if segment_id}
    remote = provider.get_contact(contact.provider_contact_id or contact.email)
    contact.provider_checked_at = utc_now()
    if remote is None and contact.provider_contact_id:
        withdraw(db, contact, "provider_contact_missing")
        contact.provider_contact_id = None
        desired = set()
    if remote:
        contact.provider_contact_id = remote["id"]
        if remote.get("unsubscribed") and eligible(contact) and not contact.resubscribe_revision:
            withdraw(db, contact, "provider_reconciliation")
            desired = set()
        payload = {"first_name": contact.first_name or ""}
        if not eligible(contact):
            payload["unsubscribed"] = True
        elif contact.resubscribe_revision:
            payload["unsubscribed"] = False
        provider.request("PATCH", f"/contacts/{contact.provider_contact_id}", payload)
    elif eligible(contact):
        result = provider.request("POST", "/contacts", {"email": contact.email,
            "first_name": contact.first_name or "", "unsubscribed": False})
        contact.provider_contact_id = result["id"]
    if contact.provider_contact_id:
        actual = provider.segments(contact.provider_contact_id)
        wanted = {mapping[name] for name in desired if name in mapping}
        # Remove all memberships on withdrawal, including operator-added segments.
        obsolete = actual - wanted if not eligible(contact) else (actual & set(mapping.values())) - wanted
        for segment_id in obsolete:
            provider.request("DELETE", f"/contacts/{contact.provider_contact_id}/segments/{segment_id}", missing_ok=True)
        for segment_id in wanted - actual:
            provider.request("POST", f"/contacts/{contact.provider_contact_id}/segments/{segment_id}")
    contact.resubscribe_revision = None
    contact.synced_revision = contact.revision
    contact.last_successful_sync_at = utc_now()
    contact.sync_error = None
    schedule_messages(db, contact)
    # Wake only sync-blocked messages; provider retries and frequency caps keep their deadlines.
    db.query(MarketingEmail).filter(
        MarketingEmail.contact_id == contact.id, MarketingEmail.status.in_({"pending", "retry"}),
        MarketingEmail.reason == "awaiting_contact_sync",
    ).update({"due_at": utc_now(), "reason": None}, synchronize_session=False)


def process_webhook(db, receipt, provider):
    payload = json.loads(receipt.payload)
    kind, data = payload["type"], payload["data"]
    contact = db.query(MarketingContact).filter_by(provider_contact_id=data["id"]).with_for_update().first() if kind.startswith("contact.") and data.get("id") else None
    if not contact and data.get("email"):
        candidate = db.query(MarketingContact).filter_by(email=str(data["email"]).strip().lower()).with_for_update().first()
        if candidate and not (kind.startswith("contact.") and data.get("id") and candidate.provider_contact_id and candidate.provider_contact_id != data["id"]):
            contact = candidate
    if kind == "contact.updated" and contact:
        unsubscribed = data.get("unsubscribed")
        if unsubscribed is None:
            remote = provider.get_contact(contact.provider_contact_id or contact.email)
            unsubscribed = remote.get("unsubscribed") if remote else True
        if unsubscribed is True:
            withdraw(db, contact, "provider_webhook", evidence=receipt.event_id)
        # Provider opt-in is never treated as authenticated local consent.
    if kind == "contact.deleted" and contact:
        withdraw(db, contact, "provider_deleted", evidence=receipt.event_id)
        contact.provider_contact_id = None
    message = db.query(MarketingEmail).filter_by(provider_message_id=data.get("email_id")).first() if data.get("email_id") else None
    tags = data.get("tags") or {}
    if isinstance(tags, list):
        tags = {item.get("name"): item.get("value") for item in tags}
    if not message and str(tags.get("decisionate_marketing_id", "")).isdigit():
        message = db.get(MarketingEmail, int(tags["decisionate_marketing_id"]))
        if message and message.first_attempt_at:
            message.provider_message_id = data.get("email_id")
        else:
            message = None
    terminal = {"bounced", "complained", "failed", "suppressed"}
    if message:
        contact = db.query(MarketingContact).filter_by(id=message.contact_id).with_for_update().one()
        message = db.query(MarketingEmail).filter_by(id=message.id).populate_existing().with_for_update().one()
        state = kind.removeprefix("email.")
        if state in terminal or (message.status not in terminal and state == "delivered") or (message.status in {"sending", "uncertain", "retry", "submitted"} and state == "sent"):
            message.status = state
    if kind in {"email.bounced", "email.complained", "email.suppressed", "suppression.added"}:
        contacts = [contact] if contact else []
        recipients = data.get("to") or []
        for address in [recipients] if isinstance(recipients, str) else recipients:
            match = db.query(MarketingContact).filter_by(email=str(address).strip().lower()).with_for_update().first()
            if match and match not in contacts:
                contacts.append(match)
        for record in contacts:
            record.suppression_reason = kind
            withdraw(db, record, "provider_suppression", evidence=receipt.event_id)
            touch_contact(db, record)
    receipt.processed_at = utc_now()


def process_job(db, job, provider):
    if job.job_type == "contact":
        contact = db.query(MarketingContact).filter_by(id=int(job.entity_id)).with_for_update().first()
        if contact:
            if job.revision is not None and job.revision <= contact.synced_revision and contact.synced_revision == contact.revision:
                return
            sync_contact(db, contact, provider)
            db.query(MarketingJob).filter(
                MarketingJob.job_type == "contact", MarketingJob.entity_id == job.entity_id,
                MarketingJob.status == "queued", MarketingJob.revision.isnot(None),
                MarketingJob.revision <= contact.synced_revision,
            ).update({"status": "succeeded", "completed_at": utc_now()}, synchronize_session=False)
    elif job.job_type == "workspace":
        org = db.query(Organization).filter_by(owner_user_id=job.entity_id).first()
        user_ids = {member.clerk_user_id for member in db.query(OrganizationMember).filter_by(organization_id=org.id)} if org else set()
        user_ids.add(job.entity_id)
        for contact in db.query(MarketingContact).filter(or_(MarketingContact.user_id.in_(user_ids), MarketingContact.primary_workspace_id == job.entity_id)).with_for_update():
            touch_contact(db, contact)
    elif job.job_type == "webhook":
        receipt = db.get(MarketingWebhook, job.entity_id)
        if receipt and not receipt.processed_at:
            process_webhook(db, receipt, provider)


def deliver_message(db, message, provider):
    now, config = utc_now(), settings()
    contact = db.query(MarketingContact).filter_by(id=message.contact_id).populate_existing().with_for_update().first()
    message = db.query(MarketingEmail).filter_by(id=message.id).populate_existing().with_for_update().one()
    if message.status not in {"pending", "retry"}:
        return
    blocker = message_blocker(db, contact, message, now)
    if blocker:
        if blocker == "ingestion_in_progress":
            message.due_at, message.reason = now + timedelta(hours=6), blocker
        else:
            message.status, message.reason = "skipped", blocker
        db.commit()
        return
    delivery_test = message.is_test and message.message_type == "delivery_test"
    if not config["enabled"] or not config["sending"] or (not delivery_test and not config["automation"].get(message.message_type)):
        message.reason = "dry_run_sending_disabled"
        message.due_at = now + timedelta(hours=1)
        db.commit()
        return
    if (not config["production"] or config["test_mode"] or message.is_test) and contact.email not in config["test_recipients"]:
        message.reason = "test_recipient_required"
        db.commit()
        return
    if not config["consent_available"] or not config["from_email"] or not config["cutoff"]:
        message.reason = "sender_or_activation_cutoff_missing"
        db.commit()
        return
    if not contact.provider_contact_id or contact.synced_revision < contact.revision or contact.sync_error:
        message.due_at, message.reason = now + timedelta(minutes=10), "awaiting_contact_sync"
        db.commit()
        return
    if not message.first_attempt_at:
        if message.message_type == "trial_ending":
            from app.modules.marketing.service import workspace_facts
            facts = workspace_facts(db, message.workspace_id)
            message.trial_deadline = facts["trial_ends_at"]
            actual_due = max(facts["trial_ends_at"] - timedelta(hours=config["trial_hours"]), facts["trial_started_at"] + timedelta(hours=config["frequency_hours"]))
            if now < actual_due:
                message.due_at, message.reason = actual_due, "trial_extended"
                db.commit()
                return
            if facts["trial_ends_at"] - now < timedelta(hours=config["min_notice_hours"]):
                message.status, message.reason = "skipped", "trial_notice_no_longer_useful"
                db.commit()
                return
        recent = db.query(MarketingEmail).filter(MarketingEmail.contact_id == contact.id,
            MarketingEmail.id != message.id, MarketingEmail.first_attempt_at > now - timedelta(hours=config["frequency_hours"]),
            MarketingEmail.status.in_({"sending", "submitted", "sent", "delivered", "uncertain", "retry"})).order_by(MarketingEmail.first_attempt_at.desc()).first()
        if recent:
            message.due_at = recent.first_attempt_at + timedelta(hours=config["frequency_hours"])
            message.reason = "frequency_cap"
            db.commit()
            return
        message.payload = json.dumps({"from": formataddr((config["from_name"], config["from_email"])),
            "to": [contact.email], "reply_to": config["reply_to"], **render_message(db, contact, message)})
        message.first_attempt_at = now
    elif now >= message.first_attempt_at + timedelta(hours=23):
        message.status, message.reason = "uncertain", "idempotency_window_elapsed_manual_reconciliation_required"
        db.commit()
        return
    message.status = "sending"
    message.attempts += 1
    db.commit()
    # Reacquire the contact lock and recheck consent immediately before submission.
    contact = db.query(MarketingContact).filter_by(id=message.contact_id).populate_existing().with_for_update().one()
    message = db.query(MarketingEmail).filter_by(id=message.id).populate_existing().with_for_update().one()
    if message.status != "sending":
        db.commit()
        return
    blocker = message_blocker(db, contact, message, utc_now())
    if blocker:
        message.status, message.reason = "skipped", blocker
        db.commit()
        return
    try:
        remote = provider.get_contact(contact.provider_contact_id)
        if remote is None or remote.get("unsubscribed"):
            withdraw(db, contact, "provider_pre_send_check")
            message.status, message.reason = "skipped", "provider_opt_out"
            db.commit()
            return
        result = provider.request("POST", "/emails", json.loads(message.payload), key=f"decisionate-marketing/{message.id}")
        message.provider_message_id = result["id"]
        message.status, message.reason, message.submitted_at = "submitted", None, utc_now()
    except ProviderError as error:
        message.status = "retry" if error.retryable and message.attempts < 8 else "uncertain" if error.uncertain else "failed"
        message.reason = "submission_uncertain" if error.uncertain else str(error)
        message.due_at = now + timedelta(seconds=max(error.retry_after, min(3600, 30 * 2 ** message.attempts)) + random.randint(0, 30))
    db.commit()


def process_batch(limit=10, heartbeat=None):
    config = settings()
    if not config["enabled"]:
        return {"status": "disabled", "processed": 0}
    provider, processed, failed = ResendMarketing(heartbeat), 0, 0
    for _ in range(limit):
        with SessionLocal() as db:
            job = db.query(MarketingJob).filter_by(status="queued").filter(MarketingJob.next_attempt_at <= utc_now()).order_by(
                case({"webhook": 0, "contact": 1}, value=MarketingJob.job_type, else_=2), MarketingJob.id,
            ).with_for_update(skip_locked=True).first()
            if not job:
                break
            try:
                process_job(db, job, provider)
                job.status, job.completed_at = "succeeded", utc_now()
                db.commit()
            except Exception as error:
                job_id = job.id
                db.rollback()
                job = db.get(MarketingJob, job_id)
                job.attempts += 1
                job.error = str(error) if isinstance(error, ProviderError) else f"Marketing job failed ({type(error).__name__}); inspect server monitoring."
                logger.warning("Marketing job failed", extra={"job_id": job_id, "error_type": type(error).__name__})
                retryable = not isinstance(error, ProviderError) or error.retryable
                job.status = "queued" if retryable and job.attempts < 8 else "failed"
                job.next_attempt_at = utc_now() + timedelta(seconds=max(getattr(error, "retry_after", 0), min(3600, 30 * 2 ** job.attempts)) + random.randint(0, 30))
                if job.job_type == "contact":
                    contact = db.get(MarketingContact, int(job.entity_id))
                    if contact:
                        contact.sync_error = job.error
                db.commit()
                failed += 1
            processed += 1
    with SessionLocal() as db:
        # A crashed submission is only retried with the original payload/key and
        # inside Resend's retention window. Older uncertain work is held.
        db.query(MarketingEmail).filter_by(status="sending").filter(MarketingEmail.first_attempt_at < utc_now() - timedelta(minutes=10)).update(
            {"status": "retry", "reason": "interrupted_submission"}, synchronize_session=False)
        db.commit()
        messages = db.query(MarketingEmail).filter(MarketingEmail.status.in_({"pending", "retry"}),
            MarketingEmail.due_at <= utc_now()).order_by(MarketingEmail.due_at, MarketingEmail.id).limit(limit).all()
        for message in messages:
            try:
                deliver_message(db, message, provider)
            except Exception as error:
                message_id = message.id
                db.rollback()
                message = db.get(MarketingEmail, message_id)
                message.reason = f"marketing_processing_error:{type(error).__name__}"
                message.status = "retry" if message.first_attempt_at else "pending"
                message.due_at = utc_now() + timedelta(minutes=10)
                db.commit()
                logger.warning("Marketing email processing failed", extra={"message_id": message_id, "error_type": type(error).__name__})
                failed += 1
    return {"status": "processed", "processed": processed, "failed_count": failed}


def reconcile_page(after_contact=0, after_user="", limit=100):
    with SessionLocal() as db:
        users = db.query(AppUser).filter(AppUser.id > after_user).order_by(AppUser.id).limit(limit).all()
        for user in users:
            # No verified-address or consent backfill assumptions.
            if not db.query(MarketingContact.id).filter_by(user_id=user.id, deleted_at=None).first():
                capture_identity(db, user.id, user.email, verified=False)
        contacts = db.query(MarketingContact).filter(MarketingContact.id > after_contact).order_by(MarketingContact.id).with_for_update(skip_locked=True).limit(limit).all()
        for contact in contacts:
            if contact.user_id and not db.get(AppUser, contact.user_id) and not contact.deleted_at:
                withdraw(db, contact, "account_deleted")
                contact.deleted_at = utc_now()
            desired_segments(db, contact)
            schedule_messages(db, contact)
            enqueue(db, "contact", contact.id, key=f"daily:{utc_now().date()}:{contact.id}")
        db.commit()
        return {"processed": len(contacts), "next_contact_id": contacts[-1].id if len(contacts) == limit else None,
                "next_user_id": users[-1].id if len(users) == limit else None}
