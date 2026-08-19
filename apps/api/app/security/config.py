from __future__ import annotations

from urllib.parse import urlparse

from app.configuration import get_runtime_configuration
from app.security.secrets import secret_encryption_is_configured

def _is_https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def build_security_configuration_status() -> dict:
    runtime = get_runtime_configuration()
    app_environment = runtime.app_env
    auth_jwks_configured = bool(runtime.auth_jwks_url)
    database_url = runtime.database_url
    storage_provider = runtime.object_storage_provider
    web_url = runtime.web_url
    api_url = runtime.api_url
    cors_origins = list(runtime.cors_allowed_origins)

    issues: list[str] = []
    if app_environment == "production":
        if not auth_jwks_configured:
            issues.append("AUTH_JWKS_URL or CLERK_JWKS_URL is required")
        if not secret_encryption_is_configured():
            issues.append("OAUTH_TOKEN_ENCRYPTION_KEY is required")
        if not runtime.sentry_dsn:
            issues.append("SENTRY_DSN is required")
        if not database_url or database_url.startswith("sqlite"):
            issues.append("a non-SQLite DATABASE_URL is required")
        if storage_provider not in {"r2", "s3"}:
            issues.append("remote object storage (r2 or s3) is required")
        if not _is_https_url(web_url):
            issues.append("DECISIONATE_WEB_APP_URL must use HTTPS")
        if not _is_https_url(api_url):
            issues.append("DECISIONATE_API_URL must use HTTPS")
        if not cors_origins:
            issues.append("CORS_ALLOWED_ORIGINS must be explicitly configured")
        if "*" in cors_origins:
            issues.append("production CORS origins cannot use a wildcard")
        if any(
            origin.startswith("http://localhost")
            or origin.startswith("http://127.0.0.1")
            for origin in cors_origins
        ):
            issues.append("production CORS origins cannot include localhost")

    return {
        "environment": app_environment,
        "production_guard_enabled": app_environment == "production",
        "production_ready": not issues,
        "authentication_verification_configured": auth_jwks_configured,
        "stored_secret_encryption_configured": secret_encryption_is_configured(),
        "error_monitoring_configured": bool(runtime.sentry_dsn),
        "https_urls_configured": (
            _is_https_url(web_url) and _is_https_url(api_url)
        ),
        "issues": issues,
    }


def validate_production_security_configuration() -> None:
    status = build_security_configuration_status()
    if not status["production_guard_enabled"] or status["production_ready"]:
        return

    raise RuntimeError(
        "Production security configuration is incomplete: "
        + "; ".join(status["issues"])
    )
