import asyncio
import json
import logging
import math
import os
import shutil
import uuid
from datetime import date
from datetime import datetime
from datetime import timedelta
from pathlib import Path
from secrets import token_urlsafe
from typing import Literal
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

import pandas as pd
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
from app.db.models import DatasetJoinCache
from app.db.models import DatasetRelationship
from app.db.models import UserPreference
from app.db.models import WeeklyReportPreference
from app.db.models import utc_now
from app.infrastructure.object_storage import (
    get_dataset_storage_reference,
    get_object_storage,
)

from app.modules.datasets.schemas import DataSourceConnectionCreate
from app.modules.datasets.schemas import DataSourceConnectionUpdate
from app.modules.datasets.schemas import DataSourceConnectionSync
from app.modules.datasets.schemas import DataSourceConnectionSchedule
from app.modules.datasets.schemas import DatasetCreate
from app.modules.datasets.schemas import DatasetMetricSelectionUpdate
from app.modules.datasets.schemas import DatasetSignedUrlImport
from app.modules.datasets.schemas import DatasetJoinRequest
from app.modules.datasets.schemas import DatasetRelationshipRequest
from app.modules.datasets.schemas import DatasetMultiMetricAnalysisRequest

from app.modules.datasets.services.dataset_loader import (
    load_dataset,
    load_dataframe,
)
from app.modules.datasets.services.file_loader import (
    build_upload_source_config,
    convert_dataframe_to_parquet,
    load_dataset_file,
    get_dataset_file_type,
    sanitize_upload_filename,
)

from app.modules.datasets.services.analytics_engine import (
    build_analytics_engine_status,
)
from app.modules.datasets.services.analytics_storage import (
    normalize_analytics_identifier,
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
from app.modules.datasets.services.metric_selection import (
    DATASET_SELECTED_METRICS_KEY,
    filter_dataframe_to_selected_metrics,
    get_effective_dataset_metric_columns,
    get_selectable_numeric_columns,
    normalize_selected_metric_columns,
)

from app.modules.datasets.services.charts import (
    generate_chart_data,
)

from app.modules.datasets.services.insights import (
    generate_dataset_ai_analysis,
    generate_insights,
)
from app.modules.datasets.services.anomalies import (
    detect_dataset_anomalies,
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
from app.modules.datasets.services.joins import (
    build_join_dataset_metadata,
    build_joined_dataset,
)
from app.modules.datasets.services.relationships import (
    build_dataset_relationship,
)
from app.modules.datasets.services.join_cache import (
    build_dataset_source_fingerprint,
    build_join_cache_dataset_ids_json,
    build_join_cache_definition_json,
    build_join_definition,
)
from app.modules.datasets.services.multi_metric_analysis import (
    build_multi_metric_analysis,
    generate_multi_metric_ai_analysis,
)
from app.modules.datasets.services.source_metadata import (
    build_dataset_source_metadata,
)
from app.modules.forecasting.services import (
    identify_forecast_columns,
    prepare_forecast_dataframe,
)
from app.modules.datasets.services.sources import (
    IMPLEMENTED_CONNECTOR_TYPES,
    get_dataset_source,
    is_dataset_source_available,
    list_dataset_sources,
    normalize_dataset_source_type,
)
from app.modules.datasets.services.google_analytics import (
    GoogleAnalyticsConnectorUnavailable,
    load_google_analytics_report,
)
from app.modules.datasets.services.connectors import (
    ConnectorNoData,
    ConnectorUnavailable,
    STRIPE_ENCRYPTED_API_KEY_CONFIG,
    load_connector_dataframe,
)
from app.modules.datasets.services.scheduling import (
    connection_sync_is_due,
    parse_connection_config as parse_schedule_config,
    read_connection_schedule_details,
    write_connection_schedule,
)
from app.modules.datasets.services.retention import (
    CONNECTOR_DATA_RETENTION_MONTHS,
    CONNECTOR_DATA_RETENTION_YEARS,
    connector_retention_cutoff_month,
    filter_connector_summary_by_retention,
    has_expired_connector_month,
)
from app.modules.datasets.services.auth import (
    get_user_id,
    get_workspace_id,
    require_workspace_connection_viewer,
    require_workspace_data_manager,
)
from app.modules.oauth.service import (
    OAuthProviderUnavailable,
    encrypt_token,
)

router = APIRouter()
logger = logging.getLogger(__name__)

INITIAL_CONNECTOR_SYNC_DAYS = 30
CONNECTOR_INCREMENTAL_LOOKBACK_DAYS = 1
CONNECTOR_DEDUP_KEYS = {
    "hubspot": ["record_id"],
    "stripe": ["charge_id"],
    "shopify": ["order_id"],
    "meta_ads": ["date_start", "campaign_id"],
    "quickbooks": ["invoice_id"],
    "freshbooks": ["invoice_id"],
    "xero": ["invoice_id"],
    "salesforce": ["record_id"],
}
REMOVED_FILE_STORAGE_CONNECTORS = {
    "google_drive",
    "onedrive",
}


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


SIGNED_FILE_URL_MAX_BYTES = 100 * 1024 * 1024
SIGNED_FILE_URL_HOST_SUFFIXES = (
    "googleusercontent.com",
    "usercontent.google.com",
    "googleapis.com",
    "drive.google.com",
    "docs.google.com",
    "1drv.com",
    "sharepoint.com",
    "onedrive.live.com",
    "onedrive.com",
    "microsoft.com",
)
SIGNED_FILE_CONTENT_TYPE_EXTENSIONS = {
    "text/csv": ".csv",
    "application/json": ".json",
    "application/x-ndjson": ".jsonl",
    "application/vnd.apache.parquet": ".parquet",
    "application/octet-stream": ".csv",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}


def validate_signed_file_url(value: str):
    parsed_url = urlparse(str(value or "").strip())
    hostname = (parsed_url.hostname or "").lower().rstrip(".")

    if parsed_url.scheme != "https" or not hostname:
        raise HTTPException(
            status_code=422,
            detail="Signed file URLs must use HTTPS.",
        )

    if parsed_url.username or parsed_url.password:
        raise HTTPException(
            status_code=422,
            detail="Signed file URLs must not contain embedded credentials.",
        )

    if not any(
        hostname == suffix
        or hostname.endswith(f".{suffix}")
        for suffix in SIGNED_FILE_URL_HOST_SUFFIXES
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Only Google Drive and OneDrive signed file URLs are supported."
            ),
        )

    return parsed_url


def infer_signed_file_name(
    url: str,
    requested_file_name: str | None,
    content_type: str | None,
):
    parsed_url = urlparse(url)
    candidate = requested_file_name or os.path.basename(
        parsed_url.path.rstrip("/")
    )
    candidate = sanitize_upload_filename(candidate)

    if get_dataset_file_type(candidate):
        return candidate

    normalized_content_type = str(
        content_type or ""
    ).split(";", 1)[0].strip().lower()
    extension = SIGNED_FILE_CONTENT_TYPE_EXTENSIONS.get(
        normalized_content_type
    )
    if extension:
        return (
            os.path.splitext(candidate)[0]
            + extension
        )

    raise HTTPException(
        status_code=422,
        detail=(
            "Provide a file name ending in .csv, .json, .jsonl, .parquet, "
            ".xls, or .xlsx when the signed URL has no recognizable file type."
        ),
    )


def download_signed_file(
    url: str,
    file_path: str,
):
    validate_signed_file_url(url)
    request = UrlRequest(
        url,
        headers={"User-Agent": "Decisionate signed file importer"},
        method="GET",
    )

    try:
        with urlopen(request, timeout=60) as response:
            validate_signed_file_url(response.geturl())
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > SIGNED_FILE_URL_MAX_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Signed file exceeds the 100 MB import limit.",
                )

            bytes_written = 0
            with open(file_path, "wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_written += len(chunk)
                    if bytes_written > SIGNED_FILE_URL_MAX_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="Signed file exceeds the 100 MB import limit.",
                        )
                    output.write(chunk)

            return response.headers.get("Content-Type")
    except HTTPException:
        raise
    except HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Signed file could not be downloaded (HTTP {error.code}).",
        ) from error
    except (URLError, TimeoutError, OSError, ValueError) as error:
        raise HTTPException(
            status_code=502,
            detail="Signed file could not be downloaded.",
        ) from error


def persist_dataset_file(
    db,
    user_id: str,
    workspace_id: str,
    file_path: str,
    upload_filename: str,
    source_config: dict,
):
    parquet_path = None
    stored_file_path = file_path
    stored_reference = file_path
    storage_provider = None
    storage = get_object_storage()
    try:
        source_type, dataframe = load_dataset_file(
            file_path,
            upload_filename,
        )
        parquet_path = convert_dataframe_to_parquet(
            dataframe,
            file_path,
        )

        if parquet_path != file_path:
            remove_dataset_file(file_path)
            file_path = parquet_path

        if storage.is_remote:
            stored_reference = storage.put_file(
                file_path,
                key=(
                    "datasets/"
                    f"workspace={normalize_analytics_identifier(workspace_id, 'workspace')}/"
                    f"dataset-{uuid.uuid4().hex}.parquet"
                ),
            )
            stored_file_path = storage.reference_key(stored_reference)
            storage_provider = storage.config.provider
        else:
            stored_file_path = file_path

        dataset = Dataset(
            user_id=user_id,
            workspace_id=workspace_id,
            source_type=source_type,
            source_config=json.dumps(
                source_config,
                sort_keys=True,
            ),
            file_name=upload_filename,
            file_path=stored_file_path,
            storage_provider=storage_provider,
            row_count=len(dataframe),
            column_count=len(dataframe.columns),
        )

        db.add(dataset)
        db.commit()
        db.refresh(dataset)
        if stored_reference != file_path:
            remove_dataset_file(file_path)
        return dataset
    except Exception:
        remove_dataset_file(stored_reference)
        remove_dataset_file(file_path)
        if parquet_path and parquet_path != file_path:
            remove_dataset_file(parquet_path)
        raise


def remove_dataset_file(
    file_path: str | None,
):
    if not file_path:
        return

    try:
        get_object_storage().delete(file_path)
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


def remove_dashboard_dataset_id_entry(
    preference_json: str | None,
    dataset_id: int,
):
    if not preference_json:
        return preference_json

    try:
        dashboard_dataset_ids = json.loads(
            preference_json
        )
    except json.JSONDecodeError:
        return None

    if not isinstance(dashboard_dataset_ids, dict):
        return None

    next_dashboard_dataset_ids = {
        key: value
        for key, value in dashboard_dataset_ids.items()
        if value != dataset_id
    }

    return (
        json.dumps(next_dashboard_dataset_ids)
        if next_dashboard_dataset_ids
        else None
    )


def remove_dashboard_view_dataset_entry(
    preference_json: str | None,
    dataset_id: int,
):
    if not preference_json:
        return preference_json

    try:
        dashboard_views = json.loads(preference_json)
    except json.JSONDecodeError:
        return None

    if not isinstance(dashboard_views, dict):
        return None

    dashboard_views.pop(str(dataset_id), None)

    return (
        json.dumps(dashboard_views)
        if dashboard_views
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
        preference.dashboard_dataset_ids = remove_dashboard_dataset_id_entry(
            preference.dashboard_dataset_ids,
            dataset.id,
        )
        preference.dashboard_views = remove_dashboard_view_dataset_entry(
            preference.dashboard_views,
            dataset.id,
        )


def cleanup_deleted_dataset_join_caches(
    db,
    dataset,
):
    caches = (
        db.query(DatasetJoinCache)
        .filter(
            DatasetJoinCache.workspace_id == dataset.workspace_id,
        )
        .all()
    )

    for cache in caches:
        try:
            dataset_ids = {
                int(dataset_id)
                for dataset_id in json.loads(cache.dataset_ids)
            }
        except (TypeError, ValueError, json.JSONDecodeError):
            dataset_ids = set()

        if dataset.id in dataset_ids:
            db.delete(cache)


def cleanup_deleted_dataset_relationships(
    db,
    dataset,
):
    filters = [
        DatasetRelationship.left_dataset_id == dataset.id,
        DatasetRelationship.right_dataset_id == dataset.id,
    ]
    relationships = (
        db.query(DatasetRelationship)
        .filter(
            or_(*filters),
            DatasetRelationship.workspace_id == dataset.workspace_id,
        )
        .all()
    )
    for relationship in relationships:
        db.delete(relationship)


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
    workspace_id: str | None = None,
    actor_user_id: str | None = None,
    start_date: str | None = None,
    period_filter: str | None = None,
    aggregation: str | None = None,
    aggregation_type: str | None = None,
    include_ai_analysis: bool = True,
):
    available_metric_columns = get_selectable_numeric_columns(
        dataframe
    )
    selected_metric_columns = (
        get_effective_dataset_metric_columns(
            dataset,
            dataframe,
        )
    )
    report_dataframe = filter_dataframe_to_selected_metrics(
        dataset,
        dataframe,
    )
    date_column, _ = identify_forecast_columns(
        dataframe
    )

    if any(
        value is not None
        for value in (
            start_date,
            period_filter,
            aggregation,
            aggregation_type,
        )
    ):
        report_dataframe = prepare_forecast_dataframe(
            report_dataframe,
            date_column,
            start_date,
            period_filter,
            aggregation,
            aggregation_type,
        )

    response = {
        **build_dataset_summary_response(
            dataset
        ),
        "preview": generate_preview(dataframe),
        "columns": [
            str(column)
            for column in dataframe.columns
        ],
        "metrics": generate_metrics(report_dataframe),
        "insights": generate_insights(report_dataframe),
        "chart": generate_chart_data(
            report_dataframe,
            limit=chart_limit,
            date_column=date_column,
        ),
        "numeric_columns": available_metric_columns,
        "selected_metric_columns": selected_metric_columns,
    }

    if include_ai_analysis:
        response["ai_analysis"] = generate_dataset_ai_analysis(
            report_dataframe,
            None,
            learning_context,
            workspace_id,
            actor_user_id,
        )
    else:
        response["ai_analysis"] = None

    return response


def build_source_connection_response(
    connection,
    dataset=None,
):
    source_type = normalize_dataset_source_type(
        connection.source_type
    )
    source = get_dataset_source(
        source_type
    )
    (
        sync_enabled,
        sync_interval_hours,
        sync_time_of_day,
        sync_timezone,
        _,
        sync_day_of_week,
    ) = read_connection_schedule_details(
        connection.connection_config
    )

    parsed_config = parse_source_connection_config(
        connection.connection_config
    )
    has_config = has_source_connection_config(
        connection.connection_config
    )
    if source_type == "stripe":
        has_config = bool(
            parsed_config.get(STRIPE_ENCRYPTED_API_KEY_CONFIG)
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
        "has_config": has_config,
        "dataset_id": dataset.id if dataset else None,
        "dataset_file_name": (
            dataset.file_name
            if dataset
            else None
        ),
        "last_synced_at": connection.last_synced_at,
        "sync_enabled": sync_enabled,
        "sync_interval_hours": sync_interval_hours,
        "sync_time_of_day": sync_time_of_day,
        "sync_timezone": sync_timezone,
        "sync_day_of_week": sync_day_of_week,
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
            for key, value in connection_config.items()
            if not str(key).startswith("_")
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


def require_source_connection_available(source):
    if source["status"] == "planned":
        raise HTTPException(
            status_code=409,
            detail=(
                f'{source["label"]} connector is planned and is not available yet'
            ),
        )


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


def protect_source_connection_config(
    source_type: str,
    connection_config,
):
    """Encrypt customer-provided connector secrets before persistence."""
    parsed_config = parse_source_connection_config(connection_config)
    if source_type != "stripe":
        return (
            json.dumps(parsed_config, sort_keys=True)
            if parsed_config
            else None
        )

    api_key = str(parsed_config.pop("api_key", "") or "").strip()
    if api_key:
        try:
            parsed_config[STRIPE_ENCRYPTED_API_KEY_CONFIG] = encrypt_token(
                api_key
            )
        except OAuthProviderUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return (
        json.dumps(parsed_config, sort_keys=True)
        if parsed_config
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

    db = SessionLocal()

    try:
        dataset = persist_dataset_file(
            db,
            user_id,
            workspace_id,
            file_path,
            upload_filename,
            build_upload_source_config(
                upload_filename
            ),
        )

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

    finally:
        db.close()


@router.post("/import-url")
async def import_dataset_from_signed_url(
    request: Request,
    payload: DatasetSignedUrlImport,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(request)
    signed_url = str(payload.url).strip()
    parsed_url = validate_signed_file_url(signed_url)
    upload_dir = get_dataset_upload_dir()
    os.makedirs(upload_dir, exist_ok=True)
    temporary_path = os.path.join(
        upload_dir,
        f"{uuid.uuid4()}-signed-download",
    )
    file_path = None

    try:
        content_type = download_signed_file(
            signed_url,
            temporary_path,
        )
        upload_filename = infer_signed_file_name(
            signed_url,
            payload.file_name,
            content_type,
        )
        file_path = build_dataset_upload_path(
            upload_filename,
        )
        os.replace(
            temporary_path,
            file_path,
        )

        source_config = build_upload_source_config(
            upload_filename
        )
        source_config.update({
            "ingestion_mode": "signed_url_import",
            "source_provider": parsed_url.hostname,
        })
        db = SessionLocal()
        try:
            dataset = persist_dataset_file(
                db,
                user_id,
                workspace_id,
                file_path,
                upload_filename,
                source_config,
            )
        finally:
            db.close()

        return {
            "id": dataset.id,
            "workspace_id": dataset.workspace_id,
            **build_dataset_source_metadata(dataset),
            "file_name": dataset.file_name,
            "file_path": dataset.file_path,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
        }
    except Exception:
        remove_dataset_file(temporary_path)
        if file_path:
            remove_dataset_file(file_path)
        raise


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


@router.get("/join/metadata")
async def get_dataset_join_metadata(
    request: Request,
    dataset_ids: list[int] = Query(...),
):
    if len(dataset_ids) < 1 or len(dataset_ids) > 5:
        raise HTTPException(
            status_code=400,
            detail="Select between one and five datasets to inspect",
        )

    clean_dataset_ids = list(dict.fromkeys(dataset_ids))
    if len(clean_dataset_ids) != len(dataset_ids):
        raise HTTPException(
            status_code=400,
            detail="Each dataset can only be selected once",
        )

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    db = SessionLocal()

    try:
        metadata = []
        for dataset_id in clean_dataset_ids:
            dataset, dataframe = load_dataframe(
                db,
                dataset_id,
            )
            verify_dataset_owner(
                dataset,
                user_id,
                workspace_id,
            )
            metadata.append(
                build_join_dataset_metadata(
                    dataset,
                    dataframe,
                )
            )

        return {"datasets": metadata}
    finally:
        db.close()


@router.post("/multi-metric-analysis")
async def analyze_multiple_dataset_metrics(
    request: Request,
    payload: DatasetMultiMetricAnalysisRequest,
):
    """Analyze selected metrics without joining source tables."""
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    selected_dataset_ids = list(dict.fromkeys(
        item.dataset_id
        for item in payload.metrics
    ))
    db = SessionLocal()

    try:
        dataset_frames = []
        for dataset_id in selected_dataset_ids:
            dataset, dataframe = load_dataframe(
                db,
                dataset_id,
            )
            verify_dataset_owner(
                dataset,
                user_id,
                workspace_id,
            )
            dataset_frames.append((dataset, dataframe))

        definition = payload.model_dump()
        result = await asyncio.to_thread(
            build_multi_metric_analysis,
            dataset_frames,
            definition,
        )
        learning_context = build_workspace_decision_learning_context(
            db,
            user_id,
            workspace_id,
            learning_scope="workspace",
        )
        result["ai_analysis"] = await asyncio.to_thread(
            generate_multi_metric_ai_analysis,
            result,
            learning_context,
            workspace_id,
            user_id,
        )
        return result
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error
    finally:
        db.close()


@router.get("/join/cache")
async def get_dataset_join_cache(
    request: Request,
    dataset_id: int = Query(..., ge=1),
    dashboard: str | None = Query(None),
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    dashboard_key = clean_dashboard_share_key(dashboard)
    db = SessionLocal()

    try:
        cache = (
            db.query(DatasetJoinCache)
            .filter(
                DatasetJoinCache.user_id == user_id,
                DatasetJoinCache.workspace_id == workspace_id,
                DatasetJoinCache.dashboard_key == dashboard_key,
            )
            .first()
        )
        if not cache:
            return None

        definition = json.loads(cache.definition)
        selections = definition.get("selections", [])
        cached_dataset_ids = {
            int(dataset_id)
            for dataset_id in json.loads(cache.dataset_ids)
        }
        if dataset_id not in cached_dataset_ids:
            return None

        dataset_frames = []
        for selection in selections:
            dataset, dataframe = load_dataframe(
                db,
                int(selection["dataset_id"]),
            )
            verify_dataset_owner(
                dataset,
                user_id,
                workspace_id,
            )
            dataset_frames.append(
                (
                    dataset,
                    dataframe,
                    build_join_dataset_metadata(
                        dataset,
                        dataframe,
                    ),
                )
            )

        source_fingerprint = build_dataset_source_fingerprint(
            [frame[0] for frame in dataset_frames]
        )
        if source_fingerprint != cache.source_fingerprint:
            result = await asyncio.to_thread(
                build_joined_dataset,
                dataset_frames,
                selections,
                definition.get("start_date"),
                definition.get("period_filter", "all"),
                definition.get("aggregation", "monthly"),
                definition.get("aggregation_type", "sum"),
            )
            cache.result = json.dumps(
                result,
                sort_keys=True,
            )
            cache.source_fingerprint = source_fingerprint
            cache.dataset_ids = build_join_cache_dataset_ids_json(
                result["dataset_ids"]
            )
            db.commit()
            return result

        return json.loads(cache.result)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        db.rollback()
        return None
    finally:
        db.close()


@router.delete("/join/cache")
async def delete_dataset_join_cache(
    request: Request,
    dataset_id: int = Query(..., ge=1),
    dashboard: str | None = Query(None),
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    dashboard_key = clean_dashboard_share_key(dashboard)
    db = SessionLocal()

    try:
        cache = (
            db.query(DatasetJoinCache)
            .filter(
                DatasetJoinCache.user_id == user_id,
                DatasetJoinCache.workspace_id == workspace_id,
                DatasetJoinCache.dashboard_key == dashboard_key,
            )
            .first()
        )
        if cache:
            cached_dataset_ids = {
                int(cached_id)
                for cached_id in json.loads(cache.dataset_ids)
            }
            if dataset_id in cached_dataset_ids:
                db.delete(cache)
                db.commit()

        return {"deleted": bool(cache)}
    finally:
        db.close()


@router.post("/join")
async def join_datasets(
    request: Request,
    payload: DatasetJoinRequest,
):
    clean_dataset_ids = [
        selection.dataset_id
        for selection in payload.selections
    ]
    if len(set(clean_dataset_ids)) != len(clean_dataset_ids):
        raise HTTPException(
            status_code=400,
            detail="Each dataset can only be selected once",
        )

    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    db = SessionLocal()

    try:
        dataset_frames = []
        for selection in payload.selections:
            dataset, dataframe = load_dataframe(
                db,
                selection.dataset_id,
            )
            verify_dataset_owner(
                dataset,
                user_id,
                workspace_id,
            )
            dataset_frames.append(
                (
                    dataset,
                    dataframe,
                    build_join_dataset_metadata(
                        dataset,
                        dataframe,
                    ),
                )
            )

        result = await asyncio.to_thread(
            build_joined_dataset,
            dataset_frames,
            [
                selection.model_dump()
                for selection in payload.selections
            ],
            str(payload.start_date)
            if payload.start_date
            else None,
            payload.period_filter,
            payload.aggregation,
            payload.aggregation_type,
        )

        if payload.dashboard_key:
            dashboard_key = clean_dashboard_share_key(
                payload.dashboard_key
            )
            definition = build_join_definition(
                [
                    selection.model_dump()
                    for selection in payload.selections
                ],
                str(payload.start_date)
                if payload.start_date
                else None,
                payload.period_filter,
                payload.aggregation,
                payload.aggregation_type,
            )
            source_fingerprint = build_dataset_source_fingerprint(
                [frame[0] for frame in dataset_frames]
            )
            cache = (
                db.query(DatasetJoinCache)
                .filter(
                    DatasetJoinCache.user_id == user_id,
                    DatasetJoinCache.workspace_id == workspace_id,
                    DatasetJoinCache.dashboard_key == dashboard_key,
                )
                .first()
            )
            if not cache:
                cache = DatasetJoinCache(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    dashboard_key=dashboard_key,
                    created_at=utc_now(),
                )
                db.add(cache)

            cache.dataset_ids = build_join_cache_dataset_ids_json(
                result["dataset_ids"]
            )
            cache.definition = build_join_cache_definition_json(
                definition
            )
            cache.result = json.dumps(
                result,
                sort_keys=True,
            )
            cache.source_fingerprint = source_fingerprint
            cache.updated_at = utc_now()
            db.commit()

        return result
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error
    finally:
        db.close()


def _relationship_workspace_filter(
    user_id: str,
    workspace_id: str | None,
):
    if workspace_id:
        return (
            DatasetRelationship.workspace_id == workspace_id,
        )

    return (
        DatasetRelationship.user_id == user_id,
        DatasetRelationship.workspace_id.is_(None),
    )


def _relationship_definition_from_record(
    relationship: DatasetRelationship,
):
    return {
        "name": relationship.name,
        "left": {
            "dataset_id": relationship.left_dataset_id,
            "date_column": relationship.left_date_column,
            "metric_column": relationship.left_metric,
        },
        "right": {
            "dataset_id": relationship.right_dataset_id,
            "date_column": relationship.right_date_column,
            "metric_column": relationship.right_metric,
        },
        "period": relationship.period,
        "aggregation": relationship.aggregation,
        "method": relationship.method,
        "lag_mode": getattr(relationship, "lag_mode", None) or "manual",
        "lag_periods": relationship.lag_periods,
    }


def _load_relationship_frames(
    db,
    relationship_definition: dict,
    user_id: str,
    workspace_id: str | None,
):
    selections = [
        relationship_definition["left"],
        relationship_definition["right"],
    ]
    frames = []
    for selection in selections:
        dataset, dataframe = load_dataframe(
            db,
            int(selection["dataset_id"]),
        )
        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )
        frames.append((dataset, dataframe))

    return frames


async def _calculate_dataset_relationship(
    db,
    definition: dict,
    user_id: str,
    workspace_id: str | None,
    relationship_id: int | None = None,
):
    frames = _load_relationship_frames(
        db,
        definition,
        user_id,
        workspace_id,
    )
    return build_dataset_relationship(
        frames,
        definition,
        relationship_id,
    )


@router.post("/relationships/preview")
async def preview_dataset_relationship(
    request: Request,
    payload: DatasetRelationshipRequest,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    db = SessionLocal()

    try:
        return await _calculate_dataset_relationship(
            db,
            payload.model_dump(),
            user_id,
            workspace_id,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error
    finally:
        db.close()


@router.get("/relationships")
async def get_dataset_relationships(
    request: Request,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    db = SessionLocal()

    try:
        relationships = (
            db.query(DatasetRelationship)
            .filter(
                *_relationship_workspace_filter(
                    user_id,
                    workspace_id,
                )
            )
            .order_by(
                DatasetRelationship.updated_at.desc(),
                DatasetRelationship.id.desc(),
            )
            .all()
        )
        results = []
        for relationship in relationships:
            try:
                results.append(
                    await _calculate_dataset_relationship(
                        db,
                        _relationship_definition_from_record(
                            relationship
                        ),
                        user_id,
                        workspace_id,
                        relationship.id,
                    )
                )
            except (HTTPException, ValueError, OSError):
                results.append({
                    **_relationship_definition_from_record(
                        relationship
                    ),
                    "id": relationship.id,
                    "left_dataset_name": f"Dataset {relationship.left_dataset_id}",
                    "right_dataset_name": f"Dataset {relationship.right_dataset_id}",
                    "period": relationship.period,
                    "aggregation": relationship.aggregation,
                    "method": relationship.method,
                    "lag_mode": getattr(relationship, "lag_mode", None) or "manual",
                    "lag_periods": relationship.lag_periods,
                    "matched_period_count": 0,
                    "correlation": None,
                    "relationship_strength": "unavailable",
                    "direction": "undetermined",
                    "evidence": [],
                    "decision_context": "The source dataset is unavailable.",
                    "status": "unavailable",
                })

        return results
    finally:
        db.close()


@router.post("/relationships")
async def create_dataset_relationship(
    request: Request,
    payload: DatasetRelationshipRequest,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    db = SessionLocal()

    try:
        definition = payload.model_dump()
        result = await _calculate_dataset_relationship(
            db,
            definition,
            user_id,
            workspace_id,
        )
        relationship = DatasetRelationship(
            user_id=user_id,
            workspace_id=workspace_id,
            name=result["name"],
            left_dataset_id=result["left"]["dataset_id"],
            left_date_column=result["left"]["date_column"],
            left_metric=result["left"]["metric_column"],
            right_dataset_id=result["right"]["dataset_id"],
            right_date_column=result["right"]["date_column"],
            right_metric=result["right"]["metric_column"],
            period=result["period"],
            aggregation=result["aggregation"],
            method=result["method"],
            lag_mode=result["lag_mode"],
            lag_periods=result["lag_periods"],
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(relationship)
        db.commit()
        db.refresh(relationship)
        result["id"] = relationship.id
        return result
    except ValueError as error:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error
    finally:
        db.close()


@router.delete("/relationships/{relationship_id}")
async def delete_dataset_relationship(
    request: Request,
    relationship_id: int,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    db = SessionLocal()

    try:
        relationship = (
            db.query(DatasetRelationship)
            .filter(
                DatasetRelationship.id == relationship_id,
                *_relationship_workspace_filter(
                    user_id,
                    workspace_id,
                ),
            )
            .first()
        )
        if not relationship:
            raise HTTPException(
                status_code=404,
                detail="Relationship not found",
            )

        alert_preference = (
            db.query(WeeklyReportPreference)
            .filter(
                WeeklyReportPreference.workspace_id == workspace_id,
            )
            .first()
        )
        if alert_preference:
            try:
                relationship_focus = json.loads(
                    alert_preference.relationship_focus or "[]"
                )
            except (TypeError, json.JSONDecodeError):
                relationship_focus = []

            if not isinstance(relationship_focus, list):
                relationship_focus = []

            remaining_relationships = []
            for value in relationship_focus:
                try:
                    focus_id = int(value)
                except (TypeError, ValueError):
                    continue
                if focus_id != relationship_id:
                    remaining_relationships.append(focus_id)

            alert_preference.relationship_focus = json.dumps(
                remaining_relationships,
                sort_keys=True,
            )
            try:
                metric_focus = json.loads(
                    alert_preference.metric_focus or "[]"
                )
            except (TypeError, json.JSONDecodeError):
                metric_focus = []
            if not isinstance(metric_focus, list):
                metric_focus = []

            if not remaining_relationships and not metric_focus:
                alert_preference.enabled = 0

        db.delete(relationship)
        db.commit()
        return {"deleted": True}
    finally:
        db.close()


@router.get("/source-connections")
async def get_source_connections(
    request: Request,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_connection_viewer(
        request,
    )

    db = SessionLocal()

    try:
        connections = (
            db.query(DataSourceConnection)
            .filter(
                filter_source_connections_for_workspace(
                    user_id,
                    workspace_id,
                ),
                ~DataSourceConnection.source_type.in_(
                    REMOVED_FILE_STORAGE_CONNECTORS
                ),
            )
            .order_by(
                DataSourceConnection.created_at.desc(),
                DataSourceConnection.id.desc(),
            )
            .all()
        )

        return [
            build_source_connection_response(
                connection,
                find_connector_dataset(
                    db,
                    connection,
                ),
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

    require_source_connection_available(source)

    display_name = sanitize_source_connection_display_name(
        payload.display_name,
        source["label"],
    )
    connection_config = sanitize_source_connection_config(
        source,
        payload.connection_config,
    )
    connection_config = protect_source_connection_config(
        source_type,
        connection_config,
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
                existing_connection,
                find_connector_dataset(
                    db,
                    existing_connection,
                ),
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
            connection,
            None,
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
            existing_config = parse_schedule_config(
                connection.connection_config
            )
            sanitized_config = sanitize_source_connection_config(
                source,
                payload.connection_config,
            )
            next_config = parse_schedule_config(sanitized_config)
            for config_key, config_value in existing_config.items():
                if (
                    str(config_key).startswith("_")
                    and config_key != "_connector_retention_months"
                    and config_key not in next_config
                ):
                    next_config[config_key] = config_value
                if (
                    connection.source_type == "salesforce"
                    and config_key == "instance_url"
                    and config_key not in next_config
                ):
                    next_config[config_key] = config_value
            if (
                connection.source_type == "stripe"
                and "api_key" not in next_config
            ):
                next_config.pop(STRIPE_ENCRYPTED_API_KEY_CONFIG, None)
            connection.connection_config = (
                protect_source_connection_config(
                    connection.source_type,
                    next_config,
                )
            )

        db.commit()
        db.refresh(connection)

        return build_source_connection_response(
            connection,
            find_connector_dataset(
                db,
                connection,
            ),
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


@router.patch("/source-connections/{connection_id}/schedule")
async def update_source_connection_schedule(
    request: Request,
    connection_id: int,
    payload: DataSourceConnectionSchedule,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(request, user_id)
    require_workspace_data_manager(request)
    db = SessionLocal()
    try:
        connection = get_owned_source_connection(
            db,
            connection_id,
            user_id,
            workspace_id,
        )
        source = get_dataset_source(connection.source_type)
        if not source or "scheduled" not in source.get("sync_modes", []):
            raise HTTPException(
                status_code=400,
                detail="Scheduled sync is not available for this source",
            )
        require_source_connection_available(source)
        try:
            connection.connection_config = write_connection_schedule(
                connection.connection_config,
                payload.enabled,
                payload.interval_hours,
                payload.time_of_day,
                payload.timezone,
                payload.day_of_week,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        db.commit()
        db.refresh(connection)
        return build_source_connection_response(
            connection,
            find_connector_dataset(
                db,
                connection,
            ),
        )
    finally:
        db.close()


def get_incremental_sync_window(
    connection,
    payload: DataSourceConnectionSync,
):
    start_date = payload.start_date
    end_date = payload.end_date

    if start_date is None:
        if connection.last_synced_at:
            start_date = (
                connection.last_synced_at.date()
                - timedelta(days=CONNECTOR_INCREMENTAL_LOOKBACK_DAYS)
            )
        else:
            start_date = date.today() - timedelta(
                days=INITIAL_CONNECTOR_SYNC_DAYS
            )

    if end_date is None and start_date is not None:
        end_date = date.today()

    return start_date, end_date


def find_connector_dataset(
    db,
    connection,
):
    datasets = (
        db.query(Dataset)
        .filter(
            Dataset.workspace_id == connection.workspace_id,
            Dataset.source_type == connection.source_type,
        )
        .order_by(
            Dataset.created_at.desc(),
            Dataset.id.desc(),
        )
        .all()
    )

    for dataset in datasets:
        source_config = parse_source_connection_config(
            dataset.source_config
        )
        if str(source_config.get("connection_id") or "") == str(
            connection.id
        ):
            return dataset

    return None


CONNECTOR_PARTITION_DATE_COLUMNS = (
    "date",
    "date_start",
    "created_at",
    "created_at_utc",
    "created",
    "created_date",
    "transaction_date",
    "invoice_date",
    "updated_at",
    "updated_date",
    "timestamp",
)
CONNECTOR_HOT_MONTHS = 24
CONNECTOR_HOT_DIRECTORY = "hot"
CONNECTOR_HISTORICAL_DIRECTORY = "historical"
CONNECTOR_HISTORICAL_LEGACY_FILENAME = "historical-summary.parquet"
CONNECTOR_PARQUET_COMPRESSION = "snappy"
SUMMARY_MONTH_COLUMN = "__decisionate_summary_month__"
SUMMARY_MARKER_COLUMN = "__decisionate_summary__"
CONNECTOR_PARTITION_MONTH_COLUMN = "__decisionate_partition_month__"
MAX_SUMMARY_GROUP_COLUMNS = 4
MAX_SUMMARY_GROUP_CARDINALITY = 50


def build_connector_partition_dir(
    connection,
):
    workspace_namespace = normalize_analytics_identifier(
        connection.workspace_id or connection.user_id,
        "workspace",
    )
    source_namespace = normalize_analytics_identifier(
        connection.source_type,
        "connector",
    )

    return os.path.join(
        get_dataset_upload_dir(),
        "connectors",
        f"workspace={workspace_namespace}",
        f"source={source_namespace}",
        f"connection={connection.id}",
    )


def build_connector_storage_prefix(
    connection,
):
    workspace_namespace = normalize_analytics_identifier(
        connection.workspace_id or connection.user_id,
        "workspace",
    )
    source_namespace = normalize_analytics_identifier(
        connection.source_type,
        "connector",
    )
    return (
        "connectors/"
        f"workspace={workspace_namespace}/"
        f"source={source_namespace}/"
        f"connection={connection.id}/"
        f"revision={uuid.uuid4().hex}"
    )


def build_connector_hot_dir(
    partition_dir: str,
):
    return os.path.join(
        partition_dir,
        CONNECTOR_HOT_DIRECTORY,
    )


def build_connector_historical_dir(
    partition_dir: str,
):
    return os.path.join(
        partition_dir,
        CONNECTOR_HISTORICAL_DIRECTORY,
    )


def build_connector_historical_year_path(
    partition_dir: str,
    year: str,
):
    return os.path.join(
        build_connector_historical_dir(partition_dir),
        f"year={year}.parquet",
    )


def build_connector_legacy_summary_path(
    partition_dir: str,
):
    return os.path.join(
        partition_dir,
        CONNECTOR_HISTORICAL_LEGACY_FILENAME,
    )


def list_connector_raw_partition_paths(
    partition_dir: str,
):
    paths = []
    for directory in (
        partition_dir,
        build_connector_hot_dir(partition_dir),
    ):
        if not os.path.isdir(directory):
            continue
        for filename in os.listdir(directory):
            if not (
                filename.startswith("month=")
                and filename.endswith(".parquet")
            ):
                continue
            paths.append(
                os.path.join(
                    directory,
                    filename,
                )
            )
    return sorted(set(paths))


def load_connector_raw_dataframe(
    partition_dir: str,
):
    with get_object_storage().materialize(partition_dir) as local_partition_dir:
        partition_paths = list_connector_raw_partition_paths(
            local_partition_dir
        )
        if not partition_paths:
            return pd.DataFrame()

        dataframes = []
        for path in partition_paths:
            dataframe = pd.read_parquet(path)
            filename = Path(path).name
            month = filename.removeprefix("month=").removesuffix(
                ".parquet"
            )
            dataframe[CONNECTOR_PARTITION_MONTH_COLUMN] = month
            dataframes.append(dataframe)

        return pd.concat(
            dataframes,
            ignore_index=True,
            sort=False,
        )


def load_connector_summary_dataframe(
    partition_dir: str,
):
    with get_object_storage().materialize(partition_dir) as local_partition_dir:
        historical_dir = build_connector_historical_dir(
            local_partition_dir
        )
        historical_paths = sorted(
            path
            for path in Path(historical_dir).glob("year=*.parquet")
            if path.is_file()
        ) if os.path.isdir(historical_dir) else []
        legacy_path = build_connector_legacy_summary_path(
            local_partition_dir
        )
        if os.path.isfile(legacy_path):
            historical_paths.append(Path(legacy_path))

        if not historical_paths:
            return pd.DataFrame()

        return pd.concat(
            [pd.read_parquet(path) for path in historical_paths],
            ignore_index=True,
            sort=False,
        )


def find_connector_partition_date_column(
    dataframe,
    report_config: dict,
):
    configured_column = report_config.get("date_column")
    candidates = [
        configured_column,
        *CONNECTOR_PARTITION_DATE_COLUMNS,
    ]
    seen = set()

    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        if candidate not in dataframe.columns:
            continue

        parsed = pd.to_datetime(
            dataframe[candidate],
            errors="coerce",
            utc=True,
        )
        if parsed.notna().any():
            return candidate

    for column in dataframe.columns:
        normalized = str(column).strip().lower()
        if not any(
            token in normalized
            for token in ("date", "time", "created", "updated")
        ):
            continue

        parsed = pd.to_datetime(
            dataframe[column],
            errors="coerce",
            utc=True,
        )
        if parsed.notna().any():
            return column

    return None


def get_connector_month_index(
    value: str,
):
    parsed_value = datetime.strptime(
        value,
        "%Y-%m",
    )
    return parsed_value.year * 12 + parsed_value.month - 1


def get_connector_summary_group_columns(
    dataframe,
    date_column,
    report_config: dict,
):
    preferred_columns = report_config.get("dimensions") or []
    candidates = [
        *preferred_columns,
        *dataframe.select_dtypes(exclude="number").columns.tolist(),
    ]
    group_columns = []
    seen = set()

    for column in candidates:
        if (
            column in seen
            or column not in dataframe.columns
            or column == date_column
            or column in {
                SUMMARY_MONTH_COLUMN,
                SUMMARY_MARKER_COLUMN,
            }
        ):
            continue
        seen.add(column)
        normalized = str(column).strip().lower()
        if any(
            token in normalized
            for token in (
                "email",
                "phone",
                "record_id",
                "transaction_id",
                "customer_id",
                "uuid",
            )
        ):
            continue
        if dataframe[column].nunique(dropna=False) > MAX_SUMMARY_GROUP_CARDINALITY:
            continue
        group_columns.append(column)
        if len(group_columns) >= MAX_SUMMARY_GROUP_COLUMNS:
            break

    return group_columns


def build_connector_summary_dataframe(
    dataframe,
    date_column,
    report_config: dict,
):
    if dataframe.empty:
        return pd.DataFrame()

    summary_input = dataframe.copy()
    fallback_month = date.today().strftime("%Y-%m")
    if date_column:
        parsed_dates = pd.to_datetime(
            summary_input[date_column],
            errors="coerce",
            utc=True,
        )
        summary_months = parsed_dates.dt.strftime("%Y-%m")
        if CONNECTOR_PARTITION_MONTH_COLUMN in summary_input.columns:
            summary_months = summary_months.fillna(
                summary_input[CONNECTOR_PARTITION_MONTH_COLUMN]
            )
        summary_input[SUMMARY_MONTH_COLUMN] = summary_months.fillna(
            fallback_month
        )
    elif CONNECTOR_PARTITION_MONTH_COLUMN in summary_input.columns:
        summary_input[SUMMARY_MONTH_COLUMN] = summary_input[
            CONNECTOR_PARTITION_MONTH_COLUMN
        ]
    else:
        summary_input[SUMMARY_MONTH_COLUMN] = fallback_month

    group_columns = get_connector_summary_group_columns(
        summary_input,
        date_column,
        report_config,
    )
    metric_columns = [
        column
        for column in summary_input.select_dtypes(include="number").columns
        if column not in {
            SUMMARY_MONTH_COLUMN,
            SUMMARY_MARKER_COLUMN,
        }
    ]
    if not metric_columns:
        return pd.DataFrame()

    grouping_columns = [
        SUMMARY_MONTH_COLUMN,
        *group_columns,
    ]
    aggregated = (
        summary_input.groupby(
            grouping_columns,
            dropna=False,
            sort=True,
        )[metric_columns]
        .agg(["mean", "min", "max", "count", "sum"])
        .reset_index()
    )

    flattened_columns = []
    for column in aggregated.columns:
        if not isinstance(column, tuple):
            flattened_columns.append(column)
            continue
        metric, statistic = column
        if not statistic:
            flattened_columns.append(metric)
        elif statistic == "sum":
            flattened_columns.append(metric)
        else:
            flattened_columns.append(
                f"{metric}__{statistic}"
            )
    aggregated.columns = flattened_columns

    # Keep an explicit sum statistic alongside the original metric name.
    # The original name remains the compatibility alias used by dashboards.
    for metric in metric_columns:
        if metric in aggregated.columns:
            aggregated[f"{metric}__sum"] = aggregated[metric]

    if date_column:
        aggregated[date_column] = (
            aggregated[SUMMARY_MONTH_COLUMN]
            + "-01"
        )
    aggregated[SUMMARY_MARKER_COLUMN] = True
    return aggregated


def merge_connector_summary_dataframes(
    existing_summary,
    new_summary,
):
    if new_summary.empty:
        return existing_summary
    if existing_summary.empty:
        return new_summary.reset_index(drop=True)

    summary_months = set(
        new_summary[SUMMARY_MONTH_COLUMN]
        .dropna()
        .astype(str)
    )
    retained_summary = existing_summary.loc[
        ~existing_summary[SUMMARY_MONTH_COLUMN]
        .astype(str)
        .isin(summary_months)
    ]
    return pd.concat(
        [retained_summary, new_summary],
        ignore_index=True,
        sort=False,
    ).reset_index(drop=True)


def write_connector_monthly_partitions(
    dataframe,
    connection,
    report_config: dict,
    existing_summary=None,
):
    partition_dir = build_connector_partition_dir(
        connection,
    )
    staging_dir = f"{partition_dir}.tmp-{uuid.uuid4().hex}"
    staging_hot_dir = build_connector_hot_dir(staging_dir)
    os.makedirs(staging_hot_dir, exist_ok=True)

    date_column = find_connector_partition_date_column(
        dataframe,
        report_config,
    )
    fallback_month = date.today().strftime("%Y-%m")
    partition_key = CONNECTOR_PARTITION_MONTH_COLUMN
    partitioned_dataframe = dataframe.copy()

    if date_column:
        parsed_dates = pd.to_datetime(
            partitioned_dataframe[date_column],
            errors="coerce",
            utc=True,
        )
        partitioned_dataframe[partition_key] = (
            parsed_dates.dt.strftime("%Y-%m")
            .fillna(fallback_month)
        )
    elif partition_key in partitioned_dataframe.columns:
        partitioned_dataframe[partition_key] = (
            partitioned_dataframe[partition_key]
            .astype(str)
            .replace("nan", fallback_month)
        )
    else:
        partitioned_dataframe[partition_key] = fallback_month

    current_month_index = (
        date.today().year * 12
        + date.today().month
        - 1
    )
    hot_cutoff_month_index = (
        current_month_index
        - CONNECTOR_HOT_MONTHS
        + 1
    )
    month_indices = partitioned_dataframe[partition_key].map(
        get_connector_month_index
    )
    hot_dataframe = partitioned_dataframe.loc[
        month_indices >= hot_cutoff_month_index
    ]
    expired_dataframe = partitioned_dataframe.loc[
        month_indices < hot_cutoff_month_index
    ]
    if existing_summary is None:
        existing_summary = load_connector_summary_dataframe(
            partition_dir
        )
    existing_summary = filter_connector_summary_by_retention(
        existing_summary,
        SUMMARY_MONTH_COLUMN,
    )
    new_summary = build_connector_summary_dataframe(
        expired_dataframe.drop(
            columns=[partition_key],
        ),
        date_column,
        report_config,
    )
    merged_summary = merge_connector_summary_dataframes(
        existing_summary,
        new_summary,
    )
    merged_summary = filter_connector_summary_by_retention(
        merged_summary,
        SUMMARY_MONTH_COLUMN,
    )

    hot_partition_count = 0
    historical_partition_paths = []
    try:
        for month, month_dataframe in hot_dataframe.groupby(
            partition_key,
            sort=True,
        ):
            output_path = os.path.join(
                staging_hot_dir,
                f"month={month}.parquet",
            )
            month_dataframe.drop(
                columns=[partition_key],
            ).to_parquet(
                output_path,
                index=False,
                compression=CONNECTOR_PARQUET_COMPRESSION,
            )
            hot_partition_count += 1

        if not merged_summary.empty:
            staging_historical_dir = build_connector_historical_dir(
                staging_dir
            )
            os.makedirs(staging_historical_dir, exist_ok=True)
            summary_years = (
                merged_summary[SUMMARY_MONTH_COLUMN]
                .astype(str)
                .str.slice(0, 4)
            )
            for year, year_dataframe in merged_summary.groupby(
                summary_years,
                sort=True,
            ):
                output_path = build_connector_historical_year_path(
                    staging_dir,
                    str(year),
                )
                year_dataframe.to_parquet(
                    output_path,
                    index=False,
                    compression=CONNECTOR_PARQUET_COMPRESSION,
                )
                historical_partition_paths.append(output_path)

        if os.path.isdir(partition_dir):
            shutil.rmtree(partition_dir)
        elif os.path.exists(partition_dir):
            os.remove(partition_dir)

        os.makedirs(
            os.path.dirname(partition_dir),
            exist_ok=True,
        )
        os.replace(
            staging_dir,
            partition_dir,
        )
    except Exception:
        if os.path.isdir(staging_dir):
            shutil.rmtree(staging_dir)
        raise

    return {
        "partition_dir": partition_dir,
        "date_column": date_column,
        "hot_partition_count": hot_partition_count,
        "hot_row_count": len(hot_dataframe),
        "historical_summary_row_count": len(merged_summary),
        "historical_partition_count": len(
            historical_partition_paths
        ),
        "historical_partition_paths": [
            build_connector_historical_year_path(
                partition_dir,
                str(year),
            )
            for year in (
                merged_summary[SUMMARY_MONTH_COLUMN]
                .astype(str)
                .str.slice(0, 4)
                .drop_duplicates()
                .sort_values()
                if not merged_summary.empty
                else []
            )
        ],
        "column_count": len(
            set(hot_dataframe.columns)
            | set(merged_summary.columns)
        ),
    }


def get_connector_dedup_keys(
    source_type: str,
    report_config: dict,
    columns,
):
    if source_type == "google_analytics":
        keys = report_config.get("dimensions") or []
    else:
        keys = CONNECTOR_DEDUP_KEYS.get(source_type, [])

    available_keys = [
        key
        for key in keys
        if key in columns
    ]
    if available_keys and len(available_keys) == len(keys):
        return available_keys

    for candidate in (
        "id",
        "record_id",
        "external_id",
    ):
        if candidate in columns:
            return [candidate]

    return []


def merge_connector_dataframes(
    existing_dataframe,
    incoming_dataframe,
    source_type: str,
    report_config: dict,
):
    if existing_dataframe is None or existing_dataframe.empty:
        return incoming_dataframe.reset_index(drop=True)

    combined = pd.concat(
        [existing_dataframe, incoming_dataframe],
        ignore_index=True,
        sort=False,
    )
    dedup_keys = get_connector_dedup_keys(
        source_type,
        report_config,
        combined.columns,
    )

    if not dedup_keys:
        return combined.drop_duplicates(
            keep="last"
        ).reset_index(drop=True)

    has_identity = combined[dedup_keys].notna().all(axis=1)
    identified = combined.loc[has_identity].drop_duplicates(
        subset=dedup_keys,
        keep="last",
    )
    unidentified = combined.loc[~has_identity].drop_duplicates(
        keep="last"
    )

    return pd.concat(
        [identified, unidentified],
        ignore_index=True,
        sort=False,
    ).reset_index(drop=True)


def run_google_analytics_sync(
    db,
    connection,
    payload: DataSourceConnectionSync,
):
    connection_config = parse_source_connection_config(
        connection.connection_config
    )
    property_id = str(connection_config.get("property_id") or "").strip()
    if not property_id:
        raise ValueError("Configure a Google Analytics property ID first")

    start_date, end_date = get_incremental_sync_window(
        connection,
        payload,
    )
    today = date.today()
    start_date = start_date or today - timedelta(days=365)
    end_date = end_date or today
    dataframe, report_config = load_google_analytics_report(
        property_id=property_id,
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        dimensions=payload.dimensions,
        metrics=payload.metrics,
        db=db,
        connection=connection,
    )
    return persist_connector_dataframe(
        db,
        connection,
        dataframe,
        report_config,
    )


def persist_connector_dataframe(
    db,
    connection,
    dataframe,
    report_config,
):
    file_path = None
    replaced_file_path = None
    try:
        report_config = report_config or {}
        existing_dataset = find_connector_dataset(
            db,
            connection,
        )

        storage = get_object_storage()
        existing_reference = (
            get_dataset_storage_reference(existing_dataset)
            if existing_dataset
            else ""
        )
        existing_dataframe = None
        existing_summary = pd.DataFrame()
        if existing_dataset:
            if storage.is_directory_reference(existing_reference):
                existing_dataframe = load_connector_raw_dataframe(
                    existing_reference
                )
                existing_summary = load_connector_summary_dataframe(
                    existing_reference
                )
            else:
                _, existing_dataframe = load_dataset_file(
                    existing_reference,
                    existing_dataset.file_name,
                )

        fetched_row_count = len(dataframe)
        storage_migration_required = bool(
            existing_dataset
            and not storage.is_directory_reference(existing_reference)
        )

        if dataframe.empty:
            if not existing_dataset:
                start_date = report_config.get("start_date")
                end_date = report_config.get("end_date")
                period = (
                    f" from {start_date} through {end_date}"
                    if start_date and end_date
                    else " for the selected sync period"
                )
                raise ConnectorNoData(
                    f"{connection.source_type.replace('_', ' ').title()} "
                    f"returned no records{period}. Verify that the connected "
                    "account contains data in this range."
                )
            dataframe = existing_dataframe

        merged_dataframe = merge_connector_dataframes(
            existing_dataframe,
            dataframe,
            connection.source_type,
            report_config,
        )
        base_filename = (
            existing_dataset.file_name
            if existing_dataset
            else sanitize_upload_filename(
                f"{connection.source_type}-{connection.id}-"
                f"{date.today().isoformat()}.csv"
            )
        )
        upload_filename = (
            os.path.splitext(
                sanitize_upload_filename(base_filename)
            )[0]
            + ".parquet"
        )
        try:
            storage_result = write_connector_monthly_partitions(
                merged_dataframe,
                connection,
                report_config,
                existing_summary=existing_summary,
            )
        except ImportError as error:
            raise ConnectorUnavailable(
                "Connector dataset storage requires the pyarrow package"
            ) from error
        except Exception as error:
            raise ConnectorUnavailable(
                "Connector data could not be stored as Parquet"
            ) from error
        local_partition_dir = storage_result["partition_dir"]
        file_path = storage.put_directory(
            local_partition_dir,
            key_prefix=build_connector_storage_prefix(connection),
        )
        storage_provider = (
            storage.config.provider
            if storage.is_remote
            else None
        )
        stored_file_path = (
            storage.reference_key(file_path)
            if storage.is_remote
            else file_path
        )
        if file_path != local_partition_dir:
            remove_dataset_file(local_partition_dir)

        storage_key = stored_file_path
        historical_summary_files = []
        for local_path in storage_result[
            "historical_partition_paths"
        ]:
            relative_path = os.path.relpath(
                local_path,
                local_partition_dir,
            ).replace(os.sep, "/")
            historical_summary_files.append(
                f"{storage_key.rstrip('/')}/{relative_path}"
                if storage.is_remote
                else local_path
            )
        historical_directory = (
            f"{storage_key.rstrip('/')}/{CONNECTOR_HISTORICAL_DIRECTORY}/"
            if storage.is_remote
            else os.path.join(
                storage_key,
                CONNECTOR_HISTORICAL_DIRECTORY,
            )
        )

        merged_report_config = {
            **report_config,
            "incremental_sync": bool(existing_dataset),
            "source_columns": [
                str(column)
                for column in merged_dataframe.columns
            ],
            "source_schema": {
                str(column): str(merged_dataframe[column].dtype)
                for column in merged_dataframe.columns
            },
            "fetched_row_count": fetched_row_count,
            "row_count": (
                storage_result["hot_row_count"]
                + storage_result["historical_summary_row_count"]
            ),
            "added_row_count": (
                0
                if storage_migration_required
                else (
                    len(merged_dataframe)
                    if existing_dataframe is None
                    else max(
                        0,
                        len(merged_dataframe) - len(existing_dataframe),
                    )
                )
            ),
            "stored_file_format": "parquet",
            "partitioned_storage": "monthly_hot_with_yearly_historical_summary",
            "partition_directory": storage_key,
            "partition_date_column": storage_result["date_column"],
            "hot_months": CONNECTOR_HOT_MONTHS,
            "retention_years": CONNECTOR_DATA_RETENTION_YEARS,
            "retention_months": CONNECTOR_DATA_RETENTION_MONTHS,
            "retention_cutoff_month": connector_retention_cutoff_month(),
            "partition_count": storage_result["hot_partition_count"],
            "hot_partition_count": storage_result["hot_partition_count"],
            "historical_directory": historical_directory,
            "historical_summary_files": historical_summary_files,
            "historical_summary_file": (
                historical_summary_files[0]
                if historical_summary_files
                else None
            ),
            "historical_partition_count": storage_result[
                "historical_partition_count"
            ],
            "historical_summary_row_count": storage_result[
                "historical_summary_row_count"
            ],
        }
        next_source_config = {
            "connection_id": connection.id,
            "ingestion_mode": "connector_sync",
            **merged_report_config,
        }
        if existing_dataset:
            previous_source_config = parse_source_connection_config(
                existing_dataset.source_config
            )
            if DATASET_SELECTED_METRICS_KEY in previous_source_config:
                next_source_config[DATASET_SELECTED_METRICS_KEY] = (
                    previous_source_config[DATASET_SELECTED_METRICS_KEY]
                )
        source_config = json.dumps(
            next_source_config,
            sort_keys=True,
        )

        if existing_dataset:
            dataset = existing_dataset
            if (
                dataset.file_path != stored_file_path
                or dataset.storage_provider != storage_provider
            ):
                replaced_file_path = existing_reference
            dataset.file_name = upload_filename
            dataset.file_path = stored_file_path
            dataset.storage_provider = storage_provider
            dataset.source_config = source_config
            dataset.row_count = (
                storage_result["hot_row_count"]
                + storage_result["historical_summary_row_count"]
            )
            dataset.column_count = storage_result["column_count"]
        else:
            dataset = Dataset(
                user_id=connection.user_id,
                workspace_id=connection.workspace_id,
                source_type=connection.source_type,
                source_config=source_config,
                file_name=upload_filename,
                file_path=stored_file_path,
                storage_provider=storage_provider,
                row_count=(
                    storage_result["hot_row_count"]
                    + storage_result["historical_summary_row_count"]
                ),
                column_count=storage_result["column_count"],
            )
            db.add(dataset)

        connection.status = "connected"
        connection.last_synced_at = utc_now()
        db.flush()
        return dataset, merged_report_config, file_path, replaced_file_path
    except Exception:
        if file_path:
            remove_dataset_file(file_path)
        raise


def connector_dataset_requires_retention_cleanup(
    dataset,
) -> bool:
    """Check partition metadata without rewriting an active connector dataset."""
    source_config = parse_source_connection_config(
        dataset.source_config
    )
    date_column = source_config.get("partition_date_column")
    storage = get_object_storage()

    dataset_reference = get_dataset_storage_reference(dataset)
    if storage.is_directory_reference(dataset_reference):
        with storage.materialize(dataset_reference) as local_partition_dir:
            for path in list_connector_raw_partition_paths(
                local_partition_dir
            ):
                filename = Path(path).name
                month = filename.removeprefix("month=").removesuffix(
                    ".parquet"
                )
                if month and has_expired_connector_month(month):
                    return True

            historical_dir = build_connector_historical_dir(
                local_partition_dir
            )
            historical_paths = (
                sorted(
                    path
                    for path in Path(historical_dir).glob("year=*.parquet")
                    if path.is_file()
                )
                if os.path.isdir(historical_dir)
                else []
            )
            legacy_path = build_connector_legacy_summary_path(
                local_partition_dir
            )
            if os.path.isfile(legacy_path):
                historical_paths.append(Path(legacy_path))
            if not historical_paths:
                return False

            summary = pd.concat(
                [pd.read_parquet(path) for path in historical_paths],
                ignore_index=True,
                sort=False,
            )
            if SUMMARY_MONTH_COLUMN not in summary.columns:
                return False
            months = summary[SUMMARY_MONTH_COLUMN].dropna().astype(str)
            return any(
                has_expired_connector_month(month)
                for month in months
                if len(month) >= 7
            )

    if not date_column:
        created_at = dataset.created_at
        return bool(
            created_at
            and created_at.date()
            < date.fromisoformat(
                f"{connector_retention_cutoff_month()}-01"
            )
        )

    with storage.materialize(dataset_reference) as local_file_path:
        try:
            dataframe = load_dataset_file(
                local_file_path,
                dataset.file_name,
            )[1]
        except (FileNotFoundError, OSError, ValueError):
            return False
    if date_column not in dataframe.columns:
        return False
    parsed_dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
        utc=True,
    )
    months = parsed_dates.dropna().dt.strftime("%Y-%m")
    return any(
        has_expired_connector_month(month)
        for month in months
    )


def purge_expired_connector_dataset(
    db,
    connection,
):
    """Rewrite a connector dataset only when its five-year boundary is crossed."""
    dataset = find_connector_dataset(db, connection)
    if not dataset or not connector_dataset_requires_retention_cleanup(dataset):
        return None

    previous_last_synced_at = connection.last_synced_at
    source_config = parse_source_connection_config(
        dataset.source_config
    )
    _, report_config, _file_path, replaced_file_path = (
        persist_connector_dataframe(
            db,
            connection,
            pd.DataFrame(),
            source_config,
        )
    )
    # Retention maintenance is not a source sync and must not move the
    # connector's next scheduled sync window.
    connection.last_synced_at = previous_last_synced_at
    db.flush()
    return {
        "dataset_id": dataset.id,
        "deleted_before_month": report_config.get(
            "retention_cutoff_month",
            connector_retention_cutoff_month(),
        ),
        "replaced_file_path": replaced_file_path,
    }


def run_data_source_sync(
    db,
    connection,
    payload: DataSourceConnectionSync,
):
    if connection.source_type == "google_analytics":
        return run_google_analytics_sync(db, connection, payload)

    if connection.source_type not in IMPLEMENTED_CONNECTOR_TYPES:
        raise ConnectorUnavailable(
            f"{connection.source_type} connector does not have a dataset adapter yet"
        )

    start_date, end_date = get_incremental_sync_window(
        connection,
        payload,
    )
    dataframe, report_config = load_connector_dataframe(
        db,
        connection,
        start_date,
        end_date,
    )
    return persist_connector_dataframe(
        db,
        connection,
        dataframe,
        report_config,
    )


def get_connectors_scheduler_secret():
    return str(
        os.getenv("CONNECTORS_SCHEDULER_SECRET", "") or ""
    ).strip()


def require_connectors_scheduler_secret(request: Request):
    expected_secret = get_connectors_scheduler_secret()
    if not expected_secret:
        raise HTTPException(
            status_code=503,
            detail="Connector scheduler secret is not configured",
        )
    provided_secret = str(
        request.headers.get("X-Connectors-Scheduler-Secret", "") or ""
    ).strip()
    if provided_secret != expected_secret:
        raise HTTPException(
            status_code=401,
            detail="Invalid connector scheduler secret",
        )


@router.post("/source-connections/sync-due")
async def sync_due_source_connections(request: Request):
    require_connectors_scheduler_secret(request)
    now = utc_now()
    db = SessionLocal()
    results = []
    retention_results = []
    try:
        connections = (
            db.query(DataSourceConnection)
            .filter(DataSourceConnection.status != "planned")
            .order_by(DataSourceConnection.id.asc())
            .all()
        )
        for connection in connections:
            try:
                retention_result = purge_expired_connector_dataset(
                    db,
                    connection,
                )
                if retention_result:
                    db.commit()
                    remove_dataset_file(
                        retention_result["replaced_file_path"]
                    )
                    retention_results.append({
                        "connection_id": connection.id,
                        "status": "retention_pruned",
                        "dataset_id": retention_result["dataset_id"],
                        "deleted_before_month": retention_result[
                            "deleted_before_month"
                        ],
                    })
            except Exception as error:
                db.rollback()
                retention_results.append({
                    "connection_id": connection.id,
                    "status": "retention_cleanup_failed",
                    "detail": str(error)[:240],
                })

            source = get_dataset_source(connection.source_type)
            if (
                connection.status != "connected"
                and not (
                    has_source_connection_config(
                        connection.connection_config,
                    )
                    or has_source_connection_credentials(
                        source,
                        connection.connection_config,
                    )
                )
            ):
                continue

            (
                enabled,
                interval_hours,
                time_of_day,
                timezone_name,
                anchor_date,
                day_of_week,
            ) = read_connection_schedule_details(
                connection.connection_config
            )
            if not enabled or not connection_sync_is_due(
                connection.last_synced_at,
                now,
                interval_hours,
                time_of_day,
                timezone_name,
                anchor_date,
                day_of_week,
            ):
                continue

            if connection.source_type not in {
                "google_analytics",
                *IMPLEMENTED_CONNECTOR_TYPES,
            }:
                results.append({
                    "connection_id": connection.id,
                    "status": "unsupported",
                    "detail": (
                        "Scheduled sync is enabled, but this connector has "
                        "no dataset adapter is enabled for this source"
                    ),
                })
                continue

            try:
                (
                    dataset,
                    report_config,
                    file_path,
                    replaced_file_path,
                ) = run_data_source_sync(
                    db,
                    connection,
                    DataSourceConnectionSync(),
                )
                db.commit()
                remove_dataset_file(replaced_file_path)
                results.append({
                    "connection_id": connection.id,
                    "dataset_id": dataset.id,
                    "status": "synced",
                    "row_count": dataset.row_count,
                    "report": report_config,
                })
            except (GoogleAnalyticsConnectorUnavailable, ConnectorUnavailable) as error:
                db.rollback()
                results.append({
                    "connection_id": connection.id,
                    "status": "failed",
                    "detail": str(error),
                })
            except Exception as error:
                db.rollback()
                results.append({
                    "connection_id": connection.id,
                    "status": "failed",
                    "detail": str(error)[:240],
                })

        return {
            "processed_count": len(results),
            "synced_count": sum(
                result["status"] == "synced" for result in results
            ),
            "failed_count": sum(
                result["status"] == "failed" for result in results
            ),
            "retention_pruned_count": sum(
                result["status"] == "retention_pruned"
                for result in retention_results
            ),
            "retention_results": retention_results,
            "results": results,
        }
    finally:
        db.close()


@router.post("/source-connections/{connection_id}/sync")
async def sync_source_connection(
    request: Request,
    connection_id: int,
    payload: DataSourceConnectionSync,
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
    connection = None
    try:
        connection = get_owned_source_connection(
            db,
            connection_id,
            user_id,
            workspace_id,
        )

        if connection.source_type not in {
            "google_analytics",
            *IMPLEMENTED_CONNECTOR_TYPES,
        }:
            raise HTTPException(
                status_code=400,
                detail="Manual sync is not enabled for this source",
            )

        (
            dataset,
            report_config,
            _file_path,
            replaced_file_path,
        ) = run_data_source_sync(
            db,
            connection,
            payload,
        )
        db.commit()
        remove_dataset_file(replaced_file_path)
        db.refresh(dataset)

        return {
            "connection_id": connection.id,
            "dataset_id": dataset.id,
            "workspace_id": dataset.workspace_id,
            **build_dataset_source_metadata(dataset),
            "file_name": dataset.file_name,
            "file_path": dataset.file_path,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
            "report": report_config,
        }
    except ConnectorNoData as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error
    except (GoogleAnalyticsConnectorUnavailable, ConnectorUnavailable) as error:
        raise HTTPException(
            status_code=503,
            detail=str(error),
        ) from error
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Connector sync failed",
            extra={
                "connection_id": connection_id,
                "source_type": getattr(connection, "source_type", None),
            },
        )
        raise HTTPException(
            status_code=502,
            detail="Connector data could not be loaded",
        )
    finally:
        db.close()


@router.patch("/{dataset_id}/metric-selection")
async def update_dataset_metric_selection(
    request: Request,
    dataset_id: int,
    payload: DatasetMetricSelectionUpdate,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )
    require_workspace_data_manager(request)

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
            apply_metric_selection=False,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        numeric_columns, selected_columns = (
            normalize_selected_metric_columns(
                dataframe,
                payload.selected_metric_columns,
            )
        )
        source_config = parse_source_connection_config(
            dataset.source_config
        )
        source_config[DATASET_SELECTED_METRICS_KEY] = (
            selected_columns
        )
        dataset.source_config = json.dumps(
            source_config,
            sort_keys=True,
        )
        db.commit()
        db.refresh(dataset)

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "numeric_columns": numeric_columns,
            "selected_metric_columns": selected_columns,
        }
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error
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
            apply_metric_selection=False,
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
            workspace_id,
            user_id,
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


@router.get("/{dataset_id}/anomalies")
async def dataset_anomalies(
    request: Request,
    dataset_id: int,
    metric: str | None = Query(None, max_length=120),
    date_column: str | None = Query(None, max_length=120),
    start_date: str | None = Query(None, max_length=40),
    period_filter: Literal[
        "1m",
        "1q",
        "6m",
        "1y",
        "2y",
        "3y",
        "5y",
        "all",
    ] = "all",
    aggregation: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] = "monthly",
    aggregation_type: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] = "sum",
    sensitivity: Literal[
        "high",
        "medium",
        "low",
    ] = "medium",
    max_anomalies: int = Query(
        100,
        ge=1,
        le=100,
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

        try:
            result = await asyncio.to_thread(
                detect_dataset_anomalies,
                dataframe,
                metric=metric,
                date_column=date_column,
                start_date=start_date,
                period_filter=period_filter,
                aggregation=aggregation,
                aggregation_type=aggregation_type,
                sensitivity=sensitivity,
                max_anomalies=max_anomalies,
            )
        except ValueError as error:
            raise HTTPException(
                status_code=400,
                detail=str(error),
            ) from error

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            **result,
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
    start_date: str | None = Query(None),
    period_filter: Literal[
        "1m",
        "1q",
        "6m",
        "1y",
        "2y",
        "3y",
        "5y",
        "all",
    ] | None = Query(None),
    aggregation: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] | None = Query(None),
    aggregation_type: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] | None = Query(None),
    include_ai_analysis: bool = Query(
        default=True,
        description="Include AI analysis in the initial dataset response.",
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
            apply_metric_selection=False,
        )

        verify_dataset_owner(
            dataset,
            user_id,
            workspace_id,
        )

        learning_context = None
        if include_ai_analysis:
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
            workspace_id=workspace_id,
            actor_user_id=user_id,
            start_date=start_date,
            period_filter=period_filter,
            aggregation=aggregation,
            aggregation_type=aggregation_type,
            include_ai_analysis=include_ai_analysis,
        )

    finally:
        db.close()


@router.get("/{dataset_id}/ai-analysis")
async def dataset_ai_analysis(
    request: Request,
    dataset_id: int,
    metric: str | None = None,
    start_date: str | None = Query(None),
    period_filter: Literal[
        "1m",
        "1q",
        "6m",
        "1y",
        "2y",
        "3y",
        "5y",
        "all",
    ] | None = Query(None),
    aggregation: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] | None = Query(None),
    aggregation_type: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] | None = Query(None),
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

        if any(
            value is not None
            for value in (
                start_date,
                period_filter,
                aggregation,
                aggregation_type,
            )
        ):
            date_column, _ = identify_forecast_columns(
                dataframe
            )
            dataframe = prepare_forecast_dataframe(
                dataframe,
                date_column,
                start_date,
                period_filter,
                aggregation,
                aggregation_type,
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
            workspace_id,
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

        remove_dataset_file(get_dataset_storage_reference(dataset))
        cleanup_deleted_dataset_preferences(
            db,
            dataset,
        )
        cleanup_deleted_dataset_join_caches(
            db,
            dataset,
        )
        cleanup_deleted_dataset_relationships(
            db,
            dataset,
        )

        db.delete(dataset)
        db.commit()

        return {"message": "Dataset deleted"}

    finally:
        db.close()
