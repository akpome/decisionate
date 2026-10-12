from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, UniqueConstraint

from app.db.database import Base
from app.db.models import utc_now


class MarketingSettings(Base):
    __tablename__ = "marketing_settings"
    id = Column(Integer, primary_key=True)
    sender_identity = Column(String)
    mailing_address = Column(Text)
    reply_to = Column(String)
    from_email = Column(String)
    from_name = Column(String)
    reconciliation_contact_cursor = Column(Integer, nullable=False, default=0)
    reconciliation_user_cursor = Column(String, nullable=False, default="")


class MarketingContact(Base):
    __tablename__ = "marketing_contacts"
    id = Column(Integer, primary_key=True)
    user_id = Column(String, index=True, nullable=True)
    email = Column(String, unique=True, nullable=False)
    first_name = Column(String)
    source = Column(String, nullable=False, default="signup")
    email_verified_at = Column(DateTime)
    marketing_status = Column(String, nullable=False, default="unknown")
    consent_at = Column(DateTime)
    consent_source = Column(String)
    consent_text_version = Column(String)
    unsubscribed_at = Column(DateTime)
    suppression_reason = Column(String)
    primary_workspace_id = Column(String)
    revision = Column(Integer, nullable=False, default=1)
    resubscribe_revision = Column(Integer)
    provider_contact_id = Column(String, unique=True)
    provider_checked_at = Column(DateTime)
    synced_revision = Column(Integer, nullable=False, default=0)
    last_successful_sync_at = Column(DateTime)
    sync_error = Column(String)
    deleted_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)


class MarketingConsentEvent(Base):
    __tablename__ = "marketing_consent_events"
    id = Column(Integer, primary_key=True)
    contact_id = Column(Integer, nullable=False, index=True)
    revision = Column(Integer, nullable=False)
    status = Column(String, nullable=False)
    source = Column(String, nullable=False)
    actor_user_id = Column(String)
    text_version = Column(String)
    evidence_reference = Column(String)
    consent_text = Column(Text)
    sender_identity = Column(String)
    mailing_address = Column(Text)
    reply_to = Column(String)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class MarketingWorkspace(Base):
    __tablename__ = "marketing_workspaces"
    workspace_id = Column(String, primary_key=True)
    first_data_ready_at = Column(DateTime)
    last_meaningful_activity_at = Column(DateTime)


class MarketingDatasetState(Base):
    __tablename__ = "marketing_dataset_states"
    dataset_id = Column(Integer, primary_key=True, autoincrement=False)
    ready_at = Column(DateTime)


class MarketingMembership(Base):
    __tablename__ = "marketing_memberships"
    __table_args__ = (UniqueConstraint("contact_id", "workspace_id"),)
    id = Column(Integer, primary_key=True)
    contact_id = Column(Integer, nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)
    onboarding_recipient = Column(Boolean, nullable=False, default=False)
    billing_recipient = Column(Boolean, nullable=False, default=False)
    eligible = Column(Boolean, nullable=False, default=False)


class MarketingJob(Base):
    __tablename__ = "marketing_jobs"
    id = Column(Integer, primary_key=True)
    dedupe_key = Column(String, unique=True, nullable=False)
    job_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    revision = Column(Integer)
    status = Column(String, nullable=False, default="queued", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime, nullable=False, default=utc_now, index=True)
    error = Column(String)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    completed_at = Column(DateTime)


class MarketingEmail(Base):
    __tablename__ = "marketing_emails"
    __table_args__ = (UniqueConstraint("contact_id", "workspace_id", "sequence_instance", "message_type"),)
    id = Column(Integer, primary_key=True)
    contact_id = Column(Integer, nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    sequence_instance = Column(String, nullable=False)
    message_type = Column(String, nullable=False)
    template_version = Column(String, nullable=False, default="v1")
    is_test = Column(Boolean, nullable=False, default=False)
    due_at = Column(DateTime, nullable=False, index=True)
    trial_deadline = Column(DateTime)
    status = Column(String, nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    reason = Column(String)
    provider_message_id = Column(String, unique=True)
    first_attempt_at = Column(DateTime)
    submitted_at = Column(DateTime)
    payload = Column(Text)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class MarketingWebhook(Base):
    __tablename__ = "marketing_webhooks"
    event_id = Column(String, primary_key=True)
    event_type = Column(String, nullable=False)
    payload = Column(Text, nullable=False)
    received_at = Column(DateTime, nullable=False, default=utc_now)
    processed_at = Column(DateTime)


class MarketingLinkVisit(Base):
    __tablename__ = "marketing_link_visits"
    message_id = Column(Integer, primary_key=True, autoincrement=False)
    contact_id = Column(Integer, nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    visited_at = Column(DateTime, nullable=False, default=utc_now)
