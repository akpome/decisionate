import hashlib
import json
import os
from urllib.parse import urlparse

from app.modules.alerts.email_delivery import clean_env_bool, clean_env_int, clean_env_value
from app.db.database import SessionLocal
from app.modules.marketing.models import MarketingSettings

CONSENT_TEXT = "Send me Decisionate product updates, tips and offers. I can unsubscribe at any time."
CONSENT_TEXT_FR = "Envoyez-moi les actualit\u00e9s, conseils et offres de Decisionate. Je peux me d\u00e9sabonner \u00e0 tout moment."
SEGMENTS = (
    "prospect", "trial_setup_incomplete", "trial_data_ready", "paying_customer",
    "trial_expired", "former_customer", "inactive_customer", "agency_account",
)
MESSAGE_TYPES = ("welcome", "incomplete_setup", "trial_ending")


def settings():
    with SessionLocal() as db:
        saved = db.get(MarketingSettings, 1)
        def value(field, env, default=""):
            return str(getattr(saved, field, None) or clean_env_value(env, default)).strip()
        identity = value("sender_identity", "MARKETING_SENDER_IDENTITY")
        address = value("mailing_address", "MARKETING_MAILING_ADDRESS")
        reply_to = value("reply_to", "MARKETING_REPLY_TO", "support@decisionate.ca")
        from_email = value("from_email", "MARKETING_FROM_EMAIL")
        from_name = value("from_name", "MARKETING_FROM_NAME", "Decisionate")
    version = "v1-" + hashlib.sha256(f"{CONSENT_TEXT}|{identity}|{address}|{reply_to}".encode()).hexdigest()[:16]
    french_version = "v1-fr-" + hashlib.sha256(f"{CONSENT_TEXT_FR}|{identity}|{address}|{reply_to}".encode()).hexdigest()[:16]
    try:
        segments = json.loads(clean_env_value("MARKETING_SEGMENT_IDS", "{}"))
        if not isinstance(segments, dict):
            segments = {}
    except ValueError:
        segments = {}
    return {
        "enabled": clean_env_bool("MARKETING_ENABLED", False),
        "sending": clean_env_bool("MARKETING_SEND_ENABLED", False),
        "test_mode": clean_env_bool("MARKETING_TEST_MODE", True),
        "automation": {kind: clean_env_bool(f"MARKETING_{kind.upper()}_ENABLED", False) for kind in MESSAGE_TYPES},
        "identity": identity, "address": address, "reply_to": reply_to, "consent_version": version,
        "consent_versions": {"en": version, "fr": french_version},
        "from_email": from_email, "from_name": from_name,
        "consent_available": bool(identity and address and reply_to),
        "segments": {name: str(segments.get(name) or "").strip() for name in SEGMENTS},
        "test_recipients": {email.strip().lower() for email in clean_env_value("MARKETING_TEST_RECIPIENTS").split(",") if email.strip()},
        "production": os.getenv("APP_ENV", "development").strip().lower() == "production",
        "inactivity_days": max(1, clean_env_int("MARKETING_INACTIVITY_DAYS", 14)),
        "setup_hours": max(1, clean_env_int("MARKETING_SETUP_DELAY_HOURS", 48)),
        "trial_hours": max(1, clean_env_int("MARKETING_TRIAL_REMINDER_HOURS", 48)),
        "min_notice_hours": max(1, clean_env_int("MARKETING_TRIAL_MIN_NOTICE_HOURS", 6)),
        "welcome_hours": max(1, clean_env_int("MARKETING_WELCOME_WINDOW_HOURS", 48)),
        "frequency_hours": max(1, clean_env_int("MARKETING_FREQUENCY_CAP_HOURS", 24)),
        "cutoff": clean_env_value("MARKETING_ACTIVATION_CUTOFF"),
    }


def public_settings(language="en"):
    config = settings()
    language = "fr" if language == "fr" else "en"
    return {"available": config["consent_available"], "text": CONSENT_TEXT_FR if language == "fr" else CONSENT_TEXT,
            "version": config["consent_versions"][language], "language": language, "sender_identity": config["identity"],
            "mailing_address": config["address"], "reply_to": config["reply_to"]}


def absolute_url(value):
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("Marketing URLs must be absolute application URLs")
    if settings()["production"] and parsed.scheme != "https":
        raise ValueError("Production marketing URLs must use HTTPS")
    return value.rstrip("/")
