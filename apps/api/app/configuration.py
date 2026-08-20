"""Provider-neutral runtime configuration for the Decisionate API.

The application reads deployment choices from environment variables at boot.
Provider-specific modules should consume this boundary instead of knowing
where the service is hosted. Secrets are never included in status output.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _first_env(*names: str) -> str:
    for name in names:
        value = _env(name)
        if value:
            return value
    return ""


def get_provider_setting(name: str) -> str:
    """Read a provider-specific setting without embedding a provider default."""
    return _env(name)


def _int_env(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except (TypeError, ValueError):
        return default


def normalize_database_url(value: str | None) -> str:
    """Normalize common hosted PostgreSQL URLs for SQLAlchemy."""
    database_url = str(value or "").strip() or "sqlite:///./decisionate.db"
    if database_url.startswith("postgres://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgres://")
    if database_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgresql://")
    return database_url


@dataclass(frozen=True)
class RuntimeConfiguration:
    app_env: str
    database_url: str
    api_url: str
    web_url: str
    cors_allowed_origins: tuple[str, ...]
    dataset_upload_dir: str
    object_storage_provider: str
    object_storage_bucket: str
    object_storage_endpoint: str
    object_storage_access_key: str
    object_storage_secret_key: str
    object_storage_region: str
    object_storage_project: str
    object_storage_credentials_file: str
    object_storage_credentials_json: str
    object_storage_connection_string: str
    object_storage_account_url: str
    object_storage_account_name: str
    object_storage_account_key: str
    object_storage_sas_token: str
    cache_provider: str
    redis_url: str
    analytics_engine: str
    analytics_storage_format: str
    analytics_storage_dir: str
    duckdb_database_path: str
    bigquery_project_id: str
    bigquery_dataset: str
    bigquery_location: str
    auth_provider: str
    auth_jwks_url: str
    auth_jwt_audience: str
    auth_jwt_issuer: str
    ai_provider: str
    ai_api_key: str
    ai_model: str
    ai_api_url: str
    stripe_api_url: str
    sentry_dsn: str
    sentry_traces_sample_rate: str


def get_runtime_configuration() -> RuntimeConfiguration:
    """Read the deployment contract from the current process environment."""
    cors_origins = tuple(
        origin.strip().rstrip("/")
        for origin in _env("CORS_ALLOWED_ORIGINS").split(",")
        if origin.strip()
    )

    return RuntimeConfiguration(
        app_env=_env("APP_ENV", "development").lower() or "development",
        database_url=normalize_database_url(_env("DATABASE_URL")),
        api_url=_env("DECISIONATE_API_URL", "http://localhost:8000"),
        web_url=_env("DECISIONATE_WEB_APP_URL", "http://localhost:3000"),
        cors_allowed_origins=cors_origins,
        dataset_upload_dir=_env("DATASET_UPLOAD_DIR", "uploads") or "uploads",
        object_storage_provider=(
            _env("OBJECT_STORAGE_PROVIDER", "local").lower()
            or "local"
        ),
        object_storage_bucket=_first_env(
            "OBJECT_STORAGE_BUCKET",
            "R2_BUCKET",
            "GCS_BUCKET",
            "AZURE_STORAGE_CONTAINER",
        ),
        object_storage_endpoint=_first_env("OBJECT_STORAGE_ENDPOINT", "R2_ENDPOINT"),
        object_storage_access_key=_first_env(
            "OBJECT_STORAGE_ACCESS_KEY",
            "R2_ACCESS_KEY_ID",
        ),
        object_storage_secret_key=_first_env(
            "OBJECT_STORAGE_SECRET_KEY",
            "R2_SECRET_ACCESS_KEY",
        ),
        object_storage_region=_env("OBJECT_STORAGE_REGION"),
        object_storage_project=_first_env(
            "OBJECT_STORAGE_PROJECT",
            "GCS_PROJECT",
        ),
        object_storage_credentials_file=_first_env(
            "OBJECT_STORAGE_CREDENTIALS_FILE",
            "GCS_CREDENTIALS_FILE",
        ),
        object_storage_credentials_json=_first_env(
            "OBJECT_STORAGE_CREDENTIALS_JSON",
            "GCS_CREDENTIALS_JSON",
        ),
        object_storage_connection_string=_first_env(
            "OBJECT_STORAGE_CONNECTION_STRING",
            "AZURE_STORAGE_CONNECTION_STRING",
        ),
        object_storage_account_url=_first_env(
            "OBJECT_STORAGE_ACCOUNT_URL",
            "AZURE_STORAGE_ACCOUNT_URL",
        ),
        object_storage_account_name=_first_env(
            "OBJECT_STORAGE_ACCOUNT_NAME",
            "AZURE_STORAGE_ACCOUNT_NAME",
        ),
        object_storage_account_key=_first_env(
            "OBJECT_STORAGE_ACCOUNT_KEY",
            "AZURE_STORAGE_ACCOUNT_KEY",
        ),
        object_storage_sas_token=_first_env(
            "OBJECT_STORAGE_SAS_TOKEN",
            "AZURE_STORAGE_SAS_TOKEN",
        ),
        cache_provider=(
            _env("CACHE_PROVIDER", "memory").lower() or "memory"
        ),
        redis_url=_env("REDIS_URL"),
        analytics_engine=(
            _env("ANALYTICS_ENGINE", "duckdb").lower() or "duckdb"
        ),
        analytics_storage_format=(
            _env("ANALYTICS_STORAGE_FORMAT", "parquet").lower()
            or "parquet"
        ),
        analytics_storage_dir=_env(
            "ANALYTICS_STORAGE_DIR",
            "analytics/datasets",
        ),
        duckdb_database_path=_env(
            "DUCKDB_DATABASE_PATH",
            "analytics/decisionate.duckdb",
        ),
        bigquery_project_id=_env("BIGQUERY_PROJECT_ID"),
        bigquery_dataset=_env("BIGQUERY_ANALYTICS_DATASET"),
        bigquery_location=_env("BIGQUERY_LOCATION"),
        # Clerk remains the local/default authentication adapter. Deployments
        # can replace it through AUTH_PROVIDER without changing application
        # code; an empty variable must not create a new identity namespace.
        auth_provider=(
            _env("AUTH_PROVIDER", "clerk").lower() or "clerk"
        ),
        auth_jwks_url=_first_env("AUTH_JWKS_URL", "CLERK_JWKS_URL"),
        auth_jwt_audience=_first_env(
            "AUTH_JWT_AUDIENCE",
            "CLERK_JWT_AUDIENCE",
        ),
        auth_jwt_issuer=_first_env(
            "AUTH_JWT_ISSUER",
            "CLERK_JWT_ISSUER",
        ),
        ai_provider=_env("AI_PROVIDER").lower(),
        ai_api_key=_first_env("AI_API_KEY", "OPENAI_API_KEY"),
        ai_model=_first_env("AI_MODEL", "OPENAI_MODEL"),
        ai_api_url=_first_env("AI_API_URL", "OPENAI_API_URL"),
        stripe_api_url=_env("STRIPE_API_URL").rstrip("/"),
        sentry_dsn=_env("SENTRY_DSN"),
        sentry_traces_sample_rate=_env("SENTRY_TRACES_SAMPLE_RATE", "0") or "0",
    )


def build_runtime_configuration_status(
    config: RuntimeConfiguration | None = None,
) -> dict[str, object]:
    """Return migration-safe provider information without exposing secrets."""
    runtime = config or get_runtime_configuration()
    return {
        "environment": runtime.app_env,
        "database": "postgresql" if runtime.database_url.startswith("postgresql+") else "sqlite",
        "object_storage": runtime.object_storage_provider,
        "cache": runtime.cache_provider,
        "analytics": runtime.analytics_engine,
        "analytics_storage_format": runtime.analytics_storage_format,
        "authentication": runtime.auth_provider,
        "api_url_configured": bool(runtime.api_url),
        "web_url_configured": bool(runtime.web_url),
        "cors_origins_configured": bool(runtime.cors_allowed_origins),
    }
