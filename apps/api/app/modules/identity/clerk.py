"""Primary-address verification for account preferences without custom JWT claims."""

import json
import logging
import os
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException


logger = logging.getLogger(__name__)
LOOKUP_UNAVAILABLE = "Account email verification is temporarily unavailable. Please try again later or contact support."


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


_clerk_opener = build_opener(_NoRedirects())


def get_verified_clerk_primary_email(subject: str) -> str | None:
    key = str(os.getenv("CLERK_SECRET_KEY") or "").strip()
    if not key:
        raise HTTPException(503, "Account email verification is not configured. Please contact support.")
    try:
        request = Request(
            "https://api.clerk.com/v1/users/" + quote(subject, safe=""),
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
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
    except (URLError, OSError, ValueError) as error:
        logger.warning("Clerk primary email lookup failed", extra={"error_type": type(error).__name__})
        raise HTTPException(503, LOOKUP_UNAVAILABLE) from None

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
