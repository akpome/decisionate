"""Shared hosted portal configuration and readiness, with no per-agency secrets."""

import base64
import binascii
import json
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.db.models import HostedSubdomainEvent
from app.modules.hosted_subdomains.context import PRIMARY_ORIGIN

RESERVED = frozenset({"www", "app", "api", "admin", "mail", "support", "billing", "auth", "status",
    "clerk", "accounts", "account", "login", "signin", "signup", "cdn", "assets", "static", "dev",
    "staging", "test", "preview", "demo", "decisionate", "security", "help", "docs", "system", "root"})
MAX_LOGO_BYTES = 1024 * 1024
MAX_OTHER_IMAGE_BYTES = 128 * 1024


def normalize_slug(value):
    value = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,38}[a-z0-9]", value) or value in RESERVED or "--" in value:
        raise ValueError("Use 3-40 letters, numbers or single hyphens. This address must not be a reserved name.")
    return value


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
        allowed = {item.strip().lower() for item in os.getenv("HOSTED_SUBDOMAINS_ASSET_HOSTS", "app.decisionate.ca").split(",") if item.strip()}
        if (parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.password
                or parsed.port not in {None, 443} or "\\" in value or re.search(r"[\s<>]", value)
                or not parsed.path.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".ico"))):
            raise ValueError("Use a PNG, JPEG, WebP or ICO image from an approved asset host.")
        return value


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
                      headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        raise HTTPException(503, "Shared sign-in setup could not be confirmed. Retry without changing your address.") from error


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
    brand = json.loads(row.published_configuration)
    base = os.getenv("DECISIONATE_API_URL", "https://api.decisionate.ca").rstrip("/")
    for field in ("logo_url", "favicon_url", "background_url"):
        if brand[field].startswith("data:"):
            brand[field] = f"{base}/api/v2/hosted-subdomains/assets/{row.hostname}/{field}"
    return brand


def portal_record(row):
    return {"id": row.id, "slug": row.slug, "hostname": row.hostname, "status": row.status,
            "revision": row.revision, "configuration": json.loads(row.configuration),
            "published": bool(row.published_configuration), "last_error": row.last_error,
            "url": "https://" + row.hostname}


def audit(db, row, user_id, action, reason=""):
    db.add(HostedSubdomainEvent(portal_id=row.id, user_id=user_id, action=action, revision=row.revision, reason=reason))
