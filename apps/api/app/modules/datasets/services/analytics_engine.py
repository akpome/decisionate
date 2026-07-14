import os
from dataclasses import dataclass


SUPPORTED_ANALYTICS_ENGINES = {
    "duckdb",
    "bigquery",
}

SUPPORTED_ANALYTICS_STORAGE_FORMATS = {
    "parquet",
    "csv",
}


@dataclass(frozen=True)
class AnalyticsEngineConfig:
    engine: str
    duckdb_path: str
    analytics_storage_dir: str
    storage_format: str
    bigquery_project_id: str | None
    bigquery_dataset: str | None
    bigquery_location: str | None


def get_analytics_engine_name():
    engine = os.getenv(
        "ANALYTICS_ENGINE",
        "duckdb",
    ).strip().lower()

    if engine not in SUPPORTED_ANALYTICS_ENGINES:
        raise ValueError(
            f"Unsupported analytics engine: {engine}"
        )

    return engine


def get_analytics_storage_format():
    storage_format = os.getenv(
        "ANALYTICS_STORAGE_FORMAT",
        "parquet",
    ).strip().lower()

    if (
        storage_format
        not in SUPPORTED_ANALYTICS_STORAGE_FORMATS
    ):
        raise ValueError(
            "Unsupported analytics storage format: "
            f"{storage_format}"
        )

    return storage_format


def get_analytics_engine_config():
    return AnalyticsEngineConfig(
        engine=get_analytics_engine_name(),
        duckdb_path=os.getenv(
            "DUCKDB_DATABASE_PATH",
            "analytics/decisionate.duckdb",
        ),
        analytics_storage_dir=os.getenv(
            "ANALYTICS_STORAGE_DIR",
            "analytics/datasets",
        ),
        storage_format=get_analytics_storage_format(),
        bigquery_project_id=os.getenv(
            "BIGQUERY_PROJECT_ID",
        ),
        bigquery_dataset=os.getenv(
            "BIGQUERY_ANALYTICS_DATASET",
        ),
        bigquery_location=os.getenv(
            "BIGQUERY_LOCATION",
            "US",
        ),
    )


def should_use_portable_analytics_storage():
    return (
        get_analytics_engine_config()
        .storage_format == "parquet"
    )


def build_analytics_engine_status(
    config: AnalyticsEngineConfig | None = None,
):
    analytics_config = (
        config
        or get_analytics_engine_config()
    )

    return {
        "engine": analytics_config.engine,
        "storage_format": analytics_config.storage_format,
        "portable_storage": (
            analytics_config.storage_format == "parquet"
        ),
        "duckdb_configured": bool(
            analytics_config.duckdb_path
        ),
        "bigquery_configured": bool(
            analytics_config.bigquery_project_id
            and analytics_config.bigquery_dataset
        ),
        "bigquery_location": analytics_config.bigquery_location,
    }
