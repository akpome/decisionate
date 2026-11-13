"""Short-lived database registry shared by the API, workers and scheduler."""

import json
import logging
from threading import Lock
from time import monotonic

from app.modules.hosted_portal_providers import setting

_lock = Lock()
_cache = (0.0, ())
logger = logging.getLogger(__name__)


def invalidate_registry():
    global _cache
    with _lock:
        _cache = (0.0, ())


def hosted_applications():
    if setting("ENABLED") != "true":
        return ()
    from app.application_context import Application
    from app.db.database import SessionLocal
    from app.db.models import HostedPortal
    from app.security.secrets import SecretProtectionUnavailable, decrypt_secret

    global _cache
    with _lock:
        if monotonic() < _cache[0]:
            return _cache[1]
        # Database failures must fail closed, not reuse an expired registration.
        with SessionLocal() as db:
            rows = db.query(HostedPortal).filter_by(status="live").all()
            entries = []
            for row in rows:
                try:
                    if not row.protected_settings.startswith("enc:v1:"):
                        raise ValueError("Missing encrypted configuration")
                    settings = json.loads(decrypt_secret(row.protected_settings))
                    if not all(settings.get(key) for key in ("AUTH_JWT_ISSUER", "AUTH_JWKS_URL", "STRIPE_CONNECTED_ACCOUNT_ID")):
                        raise ValueError("Incomplete configuration")
                    entries.append(Application(
                        row.id, json.loads(row.configuration)["name"], "https://" + row.domain,
                        ("https://" + row.domain,), protected_settings=row.protected_settings,
                    ))
                except (ValueError, KeyError, TypeError, SecretProtectionUnavailable):
                    logger.error("Hosted portal registration unavailable: portal_id=%s", row.id)
            result = tuple(entries)
        _cache = (monotonic() + 5, result)
        return result
