import os
import logging

from fastapi import FastAPI
from fastapi import HTTPException

from app.db.database import Base
from app.db.database import engine
from app.db.database import SessionLocal
from app.db.database import get_table_columns
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.modules.datasets.router import (
    router as datasets_router,
)

from app.modules.organizations.router import (
    router as organization_router,
)

from app.modules.alerts.router import (
    router as alerts_router,
)
from app.modules.alerts.email_delivery import (
    is_email_delivery_configured,
)
from app.modules.billing.router import (
    router as billing_router,
)
from app.modules.billing.service import (
    get_billing_config,
    is_billing_configured,
)
from app.modules.billing.lifecycle import (
    build_subscription_access_state,
    get_subscription_for_workspace,
    is_subscription_exempt_path,
    subscription_access_error,
)
from app.modules.billing.notifications import (
    get_billing_scheduler_secret,
)
from app.modules.oauth.router import (
    router as oauth_router,
)

from app.modules.ai.router import (
    router as ai_router,
)
from app.modules.ai.service import (
    build_ai_status,
)

from app.modules.forecasting.router import (
    router as forecasting_router,
)

from app.modules.datasets.services.analytics_engine import (
    build_analytics_engine_status,
)
from app.modules.datasets.services.google_analytics import (
    is_google_analytics_connector_available,
)

from app.modules.public_dashboard import (
    router as public_dashboard_router,
)
from app.modules.demo_dashboard import (
    router as demo_dashboard_router,
)

from app.modules.platform_admin import (
    ensure_platform_admin_roles,
    router as platform_admin_router,
)
from app.modules.support.router import (
    router as support_router,
)

from app.modules.decisions import (
    router as decisions_router
)

from app.modules.decisions.models import Decision
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.auth_context import (
    get_auth_context,
)
from app.modules.usage_activity import (
    collect_usage_activity,
)
from app.modules.identity.service import (
    ensure_internal_identity_backfill,
)
from app.infrastructure.cache import build_cache_status
from app.infrastructure.object_storage import build_storage_status
from app.configuration import (
    build_runtime_configuration_status,
    get_runtime_configuration,
)
from app.security.config import (
    build_security_configuration_status,
    validate_production_security_configuration,
)


logger = logging.getLogger(__name__)


def configure_error_monitoring():
    runtime = get_runtime_configuration()
    dsn = runtime.sentry_dsn
    if not dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=runtime.app_env,
            traces_sample_rate=float(
                runtime.sentry_traces_sample_rate or 0
            ),
        )
    except ModuleNotFoundError:
        logger.warning(
            "SENTRY_DSN is set but sentry-sdk is not installed"
        )
    except (TypeError, ValueError) as error:
        logger.warning("Sentry configuration is invalid: %s", error)


configure_error_monitoring()
validate_production_security_configuration()

Base.metadata.create_all(bind=engine)


def ensure_dataset_relationship_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "dataset_relationships",
        )
        if not column_names:
            return
        if "lag_mode" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE dataset_relationships "
                    "ADD COLUMN lag_mode VARCHAR NOT NULL DEFAULT 'manual'"
                )
            )


ensure_dataset_relationship_columns()


def ensure_oauth_connection_state_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "oauth_connection_states",
        )
        if "code_verifier" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE oauth_connection_states "
                    "ADD COLUMN code_verifier TEXT"
                )
            )


ensure_oauth_connection_state_columns()


def ensure_data_source_connection_status_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "data_source_connections",
        )
        for column_name, column_type in [
            ("authorization_error", "TEXT"),
            ("authorization_error_at", "TIMESTAMP"),
            ("authorization_notification_error", "TEXT"),
            ("authorization_notification_sent_at", "TIMESTAMP"),
        ]:
            if column_name not in column_names:
                connection.execute(
                    text(
                        "ALTER TABLE data_source_connections "
                        f"ADD COLUMN {column_name} {column_type}"
                    )
                )


ensure_data_source_connection_status_columns()


def ensure_platform_admin_role_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "platform_admin_roles",
        )
        if "permissions" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE platform_admin_roles "
                    "ADD COLUMN permissions TEXT"
                )
            )


ensure_platform_admin_role_columns()


def ensure_organization_branding_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(connection, "organizations")

        for column_name, column_type in [
            (
                "logo_url",
                "TEXT",
            ),
            (
                "primary_color",
                "VARCHAR",
            ),
            (
                "accent_color",
                "VARCHAR",
            ),
            (
                "report_display_name",
                "VARCHAR",
            ),
            (
                "agency_owner_access_enabled",
                "BOOLEAN DEFAULT FALSE",
            ),
        ]:
            if column_name not in column_names:
                connection.execute(
                    text(
                        f"ALTER TABLE organizations ADD COLUMN {column_name} {column_type}"
                    )
                )


ensure_organization_branding_columns()


def ensure_platform_email_provider_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "platform_email_settings",
        )
        for column_name, column_type in [
            ("provider", "VARCHAR"),
            ("resend_api_key", "TEXT"),
            ("resend_from_email", "VARCHAR"),
            ("resend_from_name", "VARCHAR"),
        ]:
            if column_name not in column_names:
                connection.execute(
                    text(
                        "ALTER TABLE platform_email_settings "
                        f"ADD COLUMN {column_name} {column_type}"
                    )
                )


ensure_platform_email_provider_columns()


def ensure_billing_subscription_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "workspace_subscriptions",
        )

        for column_name, column_type, default_value in [
            ("additional_client_workspaces", "INTEGER", "0"),
            ("provider_addon_subscription_item_id", "VARCHAR", "NULL"),
            ("billing_interval", "VARCHAR", "'month'"),
            ("current_period_start", "TIMESTAMP", "NULL"),
            ("ai_credits_used", "INTEGER", "0"),
            ("additional_ai_credit_packs", "INTEGER", "0"),
            ("lifecycle_notice_key", "VARCHAR", "NULL"),
            ("lifecycle_notice_at", "TIMESTAMP", "NULL"),
            ("data_purged_at", "TIMESTAMP", "NULL"),
            ("canceled_at", "TIMESTAMP", "NULL"),
        ]:
            if column_name not in column_names:
                default_clause = (
                    ""
                    if default_value == "NULL"
                    else f"NOT NULL DEFAULT {default_value}"
                )
                connection.execute(
                    text(
                        "ALTER TABLE workspace_subscriptions "
                        f"ADD COLUMN {column_name} {column_type} "
                        f"{default_clause}"
                    )
                )


ensure_billing_subscription_columns()


def ensure_platform_billing_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "platform_billing_settings",
        )
        if not column_names:
            return

        if "agency_client_ai_credits" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE platform_billing_settings "
                    "ADD COLUMN agency_client_ai_credits "
                    "INTEGER NOT NULL DEFAULT 2500"
                )
            )


ensure_platform_billing_columns()


def ensure_ai_usage_event_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "ai_usage_events",
        )

        if "actor_user_id" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE ai_usage_events "
                    "ADD COLUMN actor_user_id VARCHAR"
                )
            )

        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS "
                "idx_ai_usage_events_actor_user_id "
                "ON ai_usage_events (actor_user_id)"
            )
        )


ensure_ai_usage_event_columns()


def ensure_workspace_column(
    table_name: str,
    owner_column: str,
):
    with engine.begin() as connection:
        column_names = get_table_columns(connection, table_name)

        if "workspace_id" not in column_names:
            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN workspace_id VARCHAR")
            )

        connection.execute(
            text(
                f"""
                UPDATE {table_name}
                SET workspace_id = {owner_column}
                WHERE workspace_id IS NULL
                """
            )
        )


ensure_workspace_column(
    "decisions",
    "clerk_user_id",
)
ensure_workspace_column(
    "datasets",
    "user_id",
)
ensure_workspace_column(
    "user_preferences",
    "clerk_user_id",
)


# =========================
# Provider-Independent Identity Backfill
# =========================

ensure_internal_identity_backfill()
ensure_platform_admin_roles()


# =========================
# Workspace Lookup Indexes For Shared Workspace Scoped Queries
# =========================

def ensure_workspace_indexes():
    workspace_indexes = [
        (
            "idx_decisions_workspace_id",
            "decisions",
            "workspace_id",
        ),
        (
            "idx_decisions_user_workspace",
            "decisions",
            "clerk_user_id, workspace_id",
        ),
        (
            "idx_datasets_workspace_id",
            "datasets",
            "workspace_id",
        ),
        (
            "idx_datasets_user_workspace",
            "datasets",
            "user_id, workspace_id",
        ),
        (
            "idx_user_preferences_workspace_id",
            "user_preferences",
            "workspace_id",
        ),
        (
            "idx_user_preferences_user_workspace",
            "user_preferences",
            "clerk_user_id, workspace_id",
        ),
    ]

    with engine.begin() as connection:
        for index_name, table_name, column_names in workspace_indexes:
            connection.execute(
                text(
                    f"""
                    CREATE INDEX IF NOT EXISTS {index_name}
                    ON {table_name} ({column_names})
                    """
                )
            )


ensure_workspace_indexes()


# =========================
# Decision Activity Workspace Backfill For Shared Workspace History
# =========================

def ensure_decision_activity_workspace_column():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "decision_activities",
        )

        if "workspace_id" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decision_activities "
                    "ADD COLUMN workspace_id VARCHAR"
                )
            )

        if "decision_title" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decision_activities "
                    "ADD COLUMN decision_title VARCHAR"
                )
            )

        if "actor_user_id" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decision_activities "
                    "ADD COLUMN actor_user_id VARCHAR"
                )
            )

        connection.execute(
            text(
                """
                UPDATE decision_activities
                SET workspace_id = (
                    SELECT decisions.workspace_id
                    FROM decisions
                    WHERE decisions.id = decision_activities.decision_id
                )
                WHERE workspace_id IS NULL
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decision_activities
                SET decision_title = (
                    SELECT decisions.title
                    FROM decisions
                    WHERE decisions.id = decision_activities.decision_id
                )
                WHERE decision_title IS NULL
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_decision_activities_workspace_id
                ON decision_activities (workspace_id)
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_decision_activities_decision_workspace
                ON decision_activities (decision_id, workspace_id)
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_decision_activities_actor_user_id
                ON decision_activities (actor_user_id)
                """
            )
        )


ensure_decision_activity_workspace_column()


def ensure_decision_activity_delete_history():
    """Allow audit rows to survive deletion of their decision."""
    # The declarative model already creates the correct nullable SET NULL
    # foreign key for new Postgres databases. This legacy table rebuild is
    # SQLite-specific and is retained only for existing local databases.
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        columns = connection.execute(
            text("PRAGMA table_info(decision_activities)")
        ).fetchall()

        if not columns:
            return

        decision_column = next(
            (
                column
                for column in columns
                if column[1] == "decision_id"
            ),
            None,
        )
        foreign_key = next(
            (
                foreign_key
                for foreign_key in connection.execute(
                    text(
                        "PRAGMA foreign_key_list(decision_activities)"
                    )
                ).fetchall()
                if foreign_key[3] == "decision_id"
            ),
            None,
        )

        if (
            decision_column is not None
            and decision_column[3] == 0
            and foreign_key is not None
            and str(foreign_key[6]).upper() == "SET NULL"
        ):
            return

        connection.execute(
            text(
                "ALTER TABLE decision_activities "
                "RENAME TO decision_activities_legacy"
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE decision_activities (
                    id INTEGER PRIMARY KEY,
                    decision_id INTEGER,
                    workspace_id VARCHAR,
                    actor_user_id VARCHAR,
                    activity_type VARCHAR NOT NULL,
                    decision_title VARCHAR,
                    message VARCHAR NOT NULL,
                    created_at TIMESTAMP,
                    FOREIGN KEY (decision_id)
                        REFERENCES decisions(id)
                        ON DELETE SET NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO decision_activities (
                    id,
                    decision_id,
                    workspace_id,
                    actor_user_id,
                    activity_type,
                    decision_title,
                    message,
                    created_at
                )
                SELECT
                    id,
                    decision_id,
                    workspace_id,
                    actor_user_id,
                    activity_type,
                    decision_title,
                    message,
                    created_at
                FROM decision_activities_legacy
                """
            )
        )
        connection.execute(
            text("DROP TABLE decision_activities_legacy")
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_decision_activities_workspace_id
                ON decision_activities (workspace_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_decision_activities_decision_workspace
                ON decision_activities (decision_id, workspace_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_decision_activities_actor_user_id
                ON decision_activities (actor_user_id)
                """
            )
        )


ensure_decision_activity_delete_history()


# =========================
# Decision Optional Column Backfill For Existing Development Databases
# =========================

def ensure_decision_optional_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(connection, "decisions")

        if "confidence_score" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decisions "
                    "ADD COLUMN confidence_score VARCHAR"
                )
            )

        if "metric_column" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decisions "
                    "ADD COLUMN metric_column VARCHAR"
                )
            )

        if "updated_at" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decisions "
                    "ADD COLUMN updated_at TIMESTAMP"
                )
            )

        for column_name, column_type in [
            ("action", "TEXT"),
            ("recommendation_text", "TEXT"),
            ("recommendation_source", "VARCHAR"),
            ("recommendation_context", "TEXT"),
        ]:
            if column_name not in column_names:
                connection.execute(
                    text(
                        f"ALTER TABLE decisions "
                        f"ADD COLUMN {column_name} {column_type}"
                    )
                )

        # Older decisions predate the explicit action field. Their title is
        # the safest migration value until the owner edits the action.
        connection.execute(
            text(
                "UPDATE decisions SET action = title "
                "WHERE action IS NULL OR trim(action) = ''"
            )
        )


ensure_decision_optional_columns()


# =========================
# Dataset Source Metadata Backfill For CSV And Future Connectors
# =========================

def ensure_dataset_source_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(connection, "datasets")

        if "source_type" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE datasets "
                    "ADD COLUMN source_type VARCHAR DEFAULT 'csv'"
                )
            )

        if "source_config" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE datasets "
                    "ADD COLUMN source_config TEXT"
                )
            )

        connection.execute(
            text(
                """
                UPDATE datasets
                SET source_type = 'csv'
                WHERE source_type IS NULL
                OR source_type = ''
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_datasets_source_type
                ON datasets (source_type)
                """
            )
        )


ensure_dataset_source_columns()


def ensure_dataset_storage_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(connection, "datasets")
        if "storage_provider" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE datasets "
                    "ADD COLUMN storage_provider VARCHAR"
                )
            )


ensure_dataset_storage_columns()


# =========================
# Decision Title Cleanup For Existing Required Records
# =========================

def normalize_existing_decision_titles():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE decisions
                SET title = trim(title)
                WHERE title IS NOT NULL
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET title = 'Untitled decision'
                WHERE title IS NULL
                OR title = ''
                """
            )
        )


normalize_existing_decision_titles()


# =========================
# Decision Text Cleanup For Existing Whitespace Only Records
# =========================

def normalize_existing_decision_text_columns():
    text_columns = [
        "description",
        "notes",
        "expected_outcome",
        "actual_outcome",
        "lessons_learned",
        "recommendation_text",
        "recommendation_context",
        "confidence_score",
    ]

    with engine.begin() as connection:
        for column_name in text_columns:
            connection.execute(
                text(
                    f"""
                    UPDATE decisions
                    SET {column_name} = NULL
                    WHERE {column_name} IS NOT NULL
                    AND trim({column_name}) = ''
                    """
                )
            )

            connection.execute(
                text(
                    f"""
                    UPDATE decisions
                    SET {column_name} = trim({column_name})
                    WHERE {column_name} IS NOT NULL
                    """
                )
            )


normalize_existing_decision_text_columns()


# =========================
# Decision Controlled Value Cleanup For Existing Portfolio Metrics
# =========================

def normalize_existing_decision_controlled_columns():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE decisions
                SET status = trim(status)
                WHERE status IS NOT NULL
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET status = 'planned'
                WHERE status IS NULL
                OR status = ''
                OR status NOT IN (
                    'planned',
                    'in_progress',
                    'completed',
                    'cancelled',
                    'archived'
                )
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET priority = trim(priority)
                WHERE priority IS NOT NULL
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET priority = 'medium'
                WHERE priority IS NULL
                OR priority = ''
                OR priority NOT IN (
                    'high',
                    'medium',
                    'low'
                )
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET category = trim(category)
                WHERE category IS NOT NULL
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET category = 'general'
                WHERE category IS NULL
                OR category = ''
                OR category NOT IN (
                    'general',
                    'marketing',
                    'sales',
                    'operations',
                    'finance',
                    'hiring',
                    'product'
                )
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET outcome_status = trim(outcome_status)
                WHERE outcome_status IS NOT NULL
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE decisions
                SET outcome_status = NULL
                WHERE outcome_status IS NOT NULL
                AND (
                    outcome_status = ''
                    OR outcome_status NOT IN (
                        'successful',
                        'partially_successful',
                        'unsuccessful'
                    )
                )
                """
            )
        )


normalize_existing_decision_controlled_columns()


def ensure_user_preference_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "user_preferences",
        )

        if "metric_targets" not in column_names:
            connection.execute(
                text("ALTER TABLE user_preferences ADD COLUMN metric_targets TEXT")
            )

        if "dashboard_preferences" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE user_preferences "
                    "ADD COLUMN dashboard_preferences TEXT"
                )
            )

        if "dashboard_dataset_ids" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE user_preferences "
                    "ADD COLUMN dashboard_dataset_ids TEXT"
                )
            )

        if "dashboard_views" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE user_preferences "
                    "ADD COLUMN dashboard_views TEXT"
                )
            )

        if "selected_dashboard" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE user_preferences "
                    "ADD COLUMN selected_dashboard VARCHAR"
                )
            )


ensure_user_preference_columns()


def ensure_user_preference_workspace_uniqueness():
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        indexes = connection.execute(
            text("PRAGMA index_list(user_preferences)")
        ).fetchall()
        has_single_user_unique_index = False

        for index in indexes:
            index_name = index[1]
            is_unique = bool(index[2])

            if not is_unique:
                continue

            indexed_columns = connection.execute(
                text(f"PRAGMA index_info({index_name})")
            ).fetchall()
            column_names = [
                column[2]
                for column in indexed_columns
            ]

            if column_names == ["clerk_user_id"]:
                has_single_user_unique_index = True
                break

        if has_single_user_unique_index:
            connection.execute(
                text(
                    """
                    DROP TABLE IF EXISTS
                    user_preferences_workspace_migration
                    """
                )
            )
            connection.execute(
                text(
                    """
                    CREATE TABLE user_preferences_workspace_migration (
                        id INTEGER NOT NULL,
                        clerk_user_id VARCHAR NOT NULL,
                        workspace_id VARCHAR,
                        selected_dataset_id INTEGER,
                        selected_metric VARCHAR,
                        metric_targets TEXT,
                        dashboard_preferences TEXT,
                        dashboard_dataset_ids TEXT,
                        dashboard_views TEXT,
                        selected_dashboard VARCHAR,
                        created_at TIMESTAMP,
                        PRIMARY KEY (id)
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    INSERT INTO user_preferences_workspace_migration (
                        id,
                        clerk_user_id,
                        workspace_id,
                        selected_dataset_id,
                        selected_metric,
                        metric_targets,
                        dashboard_preferences,
                        dashboard_dataset_ids,
                        dashboard_views,
                        selected_dashboard,
                        created_at
                    )
                    SELECT
                        id,
                        clerk_user_id,
                        workspace_id,
                        selected_dataset_id,
                        selected_metric,
                        metric_targets,
                        dashboard_preferences,
                        dashboard_dataset_ids,
                        dashboard_views,
                        selected_dashboard,
                        created_at
                    FROM user_preferences
                    """
                )
            )
            connection.execute(
                text("DROP TABLE user_preferences")
            )
            connection.execute(
                text(
                    """
                    ALTER TABLE user_preferences_workspace_migration
                    RENAME TO user_preferences
                    """
                )
            )

        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS
                uq_user_preferences_user_workspace
                ON user_preferences (clerk_user_id, workspace_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_user_preferences_clerk_user_id
                ON user_preferences (clerk_user_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_user_preferences_workspace_id
                ON user_preferences (workspace_id)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_user_preferences_user_workspace
                ON user_preferences (clerk_user_id, workspace_id)
                """
            )
        )


ensure_user_preference_workspace_uniqueness()


def ensure_dataset_share_token_column():
    with engine.begin() as connection:
        column_names = get_table_columns(connection, "datasets")

        if "share_token" not in column_names:
            connection.execute(
                text("ALTER TABLE datasets ADD COLUMN share_token VARCHAR")
            )

        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_datasets_share_token
                ON datasets (share_token)
                """
            )
        )


ensure_dataset_share_token_column()


def ensure_dashboard_shares_table():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS dashboard_shares (
                    id INTEGER PRIMARY KEY,
                    dataset_id INTEGER NOT NULL,
                    dashboard_key VARCHAR NOT NULL,
                    share_token VARCHAR NOT NULL,
                    created_at TIMESTAMP,
                    CONSTRAINT uq_dashboard_shares_dataset_dashboard
                    UNIQUE (dataset_id, dashboard_key)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_shares_share_token
                ON dashboard_shares (share_token)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_dashboard_shares_dataset_dashboard
                ON dashboard_shares (dataset_id, dashboard_key)
                """
            )
        )


ensure_dashboard_shares_table()


def ensure_weekly_report_delivery_columns():
    with engine.begin() as connection:
        column_names = get_table_columns(
            connection,
            "weekly_report_preferences",
        )

        for column_name, column_type in [
            (
                "relationship_focus",
                "TEXT",
            ),
            (
                "metric_targets",
                "TEXT",
            ),
            (
                "sender_name",
                "VARCHAR",
            ),
            (
                "sender_email",
                "VARCHAR",
            ),
            (
                "reply_to_email",
                "VARCHAR",
            ),
            (
                "subject_prefix",
                "VARCHAR",
            ),
            (
                "smtp_host",
                "VARCHAR",
            ),
            (
                "smtp_port",
                "INTEGER",
            ),
            (
                "smtp_username",
                "VARCHAR",
            ),
            (
                "smtp_password",
                "TEXT",
            ),
            (
                "smtp_use_tls",
                "INTEGER",
            ),
            (
                "smtp_use_ssl",
                "INTEGER",
            ),
            (
                "last_sent_at",
                "TIMESTAMP",
            ),
            (
                "last_send_status",
                "VARCHAR",
            ),
            (
                "last_send_error",
                "TEXT",
            ),
        ]:
            if column_name not in column_names:
                connection.execute(
                    text(
                        "ALTER TABLE weekly_report_preferences "
                        f"ADD COLUMN {column_name} {column_type}"
                    )
                )

        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS
                idx_weekly_report_preferences_enabled_day
                ON weekly_report_preferences (enabled, delivery_day)
                """
            )
        )


ensure_weekly_report_delivery_columns()


# =========================
# Organization Owner Membership Backfill For Workspace Role Readiness
# =========================

def ensure_organization_owner_memberships():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO organization_members (
                    organization_id,
                    clerk_user_id,
                    role,
                    created_at
                )
                SELECT
                    organizations.id,
                    organizations.owner_user_id,
                    'owner',
                    CURRENT_TIMESTAMP
                FROM organizations
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM organization_members
                    WHERE organization_members.organization_id = organizations.id
                    AND organization_members.clerk_user_id = organizations.owner_user_id
                )
                """
            )
        )


ensure_organization_owner_memberships()

app = FastAPI(
    title="Decisionate API"
)


def get_allowed_origins():
    runtime = get_runtime_configuration()
    configured_origins = list(runtime.cors_allowed_origins)
    configured_web_origin = runtime.web_url.strip().rstrip("/")

    if (
        configured_web_origin and
        configured_web_origin not in configured_origins
    ):
        configured_origins.append(configured_web_origin)

    if configured_origins:
        return configured_origins

    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]


# =========================
# API Authentication Boundary For Protected Product Routes
# =========================

@app.middleware("http")
async def enforce_product_route_auth(
    request,
    call_next,
):
    protected_prefixes = (
        "/datasets",
        "/organizations",
        "/alerts",
        "/forecasting",
        "/decisions",
        "/billing",
        "/ai",
    )

    if (
        request.method != "OPTIONS"
        and request.url.path.startswith(protected_prefixes)
        and request.url.path not in {
            "/datasets/source-connections/sync-due",
            "/alerts/weekly-report/send-due",
            "/billing/lifecycle/send-due",
        }
    ):
        try:
            request.state.auth_context = get_auth_context(
                request,
            )
        except HTTPException as error:
            return JSONResponse(
                status_code=error.status_code,
                content={
                    "detail": error.detail,
                },
            )

        if not is_subscription_exempt_path(request.url.path):
            db = SessionLocal()
            try:
                subscription = get_subscription_for_workspace(
                    db,
                    request.state.auth_context.workspace_id,
                )
                access_state = build_subscription_access_state(
                    subscription,
                )
                if not access_state.access_allowed:
                    return JSONResponse(
                        status_code=402,
                        content={
                            "detail": subscription_access_error(
                                access_state,
                            ),
                            "subscription_required": True,
                            "subscription_status": access_state.status,
                            "current_period_end": (
                                access_state.current_period_end.isoformat()
                                if access_state.current_period_end
                                else None
                            ),
                            "grace_period_end": (
                                access_state.grace_period_end.isoformat()
                                if access_state.grace_period_end
                                else None
                            ),
                        },
                    )
            finally:
                db.close()

    return await call_next(
        request,
    )


@app.middleware("http")
async def collect_product_usage_activity(
    request,
    call_next,
):
    return await collect_usage_activity(
        request,
        call_next,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    datasets_router,
    prefix="/datasets",
    tags=["datasets"],
)

app.include_router(
    organization_router,
    prefix="/organizations",
    tags=["organizations"],
)

app.include_router(
    alerts_router,
    prefix="/alerts",
    tags=["alerts"],
)

app.include_router(
    billing_router,
    prefix="/billing",
    tags=["billing"],
)

app.include_router(
    oauth_router,
    prefix="/oauth",
    tags=["oauth"],
)

app.include_router(
    ai_router,
    prefix="/ai",
    tags=["ai"],
)

app.include_router(
    forecasting_router,
    prefix="/forecasting",
    tags=["forecasting"],
)

app.include_router(
    public_dashboard_router,
    prefix="/public",
    tags=["public"],
)

app.include_router(
    demo_dashboard_router,
    prefix="/public",
    tags=["public-demo"],
)

app.include_router(
    decisions_router.router
)

app.include_router(
    platform_admin_router,
    prefix="/admin",
    tags=["platform-admin"],
)

app.include_router(
    support_router,
    prefix="/support",
    tags=["support"],
)

@app.get("/")
def root():
    return {
        "message": "Decisionate API"
    }


@app.get("/health")
def health():
    try:
        analytics_status = build_analytics_engine_status()
        health_status = "ok"
    except (OSError, ValueError) as error:
        health_status = "degraded"
        analytics_status = {
            "engine": "unavailable",
            "storage_format": "unknown",
            "error": str(error),
        }

    return JSONResponse(
        content={
            "status": health_status,
            "service": "decisionate-api",
            "capabilities": {
                "ai": build_ai_status(),
                "analytics": analytics_status,
                "storage": build_storage_status(),
                "cache": build_cache_status(),
                "alerts": {
                    "server_smtp_configured": (
                        is_email_delivery_configured()
                    ),
                    "scheduler_configured": bool(
                        os.getenv(
                            "ALERTS_SCHEDULER_SECRET",
                            "",
                        ).strip()
                    ),
                },
                "connectors": {
                    "google_analytics": {
                        "configured": is_google_analytics_connector_available(),
                    },
                    "scheduler_configured": bool(
                        os.getenv("CONNECTORS_SCHEDULER_SECRET", "").strip()
                    ),
                },
                "billing": {
                    "provider": get_billing_config()["provider"],
                    "configured": is_billing_configured(),
                    "lifecycle_scheduler_configured": bool(
                        get_billing_scheduler_secret()
                    ),
                },
            "security": build_security_configuration_status(),
            "configuration": build_runtime_configuration_status(),
            },
        },
        headers={"Cache-Control": "no-store"},
    )
