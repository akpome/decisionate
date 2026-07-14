import re
from pathlib import PurePosixPath

from app.modules.datasets.services.analytics_engine import (
    AnalyticsEngineConfig,
    get_analytics_engine_config,
)


def normalize_analytics_identifier(
    value,
    fallback: str,
):
    normalized = re.sub(
        r"[^a-zA-Z0-9_]+",
        "_",
        str(value or "").strip().lower(),
    ).strip("_")

    if not normalized:
        normalized = re.sub(
            r"[^a-zA-Z0-9_]+",
            "_",
            str(fallback or "").strip().lower(),
        ).strip("_") or "identifier"

    if normalized[0].isdigit():
        normalized = f"_{normalized}"

    return normalized


def normalize_analytics_storage_dir(
    value,
):
    storage_dir = str(value or "").strip()

    if not storage_dir:
        return "analytics/datasets"

    return storage_dir.rstrip("/")


def build_dataset_table_name(
    dataset,
):
    return normalize_analytics_identifier(
        f"dataset_{dataset.id}",
        "dataset",
    )


def build_workspace_namespace(
    dataset,
):
    workspace_value = (
        dataset.workspace_id
        or dataset.user_id
        or "personal"
    )

    return normalize_analytics_identifier(
        workspace_value,
        "workspace",
    )


def build_dataset_parquet_path(
    dataset,
    config: AnalyticsEngineConfig | None = None,
):
    analytics_config = (
        config
        or get_analytics_engine_config()
    )
    workspace_namespace = (
        build_workspace_namespace(dataset)
    )
    table_name = build_dataset_table_name(
        dataset
    )

    return str(
        PurePosixPath(
            normalize_analytics_storage_dir(
                analytics_config.analytics_storage_dir
            )
        )
        / f"workspace={workspace_namespace}"
        / f"{table_name}.parquet"
    )


def build_bigquery_table_id(
    dataset,
    config: AnalyticsEngineConfig | None = None,
):
    analytics_config = (
        config
        or get_analytics_engine_config()
    )

    if not analytics_config.bigquery_project_id:
        raise ValueError(
            "BIGQUERY_PROJECT_ID is required"
        )

    if not analytics_config.bigquery_dataset:
        raise ValueError(
            "BIGQUERY_ANALYTICS_DATASET is required"
        )

    return (
        f"{analytics_config.bigquery_project_id}."
        f"{analytics_config.bigquery_dataset}."
        f"{build_workspace_namespace(dataset)}_"
        f"{build_dataset_table_name(dataset)}"
    )


def build_dataset_analytics_manifest(
    dataset,
    config: AnalyticsEngineConfig | None = None,
):
    analytics_config = (
        config
        or get_analytics_engine_config()
    )
    manifest = {
        "engine": analytics_config.engine,
        "storage_format": analytics_config.storage_format,
        "workspace_namespace": build_workspace_namespace(
            dataset
        ),
        "table_name": build_dataset_table_name(
            dataset
        ),
        "parquet_path": build_dataset_parquet_path(
            dataset,
            analytics_config,
        ),
        "bigquery_table_id": None,
    }

    if (
        analytics_config.bigquery_project_id
        and analytics_config.bigquery_dataset
    ):
        manifest["bigquery_table_id"] = (
            build_bigquery_table_id(
                dataset,
                analytics_config,
            )
        )

    return manifest
