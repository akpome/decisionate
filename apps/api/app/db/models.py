from datetime import UTC, datetime

from sqlalchemy import Column
from sqlalchemy import Boolean
from sqlalchemy import DateTime
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint

from app.db.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC).replace(
        tzinfo=None,
    )


class AppUser(Base):
    """Provider-independent Decisionate user identity."""

    __tablename__ = "app_users"

    id = Column(
        String,
        primary_key=True,
        index=True,
    )

    email = Column(
        String,
        nullable=True,
        index=True,
    )

    display_name = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class AuthIdentity(Base):
    """External authentication subject linked to an internal user."""

    __tablename__ = "auth_identities"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "subject",
            name="uq_auth_identities_provider_subject",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    provider = Column(
        String,
        nullable=False,
        index=True,
    )

    subject = Column(
        String,
        nullable=False,
        index=True,
    )

    email = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    last_seen_at = Column(
        DateTime,
        nullable=True,
    )


class PlatformAdminRole(Base):
    """Internal platform-admin grant independent of an auth provider."""

    __tablename__ = "platform_admin_roles"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id = Column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )

    granted_by_user_id = Column(
        String,
        nullable=True,
    )

    permissions = Column(
        Text,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    file_name = Column(
        String,
        nullable=False,
    )

    file_path = Column(
        String,
        nullable=False,
    )

    # New records keep the provider-independent object key in file_path and
    # the provider separately. Legacy rows may still contain a full URI.
    storage_provider = Column(
        String,
        nullable=True,
        index=True,
    )

    source_type = Column(
        String,
        nullable=False,
        default="csv",
    )

    source_config = Column(
        Text,
        nullable=True,
    )

    row_count = Column(
        Integer,
        nullable=False,
    )

    column_count = Column(
        Integer,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    share_token = Column(
        String,
        nullable=True,
        unique=True,
        index=True,
    )


class DatasetJoinCache(Base):
    __tablename__ = "dataset_join_caches"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "workspace_id",
            "dashboard_key",
            name="uq_dataset_join_cache_user_workspace_dashboard",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    dashboard_key = Column(
        String,
        nullable=False,
        index=True,
    )

    dataset_ids = Column(
        Text,
        nullable=False,
    )

    definition = Column(
        Text,
        nullable=False,
    )

    result = Column(
        Text,
        nullable=False,
    )

    source_fingerprint = Column(
        String,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class DatasetRelationship(Base):
    """A user-confirmed relationship between two dataset metrics."""

    __tablename__ = "dataset_relationships"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    name = Column(
        String,
        nullable=False,
    )

    left_dataset_id = Column(
        Integer,
        nullable=False,
        index=True,
    )

    left_date_column = Column(
        String,
        nullable=False,
    )

    left_metric = Column(
        String,
        nullable=False,
    )

    right_dataset_id = Column(
        Integer,
        nullable=False,
        index=True,
    )

    right_date_column = Column(
        String,
        nullable=False,
    )

    right_metric = Column(
        String,
        nullable=False,
    )

    period = Column(
        String,
        nullable=False,
        default="monthly",
    )

    aggregation = Column(
        String,
        nullable=False,
        default="sum",
    )

    method = Column(
        String,
        nullable=False,
        default="pearson",
    )

    lag_mode = Column(
        String,
        nullable=False,
        default="manual",
    )

    lag_periods = Column(
        Integer,
        nullable=False,
        default=0,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class DashboardShare(Base):
    __tablename__ = "dashboard_shares"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    dataset_id = Column(
        Integer,
        nullable=False,
        index=True,
    )

    dashboard_key = Column(
        String,
        nullable=False,
        index=True,
    )

    share_token = Column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    __table_args__ = (
        UniqueConstraint(
            "dataset_id",
            "dashboard_key",
            name="uq_dashboard_shares_dataset_dashboard",
        ),
    )


class DataSourceConnection(Base):
    __tablename__ = "data_source_connections"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    source_type = Column(
        String,
        nullable=False,
        index=True,
    )

    display_name = Column(
        String,
        nullable=False,
    )

    status = Column(
        String,
        nullable=False,
        default="draft",
        index=True,
    )

    connection_config = Column(
        Text,
        nullable=True,
    )

    last_synced_at = Column(
        DateTime,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class OAuthConnectionState(Base):
    __tablename__ = "oauth_connection_states"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    state_token = Column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )

    connection_id = Column(
        Integer,
        nullable=False,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=False,
        index=True,
    )

    user_id = Column(
        String,
        nullable=False,
    )

    source_type = Column(
        String,
        nullable=False,
    )

    expires_at = Column(
        DateTime,
        nullable=False,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )


class OAuthCredential(Base):
    __tablename__ = "oauth_credentials"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    connection_id = Column(
        Integer,
        nullable=False,
        unique=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=False,
        index=True,
    )

    source_type = Column(
        String,
        nullable=False,
        index=True,
    )

    access_token_encrypted = Column(
        Text,
        nullable=True,
    )

    refresh_token_encrypted = Column(
        Text,
        nullable=True,
    )

    token_type = Column(
        String,
        nullable=True,
    )

    scope = Column(
        Text,
        nullable=True,
    )

    provider_account_id = Column(
        String,
        nullable=True,
    )

    expires_at = Column(
        DateTime,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    name = Column(
        String,
        nullable=False,
    )

    logo_url = Column(
        Text,
        nullable=True,
    )

    primary_color = Column(
        String,
        nullable=True,
    )

    accent_color = Column(
        String,
        nullable=True,
    )

    report_display_name = Column(
        String,
        nullable=True,
    )

    agency_owner_access_enabled = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    owner_user_id = Column(
        String,
        nullable=False,
        unique=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    organization_id = Column(
        Integer,
        nullable=False,
    )

    clerk_user_id = Column(
        String,
        nullable=False,
    )

    role = Column(
        String,
        nullable=False,
        default="member",
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )


class OrganizationInvite(Base):
    __tablename__ = "organization_invites"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "email",
            name="uq_organization_invites_org_email",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    organization_id = Column(
        Integer,
        nullable=False,
        index=True,
    )

    email = Column(
        String,
        nullable=False,
        index=True,
    )

    role = Column(
        String,
        nullable=False,
        default="client",
    )

    status = Column(
        String,
        nullable=False,
        default="pending",
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )


class WorkspaceSubscription(Base):
    __tablename__ = "workspace_subscriptions"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )

    provider = Column(
        String,
        nullable=False,
        default="stripe",
    )

    provider_customer_id = Column(
        String,
        nullable=True,
        index=True,
    )

    provider_subscription_id = Column(
        String,
        nullable=True,
        unique=True,
        index=True,
    )

    provider_addon_subscription_item_id = Column(
        String,
        nullable=True,
    )

    price_id = Column(
        String,
        nullable=True,
    )

    plan = Column(
        String,
        nullable=False,
        default="free",
    )

    billing_interval = Column(
        String,
        nullable=False,
        default="month",
    )

    status = Column(
        String,
        nullable=False,
        default="inactive",
        index=True,
    )

    current_period_end = Column(
        DateTime,
        nullable=True,
    )

    current_period_start = Column(
        DateTime,
        nullable=True,
    )

    canceled_at = Column(
        DateTime,
        nullable=True,
    )

    cancel_at_period_end = Column(
        Integer,
        nullable=False,
        default=0,
    )

    lifecycle_notice_key = Column(
        String,
        nullable=True,
    )

    lifecycle_notice_at = Column(
        DateTime,
        nullable=True,
    )

    data_purged_at = Column(
        DateTime,
        nullable=True,
    )

    additional_client_workspaces = Column(
        Integer,
        nullable=False,
        default=0,
    )

    ai_credits_used = Column(
        Integer,
        nullable=False,
        default=0,
    )

    additional_ai_credit_packs = Column(
        Integer,
        nullable=False,
        default=0,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=False,
        index=True,
    )

    actor_user_id = Column(
        String,
        nullable=True,
        index=True,
    )

    operation = Column(
        String,
        nullable=False,
    )

    provider = Column(
        String,
        nullable=False,
        default="",
    )

    status = Column(
        String,
        nullable=False,
        default="reserved",
        index=True,
    )

    period_start = Column(
        DateTime,
        nullable=True,
    )

    estimated_tokens = Column(
        Integer,
        nullable=False,
        default=0,
    )

    prompt_tokens = Column(
        Integer,
        nullable=True,
    )

    completion_tokens = Column(
        Integer,
        nullable=True,
    )

    total_tokens = Column(
        Integer,
        nullable=True,
    )

    estimated_credits = Column(
        Integer,
        nullable=False,
        default=0,
    )

    credits = Column(
        Integer,
        nullable=False,
        default=0,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )


class UsageActivityEvent(Base):
    __tablename__ = "usage_activity_events"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    actor_user_id = Column(
        String,
        nullable=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    route = Column(
        String,
        nullable=False,
        index=True,
    )

    method = Column(
        String,
        nullable=False,
    )

    status_code = Column(
        Integer,
        nullable=False,
        default=200,
    )

    duration_ms = Column(
        Integer,
        nullable=False,
        default=0,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
        index=True,
    )


class PlatformEmailSettings(Base):
    __tablename__ = "platform_email_settings"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    provider = Column(
        String,
        nullable=True,
    )

    resend_api_key = Column(
        Text,
        nullable=True,
    )

    resend_from_email = Column(
        String,
        nullable=True,
    )

    resend_from_name = Column(
        String,
        nullable=True,
    )

    smtp_host = Column(
        String,
        nullable=True,
    )

    smtp_port = Column(
        Integer,
        nullable=True,
    )

    smtp_username = Column(
        String,
        nullable=True,
    )

    smtp_password = Column(
        Text,
        nullable=True,
    )

    smtp_from_email = Column(
        String,
        nullable=True,
    )

    smtp_from_name = Column(
        String,
        nullable=True,
    )

    smtp_use_tls = Column(
        Integer,
        nullable=True,
    )

    smtp_use_ssl = Column(
        Integer,
        nullable=True,
    )

    updated_by_user_id = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class PlatformBillingSettings(Base):
    __tablename__ = "platform_billing_settings"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    free_ai_credits = Column(
        Integer,
        nullable=False,
        default=1000,
    )

    professional_ai_credits = Column(
        Integer,
        nullable=False,
        default=5000,
    )

    agency_ai_credits = Column(
        Integer,
        nullable=False,
        default=25000,
    )

    agency_client_ai_credits = Column(
        Integer,
        nullable=False,
        default=2500,
    )

    agency_growth_ai_credits = Column(
        Integer,
        nullable=False,
        default=15000,
    )

    agency_pro_ai_credits = Column(
        Integer,
        nullable=False,
        default=40000,
    )

    enterprise_ai_credits = Column(
        Integer,
        nullable=False,
        default=0,
    )

    additional_client_workspace_ai_credits = Column(
        Integer,
        nullable=False,
        default=2500,
    )

    ai_credit_pack_size = Column(
        Integer,
        nullable=False,
        default=5000,
    )

    updated_by_user_id = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class BillingWebhookEvent(Base):
    __tablename__ = "billing_webhook_events"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    provider = Column(
        String,
        nullable=False,
        default="stripe",
    )

    provider_event_id = Column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )

    event_type = Column(
        String,
        nullable=False,
    )

    processed_at = Column(
        DateTime,
        default=utc_now,
    )


class WeeklyReportPreference(Base):
    __tablename__ = "weekly_report_preferences"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=False,
        unique=True,
        index=True,
    )

    enabled = Column(
        Integer,
        nullable=False,
        default=0,
    )

    cadence = Column(
        String,
        nullable=False,
        default="weekly",
    )

    delivery_day = Column(
        String,
        nullable=False,
        default="monday",
    )

    recipient_emails = Column(
        Text,
        nullable=True,
    )

    metric_focus = Column(
        Text,
        nullable=True,
    )

    metric_targets = Column(
        Text,
        nullable=True,
    )

    relationship_focus = Column(
        Text,
        nullable=True,
    )

    include_recommendations = Column(
        Integer,
        nullable=False,
        default=1,
    )

    sender_name = Column(
        String,
        nullable=True,
    )

    sender_email = Column(
        String,
        nullable=True,
    )

    reply_to_email = Column(
        String,
        nullable=True,
    )

    subject_prefix = Column(
        String,
        nullable=True,
    )

    smtp_host = Column(
        String,
        nullable=True,
    )

    smtp_port = Column(
        Integer,
        nullable=True,
    )

    smtp_username = Column(
        String,
        nullable=True,
    )

    smtp_password = Column(
        Text,
        nullable=True,
    )

    smtp_use_tls = Column(
        Integer,
        nullable=True,
    )

    smtp_use_ssl = Column(
        Integer,
        nullable=True,
    )

    last_sent_at = Column(
        DateTime,
        nullable=True,
    )

    last_send_status = Column(
        String,
        nullable=True,
    )

    last_send_error = Column(
        Text,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class WeeklyReportDeliveryLog(Base):
    __tablename__ = "weekly_report_delivery_logs"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=False,
        index=True,
    )

    status = Column(
        String,
        nullable=False,
    )

    recipient_emails = Column(
        Text,
        nullable=True,
    )

    subject = Column(
        String,
        nullable=True,
    )

    delivered_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    metrics_count = Column(
        Integer,
        nullable=False,
        default=0,
    )

    error = Column(
        Text,
        nullable=True,
    )

    attempted_at = Column(
        DateTime,
        default=utc_now,
        index=True,
    )


class UserPreference(Base):
    __tablename__ = "user_preferences"
    __table_args__ = (
        UniqueConstraint(
            "clerk_user_id",
            "workspace_id",
            name="uq_user_preferences_user_workspace",
        ),
    )

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    clerk_user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    selected_dataset_id = Column(
        Integer,
        nullable=True,
    )

    selected_metric = Column(
        String,
        nullable=True,
    )

    metric_targets = Column(
        Text,
        nullable=True,
    )

    dashboard_preferences = Column(
        Text,
        nullable=True,
    )

    dashboard_dataset_ids = Column(
        Text,
        nullable=True,
    )

    dashboard_views = Column(
        Text,
        nullable=True,
    )

    selected_dashboard = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )
