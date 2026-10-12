import hashlib
import json
import secrets
from datetime import datetime, timedelta

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    AppUser, DataIngestionJob, Dataset, Organization, OrganizationMember,
    WorkspaceSubscription, utc_now,
)
from app.modules.billing.lifecycle import build_subscription_access_state
from app.modules.marketing.config import settings, CONSENT_TEXT, CONSENT_TEXT_FR
from app.modules.marketing.models import (
    MarketingContact, MarketingConsentEvent, MarketingEmail, MarketingJob,
    MarketingMembership, MarketingWorkspace, MarketingDatasetState, MarketingLinkVisit,
)


def normalize_email(value):
    return str(value or "").strip().lower()


def enqueue(db, kind, entity_id, revision=None, key=None):
    dedupe_key = key or f"{kind}:{entity_id}:{revision or secrets.token_hex(12)}"
    if any(isinstance(item, MarketingJob) and item.dedupe_key == dedupe_key for item in db.new):
        return
    if not db.query(MarketingJob.id).filter_by(dedupe_key=dedupe_key).first():
        db.add(MarketingJob(dedupe_key=dedupe_key, job_type=kind, entity_id=str(entity_id), revision=revision))


def touch_contact(db, contact):
    contact.revision = (contact.revision or 0) + 1
    enqueue(db, "contact", contact.id, contact.revision)


def withdraw(db, contact, source, *, actor=None, evidence=None):
    if contact.marketing_status != "unsubscribed":
        contact.marketing_status = "unsubscribed"
        contact.unsubscribed_at = utc_now()
        contact.resubscribe_revision = None
        touch_contact(db, contact)
        db.add(MarketingConsentEvent(contact_id=contact.id, revision=contact.revision,
                                    status="unsubscribed", source=source, actor_user_id=actor,
                                    evidence_reference=evidence))
    db.query(MarketingEmail).filter(MarketingEmail.contact_id == contact.id,
                                   MarketingEmail.status.in_({"pending", "retry"})).update(
        {"status": "skipped", "reason": "marketing_withdrawn"}, synchronize_session=False)


def capture_identity(db, user_id, email, *, verified=False):
    address = normalize_email(email)
    if not address:
        return None
    known = db.query(MarketingContact).filter_by(user_id=user_id, email=address, deleted_at=None).first()
    if known and (not verified or known.email_verified_at):
        # Routine authenticated requests must not wait on a provider-sync lock.
        # Name changes are picked up by background reconciliation.
        return known
    existing = db.query(MarketingContact).filter(
        MarketingContact.user_id == user_id, MarketingContact.deleted_at.is_(None),
    ).with_for_update().all()
    for previous in existing:
        if previous.email != address:
            withdraw(db, previous, "email_changed", actor=user_id)
            previous.deleted_at = utc_now()
            touch_contact(db, previous)
    contact = db.query(MarketingContact).filter_by(email=address).with_for_update().first()
    if contact is None:
        try:
            with db.begin_nested():
                contact = MarketingContact(user_id=user_id, email=address, marketing_status="unknown")
                db.add(contact)
                db.flush()
            enqueue(db, "contact", contact.id, contact.revision)
        except IntegrityError:
            contact = db.query(MarketingContact).filter_by(email=address).with_for_update().one()
    if contact.user_id and contact.user_id != user_id:
        if verified and contact.deleted_at and not db.get(AppUser, contact.user_id):
            contact.user_id = user_id
        else:
            return None
    if not contact.user_id and not verified:
        # Do not transfer consent or a contact's workspace links between users.
        return None
    if contact.deleted_at:
        contact.deleted_at = None
        contact.marketing_status = "unknown"
        contact.consent_at = None
        contact.email_verified_at = None
        touch_contact(db, contact)
    contact.user_id = user_id
    if verified and not contact.email_verified_at:
        contact.email_verified_at = utc_now()
        if contact.marketing_status == "pending_confirmation":
            contact.marketing_status = "subscribed"
        touch_contact(db, contact)
        if contact.marketing_status == "subscribed" and contact.unsubscribed_at and contact.consent_at and contact.consent_at > contact.unsubscribed_at:
            contact.resubscribe_revision = contact.revision
    user = db.get(AppUser, user_id)
    if user and user.first_name != contact.first_name:
        contact.first_name = user.first_name
        touch_contact(db, contact)
    return contact


def eligible(contact):
    return bool(contact and not contact.deleted_at and not contact.suppression_reason
                and contact.marketing_status == "subscribed" and contact.consent_at
                and contact.email_verified_at)


def set_preference(db, contact, subscribed, *, source, actor, version=None, language="en"):
    config = settings()
    if not subscribed:
        withdraw(db, contact, source, actor=actor)
        return
    if not config["consent_available"] or version != config["consent_versions"].get(language):
        raise ValueError("Please review the current marketing consent request before subscribing.")
    if contact.suppression_reason:
        raise ValueError("This address is suppressed. Contact support before subscribing.")
    desired = "subscribed" if contact.email_verified_at else "pending_confirmation"
    if contact.marketing_status == desired and contact.consent_text_version == version:
        return
    was_withdrawn = contact.marketing_status == "unsubscribed"
    contact.marketing_status = desired
    contact.consent_at = utc_now()
    contact.consent_source = source
    contact.consent_text_version = version
    touch_contact(db, contact)
    contact.resubscribe_revision = contact.revision if was_withdrawn and contact.email_verified_at else None
    db.add(MarketingConsentEvent(contact_id=contact.id, revision=contact.revision, status=desired,
                                source=source, actor_user_id=actor, text_version=version,
                                consent_text=CONSENT_TEXT_FR if language == "fr" else CONSENT_TEXT,
                                sender_identity=config["identity"], mailing_address=config["address"], reply_to=config["reply_to"],
                                evidence_reference=f"authenticated:{actor}"))


def dataset_is_usable(dataset):
    if not (dataset.row_count or 0) or not (dataset.column_count or 0):
        return False
    try:
        config = json.loads(dataset.source_config or "{}")
    except ValueError:
        config = {}
    return not (str(dataset.source_type or "").startswith("demo")
                or str(dataset.workspace_id or "").startswith("demo")
                or any(config.get(key) for key in ("demo", "demo_mode", "demonstration")))


def workspace_facts(db, workspace_id, now=None):
    now = now or utc_now()
    org = db.query(Organization).filter_by(owner_user_id=workspace_id).first()
    if not org:
        return None
    state = next((item for item in db.new if isinstance(item, MarketingWorkspace) and item.workspace_id == workspace_id), None) or db.get(MarketingWorkspace, workspace_id)
    if state is None:
        state = MarketingWorkspace(workspace_id=workspace_id)
        db.add(state)
    datasets = db.query(Dataset).filter(or_(Dataset.workspace_id == workspace_id,
        and_(Dataset.workspace_id.is_(None), Dataset.user_id == workspace_id))).all()
    usable = [dataset for dataset in datasets if dataset_is_usable(dataset) and dataset_completed(db, dataset)]
    if usable and not state.first_data_ready_at:
        state.first_data_ready_at = min(dataset.created_at for dataset in usable)
    billing_workspace_id = workspace_id.split(":client:", 1)[0]
    sub = db.query(WorkspaceSubscription).filter_by(workspace_id=billing_workspace_id).populate_existing().first()
    access = build_subscription_access_state(sub, now)
    raw = str(sub.status or "") if sub else ""
    if raw == "trialing":
        subscription = "trial" if access.access_allowed and sub.current_period_end and sub.current_period_end > now else "trial_expired"
    elif raw in {"past_due", "unpaid", "incomplete", "checkout_completed"}:
        subscription = "payment_attention"
    elif sub and sub.plan != "free" and access.access_allowed and raw == "active":
        subscription = "paying"
    elif sub and sub.provider_subscription_id and not access.access_allowed:
        subscription = "former"
    else:
        subscription = "untracked"
    activity = state.last_meaningful_activity_at or org.created_at
    return {"workspace_id": workspace_id, "account_type": "agency" if org.business_type == "agency" else "business",
            "subscription_status": subscription, "setup_status": "data_ready" if usable else "incomplete",
            "engagement_status": "inactive" if activity < now - timedelta(days=settings()["inactivity_days"]) else "active",
            "first_data_ready_at": state.first_data_ready_at, "last_meaningful_activity_at": state.last_meaningful_activity_at,
            "trial_started_at": sub.current_period_start if sub and raw == "trialing" else None,
            "trial_ends_at": sub.current_period_end if sub and raw == "trialing" else None,
            "sequence_instance": f"signup:{org.id}:subscription:{sub.id}" if sub and sub.current_period_start else None}


def refresh_memberships(db, contact):
    organizations = db.query(Organization, OrganizationMember).join(
        OrganizationMember, OrganizationMember.organization_id == Organization.id,
    ).filter(OrganizationMember.clerk_user_id == contact.user_id).all() if contact.user_id else []
    own = db.query(Organization).filter_by(owner_user_id=contact.user_id).all() if contact.user_id else []
    desired = {org.owner_user_id: (org, member.role) for org, member in organizations}
    desired.update({org.owner_user_id: (org, "owner") for org in own})
    records = {record.workspace_id: record for record in db.query(MarketingMembership).filter_by(contact_id=contact.id)}
    for workspace_id, (org, role) in desired.items():
        record = records.pop(workspace_id, None) or MarketingMembership(contact_id=contact.id, workspace_id=workspace_id)
        # Agency-funded client spaces do not own a trial or receive upgrade offers.
        owner = org.owner_user_id == contact.user_id and ":client:" not in workspace_id
        record.role, record.eligible = role, owner
        record.onboarding_recipient = record.billing_recipient = owner
        db.add(record)
    for record in records.values():
        db.delete(record)
    allowed = [org.owner_user_id for org, role in desired.values() if org.owner_user_id == contact.user_id and ":client:" not in org.owner_user_id]
    if contact.primary_workspace_id not in allowed:
        contact.primary_workspace_id = sorted(allowed)[0] if allowed else None
    db.flush()
    return allowed


def desired_segments(db, contact, now=None):
    refresh_memberships(db, contact)
    if not eligible(contact):
        return set()
    facts = workspace_facts(db, contact.primary_workspace_id, now) if contact.primary_workspace_id else None
    if not facts:
        return {"prospect"} if contact.source == "newsletter" else set()
    stage = facts["subscription_status"]
    segments = {"trial_data_ready" if facts["setup_status"] == "data_ready" else "trial_setup_incomplete"} if stage == "trial" else {
        {"paying": "paying_customer", "trial_expired": "trial_expired", "former": "former_customer"}.get(stage)
    }
    segments.discard(None)
    if facts["engagement_status"] == "inactive":
        segments.add("inactive_customer")
    if facts["account_type"] == "agency":
        segments.add("agency_account")
    return segments


def schedule_messages(db, contact, now=None):
    now, config = now or utc_now(), settings()
    if not eligible(contact):
        return
    for workspace_id in refresh_memberships(db, contact):
        facts = workspace_facts(db, workspace_id, now)
        if not facts or not facts["sequence_instance"] or not facts["trial_ends_at"]:
            continue
        start, end = facts["trial_started_at"], facts["trial_ends_at"]
        before_cutoff = bool(config["cutoff"] and start < datetime.fromisoformat(config["cutoff"].replace("Z", "+00:00")).replace(tzinfo=None))
        dates = {"welcome": start, "incomplete_setup": start + timedelta(hours=config["setup_hours"]),
                 "trial_ending": max(end - timedelta(hours=config["trial_hours"]), start + timedelta(hours=config["frequency_hours"]))}
        for kind, due in dates.items():
            entry = db.query(MarketingEmail).filter_by(contact_id=contact.id, workspace_id=workspace_id,
                sequence_instance=facts["sequence_instance"], message_type=kind).first()
            if not entry:
                # No historic welcome/setup backfill; a useful future trial reminder is allowed.
                stale = (before_cutoff and kind != "trial_ending") or (kind == "welcome" and now > start + timedelta(hours=config["welcome_hours"])) or (kind == "incomplete_setup" and due < contact.created_at)
                short_trial = kind == "trial_ending" and end - due < timedelta(hours=config["min_notice_hours"])
                entry = MarketingEmail(contact_id=contact.id, workspace_id=workspace_id,
                    sequence_instance=facts["sequence_instance"], message_type=kind, due_at=due, trial_deadline=end,
                    status="skipped" if stale or short_trial else "pending", reason="short_trial" if short_trial else "activation_cutoff" if stale else None)
                db.add(entry)
            elif entry.status == "pending" and kind == "trial_ending":
                entry.due_at = due
                entry.trial_deadline = end
    db.flush()


def message_blocker(db, contact, message, now=None):
    now = now or utc_now()
    if not eligible(contact):
        return "consent_or_verification_required"
    owned = refresh_memberships(db, contact)
    if message.workspace_id not in owned:
        return "recipient_changed"
    if message.message_type == "delivery_test":
        return None if message.is_test and contact.email in settings()["test_recipients"] else "test_recipient_required"
    facts = workspace_facts(db, message.workspace_id, now)
    if not facts or facts["subscription_status"] != "trial":
        return "trial_not_active"
    if message.is_test and contact.email not in settings()["test_recipients"]:
        return "test_recipient_required"
    if not message.is_test and facts["sequence_instance"] != message.sequence_instance:
        return "sequence_changed"
    if not message.is_test and message.message_type == "welcome" and now > facts["trial_started_at"] + timedelta(hours=settings()["welcome_hours"]):
        return "welcome_stale"
    if message.message_type == "incomplete_setup":
        if facts["account_type"] == "agency":
            if db.query(Organization.id).filter(Organization.owner_user_id.startswith(message.workspace_id + ":client:")).first():
                return "agency_client_workspace_created"
            return None
        if facts["setup_status"] == "data_ready":
            return "data_ready"
        active = db.query(DataIngestionJob.id).filter_by(workspace_id=message.workspace_id).filter(
            DataIngestionJob.status.in_({"queued", "running"})).first()
        if active:
            return "ingestion_in_progress"
        # Existing connector failure notifications provide the recovery workflow.
        if db.query(DataIngestionJob.id).filter_by(workspace_id=message.workspace_id, status="failed").first():
            return "existing_ingestion_failure_notice"
    return None


def unsubscribe_token(contact):
    # A persistent random secret is represented by a non-expiring signed token.
    import jwt
    from app.modules.alerts.email_delivery import clean_env_value
    secret = clean_env_value("MARKETING_UNSUBSCRIBE_SECRET")
    if len(secret) < 32:
        raise ValueError("MARKETING_UNSUBSCRIBE_SECRET must contain at least 32 characters")
    return jwt.encode({"purpose": "marketing_unsubscribe", "contact_id": contact.id,
                       "email_hash": hashlib.sha256(contact.email.encode()).hexdigest()}, secret, algorithm="HS256")


def record_meaningful_activity(db, workspace_id, now=None):
    now = now or utc_now()
    state = db.get(MarketingWorkspace, workspace_id)
    if state is None:
        state = MarketingWorkspace(workspace_id=workspace_id)
        db.add(state)
    if not state.last_meaningful_activity_at or state.last_meaningful_activity_at < now - timedelta(minutes=15):
        state.last_meaningful_activity_at = now
        enqueue(db, "workspace", workspace_id)


def dataset_completed(db, dataset):
    tracked = db.get(MarketingDatasetState, dataset.id)
    if tracked:
        return bool(tracked.ready_at)
    jobs = db.query(DataIngestionJob).filter_by(workspace_id=dataset.workspace_id or dataset.user_id).filter(
        DataIngestionJob.started_at <= dataset.created_at,
        or_(DataIngestionJob.completed_at.is_(None), DataIngestionJob.completed_at >= dataset.created_at),
    ).all()
    return all(job.status == "succeeded" for job in jobs)


def mark_completed_data(db, dataset):
    if not dataset_is_usable(dataset):
        return
    tracked = db.get(MarketingDatasetState, dataset.id) or MarketingDatasetState(dataset_id=dataset.id)
    tracked.ready_at = tracked.ready_at or utc_now()
    db.add(tracked)
    workspace_id = dataset.workspace_id or dataset.user_id
    state = next((item for item in db.new if isinstance(item, MarketingWorkspace) and item.workspace_id == workspace_id), None) or db.get(MarketingWorkspace, workspace_id)
    if not state:
        state = MarketingWorkspace(workspace_id=workspace_id)
        db.add(state)
    state.first_data_ready_at = state.first_data_ready_at or tracked.ready_at


def remove_user_marketing(db, user_id):
    for contact in db.query(MarketingContact).filter_by(user_id=user_id, deleted_at=None):
        withdraw(db, contact, "account_deleted")
        db.query(MarketingLinkVisit).filter_by(contact_id=contact.id).delete(synchronize_session=False)
        contact.deleted_at = utc_now()
        touch_contact(db, contact)
