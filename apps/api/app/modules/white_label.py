"""Guided, non-secret deployment preparation. Saving a draft never activates a brand."""

from io import BytesIO
from hashlib import sha256
import json
import os
import re
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.application_context import DEFAULT_APPLICATION_ID, _origin, application_scope, applications, scoped_setting
from app.db.database import SessionLocal
from app.db.models import HostedPortal, WhiteLabelLaunchConfirmation, WhiteLabelSetup, utc_now
from app.modules.platform_admin import require_platform_admin_full_access, record_platform_admin_audit


router = APIRouter(prefix="/admin/white-label", tags=["white-label"])

# These are the existing billing products, not a second independent plan catalog.
PRICES = (
    ("PROFESSIONAL", "Professional monthly", "PROFESSIONAL_MONTHLY"),
    ("PROFESSIONAL_ANNUAL", "Professional annual", "PROFESSIONAL_ANNUAL"),
    ("AGENCY", "Agency monthly", "AGENCY_MONTHLY"),
    ("AGENCY_ANNUAL", "Agency annual", "AGENCY_ANNUAL"),
    ("CLIENT_WORKSPACE_ADDON", "Extra workspace monthly", "ADDITIONAL_CLIENT_WORKSPACE_MONTHLY"),
    ("CLIENT_WORKSPACE_ADDON_ANNUAL", "Extra workspace annual", "ADDITIONAL_CLIENT_WORKSPACE_ANNUAL"),
    ("AI_CREDIT_PACK", "Monthly AI credit pack", "AI_CREDIT_PACK"),
    ("AI_CREDIT_TOPUP", "One-time AI top-up", "AI_CREDIT_TOPUP"),
)
SECRET_NAMES = ("CLERK_SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY")
MANUAL_CHECKS = (
    "Domain and HTTPS are working on the new frontend.",
    "Sign-in, invitations and sign-out work with the separate Clerk application.",
    "Stripe prices match the displayed amounts and currency; test checkout and a signed webhook.",
    "The sender domain is verified with SPF/DKIM and DMARC; receive a test invitation and weekly email.",
    "API, analytics worker, ingestion worker and scheduler use the same application configuration.",
    "The frontend uses this brand's logo, name, legal pages and currency, including shared pages.",
    "A user from another application cannot open this application's workspace.",
)


def https_url(value: str) -> str:
    if not value:
        return value
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or any(c.isspace() for c in value) or "\\" in value or parsed.fragment):
        raise ValueError("Use a public HTTPS URL without credentials or a fragment")
    return value


class PriceSetup(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    price_id: str = Field(default="", max_length=120, pattern=r"^(price_[A-Za-z0-9]+)?$")
    amount_cents: int | None = Field(default=None, ge=0, le=100_000_000)


class SetupConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,62}$")
    name: str = Field(min_length=1, max_length=120)
    web_url: str = Field(max_length=500)
    allowed_origins: list[str] = Field(default_factory=list, max_length=10)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    logo_url: str = Field(default="", max_length=1000)
    primary_color: str = Field(default="#0047FF", pattern=r"^#[0-9a-fA-F]{6}$")
    support_email: str = Field(default="", max_length=254)
    sender_email: str = Field(default="", max_length=254)
    privacy_url: str = Field(default="", max_length=1000)
    terms_url: str = Field(default="", max_length=1000)
    auth_issuer: str = Field(default="", max_length=500)
    prices: dict[str, PriceSetup] = Field(default_factory=dict)
    railway_api_service: str = Field(default="decisionate-api", pattern=r"^[a-zA-Z][a-zA-Z0-9_-]{0,62}$")
    confirmed_checks: list[int] = Field(default_factory=list, max_length=len(MANUAL_CHECKS))

    @field_validator("confirmed_checks")
    @classmethod
    def valid_checks(cls, values):
        if any(value < 0 or value >= len(MANUAL_CHECKS) for value in values):
            raise ValueError("Unknown launch check")
        return sorted(set(values))

    @field_validator("name")
    @classmethod
    def single_line(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError("Use a single-line name")
        return value

    @field_validator("web_url", "auth_issuer")
    @classmethod
    def origin(cls, value):
        return _origin(value) if value else value

    @field_validator("allowed_origins")
    @classmethod
    def origins(cls, values):
        return list(dict.fromkeys(_origin(value) for value in values))

    @field_validator("logo_url", "privacy_url", "terms_url")
    @classmethod
    def urls(cls, value):
        return https_url(value)

    @field_validator("support_email", "sender_email")
    @classmethod
    def email(cls, value):
        if value and not re.fullmatch(r"[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+", value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("prices")
    @classmethod
    def known_prices(cls, value):
        if set(value) - {key for key, _, _ in PRICES}:
            raise ValueError("Unknown billing product")
        return value


class SetupSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    configuration: SetupConfiguration
    revision: int = Field(default=0, ge=0)


class SetupCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(gt=0, strict=True)


def deployment_api_url():
    value = os.getenv("DECISIONATE_API_URL", "").strip()
    try:
        origin = _origin(value)
        return origin if origin.startswith("https://") else ""
    except ValueError:
        return ""


def setup_checks(config):
    fields = (
        ("name", "Brand name", 0), ("web_url", "Frontend HTTPS URL", 0),
        ("support_email", "Support email", 0), ("sender_email", "Sender email", 0),
        ("privacy_url", "Privacy page", 0), ("terms_url", "Terms page", 0),
        ("auth_issuer", "Clerk HTTPS issuer", 1),
    )
    checks = []
    for key, label, step in fields:
        value = getattr(config, key)
        complete = bool(value) and (key not in {"web_url", "auth_issuer"} or value.startswith("https://"))
        checks.append({"key": key, "label": label, "step": step, "complete": complete})
    for key, label, _ in PRICES:
        price = config.prices.get(key, PriceSetup())
        complete = (bool(price.price_id) and price.amount_cents is not None
                    and not any(word in price.price_id.upper() for word in ("REPLACE", "YOUR_", "SET_IN")))
        checks.append({"key": key, "label": label + " price and amount", "step": 1, "complete": complete})
    checks.append({"key": "api_url", "label": "API HTTPS URL (DECISIONATE_API_URL)", "step": 2,
                   "complete": bool(deployment_api_url())})
    return checks


def registration(config):
    existing = applications().get(config.id)
    return {
        "id": config.id, "name": config.name, "web_url": config.web_url,
        "allowed_origins": config.allowed_origins,
        "environment_prefix": existing.environment_prefix if existing else config.id.upper().replace("-", "_") + "_",
    }


def validate_registration(config, db):
    if db.get(HostedPortal, config.id) or db.query(HostedPortal).filter_by(domain=urlsplit(config.web_url).hostname).first():
        raise HTTPException(409, "This application or domain belongs to a hosted portal. Use its owner setup.")
    if config.id == DEFAULT_APPLICATION_ID or not config.web_url:
        raise HTTPException(422, "Use a new application ID and frontend URL. The existing default cannot be replaced.")
    proposed = registration(config)
    if config.id not in applications() and len(applications()) > 64:
        raise HTTPException(409, "The application registry is full.")
    proposed_origins = {config.web_url, *config.allowed_origins}
    for app in applications().values():
        if app.id == config.id:
            # Identity/domain changes to active brands need a controlled migration.
            issuer = (os.getenv(app.environment_prefix + "AUTH_JWT_ISSUER")
                      or os.getenv(app.environment_prefix + "CLERK_JWT_ISSUER", ""))
            if (app.web_url != config.web_url or set(app.allowed_origins) != proposed_origins
                    or (issuer and issuer != config.auth_issuer)):
                raise HTTPException(409, "This application is registered. Its domain and sign-in issuer cannot be changed by the setup wizard.")
            continue
        if proposed_origins.intersection(app.allowed_origins) or proposed["environment_prefix"] == app.environment_prefix:
            raise HTTPException(409, "This domain or environment prefix is already assigned to another application.")
        with application_scope(app):
            issuer = scoped_setting("AUTH_JWT_ISSUER") or scoped_setting("CLERK_JWT_ISSUER")
        if config.auth_issuer and issuer == config.auth_issuer:
            raise HTTPException(409, "Each application needs its own sign-in issuer.")
    for row in db.query(WhiteLabelSetup).filter(WhiteLabelSetup.application_id != config.id):
        other = SetupConfiguration.model_validate_json(row.configuration)
        if proposed_origins.intersection({other.web_url, *other.allowed_origins}) or (config.auth_issuer and config.auth_issuer == other.auth_issuer):
            raise HTTPException(409, "This domain or sign-in issuer is already used by another setup draft.")


def public_variables(config):
    values = {
        "AUTH_PROVIDER": "clerk", "AUTH_JWT_ISSUER": config.auth_issuer,
        "AUTH_JWKS_URL": config.auth_issuer.rstrip("/") + "/.well-known/jwks.json" if config.auth_issuer else "",
        "BILLING_PROVIDER": "stripe", "BILLING_ENFORCEMENT_ENABLED": "true", "BILLING_CURRENCY": config.currency,
        "EMAIL_PROVIDER": "resend", "RESEND_FROM_EMAIL": config.sender_email, "RESEND_FROM_NAME": config.name,
        "SUPPORT_EMAIL": config.support_email, "APPLICATION_LOGO_URL": config.logo_url,
        "APPLICATION_PRIMARY_COLOR": config.primary_color,
        "APPLICATION_PRIVACY_URL": config.privacy_url, "APPLICATION_TERMS_URL": config.terms_url,
    }
    for key, _, amount_key in PRICES:
        price = config.prices.get(key, PriceSetup())
        values[f"STRIPE_{key}_PRICE_ID"] = price.price_id
        values[f"BILLING_{amount_key}_PRICE_CENTS"] = str(price.amount_cents) if price.amount_cents is not None else ""
    return values


def readiness(config):
    record = registration(config)
    prefix = record["environment_prefix"]
    registered = applications().get(config.id)
    checks = []

    def check(key, label, ok, detail):
        checks.append({"key": key, "label": label, "complete": bool(ok), "detail": detail})

    check("api_url", "API HTTPS URL", deployment_api_url(), "Set DECISIONATE_API_URL to the public HTTPS API address and redeploy.")
    check("registration", "Application registered", registered and registered.name == config.name
          and registered.web_url == config.web_url and set(registered.allowed_origins) == {config.web_url, *config.allowed_origins},
          "Save the generated registry on the API and workers, then redeploy.")
    for name, value in public_variables(config).items():
        # An optional logo is the only field that can be left blank for launch.
        if name == "APPLICATION_LOGO_URL" and not value and not os.getenv(prefix + name, "").strip():
            continue
        check(name, prefix + name, value and os.getenv(prefix + name, "").strip() == value,
              "Not yet set, or different from this saved setup.")
    for name in SECRET_NAMES:
        value = os.getenv(prefix + name, "").strip()
        valid = value and not any(word in value.upper() for word in ("REPLACE", "SET_IN", "YOUR_", "${{"))
        check(name, prefix + name, valid, "Add this application's credential in the deployment secret store.")
    inputs = setup_checks(config)
    package_ready = all(item["complete"] for item in inputs)
    return {"registered": bool(registered), "configuration_complete": package_ready and all(row["complete"] for row in checks),
            "package_ready": package_ready, "setup_checks": inputs, "api_url": deployment_api_url(),
            "checks": checks, "launch_checks": list(MANUAL_CHECKS),
            "scope": "Configuration on this API process only. Provider credentials, workers and live delivery are not verified."}


def configuration_digest(config):
    # Detect credential rotation without storing or returning credential values.
    app = applications().get(config.id)
    prefix = registration(config)["environment_prefix"]
    deployed = {key: os.getenv(prefix + key, "").strip() for key in (*public_variables(config), *SECRET_NAMES)}
    deployed["registration"] = vars(app) if app else None
    deployed["api_url"] = deployment_api_url()
    return sha256(json.dumps(deployed, sort_keys=True).encode()).hexdigest()


def serialize(row, confirmation=None):
    config = SetupConfiguration.model_validate_json(row.configuration)
    status = readiness(config)
    all_confirmed = config.confirmed_checks == list(range(len(MANUAL_CHECKS)))
    current = bool(confirmation and confirmation.revision == row.revision and status["configuration_complete"]
                   and all_confirmed and confirmation.configuration_digest == configuration_digest(config))
    if confirmation and confirmation.revision == row.revision and not current:
        config.confirmed_checks = []
    stage = ("launch_confirmed" if current else "needs_review" if confirmation else
             "draft" if not status["package_ready"] else "ready_to_deploy" if not status["registered"] else
             "launch_review" if status["configuration_complete"] else "deployment_incomplete")
    return {"configuration": config.model_dump(), "revision": row.revision,
            "updated_at": row.updated_at.isoformat(), "readiness": status, "stage": stage,
            "completion": {"confirmed_at": confirmation.confirmed_at.isoformat() + "Z", "current": current} if confirmation else None}


@router.get("")
def list_setups(request: Request, response: Response):
    require_platform_admin_full_access(request)
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        confirmations = {item.application_id: item for item in db.query(WhiteLabelLaunchConfirmation)}
        return {"setups": [serialize(row, confirmations.get(row.application_id)) for row in db.query(WhiteLabelSetup).order_by(WhiteLabelSetup.updated_at.desc())],
                "registered": [{"id": app.id, "name": app.name, "web_url": app.web_url} for app in applications().values()],
                "products": [{"key": key, "label": label} for key, label, _ in PRICES]}


@router.put("/{application_id}")
def save_setup(application_id: str, payload: SetupSave, request: Request, response: Response):
    auth = require_platform_admin_full_access(request)
    response.headers["Cache-Control"] = "no-store"
    config = payload.configuration
    if application_id != config.id:
        raise HTTPException(422, "Application IDs must match")
    with SessionLocal() as db:
        validate_registration(config, db)
        prior = db.get(WhiteLabelSetup, config.id)
        if prior and payload.revision == 0:
            raise HTTPException(409, "This setup already exists. Reload it before saving.")
        if prior:
            previous = SetupConfiguration.model_validate_json(prior.configuration)
            if previous.model_dump(exclude={"confirmed_checks"}) != config.model_dump(exclude={"confirmed_checks"}):
                config.confirmed_checks = []
        values = {"configuration": config.model_dump_json(), "updated_by_user_id": auth.user_id}
        if payload.revision == 0:
            row = WhiteLabelSetup(application_id=config.id, revision=1, **values)
            db.add(row)
        else:
            changed = db.execute(update(WhiteLabelSetup).where(
                WhiteLabelSetup.application_id == config.id, WhiteLabelSetup.revision == payload.revision,
            ).values(**values, revision=payload.revision + 1))
            if changed.rowcount != 1:
                raise HTTPException(409, "This setup changed. Reload it before saving.")
            row = db.get(WhiteLabelSetup, config.id)
        try:
            db.flush()
            record_platform_admin_audit(db, admin_user_id=auth.user_id, action="white_label_setup_saved",
                                        details=f"application={config.id}; revision={row.revision}")
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "This setup already exists. Reload it before saving.") from None
        return serialize(row, db.get(WhiteLabelLaunchConfirmation, config.id))


@router.post("/{application_id}/complete")
def complete_setup(application_id: str, payload: SetupCompletion, request: Request, response: Response):
    auth = require_platform_admin_full_access(request)
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        row = db.get(WhiteLabelSetup, application_id)
        if not row:
            raise HTTPException(404, "Setup not found")
        if row.revision != payload.revision:
            raise HTTPException(409, "This setup changed. Reload it before confirming launch.")
        config = SetupConfiguration.model_validate_json(row.configuration)
        validate_registration(config, db)
        if not readiness(config)["configuration_complete"]:
            raise HTTPException(409, "Complete deployment and refresh the API configuration checks before confirming launch.")
        if config.confirmed_checks != list(range(len(MANUAL_CHECKS))):
            raise HTTPException(409, "Complete and save every launch check before confirming launch.")
        confirmation = db.get(WhiteLabelLaunchConfirmation, application_id)
        if confirmation and serialize(row, confirmation)["completion"]["current"]:
            return serialize(row, confirmation)
        if confirmation and confirmation.revision == row.revision:
            raise HTTPException(409, "Configuration changed. Review and save the launch checks again before confirming.")
        # A concurrent setup edit cannot be certified by this request.
        changed = db.execute(update(WhiteLabelSetup).where(
            WhiteLabelSetup.application_id == application_id, WhiteLabelSetup.revision == payload.revision,
        ).values(revision=payload.revision + 1, updated_by_user_id=auth.user_id))
        if changed.rowcount != 1:
            raise HTTPException(409, "This setup changed. Reload it before confirming launch.")
        if not confirmation:
            confirmation = WhiteLabelLaunchConfirmation(application_id=application_id)
            db.add(confirmation)
        confirmation.revision = payload.revision + 1
        confirmation.configuration_digest = configuration_digest(config)
        confirmation.confirmed_by_user_id = auth.user_id
        confirmation.confirmed_at = utc_now()
        record_platform_admin_audit(db, admin_user_id=auth.user_id, action="white_label_launch_confirmed",
                                    details=f"application={application_id}; revision={confirmation.revision}")
        db.commit()
        db.refresh(row)
        return serialize(row, confirmation)


@router.delete("/{application_id}")
def delete_setup(application_id: str, request: Request):
    auth = require_platform_admin_full_access(request)
    if application_id in applications():
        raise HTTPException(409, "Registered applications cannot be removed here.")
    with SessionLocal() as db:
        row = db.get(WhiteLabelSetup, application_id)
        if not row:
            raise HTTPException(404, "Setup not found")
        db.query(WhiteLabelLaunchConfirmation).filter_by(application_id=application_id).delete(synchronize_session=False)
        db.delete(row)
        record_platform_admin_audit(db, admin_user_id=auth.user_id, action="white_label_draft_deleted", details=f"application={application_id}")
        db.commit()
    return {"deleted": True}


def build_package(config):
    record = registration(config)
    prefix = record["environment_prefix"]
    registry = json.loads(os.getenv("DECISIONATE_APPLICATIONS", "[]"))
    registry = [item for item in registry if item["id"] != config.id] + [record]
    variables = {prefix + key: value for key, value in public_variables(config).items()}
    variables["DECISIONATE_APPLICATIONS"] = json.dumps(registry, separators=(",", ":"))
    secrets = [prefix + name for name in SECRET_NAMES]
    references = {key: "${{" + config.railway_api_service + "." + key + "}}" for key in [*variables, *secrets]}
    api_url = deployment_api_url()
    missing = [prefix + key for key, value in public_variables(config).items() if not value and key != "APPLICATION_LOGO_URL"]
    guide = f"""# {config.name}: white-label setup

Application: {config.id}
Frontend: {config.web_url}
API: {api_url}

This package contains NO credentials. Saving or downloading it does not activate
an application. Existing Decisionate.ca variables and subscriptions stay unchanged.

1. Complete any missing setup fields: {', '.join(missing) or 'None'}.
2. Create a separate Clerk application, Stripe account and verified Resend sender.
   Use a Clerk issuer with /.well-known/jwks.json. Configure sign-in/sign-out URLs
   for the new frontend. Keep test and live credentials in separate environments.
3. Merge api-variables.json into the API service's variables (do not replace all
   existing variables). Add the secret names in required-secrets.txt separately.
   Use prices in {config.currency}; verify their amounts and monthly/annual intervals.
4. Add a Stripe webhook: {api_url}/billing/webhook/{config.id}
   Use the events listed in stripe-events.json. Save its signing secret separately.
5. Merge worker-references.json into analytics, ingestion and scheduler services.
   These reference the API service named {config.railway_api_service}. Keep shared
   database/storage/queue settings. Redeploy API and all workers together.
6. Use frontend-settings.json for the new frontend. Supply its own Clerk public
   key and server secret through that frontend's secret store. Read the public
   brand settings from GET /api/v2/application. Use the matching token issuer,
   X-Application-Id for server calls, and X-Workspace-Id for workspace requests.
   Implement /sign-in, /dashboard, /dashboard/billing and /dashboard/connections.
7. Refresh Platform Admin > White-label setup to check the API configuration.
   Complete and save every launch check in launch-checks.json, then choose
   Confirm launch in the wizard. This records operator sign-off; it does not
   deploy services or verify provider accounts automatically.

The registry was merged at download time. Download a fresh package if another
brand has since been added; never overwrite a newer registry with an old package.
Secret values are never included or overwritten by this package. Connector OAuth
credentials require this brand's prefix and provider approval separately. Verify
SPF/DKIM/DMARC for the sender domain. No DNS, accounts, payments or emails are
created automatically. The existing plan rules and trial duration still apply.
Databases, AI processing and infrastructure are shared, not regional data residency.
The new frontend is not generated. Marketing automation and Platform Admin remain
available only on the default application. Do not remove an active registration or
roll back to a backend without application isolation after customers have joined.
"""
    return {
        "START-HERE.md": guide,
        "api-variables.json": json.dumps(variables, indent=2),
        "worker-references.json": json.dumps(references, indent=2),
        "required-secrets.txt": "\n".join(secrets) + "\n",
        "frontend-settings.json": json.dumps({"application_id": config.id, "api_url": api_url,
                                               "web_url": config.web_url, "auth_issuer": config.auth_issuer,
                                               "bootstrap_url": api_url + "/api/v2/application"}, indent=2),
        "stripe-events.json": json.dumps(["checkout.session.completed", "checkout.session.async_payment_succeeded", "customer.subscription.created",
                                          "customer.subscription.updated", "customer.subscription.deleted",
                                          "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required",
                                          "invoice.finalization_failed", "invoice.updated"], indent=2),
        "launch-checks.json": json.dumps(list(MANUAL_CHECKS), indent=2),
    }


@router.get("/{application_id}/package")
def download_package(application_id: str, request: Request, revision: int | None = None):
    require_platform_admin_full_access(request)
    with SessionLocal() as db:
        row = db.get(WhiteLabelSetup, application_id)
        if not row:
            raise HTTPException(404, "Setup not found")
        if revision is not None and row.revision != revision:
            raise HTTPException(409, "This setup changed. Reload it before downloading.")
        config = SetupConfiguration.model_validate_json(row.configuration)
        validate_registration(config, db)
    missing = [item["label"] for item in setup_checks(config) if not item["complete"]]
    if missing:
        raise HTTPException(422, "Complete setup before downloading: " + ", ".join(missing) + ".")
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as bundle:
        for name, content in build_package(config).items():
            bundle.writestr(name, content)
    return Response(buffer.getvalue(), media_type="application/zip", headers={
        "Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="{config.id}-setup.zip"',
    })
