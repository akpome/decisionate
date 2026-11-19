"""Primary-address verification for account preferences without custom JWT claims."""

import json
import logging
from collections import OrderedDict
from hashlib import sha256
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException
from app.application_context import get_application, scoped_setting


logger = logging.getLogger(__name__)
LOOKUP_UNAVAILABLE = "Account email verification is temporarily unavailable. Please try again later or contact support."


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


_clerk_opener = build_opener(_NoRedirects())


def _read_profile(subject: str, *, allow_missing: bool = False) -> dict | None:
    key = scoped_setting("CLERK_SECRET_KEY")
    if not key:
        raise HTTPException(503, "Account email verification is not configured. Please contact support.")
    try:
        request = Request(
            "https://api.clerk.com/v1/users/" + quote(subject, safe=""),
            headers={
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
                "User-Agent": "Decisionate/1.0",
            },
        )
        with _clerk_opener.open(request, timeout=5) as response:
            if response.status != 200:
                raise ValueError("Unexpected Clerk response status")
            profile = json.load(response)
        if not isinstance(profile, dict) or profile.get("id") != subject:
            raise ValueError("Clerk profile does not match the authenticated subject")
        addresses = profile.get("email_addresses")
        if not isinstance(addresses, list):
            raise ValueError("Invalid Clerk email addresses")
    except HTTPError as error:
        if allow_missing and error.code == 404:
            return None
        logger.warning(
            "Clerk primary email lookup failed: HTTP %s", error.code,
            extra={"error_type": type(error).__name__, "http_status": error.code},
        )
        raise HTTPException(503, LOOKUP_UNAVAILABLE) from None
    except (URLError, OSError, ValueError) as error:
        logger.warning(
            "Clerk primary email lookup failed: %s", type(error).__name__,
            extra={"error_type": type(error).__name__},
        )
        raise HTTPException(503, LOOKUP_UNAVAILABLE) from None

    return profile


def _verified_primary_email(profile: dict) -> str | None:
    addresses = profile["email_addresses"]
    primary_id = profile.get("primary_email_address_id")
    if not isinstance(primary_id, str) or not primary_id:
        return None
    for address in addresses:
        if not isinstance(address, dict) or address.get("id") != primary_id:
            continue
        verification = address.get("verification")
        email = address.get("email_address")
        if isinstance(verification, dict) and verification.get("status") == "verified" and isinstance(email, str):
            email = email.strip()
            return email if "@" in email else None
        return None
    return None


def get_verified_clerk_primary_email(subject: str) -> str | None:
    return _verified_primary_email(_read_profile(subject))


def lookup_clerk_email(subject: str) -> tuple[bool, str | None]:
    profile = _read_profile(subject, allow_missing=True)
    return (True, _verified_primary_email(profile)) if profile is not None else (False, None)


_email_cache = OrderedDict()
_email_cache_lock = Lock()


def cached_verified_clerk_email(subject: str) -> str | None:
    key = (get_application().id, sha256(scoped_setting("CLERK_SECRET_KEY").encode()).digest(), subject)
    with _email_cache_lock:
        entry = _email_cache.get(key)
        if entry and entry[0] > monotonic():
            _email_cache.move_to_end(key)
            return entry[1]
    email = get_verified_clerk_primary_email(subject)
    with _email_cache_lock:
        _email_cache[key] = (monotonic() + (300 if email else 10), email)
        _email_cache.move_to_end(key)
        while len(_email_cache) > 1024:
            _email_cache.popitem(last=False)
    return email
