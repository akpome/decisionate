from dataclasses import dataclass

from app.configuration import get_runtime_configuration


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
    engine = get_runtime_configuration().analytics_engine

    if engine not in SUPPORTED_ANALYTICS_ENGINES:
        raise ValueError(
            f"Unsupported analytics engine: {engine}"
        )

    return engine


def get_analytics_storage_format():
    storage_format = get_runtime_configuration().analytics_storage_format

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
    runtime = get_runtime_configuration()
    return AnalyticsEngineConfig(
        engine=runtime.analytics_engine,
        duckdb_path=runtime.duckdb_database_path,
        analytics_storage_dir=runtime.analytics_storage_dir,
        storage_format=runtime.analytics_storage_format,
        bigquery_project_id=runtime.bigquery_project_id or None,
        bigquery_dataset=runtime.bigquery_dataset or None,
        bigquery_location=runtime.bigquery_location,
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
