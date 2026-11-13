"""Deployment-registered applications. Browser identifiers select, never authorize."""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache
import json
import os
import re
from urllib.parse import urlsplit


DEFAULT_APPLICATION_ID = "decisionate-ca"
_application_id = ContextVar("application_id", default=DEFAULT_APPLICATION_ID)
_application_snapshot = ContextVar("application_snapshot", default=None)


@dataclass(frozen=True)
class Application:
    id: str
    name: str
    web_url: str
    allowed_origins: tuple[str, ...]
    environment_prefix: str = ""
    protected_settings: str = field(default="", repr=False, compare=False)

    @property
    def is_default(self):
        return self.id == DEFAULT_APPLICATION_ID


def _origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in {"https", "http"} or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or "\\" in value
            or any(character.isspace() for character in value)
            or (parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"})):
        raise ValueError("Application URLs must be HTTPS origins (localhost HTTP is allowed for development)")
    return value.rstrip("/")


@lru_cache(maxsize=8)
def _additional_applications(raw):
    records = json.loads(raw)
    if not isinstance(records, list) or len(records) > 64:
        raise ValueError("DECISIONATE_APPLICATIONS must be an array of at most 64 applications")
    applications, prefixes, origins = {}, set(), set()
    for record in records:
        if not isinstance(record, dict) or set(record) - {"id", "name", "web_url", "allowed_origins", "environment_prefix"}:
            raise ValueError("Unsupported application registration field")
        identity, prefix = record.get("id", ""), record.get("environment_prefix", "")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,62}", identity):
            raise ValueError("Invalid application id")
        if identity == DEFAULT_APPLICATION_ID or identity in applications:
            raise ValueError("Duplicate application id")
        if not isinstance(prefix, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]+_", prefix) or prefix in prefixes:
            raise ValueError("Each additional application needs a unique environment prefix")
        name = record.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError("Application name is required (maximum 120 characters)")
        web_url = _origin(record.get("web_url", ""))
        allowed = record.get("allowed_origins", [])
        if not isinstance(allowed, list) or not all(isinstance(item, str) for item in allowed):
            raise ValueError("Application allowed_origins must be an array of origins")
        allowed = tuple(dict.fromkeys([web_url, *(_origin(item) for item in allowed)]))
        if origins.intersection(allowed):
            raise ValueError("An origin cannot belong to multiple applications")
        applications[identity] = Application(identity, name.strip(), web_url, allowed, prefix)
        origins.update(allowed)
        prefixes.add(prefix)
    return applications


def applications(*, include_hosted=True):
    web_url = os.getenv("DECISIONATE_WEB_APP_URL", "http://localhost:3000").strip().rstrip("/")
    allowed = [item.strip().rstrip("/") for item in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if item.strip()]
    allowed.append(web_url)
    aliases = {"https://decisionate.ca", "https://www.decisionate.ca"}
    if aliases.intersection(allowed):
        allowed.extend(sorted(aliases))
    if not os.getenv("CORS_ALLOWED_ORIGINS"):
        allowed.extend(["http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"])
    default = Application(DEFAULT_APPLICATION_ID, "Decisionate", web_url, tuple(dict.fromkeys(allowed)))
    extra = _additional_applications(os.getenv("DECISIONATE_APPLICATIONS", "[]"))
    if any(set(app.allowed_origins).intersection(default.allowed_origins) for app in extra.values()):
        raise ValueError("Additional application origins must not be in the default application's CORS_ALLOWED_ORIGINS")
    registry = {default.id: default, **extra}
    if include_hosted:
        from app.modules.hosted_portal_registry import hosted_applications
        for app in hosted_applications():
            if app.id in registry or any(set(app.allowed_origins).intersection(other.allowed_origins) for other in registry.values()):
                raise ValueError("Hosted application registration conflicts with an existing application")
            registry[app.id] = app
    return registry


def get_application(identity=None):
    identity = identity or _application_id.get()
    snapshot = _application_snapshot.get()
    if snapshot and snapshot.id == identity:
        return snapshot
    try:
        return applications(include_hosted=identity != DEFAULT_APPLICATION_ID)[identity]
    except KeyError:
        raise ValueError("Unknown application") from None


@contextmanager
def application_scope(identity):
    app = identity if isinstance(identity, Application) else get_application(identity)
    token = _application_id.set(app.id)
    snapshot_token = _application_snapshot.set(app)
    try:
        yield app
    finally:
        _application_id.reset(token)
        _application_snapshot.reset(snapshot_token)


def scoped_setting(name, default=""):
    """Never fall back to another application's credential or billing setting."""
    app = get_application()
    if app.protected_settings:
        from app.security.secrets import decrypt_secret
        values = json.loads(decrypt_secret(app.protected_settings))
        if name == "STRIPE_SECRET_KEY" and values.get("STRIPE_CONNECTED_ACCOUNT_ID"):
            return os.getenv("HOSTED_PORTALS_STRIPE_SECRET_KEY", "").strip()
        return str(values.get(name, default) or "").strip()
    return str(os.getenv(app.environment_prefix + name, default) or "").strip()


def application_branding():
    """Public presentation only. Never return arbitrary application settings."""
    app = get_application()

    def url(name, default=""):
        value = scoped_setting(name, default)
        try:
            parsed = urlsplit(value)
            if (parsed.scheme in {"https", "http"} and parsed.hostname and not parsed.username
                    and not parsed.password and not any(c.isspace() for c in value) and "\\" not in value
                    and (parsed.scheme == "https" or parsed.hostname in {"localhost", "127.0.0.1"})):
                return value
        except ValueError:
            pass
        return ""

    color = scoped_setting("APPLICATION_PRIMARY_COLOR", "#0047FF")
    support = scoped_setting("SUPPORT_EMAIL", "support@decisionate.ca" if app.is_default else "")
    return {
        "logo_url": url("APPLICATION_LOGO_URL", app.web_url + "/icons/decisionate-logo.png" if app.is_default else ""),
        "primary_color": color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else "#0047FF",
        "support_email": support if re.fullmatch(r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+", support) else "",
        "privacy_url": url("APPLICATION_PRIVACY_URL", app.web_url + "/privacy"),
        "terms_url": url("APPLICATION_TERMS_URL", app.web_url + "/terms"),
    }


def identity_provider(provider=None):
    app = get_application()
    provider = provider or scoped_setting("AUTH_PROVIDER", "clerk")
    if app.is_default or provider.startswith(f"application:{app.id}:"):
        return provider
    return f"application:{app.id}:{provider}"


def validate_applications():
    issuers = set()
    for app in applications(include_hosted=False).values():
        with application_scope(app):
            issuer = scoped_setting("AUTH_JWT_ISSUER") or scoped_setting("CLERK_JWT_ISSUER")
            jwks = scoped_setting("AUTH_JWKS_URL") or scoped_setting("CLERK_JWKS_URL")
            if not app.is_default and (not issuer or not jwks):
                raise ValueError(f"{app.id}: configure AUTH_JWT_ISSUER and AUTH_JWKS_URL before registration")
            if issuer and issuer in issuers:
                # Separate issuers avoid a wildcard/default audience accepting another app's token.
                raise ValueError("Each registered application must use a separate authentication issuer")
            if issuer:
                issuers.add(issuer)
            if not app.is_default and (urlsplit(jwks).scheme != "https" or urlsplit(issuer).scheme != "https"):
                raise ValueError("Additional application authentication URLs must use HTTPS")
            if not re.fullmatch(r"[A-Z]{3}", scoped_setting("BILLING_CURRENCY", "CAD").upper()):
                raise ValueError("BILLING_CURRENCY must be a three-letter currency code")
