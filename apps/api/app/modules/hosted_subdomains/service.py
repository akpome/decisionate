"""Shared hosted portal configuration and readiness, with no per-agency secrets."""

import base64
import binascii
import hashlib
import json
import logging
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator
from sqlalchemy import text

from app.db.models import HostedSubdomainAddress, HostedSubdomainEvent, HostedSubdomainPortal
from app.modules.hosted_subdomains.context import PRIMARY_ORIGIN, ROOT_DOMAIN

RESERVED = frozenset({"www", "app", "api", "admin", "mail", "support", "billing", "auth", "status",
    "clerk", "accounts", "account", "login", "signin", "signup", "cdn", "assets", "static", "dev",
    "staging", "test", "preview", "demo", "decisionate", "security", "help", "docs", "system", "root"})
MAX_LOGO_BYTES = 1024 * 1024
MAX_OTHER_IMAGE_BYTES = 128 * 1024
logger = logging.getLogger(__name__)
TRANSPARENT_DECISIONATE_LOGO = PRIMARY_ORIGIN + "/icons/decisionate-logo.png"
LEGACY_DECISIONATE_JPEG_SHA256 = "be4dae140b501de8a363a3411884befa5602f7ee3938bacf4cf05911f80d868a"


def restore_legacy_logo(value):
    # The distributed JPEG flattened this logo's transparent corners to black.
    # Match the exact file, never remove dark pixels from an agency's own artwork.
    prefix = "data:image/jpeg;base64,"
    if value.startswith(prefix) and len(value) <= 4 * ((MAX_LOGO_BYTES + 2) // 3) + len(prefix):
        try:
            image = base64.b64decode(value[len(prefix):], validate=True)
        except (ValueError, binascii.Error):
            return value
        if hashlib.sha256(image).hexdigest() == LEGACY_DECISIONATE_JPEG_SHA256:
            return TRANSPARENT_DECISIONATE_LOGO
    return value


def canonical_branding(brand):
    logo = restore_legacy_logo(brand.get("logo_url") or brand.get("favicon_url") or "")
    return {**brand, "logo_url": logo, "favicon_url": ""}


def normalize_slug(value):
    value = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,38}[a-z0-9]", value) or value in RESERVED or "--" in value:
        raise ValueError("Use 3-40 letters, numbers or single hyphens. This address must not be a reserved name.")
    return value


def lock_hosted_addresses(db):
    # Primary hosts and aliases share one address namespace across two tables.
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(59831, 8)"))
    elif dialect == "sqlite":
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")


def reserved_address(db, slug):
    hostname = f"{slug}.{ROOT_DOMAIN}"
    return db.query(HostedSubdomainPortal).filter_by(hostname=hostname).first() or db.get(HostedSubdomainAddress, hostname)


class Branding(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100, pattern=r"^[^\x00-\x1f<>]+$")
    logo_url: str = Field(default="", max_length=4 * ((MAX_LOGO_BYTES + 2) // 3) + 32)
    favicon_url: str = Field(default="", max_length=180000)
    background_url: str = Field(default="", max_length=180000)
    primary_color: str = Field(default="#2563EB", pattern=r"^#[0-9a-fA-F]{6}$")
    accent_color: str = Field(default="#059669", pattern=r"^#[0-9a-fA-F]{6}$")
    background_color: str = Field(default="#F8FAFC", pattern=r"^#[0-9a-fA-F]{6}$")
    support_email: str = Field(max_length=254, pattern=r"^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$")
    welcome_heading: str = Field(default="Welcome back", max_length=120, pattern=r"^[^\x00-\x1f<>]*$")
    welcome_text: str = Field(default="", max_length=400, pattern=r"^[^\x00-\x1f<>]*$")

    @field_validator("logo_url", "favicon_url", "background_url")
    @classmethod
    def approved_asset(cls, value, info: ValidationInfo):
        if not value:
            return value
        if value.startswith("data:"):
            limit = MAX_LOGO_BYTES if info.field_name == "logo_url" else MAX_OTHER_IMAGE_BYTES
            try:
                header, encoded = value.split(",", 1)
                image = base64.b64decode(encoded, validate=True)
                valid = ((header == "data:image/png;base64" and image.startswith(b"\x89PNG\r\n\x1a\n"))
                         or (header == "data:image/jpeg;base64" and image.startswith(b"\xff\xd8\xff"))
                         or (header == "data:image/webp;base64" and image.startswith(b"RIFF") and image[8:12] == b"WEBP"))
                if valid and 16 <= len(image) <= limit:
                    return value
            except (ValueError, binascii.Error):
                pass
            size = "1 MB" if info.field_name == "logo_url" else "128 KB"
            raise ValueError(f"Upload a PNG, JPEG or WebP image no larger than {size}.")
        parsed = urlsplit(value)
        if info.field_name == "logo_url":
            if (len(value) > 2048 or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                    or parsed.port not in {None, 443} or "\\" in value or re.search(r"[\x00-\x1f\s<>]", value)):
                raise ValueError("Enter an HTTPS logo URL or upload a logo.")
            return value
        allowed = {item.strip().lower() for item in os.getenv("HOSTED_SUBDOMAINS_ASSET_HOSTS", "app.decisionate.ca").split(",") if item.strip()}
        if (parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.password
                or parsed.port not in {None, 443} or "\\" in value or re.search(r"[\s<>]", value)
                or not parsed.path.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".ico"))):
            raise ValueError("Use a PNG, JPEG, WebP or ICO image from an approved asset host.")
        return value

    @model_validator(mode="after")
    def single_logo(self):
        self.logo_url = restore_legacy_logo(self.logo_url or self.favicon_url)
        self.favicon_url = ""
        return self


def launch_blockers():
    if not os.getenv("CLERK_SECRET_KEY", "").strip():
        return ["The shared Clerk backend credential is not configured."]
    return []


def clerk_request(path, *, body=None):
    secret = os.getenv("CLERK_SECRET_KEY", "").strip()
    if not secret:
        raise HTTPException(503, "Shared sign-in setup is not configured.")
    request = Request("https://api.clerk.com/v1" + path,
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json",
                               "Accept": "application/json", "User-Agent": "Decisionate/1.0"})
    phase = "domain_create" if body is not None else "domain_lookup"
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read(64_001)
            if len(raw) > 64_000:
                raise ValueError("Clerk response is too large")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError("Invalid Clerk response")
            return result
    except HTTPError as error:
        code = "unknown"
        request_id = error.headers.get("x-request-id", "") if error.headers else ""
        try:
            raw = error.read(64_001)
            payload = json.loads(raw) if len(raw) <= 64_000 else {}
            errors = payload.get("errors", []) if isinstance(payload, dict) else []
            candidate = errors[0].get("code", "") if isinstance(errors, list) and errors and isinstance(errors[0], dict) else ""
            if isinstance(candidate, str) and re.fullmatch(r"[a-z0-9_]{1,80}", candidate) and not candidate.startswith(("sk_", "pk_")):
                code = candidate
        except (OSError, ValueError):
            pass
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", request_id) or request_id.startswith(("sk_", "pk_")):
            request_id = "unknown"
        logger.warning("Hosted portal Clerk request failed: method=%s phase=%s status=%s code=%s request_id=%s",
                       request.get_method(), phase, error.code, code, request_id)
        setup_errors = {
            "feature_not_enabled": "Clerk reports this domain feature is disabled for the instance used by the API server. Platform support must check that instance's enabled features. Your draft is saved.",
            "authorization_missing_scopes": "Clerk rejected the API server's permission to manage domains. Platform support must check domain lookup and creation permissions for the production credential. Your draft is saved.",
            "domain_managed_by_integration": "Clerk says an integration manages this application's domains. Platform support must use that integration's settings or contact Clerk to allow automated domain setup. Your draft is saved.",
            "feature_requires_custom_domain": "Clerk requires a verified custom domain for this operation. Platform support must check the existing production instance's domain setup. Your draft is saved.",
            "provider_domain_operation_not_allowed": "Clerk refused this domain configuration. Platform support must check the existing production instance's domain setup. Your draft is saved.",
            "operation_not_allowed_on_primary_domain": "Clerk refused a primary-domain operation. Platform support must check the satellite setup without changing the existing primary domain. Your draft is saved.",
        }
        if code in setup_errors:
            detail = setup_errors[code]
        elif code == "invalid_proxy_configuration":
            detail = "Clerk could not verify this portal's sign-in address. Platform support must check its HTTPS hosting and sign-in proxy. Your draft is saved."
        elif code == "domain_update_forbidden":
            detail = "Hosted portal publishing requires the production Clerk instance. Platform support must check the API server's sign-in credentials. Your draft is saved."
        elif error.code == 401:
            detail = "Clerk rejected the platform's sign-in credentials. Platform support must update them before publishing. Your draft is saved."
        elif error.code == 403:
            detail = "Clerk has not allowed this sign-in domain operation. Platform support must check the Clerk account's permissions and enabled features. Your draft is saved."
        elif error.code == 429:
            detail = "The sign-in service is receiving too many requests. Wait a moment, then retry publishing. Your draft is saved."
        else:
            detail = "The sign-in service could not finish portal setup. Retry without changing your address, or contact platform support. Your draft is saved."
        public_codes = {*setup_errors, "invalid_proxy_configuration", "domain_update_forbidden", "invalid_clerk_secret_key", "too_many_requests"}
        reference = code if code in public_codes else f"clerk_http_{error.code}"
        detail += f" Reference: {reference}/{phase}."
        raise HTTPException(503, detail) from None
    except (URLError, TimeoutError, OSError, ValueError) as error:
        logger.warning("Hosted portal Clerk request failed: method=%s phase=%s error_type=%s",
                       request.get_method(), phase, type(error).__name__)
        raise HTTPException(503, "The sign-in service could not be reached or returned an invalid response. Retry without changing your address. Your draft is saved.") from None


def ensure_satellite(hostname):
    # Reconcile by exact name after a timeout. A retry must not create another instance.
    result = clerk_request("/domains")
    domains = result.get("data", [])
    if result.get("total_count", len(domains)) > len(domains):
        raise HTTPException(503, "The sign-in domain inventory is incomplete. Contact support before retrying.")
    domain = next((item for item in domains if item.get("name") == hostname), None)
    proxy_url = "https://" + hostname + "/__clerk"
    if domain is None:
        domain = clerk_request("/domains", body={"name": hostname, "is_satellite": True, "proxy_url": proxy_url})
    if domain.get("name") != hostname or not domain.get("is_satellite") or domain.get("proxy_url") != proxy_url or not domain.get("id"):
        raise HTTPException(409, "This address has a conflicting sign-in configuration. Contact support.")
    return domain["id"]


def public_configuration(row, *, active):
    return {"id": row.id, "hostname": row.hostname, "origin": "https://" + row.hostname,
            "active": active, "primary_origin": PRIMARY_ORIGIN,
            "branding": public_branding(row) if active else None}


def public_branding(row):
    brand = canonical_branding(json.loads(row.published_configuration))
    base = os.getenv("DECISIONATE_API_URL", "https://api.decisionate.ca").rstrip("/")
    for field in ("logo_url", "background_url"):
        if brand[field].startswith("data:"):
            version = hashlib.sha256(brand[field].encode()).hexdigest()[:16]
            brand[field] = f"{base}/api/v2/hosted-subdomains/assets/{row.hostname}/{field}?v={version}"
    brand["favicon_url"] = brand["logo_url"]
    return brand


def portal_record(row):
    return {"id": row.id, "slug": row.slug, "hostname": row.hostname, "status": row.status,
            "revision": row.revision, "configuration": canonical_branding(json.loads(row.configuration)),
            "published": bool(row.published_configuration), "last_error": row.last_error,
            "url": "https://" + row.hostname}


def audit(db, row, user_id, action, reason=""):
    db.add(HostedSubdomainEvent(portal_id=row.id, user_id=user_id, action=action, revision=row.revision, reason=reason))
