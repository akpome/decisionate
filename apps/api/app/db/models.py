from datetime import UTC, datetime

from sqlalchemy import Column
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

    selected_dashboard = Column(
        String,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )
