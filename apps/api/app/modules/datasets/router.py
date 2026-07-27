import asyncio
import json
import math
import os
import shutil
import uuid
from secrets import token_urlsafe

from fastapi import APIRouter
from fastapi import File
from fastapi import HTTPException
from fastapi import Query
from fastapi import UploadFile
from fastapi import Request
from fastapi import Response

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import DataSourceConnection
from app.db.models import DashboardShare
from app.db.models import Dataset
from app.db.models import UserPreference

from app.modules.datasets.schemas import DataSourceConnectionCreate
from app.modules.datasets.schemas import DataSourceConnectionUpdate
from app.modules.datasets.schemas import DatasetCreate

from app.modules.datasets.services.dataset_loader import (
    load_dataset,
    load_dataframe,
)
from app.modules.datasets.services.file_loader import (
    build_upload_source_config,
    load_dataset_file,
    sanitize_upload_filename,
)

from app.modules.datasets.services.analytics_engine import (
    build_analytics_engine_status,
)
from app.modules.datasets.services.preview import (
    generate_preview,
)

from app.modules.datasets.services.metrics import (
    generate_metrics,
)
from app.modules.datasets.services.numeric import (
    get_numeric_columns,
)

from app.modules.datasets.services.charts import (
    generate_chart_data,
)

from app.modules.datasets.services.insights import (
    generate_dataset_ai_analysis,
    generate_insights,
)
from app.modules.ai.learning import (
    build_dataset_decision_learning_filter,
    build_workspace_decision_learning_context,
)

from app.modules.datasets.services.ownership import (
    verify_dataset_owner,
)
from app.modules.organizations.router import (
    DEFAULT_SELECTED_DASHBOARD,
    VALID_SELECTED_DASHBOARDS,
)
from app.modules.datasets.services.analytics_storage import (
    build_dataset_analytics_manifest,
)
from app.modules.datasets.services.source_metadata import (
    build_dataset_source_metadata,
)
from app.modules.datasets.services.sources import (
    get_dataset_source,
    is_dataset_source_available,
    list_dataset_sources,
    normalize_dataset_source_type,
)
from app.modules.datasets.services.auth import (
    get_user_id,
    get_workspace_id,
    require_workspace_data_manager,
)

router = APIRouter()


def get_dataset_upload_dir():
    upload_dir = str(
        os.getenv(
            "DATASET_UPLOAD_DIR",
            "uploads",
        )
        or ""
    ).strip()

    return upload_dir or "uploads"


def build_dataset_upload_path(
    filename: str | None,
):
    safe_filename = sanitize_upload_filename(
        filename
    )

    return os.path.join(
        get_dataset_upload_dir(),
        f"{uuid.uuid4()}-{safe_filename}",
    )


def remove_dataset_file(
    file_path: str | None,
):
    if not file_path:
        return

    try:
        os.remove(file_path)
    except FileNotFoundError:
        return


def remove_dataset_preference_entry(
    preference_json: str | None,
    dataset_id: int,
):
    if not preference_json:
        return preference_json

    try:
        preferences = json.loads(
            preference_json
        )
    except json.JSONDecodeError:
        return None

    if not isinstance(preferences, dict):
        return None

    dataset_key = str(dataset_id)

    if dataset_key not in preferences:
        return preference_json

    next_preferences = {
        key: value
        for key, value in preferences.items()
        if key != dataset_key
    }

    return (
        json.dumps(next_preferences)
        if next_preferences
        else None
    )


def cleanup_deleted_dataset_preferences(
    db,
    dataset,
):
    if dataset.workspace_id:
        preferences = (
            db.query(UserPreference)
            .filter(
                UserPreference.workspace_id == dataset.workspace_id,
            )
            .all()
        )
    else:
        preferences = (
            db.query(UserPreference)
            .filter(
                UserPreference.clerk_user_id == dataset.user_id,
                UserPreference.workspace_id.is_(None),
            )
            .all()
        )

    for preference in preferences:
        if preference.selected_dataset_id == dataset.id:
            preference.selected_dataset_id = None
            preference.selected_metric = None

        preference.metric_targets = remove_dataset_preference_entry(
            preference.metric_targets,
            dataset.id,
        )
        preference.dashboard_preferences = remove_dataset_preference_entry(
            preference.dashboard_preferences,
            dataset.id,
        )


def build_dataset_summary_response(
    dataset,
):
    return {
        "id": dataset.id,
        "user_id": dataset.user_id,
        "workspace_id": dataset.workspace_id,
        **build_dataset_source_metadata(
            dataset
        ),
        "file_name": dataset.file_name,
        "row_count": dataset.row_count,
        "column_count": dataset.column_count,
        "analytics": build_dataset_analytics_manifest(
            dataset
        ),
        "created_at": dataset.created_at,
    }


def build_dataset_details_response(
    dataset,
    dataframe,
    learning_context: dict | None = None,
    chart_limit: int | None = 50,
):
    return {
        **build_dataset_summary_response(
            dataset
        ),
        "preview": generate_preview(dataframe),
        "metrics": generate_metrics(dataframe),
        "insights": generate_insights(dataframe),
        "ai_analysis": generate_dataset_ai_analysis(
            dataframe,
            None,
            learning_context,
        ),
        "chart": generate_chart_data(
            dataframe,
            limit=chart_limit,
        ),
    }


def build_source_connection_response(
    connection,
):
    source_type = normalize_dataset_source_type(
        connection.source_type
    )
    source = get_dataset_source(
        source_type
    )

    return {
        "id": connection.id,
        "user_id": connection.user_id,
        "workspace_id": connection.workspace_id,
        "source_type": source_type,
        "source_label": (
            source["label"]
            if source
            else source_type
        ),
        "source_status": (
            source["status"]
            if source
            else None
        ),
        "availability_note": (
            source.get("availability_note")
            if source
            else None
        ),
        "environment_configured": (
            has_source_connection_credentials(
                source,
                connection.connection_config,
            )
        ),
        "display_name": connection.display_name,
        "status": connection.status,
        "has_config": has_source_connection_config(
            connection.connection_config
        ),
        "last_synced_at": connection.last_synced_at,
        "created_at": connection.created_at,
        "updated_at": connection.updated_at,
    }


def has_source_connection_config(
    connection_config,
):
    if connection_config is None:
        return False

    if isinstance(
        connection_config,
        str,
    ):
        clean_config = connection_config.strip()

        if not clean_config:
            return False

        try:
            parsed_config = json.loads(
                clean_config
            )
        except json.JSONDecodeError:
            return True

        return has_source_connection_config(
            parsed_config
        )

    if isinstance(
        connection_config,
        dict,
    ):
        return any(
            has_config_value(
                value
            )
            for value in connection_config.values()
        )

    return has_config_value(
        connection_config
    )


def has_config_value(
    value,
):
    if value is None:
        return False

    if isinstance(
        value,
        str,
    ):
        return bool(
            value.strip()
        )

    if isinstance(
        value,
        dict,
    ):
        return has_source_connection_config(
            value
        )

    if isinstance(
        value,
        list,
    ):
        return any(
            has_config_value(
                item
            )
            for item in value
        )

    return True


def parse_source_connection_config(
    connection_config,
):
    if not connection_config:
        return {}

    if isinstance(
        connection_config,
        dict,
    ):
        return connection_config

    if isinstance(
        connection_config,
        str,
    ):
        try:
            parsed_config = json.loads(
                connection_config
            )
        except json.JSONDecodeError:
            return {}

        return (
            parsed_config
            if isinstance(
                parsed_config,
                dict,
            )
            else {}
        )

    return {}


def get_source_connection_config_keys(
    source,
):
    if not source:
        return []

    keys = []

    for key in [
        *source.get(
            "config_keys",
            [],
        ),
        *source.get(
            "environment_keys",
            [],
        ),
    ]:
        if key not in keys:
            keys.append(key)

    return keys


def has_source_connection_credentials(
    source,
    connection_config,
):
    if not source:
        return None

    credential_keys = source.get(
        "environment_keys",
        [],
    )

    if not credential_keys:
        return source.get(
            "environment_configured"
        )

    configured_environment_keys = set(
        source.get(
            "configured_environment_keys",
            [],
        )
    )
    parsed_config = parse_source_connection_config(
        connection_config
    )

    return all(
        key in configured_environment_keys
        or has_config_value(
            parsed_config.get(
                key
            )
        )
        for key in credential_keys
    )


def build_source_connection_status(
    source_type: str,
):
    normalized_source_type = normalize_dataset_source_type(
        source_type
    )

    source = get_dataset_source(
        normalized_source_type
    )

    if not source:
        raise HTTPException(
            status_code=400,
            detail="Unknown data source",
        )

    if is_dataset_source_available(
        normalized_source_type
    ):
        return "draft"

    if source["status"] == "needs_setup":
        return "needs_setup"

    return "planned"


def sanitize_source_connection_display_name(
    display_name: str | None,
    fallback: str | None = None,
):
    if display_name is not None and not isinstance(
        display_name,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail="Connection name must be text",
        )

    normalized_name = (
        display_name.strip()
        if display_name is not None
        else None
    )

    if normalized_name:
        return normalized_name

    if fallback:
        return fallback

    raise HTTPException(
        status_code=400,
        detail="Connection name is required",
    )


def sanitize_source_connection_config(
    source,
    connection_config,
):
    if not connection_config:
        return None

    if not isinstance(connection_config, dict):
        raise HTTPException(
            status_code=400,
            detail="Connection config must be an object",
        )

    if not source:
        raise HTTPException(
            status_code=400,
            detail="Unknown data source",
        )

    config_keys = get_source_connection_config_keys(
        source
    )
    allowed_keys = set(config_keys)
    normalized_connection_config = {}

    for raw_key, value in connection_config.items():
        clean_key = str(
            raw_key
        ).strip()

        if not clean_key:
            continue

        normalized_connection_config[clean_key] = value

    provided_keys = set(
        normalized_connection_config.keys()
    )
    unknown_keys = sorted(
        provided_keys - allowed_keys
    )

    if unknown_keys:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported connection config fields: "
                + ", ".join(unknown_keys)
            ),
        )

    sanitized_config = {}

    for key in config_keys:
        if key not in normalized_connection_config:
            continue

        value = normalized_connection_config[key]

        if isinstance(value, str):
            value = value.strip()

        if value in ("", None):
            continue

        if isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Connection config values must be finite"
                ),
            )

        if not isinstance(
            value,
            (
                str,
                int,
                float,
                bool,
            ),
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Connection config values must be strings, numbers, or booleans"
                ),
            )

        sanitized_config[key] = value

    return (
        json.dumps(
            sanitized_config,
            sort_keys=True,
        )
        if sanitized_config
        else None
    )


# =========================
# Dataset Workspace Ownership Filter For Shared And Legacy Personal Rows
# =========================

def filter_datasets_for_workspace(
    user_id: str,
    workspace_id: str,
):
    return or_(
        Dataset.workspace_id == workspace_id,
        and_(
            Dataset.workspace_id.is_(None),
            Dataset.user_id == user_id,
        ),
    )


def filter_source_connections_for_workspace(
    user_id: str,
    workspace_id: str,
):
    return or_(
        DataSourceConnection.workspace_id == workspace_id,
        and_(
            DataSourceConnection.workspace_id.is_(None),
            DataSourceConnection.user_id == user_id,
        ),
    )


def get_owned_source_connection(
    db,
    connection_id: int,
    user_id: str,
    workspace_id: str,
):
    connection = (
        db.query(DataSourceConnection)
        .filter(
            DataSourceConnection.id == connection_id,
            filter_source_connections_for_workspace(
                user_id,
                workspace_id,
            ),
        )
        .first()
    )

    if not connection:
        raise HTTPException(
            status_code=404,
            detail="Data source connection not found",
        )

    return connection


def generate_share_token():
    return token_urlsafe(32)


def build_dataset_share_result(dataset):
    return {
        "dataset_id": dataset.id,
        "share_token": dataset.share_token,
        "share_enabled": bool(dataset.share_token),
    }


def clean_dashboard_share_key(
    dashboard: str | None,
):
    clean_value = str(
        dashboard or DEFAULT_SELECTED_DASHBOARD
    ).strip()

    if clean_value not in VALID_SELECTED_DASHBOARDS:
        raise HTTPException(
            status_code=400,
            detail="Invalid dashboard selection",
        )

    return clean_value


def build_dashboard_share_result(
    dataset,
    dashboard_key: str,
    dashboard_share: DashboardShare | None,
):
    return {
        "dataset_id": dataset.id,
        "dashboard": dashboard_key,
        "share_token": (
            dashboard_share.share_token
            if dashboard_share
            else None
        ),
        "share_enabled": bool(dashboard_share),
    }


def build_dashboard_share_status(
    dataset,
    dashboard_key: str,
    dashboard_share: DashboardShare | None,
):
    return {
        "dataset_id": dataset.id,
        "dashboard": dashboard_key,
        "share_enabled": bool(dashboard_share),
    }


def get_workspace_share_counts(
    db,
    datasets,
):
    dataset_ids = [
        dataset.id
        for dataset in datasets
    ]
    legacy_shares = sum(
        1
        for dataset in datasets
        if dataset.share_token
    )
    dashboard_shares = 0

    if dataset_ids:
        dashboard_shares = (
            db.query(DashboardShare)
            .filter(
                DashboardShare.dataset_id.in_(
                    dataset_ids
                )
            )
            .count()
        )

    return {
        "dataset_ids": dataset_ids,
        "legacy_shares": legacy_shares,
        "dashboard_shares": dashboard_shares,
        "shares_active": legacy_shares + dashboard_shares,
    }


def find_dashboard_share(
    db,
    dataset_id: int,
    dashboard_key: str,
):
    return (
        db.query(DashboardShare)
        .filter(
            DashboardShare.dataset_id == dataset_id,
            DashboardShare.dashboard_key == dashboard_key,
        )
        .first()
    )


def build_dataset_share_status(dataset):
    return {
        "dataset_id": dataset.id,
        "share_enabled": bool(dataset.share_token),
    }


def ensure_dataset_share_token(
    db,
    dataset,
):
    if dataset.share_token:
        return

    for _ in range(3):
        dataset.share_token = generate_share_token()

        try:
            db.commit()
            db.refresh(dataset)
            return
        except IntegrityError:
            db.rollback()
            dataset.share_token = None

    raise HTTPException(
        status_code=500,
        detail="Unable to create share link",
    )


def ensure_dashboard_share_token(
    db,
    dataset,
    dashboard_key: str,
):
    dashboard_share = find_dashboard_share(
        db,
        dataset.id,
        dashboard_key,
    )

    if dashboard_share:
        return dashboard_share

    for _ in range(3):
        dashboard_share = DashboardShare(
            dataset_id=dataset.id,
            dashboard_key=dashboard_key,
            share_token=generate_share_token(),
        )
        db.add(dashboard_share)

        try:
            db.commit()
            db.refresh(dashboard_share)
            return dashboard_share
        except IntegrityError:
            db.rollback()

    raise HTTPException(
        status_code=500,
        detail="Unable to create share link",
    )


@router.post("/")
async def create_dataset(
    request: Request,
    dataset: DatasetCreate,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db: Session = SessionLocal()

    try:
        dataset_record = Dataset(
            user_id=user_id,
            workspace_id=workspace_id,
            source_type="csv",
            file_name=dataset.file_name,
            file_path="manual_upload",
            row_count=len(dataset.rows),
            column_count=(len(dataset.rows[0]) if dataset.rows else 0),
        )

        db.add(dataset_record)
        db.commit()
        db.refresh(dataset_record)

        return {
            "id": dataset_record.id,
            "user_id": dataset_record.user_id,
            "workspace_id": dataset_record.workspace_id,
            **build_dataset_source_metadata(
                dataset_record
            ),
            "file_name": dataset_record.file_name,
            "rows": dataset_record.row_count,
            "message": "Dataset saved",
        }

    finally:
        db.close()


@router.post("/upload")
async def upload_dataset(request: Request, file: UploadFile = File(...)):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )
    upload_dir = get_dataset_upload_dir()
    os.makedirs(upload_dir, exist_ok=True)
    upload_filename = sanitize_upload_filename(
        file.filename
    )

    file_path = build_dataset_upload_path(
        upload_filename,
    )

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        source_type, dataframe = load_dataset_file(
            file_path,
            upload_filename,
        )
    except HTTPException as error:
        remove_dataset_file(
            file_path
        )
        raise error

    db = SessionLocal()

    try:
        dataset = Dataset(
            user_id=user_id,
            workspace_id=workspace_id,
            source_type=source_type,
            source_config=json.dumps(
                build_upload_source_config(
                    upload_filename
                ),
                sort_keys=True,
            ),
            file_name=upload_filename,
            file_path=file_path,
            row_count=len(dataframe),
            column_count=len(dataframe.columns),
        )

        db.add(dataset)
        db.commit()
        db.refresh(dataset)

        return {
            "id": dataset.id,
            "workspace_id": dataset.workspace_id,
            **build_dataset_source_metadata(
                dataset
            ),
            "file_name": dataset.file_name,
            "file_path": dataset.file_path,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
        }

    except Exception:
        remove_dataset_file(
            file_path
        )
        raise

    finally:
        db.close()


@router.get("/")
async def get_datasets(
    request: Request,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        datasets = (
            db.query(Dataset)
            .filter(
                filter_datasets_for_workspace(
                    user_id,
                    workspace_id,
                )
            )
            .order_by(
                Dataset.created_at.desc(),
                Dataset.id.desc(),
            )
            .all()
        )

        return [
            build_dataset_summary_response(
                dataset
            )
            for dataset in datasets
        ]

    finally:
        db.close()


@router.get("/sources")
async def get_dataset_sources(
    request: Request,
):
    get_user_id(request)

    return {
        "sources": list_dataset_sources(),
    }


@router.get("/analytics/status")
async def get_analytics_status(
    request: Request,
):
    get_user_id(request)

    return build_analytics_engine_status()


@router.get("/source-connections")
async def get_source_connections(
    request: Request,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        connections = (
            db.query(DataSourceConnection)
            .filter(
                filter_source_connections_for_workspace(
                    user_id,
                    workspace_id,
                )
            )
            .order_by(
                DataSourceConnection.created_at.desc(),
                DataSourceConnection.id.desc(),
            )
            .all()
        )

        return [
            build_source_connection_response(
                connection
            )
            for connection in connections
        ]

    finally:
        db.close()


@router.post("/source-connections")
async def create_source_connection(
    request: Request,
    payload: DataSourceConnectionCreate,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    source_type = normalize_dataset_source_type(
        payload.source_type
    )

    source = get_dataset_source(
        source_type
    )

    if not source:
        raise HTTPException(
            status_code=400,
            detail="Unknown data source",
        )

    display_name = sanitize_source_connection_display_name(
        payload.display_name,
        source["label"],
    )
    connection_config = sanitize_source_connection_config(
        source,
        payload.connection_config,
    )

    db = SessionLocal()

    try:
        existing_connection = (
            db.query(DataSourceConnection)
            .filter(
                filter_source_connections_for_workspace(
                    user_id,
                    workspace_id,
                ),
                DataSourceConnection.source_type == source_type,
            )
            .first()
        )

        if existing_connection:
            return build_source_connection_response(
                existing_connection
            )

        connection = DataSourceConnection(
            user_id=user_id,
            workspace_id=workspace_id,
            source_type=source_type,
            display_name=display_name,
            status=build_source_connection_status(
                source_type
            ),
            connection_config=connection_config,
        )

        db.add(connection)
        db.commit()
        db.refresh(connection)

        return build_source_connection_response(
            connection
        )

    finally:
        db.close()


@router.patch("/source-connections/{connection_id}")
async def update_source_connection(
    request: Request,
    connection_id: int,
    payload: DataSourceConnectionUpdate,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        connection = get_owned_source_connection(
            db,
            connection_id,
            user_id,
            workspace_id,
        )
        source = get_dataset_source(
            connection.source_type
        )

        if payload.display_name is not None:
            connection.display_name = sanitize_source_connection_display_name(
                payload.display_name,
            )

        if payload.connection_config is not None:
            connection.connection_config = (
                sanitize_source_connection_config(
                    source,
                    payload.connection_config,
                )
            )

        db.commit()
        db.refresh(connection)

        return build_source_connection_response(
            connection
        )

    finally:
        db.close()


@router.delete("/source-connections/{connection_id}")
async def delete_source_connection(
    request: Request,
    connection_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        connection = get_owned_source_connection(
            db,
            connection_id,
            user_id,
            workspace_id,
        )

        db.delete(connection)
        db.commit()

        return {
            "message": "Data source connection deleted",
        }

    finally:
        db.close()


@router.get("/{dataset_id}")
async def get_dataset(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        return {
            **build_dataset_summary_response(
                dataset
            ),
            "file_path": dataset.file_path,
        }

    finally:
        db.close()


@router.get("/{dataset_id}/analytics")
async def get_dataset_analytics(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        return build_dataset_analytics_manifest(
            dataset
        )

    finally:
        db.close()


@router.get("/{dataset_id}/preview")
async def dataset_preview(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "preview": generate_preview(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/metrics")
async def dataset_metrics(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "metrics": generate_metrics(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/insights")
async def dataset_insights(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        learning_context = (
            build_workspace_decision_learning_context(
                db,
                user_id,
                workspace_id,
                base_filter=build_dataset_decision_learning_filter(
                    dataset.id,
                ),
                learning_scope="dataset",
            )
        )
        ai_analysis = await asyncio.to_thread(
            generate_dataset_ai_analysis,
            dataframe,
            None,
            learning_context,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "insights": generate_insights(dataframe),
            "ai_analysis": ai_analysis,
        }

    finally:
        db.close()


@router.get("/{dataset_id}/chart-data")
async def dataset_chart_data(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "chart": generate_chart_data(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/details")
async def dataset_details(
    request: Request,
    dataset_id: int,
    include_all_rows: bool = Query(
        default=False,
        description="Include all dataset rows in chart data.",
    ),
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        learning_context = (
            build_workspace_decision_learning_context(
                db,
                user_id,
                workspace_id,
                base_filter=build_dataset_decision_learning_filter(
                    dataset.id,
                ),
                learning_scope="dataset",
            )
        )
        return await asyncio.to_thread(
            build_dataset_details_response,
            dataset,
            dataframe,
            learning_context,
            chart_limit=None if include_all_rows else 50,
        )

    finally:
        db.close()


@router.get("/{dataset_id}/ai-analysis")
async def dataset_ai_analysis(
    request: Request,
    dataset_id: int,
    metric: str | None = None,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        clean_metric = (
            str(metric).strip()
            if metric is not None
            else ""
        )
        numeric_columns = {
            str(column)
            for column, _ in get_numeric_columns(dataframe)
        }

        if clean_metric and clean_metric not in numeric_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Metric '{clean_metric}' is not numeric or was not found",
            )

        learning_context = (
            build_workspace_decision_learning_context(
                db,
                user_id,
                workspace_id,
                base_filter=build_dataset_decision_learning_filter(
                    dataset.id,
                    clean_metric,
                ),
                learning_scope=(
                    "metric"
                    if clean_metric
                    else "dataset"
                ),
            )
        )
        ai_analysis = await asyncio.to_thread(
            generate_dataset_ai_analysis,
            dataframe,
            clean_metric or None,
            learning_context,
        )

        return {
            "dataset_id": dataset.id,
            "metric": clean_metric or None,
            "ai_analysis": ai_analysis,
        }

    finally:
        db.close()


@router.delete("/share/all")
async def stop_all_dataset_sharing(
    request: Request,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        datasets = (
            db.query(Dataset)
            .filter(
                filter_datasets_for_workspace(
                    user_id,
                    workspace_id,
                )
            )
            .all()
        )
        share_counts = get_workspace_share_counts(
            db,
            datasets,
        )
        dataset_ids = share_counts["dataset_ids"]
        deleted_dashboard_shares = 0

        for dataset in datasets:
            dataset.share_token = None

        if dataset_ids:
            deleted_dashboard_shares = (
                db.query(DashboardShare)
                .filter(
                    DashboardShare.dataset_id.in_(
                        dataset_ids
                    )
                )
                .delete(
                    synchronize_session=False
                )
            )

        db.commit()

        return {
            "datasets_updated": len(dataset_ids),
            "legacy_shares_cleared": share_counts[
                "legacy_shares"
            ],
            "dashboard_shares_deleted": deleted_dashboard_shares,
            "shares_stopped": (
                share_counts["legacy_shares"] +
                deleted_dashboard_shares
            ),
            "share_enabled": False,
        }

    finally:
        db.close()


@router.get("/share/status/all")
async def get_all_dataset_sharing_status(
    request: Request,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        datasets = (
            db.query(Dataset)
            .filter(
                filter_datasets_for_workspace(
                    user_id,
                    workspace_id,
                )
            )
            .all()
        )
        share_counts = get_workspace_share_counts(
            db,
            datasets,
        )

        return {
            "datasets_checked": len(
                share_counts["dataset_ids"]
            ),
            "legacy_shares": share_counts[
                "legacy_shares"
            ],
            "dashboard_shares": share_counts[
                "dashboard_shares"
            ],
            "shares_active": share_counts[
                "shares_active"
            ],
            "share_enabled": (
                share_counts["shares_active"] > 0
            ),
        }

    finally:
        db.close()


@router.post("/{dataset_id}/share")
async def create_dataset_share_link(
    request: Request,
    response: Response,
    dataset_id: int,
    dashboard: str | None = None,
):
    response.headers["Cache-Control"] = "no-store"

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        if dashboard is None:
            ensure_dataset_share_token(
                db,
                dataset,
            )

            return build_dataset_share_result(dataset)

        dashboard_key = clean_dashboard_share_key(dashboard)
        dashboard_share = ensure_dashboard_share_token(
            db,
            dataset,
            dashboard_key,
        )

        return build_dashboard_share_result(
            dataset,
            dashboard_key,
            dashboard_share,
        )

    finally:
        db.close()


@router.get("/{dataset_id}/share/status")
async def get_dataset_share_status(
    request: Request,
    response: Response,
    dataset_id: int,
    dashboard: str | None = None,
):
    response.headers["Cache-Control"] = "no-store"

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        if dashboard is None:
            return build_dataset_share_status(dataset)

        dashboard_key = clean_dashboard_share_key(dashboard)
        dashboard_share = find_dashboard_share(
            db,
            dataset.id,
            dashboard_key,
        )

        return build_dashboard_share_status(
            dataset,
            dashboard_key,
            dashboard_share,
        )

    finally:
        db.close()


@router.delete("/{dataset_id}/share")
async def stop_dataset_sharing(
    request: Request,
    response: Response,
    dataset_id: int,
    dashboard: str | None = None,
):
    response.headers["Cache-Control"] = "no-store"

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        if dashboard is None:
            dataset.share_token = None
            db.commit()
            db.refresh(dataset)

            return build_dataset_share_result(dataset)

        dashboard_key = clean_dashboard_share_key(dashboard)
        dashboard_share = find_dashboard_share(
            db,
            dataset.id,
            dashboard_key,
        )

        if dashboard_share:
            db.delete(dashboard_share)

        db.commit()
        db.refresh(dataset)

        return build_dashboard_share_result(
            dataset,
            dashboard_key,
            None,
        )

    finally:
        db.close()


@router.delete("/{dataset_id}")
async def delete_dataset(
    request: Request,
    dataset_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(
        request,
    )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        remove_dataset_file(
            dataset.file_path
        )
        cleanup_deleted_dataset_preferences(
            db,
            dataset,
        )

        db.delete(dataset)
        db.commit()

        return {"message": "Dataset deleted"}

    finally:
        db.close()
