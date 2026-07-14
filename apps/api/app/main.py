import os

from fastapi import FastAPI
from fastapi import HTTPException

from app.db.database import Base
from app.db.database import engine
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

from app.modules.forecasting.router import (
    router as forecasting_router,
)

from app.modules.public_dashboard import (
    router as public_dashboard_router,
)

from app.modules.decisions import (
    router as decisions_router
)

from app.modules.decisions.models import Decision
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.auth_context import (
    get_auth_context,
)

Base.metadata.create_all(bind=engine)


def ensure_organization_branding_columns():
    with engine.begin() as connection:
        columns = connection.execute(
            text("PRAGMA table_info(organizations)")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

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
        ]:
            if column_name not in column_names:
                connection.execute(
                    text(
                        f"ALTER TABLE organizations ADD COLUMN {column_name} {column_type}"
                    )
                )


ensure_organization_branding_columns()


def ensure_workspace_column(
    table_name: str,
    owner_column: str,
):
    with engine.begin() as connection:
        columns = connection.execute(
            text(f"PRAGMA table_info({table_name})")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

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
# Workspace Lookup Indexes For Agency Client Scoped Queries
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
# Decision Activity Workspace Backfill For Agency Client History
# =========================

def ensure_decision_activity_workspace_column():
    with engine.begin() as connection:
        columns = connection.execute(
            text("PRAGMA table_info(decision_activities)")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

        if "workspace_id" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decision_activities "
                    "ADD COLUMN workspace_id VARCHAR"
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


ensure_decision_activity_workspace_column()


# =========================
# Decision Optional Column Backfill For Existing Development Databases
# =========================

def ensure_decision_optional_columns():
    with engine.begin() as connection:
        columns = connection.execute(
            text("PRAGMA table_info(decisions)")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

        if "confidence_score" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decisions "
                    "ADD COLUMN confidence_score VARCHAR"
                )
            )

        if "updated_at" not in column_names:
            connection.execute(
                text(
                    "ALTER TABLE decisions "
                    "ADD COLUMN updated_at DATETIME"
                )
            )


ensure_decision_optional_columns()


# =========================
# Dataset Source Metadata Backfill For CSV And Future Connectors
# =========================

def ensure_dataset_source_columns():
    with engine.begin() as connection:
        columns = connection.execute(
            text("PRAGMA table_info(datasets)")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

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
        columns = connection.execute(
            text("PRAGMA table_info(user_preferences)")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

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
                        created_at DATETIME,
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
        columns = connection.execute(
            text("PRAGMA table_info(datasets)")
        ).fetchall()

        column_names = {
            column[1]
            for column in columns
        }

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
    configured_origins = os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000",
    )

    return [
        origin.strip()
        for origin in configured_origins.split(",")
        if origin.strip()
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
    )

    if (
        request.method != "OPTIONS"
        and request.url.path.startswith(protected_prefixes)
    ):
        try:
            get_auth_context(
                request,
            )
        except HTTPException as error:
            return JSONResponse(
                status_code=error.status_code,
                content={
                    "detail": error.detail,
                },
            )

    return await call_next(
        request,
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
    decisions_router.router
)

@app.get("/")
def root():
    return {
        "message": "Decisionate API"
    }
