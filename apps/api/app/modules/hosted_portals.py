"""Owner-controlled hosted portals with resumable, verified provider provisioning."""

from datetime import timedelta
from hashlib import sha256
import json
import re
import secrets
from urllib.parse import quote, urlencode, urlsplit
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator
from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError
from starlette.responses import RedirectResponse

from app.application_context import application_scope, applications, get_application, scoped_setting
from app.configuration import get_runtime_configuration
from app.db.database import SessionLocal
from app.db.models import HostedPortal, WhiteLabelSetup, WorkspaceSubscription, utc_now
from app.modules.auth_context import get_auth_context
from app.modules.billing.lifecycle import build_subscription_access_state
from app.modules.billing.service import is_agency_plan
from app.modules.white_label import PRICES, deployment_api_url, https_url
from app.modules import hosted_portal_providers as providers
from app.security.secrets import decrypt_secret, encrypt_secret, secret_encryption_is_configured

router = APIRouter(prefix="/api/v2/hosted-portals", tags=["hosted-portals"])
STEPS = ("hosting", "sign_in", "email", "prices", "webhook", "deployment", "verification")


class PortalConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100, pattern=r"^[^\x00-\x1f]+$")
    domain: str = Field(min_length=4, max_length=253)
    logo_url: str = Field(default="", max_length=1000)
    primary_color: str = Field(default="#2563EB", pattern=r"^#[0-9a-fA-F]{6}$")
    support_email: str = Field(max_length=254, pattern=r"^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$")
    privacy_url: str = Field(min_length=1, max_length=1000)
    terms_url: str = Field(min_length=1, max_length=1000)
    currency: str = Field(default="USD", pattern=r"^(USD|CAD|EUR|GBP|AUD|NZD)$")
    prices: dict[str, StrictInt] = Field(min_length=len(PRICES), max_length=len(PRICES))

    @field_validator("domain")
    @classmethod
    def valid_domain(cls, value):
        value = value.lower().rstrip(".")
        if (not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", value)
                or value.endswith((".localhost", ".local", ".internal", ".vercel.app"))):
            raise ValueError("Enter your own public domain, such as portal.example.com")
        return value

    @field_validator("logo_url", "privacy_url", "terms_url")
    @classmethod
    def urls(cls, value):
        return https_url(value)

    @field_validator("prices")
    @classmethod
    def price_amounts(cls, value):
        if set(value) != {key for key, _, _ in PRICES} or any(
            isinstance(amount, bool) or amount < 50 or amount > 10_000_000 for amount in value.values()
        ):
            raise ValueError("Set every plan and add-on price between 50 and 10000000 cents")
        return value

    @model_validator(mode="after")
    def external_legal_pages(self):
        for value in (self.privacy_url, self.terms_url):
            if urlsplit(value).hostname == self.domain:
                raise ValueError("Host your privacy policy and terms on your business website, outside the portal domain")
        return self


class SavePortal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    configuration: PortalConfiguration
    revision: int = Field(default=0, ge=0, strict=True)


def platform_blockers():
    checks = {
        "Hosted portals are not enabled by the platform yet.": providers.setting("ENABLED") == "true",
        "Secure credential storage is not configured.": secret_encryption_is_configured(),
        "Automatic sign-in setup is not configured.": bool(providers.setting("CLERK_PLATFORM_TOKEN")),
        "Portal hosting is not configured.": all(providers.setting(key) for key in (
            "VERCEL_TOKEN", "VERCEL_TEAM_ID", "GITHUB_REPOSITORY", "GITHUB_REPO_ID")),
        "Stripe Connect is not configured.": all(providers.setting(key) for key in (
            "STRIPE_SECRET_KEY", "STRIPE_CLIENT_ID")) and get_runtime_configuration().stripe_api_url == "https://api.stripe.com/v1",
        "Branded email is not configured.": bool(providers.setting("RESEND_API_KEY")),
        "The public API address is not configured.": bool(deployment_api_url()),
    }
    return [message for message, ready in checks.items() if not ready]


def require_owner(request):
    auth = get_auth_context(request)
    if (not get_application().is_default or auth.workspace_role != "owner"
            or auth.workspace_id != auth.user_id):
        raise HTTPException(403, "Open white-label setup from your own agency workspace.")
    with SessionLocal() as db:
        sub = db.query(WorkspaceSubscription).filter_by(workspace_id=auth.workspace_id).first()
        if not sub or not is_agency_plan(sub.plan) or not build_subscription_access_state(sub).access_allowed:
            raise HTTPException(403, "An active Agency subscription is required for a hosted portal.")
    return auth


def owned(db, auth):
    row = db.query(HostedPortal).filter_by(owner_workspace_id=auth.workspace_id).first()
    if not row:
        raise HTTPException(404, "Save your portal details first.")
    return row


def read_settings(row):
    return json.loads(decrypt_secret(row.protected_settings)) if row.protected_settings else {}


def write_settings(row, settings):
    if not secret_encryption_is_configured():
        raise HTTPException(503, "Secure credential storage is unavailable.")
    row.protected_settings = encrypt_secret(json.dumps(settings))


def public_portal(row):
    state = json.loads(row.provider_state)
    return {
        "id": row.id, "configuration": json.loads(row.configuration), "revision": row.revision,
        "status": row.status, "stripe_connected": bool(row.stripe_account_id),
        "step": next_step(row, state), "checks": state.get("checks", {}),
        "dns_records": state.get("dns_records", []),
        "last_error": state.get("last_error", ""),
        "busy": bool(row.operation_token and row.operation_started_at and row.operation_started_at > utc_now() - timedelta(minutes=10)),
        "url": "https://" + row.domain if row.status == "live" else None,
    }


def next_step(row, state):
    if row.status == "live":
        return "live"
    if not row.stripe_account_id:
        return "stripe"
    return next((step for step in STEPS if not state.get(step)), "launch")


@router.get("")
def get_portal(request: Request, response: Response):
    auth = require_owner(request)
    response.headers["Cache-Control"] = "no-store"
    with SessionLocal() as db:
        row = db.query(HostedPortal).filter_by(owner_workspace_id=auth.workspace_id).first()
        return {"portal": public_portal(row) if row else None, "blockers": platform_blockers(),
                "prices": [{"key": key, "label": label} for key, label, _ in PRICES]}


@router.put("")
def save_portal(request: Request, payload: SavePortal):
    auth = require_owner(request)
    config = payload.configuration
    origin = "https://" + config.domain
    if any(origin in app.allowed_origins for app in applications().values()):
        raise HTTPException(409, "This domain is already in use.")
    with SessionLocal() as db:
        if any(json.loads(draft.configuration).get("web_url", "").rstrip("/") == origin for draft in db.query(WhiteLabelSetup)):
            raise HTTPException(409, "This domain is reserved by another setup.")
        row = db.query(HostedPortal).filter_by(owner_workspace_id=auth.workspace_id).first()
        if row:
            if row.status != "draft" or row.stripe_account_id or row.operation_token:
                raise HTTPException(409, "Portal details are locked after Stripe is connected.")
            result = db.execute(update(HostedPortal).where(
                HostedPortal.id == row.id, HostedPortal.revision == payload.revision,
                HostedPortal.status == "draft", HostedPortal.stripe_account_id.is_(None),
                HostedPortal.operation_token.is_(None),
            ).values(configuration=config.model_dump_json(), domain=config.domain, revision=row.revision + 1))
            if result.rowcount != 1:
                raise HTTPException(409, "This setup changed. Refresh before saving.")
        else:
            if payload.revision:
                raise HTTPException(409, "This setup no longer exists. Refresh before saving.")
            row = HostedPortal(id="portal-" + uuid4().hex[:24], owner_workspace_id=auth.workspace_id,
                               domain=config.domain, configuration=config.model_dump_json())
            db.add(row)
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(409, "This domain or workspace already has a portal.") from None
        db.refresh(row)
        return public_portal(row)


@router.post("/stripe")
def connect_stripe(request: Request):
    auth = require_owner(request)
    if platform_blockers():
        raise HTTPException(503, "Hosted setup is awaiting platform configuration.")
    with SessionLocal() as db:
        row = owned(db, auth)
        if row.stripe_account_id:
            raise HTTPException(409, "Stripe is already connected.")
        state = secrets.token_urlsafe(32)
        row.oauth_state_digest = sha256(state.encode()).hexdigest()
        row.oauth_expires_at = utc_now() + timedelta(minutes=15)
        db.commit()
        return {"url": "https://connect.stripe.com/oauth/authorize?" + urlencode({
            "client_id": providers.setting("STRIPE_CLIENT_ID"), "response_type": "code",
            "scope": "read_write", "state": state,
            "redirect_uri": deployment_api_url() + "/api/v2/hosted-portals/stripe/callback",
        })}


@router.get("/stripe/callback")
def stripe_callback(state: str = "", code: str = "", error: str = ""):
    return_url = get_application().web_url + "/dashboard/white-label"
    if not state or len(state) > 200 or len(code) > 500:
        raise HTTPException(400, "Invalid Stripe return link.")
    with SessionLocal() as db:
        row = db.query(HostedPortal).filter_by(oauth_state_digest=sha256(state.encode()).hexdigest()).first()
        if not row or not row.oauth_expires_at or row.oauth_expires_at < utc_now():
            raise HTTPException(400, "This Stripe link expired or was already used. Connect again from setup.")
        claimed = db.execute(update(HostedPortal).where(
            HostedPortal.id == row.id, HostedPortal.oauth_state_digest == row.oauth_state_digest,
            HostedPortal.stripe_account_id.is_(None), HostedPortal.status == "draft",
        ).values(oauth_state_digest=None, oauth_expires_at=None))
        if claimed.rowcount != 1:
            raise HTTPException(400, "This Stripe link was already used.")
        db.commit()
        if error or not code:
            return RedirectResponse(return_url + "?stripe=cancelled", status_code=303)
        try:
            token = providers.exchange_stripe_code(code)
            account = token.get("stripe_user_id", "")
            if not re.fullmatch(r"acct_[A-Za-z0-9]+", account) or token.get("scope") != "read_write" or token.get("livemode") is not True:
                raise providers.ProvisioningError("Billing")
            # Reject the platform's own Stripe account and any already-assigned account.
            if account == providers.stripe("/account").get("id"):
                raise providers.ProvisioningError("Billing")
            linked = db.execute(update(HostedPortal).where(
                HostedPortal.id == row.id, HostedPortal.stripe_account_id.is_(None),
                HostedPortal.status == "draft",
            ).values(stripe_account_id=account, oauth_state_digest=None, oauth_expires_at=None))
            if linked.rowcount != 1:
                raise providers.ProvisioningError("Billing")
            db.commit()
        except (providers.ProvisioningError, IntegrityError):
            db.rollback()
            return RedirectResponse(return_url + "?stripe=failed", status_code=303)
        return RedirectResponse(return_url + "?stripe=connected", status_code=303)


def add_dns(state, records, source):
    existing = [r for r in state.get("dns_records", []) if r["source"] != source]
    state["dns_records"] = existing + [{"source": source, "type": str(r.get("type") or r.get("record_type") or "CNAME"),
        "name": str(r.get("name") or r.get("host") or r.get("domain") or ""),
        "value": str(r.get("value") or ""), "priority": r.get("priority")} for r in records]


def base_settings(config):
    return {
        "AUTH_PROVIDER": "clerk", "BILLING_PROVIDER": "stripe", "BILLING_ENFORCEMENT_ENABLED": "true",
        "BILLING_CURRENCY": config.currency, "EMAIL_PROVIDER": "resend",
        "RESEND_FROM_EMAIL": "no-reply@mail." + config.domain, "RESEND_FROM_NAME": config.name,
        "SUPPORT_EMAIL": config.support_email, "APPLICATION_LOGO_URL": config.logo_url,
        "APPLICATION_PRIMARY_COLOR": config.primary_color, "APPLICATION_PRIVACY_URL": config.privacy_url,
        "APPLICATION_TERMS_URL": config.terms_url,
    }


def provision_step(row, config, state, settings, step):
    if step == "hosting":
        project = providers.ensure_project(row.id)
        state["project_id"] = project["id"]
        domain = providers.ensure_project_domain(project["id"], config.domain)
        dns = domain.get("verification", [])
        routing = providers.vercel(f"/v6/domains/{quote(config.domain, safe='')}/config")
        if domain.get("apexName") == config.domain:
            ips = (routing.get("recommendedIPv4") or [{}])[0].get("value") or []
            if not ips:
                raise providers.ProvisioningError("Hosting")
            dns.extend({"type": "A", "name": config.domain, "value": ip} for ip in ips)
        else:
            target = (routing.get("recommendedCNAME") or [{}])[0].get("value") or "cname.vercel-dns.com"
            dns.append({"type": "CNAME", "name": config.domain, "value": target})
        add_dns(state, dns, "Portal")
    elif step == "sign_in":
        app = providers.ensure_clerk_application(row.id, config.domain, state.get("clerk_id"))
        state["clerk_id"] = app["application_id"]
        instance = next((item for item in app["instances"] if item["environment_type"] == "production"), {})
        if not instance.get("secret_key") or not instance.get("publishable_key"):
            raise providers.ProvisioningError("Sign-in")
        domains = providers.clerk(f"/platform/applications/{quote(app['application_id'], safe='')}/domains")
        domain = next((item for item in domains.get("data", []) if item.get("name") == config.domain), None)
        if not domain:
            raise providers.ProvisioningError("Sign-in")
        issuer = domain["frontend_api_url"].rstrip("/")
        if not issuer.startswith("https://"):
            raise providers.ProvisioningError("Sign-in")
        for app in applications().values():
            with application_scope(app):
                if issuer == (scoped_setting("AUTH_JWT_ISSUER") or scoped_setting("CLERK_JWT_ISSUER")):
                    raise providers.ProvisioningError("Sign-in")
        settings.update({"CLERK_SECRET_KEY": instance["secret_key"], "CLERK_PUBLISHABLE_KEY": instance["publishable_key"],
                         "AUTH_JWT_ISSUER": issuer, "AUTH_JWKS_URL": issuer + "/.well-known/jwks.json"})
        add_dns(state, domain.get("dns_targets", domain.get("cname_targets", [])), "Sign-in")
    elif step == "email":
        domain = providers.ensure_email_domain("mail." + config.domain)
        state["email_domain_id"] = domain["id"]
        add_dns(state, [*domain.get("records", []), {"type": "TXT", "name": "_dmarc.mail." + config.domain,
            "value": "v=DMARC1; p=none;"}], "Email")
        # Only a domain-restricted sending key is stored in a portal's configuration.
        if not settings.get("RESEND_API_KEY"):
            # A timed-out creation cannot be read back. Revoke only unused keys
            # created for this exact setup before issuing a replacement.
            keys = providers.resend("/api-keys")
            if keys.get("has_more"):
                raise providers.ProvisioningError("Email")
            for previous in keys.get("data", []):
                if previous.get("name") == row.id:
                    providers.resend("/api-keys/" + quote(previous["id"], safe=""), method="DELETE")
            key = providers.resend("/api-keys", method="POST", body={
                "name": row.id, "permission": "sending_access", "domain_id": domain["id"],
            })
            settings["RESEND_API_KEY"] = key["token"]
    elif step == "prices":
        for key, label, amount_key in PRICES:
            if settings.get("STRIPE_" + key + "_PRICE_ID"):
                continue
            body = {"currency": config.currency.lower(),
                    "unit_amount": config.prices[key], "metadata[portal_id]": row.id,
                    "lookup_key": row.id + "-" + key}
            if key != "AI_CREDIT_TOPUP":
                body["recurring[interval]"] = "year" if "ANNUAL" in key else "month"
            # Lookup keys outlive Stripe's 24-hour idempotency window.
            prices = providers.stripe("/prices?" + urlencode({"lookup_keys[]": body["lookup_key"]}), row.stripe_account_id)
            price = (prices.get("data") or [None])[0]
            if not price:
                product = providers.stripe("/products", row.stripe_account_id, method="POST", key=f"{row.id}-{key}-product", body={
                    "name": config.name + " - " + label, "metadata[portal_id]": row.id,
                })
                body["product"] = product["id"]
                price = providers.stripe("/prices", row.stripe_account_id, method="POST", key=f"{row.id}-{key}-price", body=body)
            if price.get("unit_amount") != config.prices[key] or price.get("currency") != config.currency.lower():
                raise providers.ProvisioningError("Billing")
            settings["STRIPE_" + key + "_PRICE_ID"] = price["id"]
            settings["BILLING_" + amount_key + "_PRICE_CENTS"] = str(config.prices[key])
            return False  # One product per request; avoid holding an HTTP connection for eight calls.
    elif step == "webhook":
        hooks = providers.stripe("/webhook_endpoints?limit=100", row.stripe_account_id)
        if hooks.get("has_more"):
            raise providers.ProvisioningError("Billing")
        for previous in hooks.get("data", []):
            if (previous.get("metadata") or {}).get("portal_id") == row.id:
                providers.stripe("/webhook_endpoints/" + quote(previous["id"], safe=""), row.stripe_account_id, method="DELETE")
        webhook = providers.stripe("/webhook_endpoints", row.stripe_account_id, method="POST", key=row.id + "-webhook-" + secrets.token_hex(12), body={
            "url": deployment_api_url() + "/billing/webhook/" + row.id,
            "enabled_events[]": "*", "metadata[portal_id]": row.id,
        })
        settings["STRIPE_WEBHOOK_SECRET"] = webhook["secret"]
        state["webhook_id"] = webhook["id"]
    elif step == "deployment":
        values = {
            "NEXT_PUBLIC_API_URL": deployment_api_url(), "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": settings["CLERK_PUBLISHABLE_KEY"],
            "NEXT_PUBLIC_ENABLE_API_BEARER_AUTH": "true",
            "CLERK_SECRET_KEY": settings["CLERK_SECRET_KEY"], "NEXT_PUBLIC_PORTAL_ID": row.id,
            "NEXT_PUBLIC_PORTAL_NAME": config.name, "NEXT_PUBLIC_PORTAL_LOGO": config.logo_url,
            "NEXT_PUBLIC_PORTAL_COLOR": config.primary_color, "NEXT_PUBLIC_PORTAL_SUPPORT": config.support_email,
            "NEXT_PUBLIC_PORTAL_PRIVACY": config.privacy_url, "NEXT_PUBLIC_PORTAL_TERMS": config.terms_url,
            "NEXT_PUBLIC_PORTAL_URL": "https://" + config.domain,
        }
        providers.vercel(f"/v10/projects/{quote(state['project_id'], safe='')}/env?upsert=true", method="POST", body=[
            {"key": key, "value": value, "type": "encrypted", "target": ["production"]} for key, value in values.items()
        ])
        existing = providers.vercel("/v6/deployments?" + urlencode({"projectId": state["project_id"], "limit": 5, "target": "production"}))
        deployments = existing.get("deployments", [])
        deployment = next((d for d in deployments if (d.get("meta") or {}).get("portal_id") == row.id
                           and d.get("state") not in {"ERROR", "CANCELED"}), None)
        if not deployment:
            deployment = providers.vercel("/v13/deployments", method="POST", body={
                "name": row.id, "project": state["project_id"], "target": "production", "meta": {"portal_id": row.id},
                "gitSource": {"type": "github", "repoId": providers.setting("GITHUB_REPO_ID"),
                              "ref": providers.setting("GITHUB_REF") or "main"},
            })
        state["deployment_id"] = deployment.get("id") or deployment["uid"]
    elif step == "verification":
        providers.clerk(f"/platform/applications/{quote(state['clerk_id'], safe='')}", method="PATCH", body={"name": config.name})
        checks = verify_portal(row, state)
        state["checks"] = checks
        if not all(checks.values()):
            row.status = "waiting"
            return False
    else:
        raise HTTPException(409, "Connect Stripe before preparing your portal.")
    return True


def verify_portal(row, state):
    project = quote(state["project_id"], safe="")
    domain = quote(row.domain, safe="")
    web = providers.vercel(f"/v9/projects/{project}/domains/{domain}/verify", method="POST")
    routing = providers.vercel(f"/v6/domains/{domain}/config")
    try:
        providers.clerk(f"/platform/applications/{quote(state['clerk_id'], safe='')}/domains/{domain}/dns_check", method="POST")
    except providers.ProvisioningError as exc:
        if exc.status != 409:
            raise
    sign_in = providers.clerk(f"/platform/applications/{quote(state['clerk_id'], safe='')}/domains/{domain}/status")
    email_id = quote(state["email_domain_id"], safe="")
    providers.resend(f"/domains/{email_id}/verify", method="POST")
    email = providers.resend(f"/domains/{email_id}")
    build = providers.vercel("/v13/deployments/" + quote(state["deployment_id"], safe=""))
    if build.get("readyState") in {"ERROR", "CANCELED"}:
        state.pop("deployment", None)
        state.pop("verification", None)
        raise HTTPException(502, "The portal build did not finish. Retry preparation to start a new build.")
    account = providers.stripe("/account", row.stripe_account_id)
    hook = providers.stripe("/webhook_endpoints/" + quote(state["webhook_id"], safe=""), row.stripe_account_id)
    config = PortalConfiguration.model_validate_json(row.configuration)
    prices = providers.stripe("/prices?" + urlencode([("lookup_keys[]", row.id + "-" + key) for key, _, _ in PRICES]
                              + [("active", "true"), ("limit", "100")]), row.stripe_account_id)
    settings = read_settings(row)
    by_id = {price["id"]: price for price in prices.get("data", [])}
    prices_ready = all(
        (price := by_id.get(settings.get("STRIPE_" + key + "_PRICE_ID"), {})).get("unit_amount") == config.prices[key]
        and price.get("currency") == config.currency.lower()
        and (price.get("metadata") or {}).get("portal_id") == row.id
        and ((price.get("recurring") or {}).get("interval") == (None if key == "AI_CREDIT_TOPUP" else "year" if "ANNUAL" in key else "month"))
        and (key == "AI_CREDIT_TOPUP" or (price.get("recurring") or {}).get("interval_count") == 1)
        for key, _, _ in PRICES
    )
    return {
        "domain": web.get("verified") is True and routing.get("misconfigured") is False,
        "sign_in": sign_in.get("status") == "complete",
        "email": email.get("status") == "verified",
        "hosting": build.get("readyState") == "READY" and build.get("target") == "production",
        "https": web.get("verified") is True and routing.get("misconfigured") is False
                 and build.get("readyState") == "READY" and providers.portal_https_ready(row.domain, row.id),
        "billing": prices_ready and account.get("id") == row.stripe_account_id
                   and account.get("charges_enabled") is True and account.get("payouts_enabled") is True
                   and hook.get("status") == "enabled" and hook.get("url") == deployment_api_url() + "/billing/webhook/" + row.id,
    }


@router.post("/prepare")
def prepare_portal(request: Request):
    return run_operation(request, launch=False)


@router.post("/launch")
def launch_portal(request: Request):
    return run_operation(request, launch=True)


def run_operation(request, *, launch):
    auth = require_owner(request)
    if platform_blockers():
        raise HTTPException(503, "Hosted setup is awaiting platform configuration.")
    operation = secrets.token_hex(16)
    with SessionLocal() as db:
        row = owned(db, auth)
        if row.status == "live":
            return public_portal(row)
        claim = db.execute(update(HostedPortal).where(
            HostedPortal.id == row.id,
            or_(HostedPortal.operation_token.is_(None), HostedPortal.operation_started_at < utc_now() - timedelta(minutes=10)),
        ).values(operation_token=operation, operation_started_at=utc_now()))
        if claim.rowcount != 1:
            raise HTTPException(409, "Setup is already running. Refresh shortly.")
        db.commit()
        db.refresh(row)
        config = PortalConfiguration.model_validate_json(row.configuration)
        state, settings = json.loads(row.provider_state), read_settings(row)
        settings.update(base_settings(config))
        settings["STRIPE_CONNECTED_ACCOUNT_ID"] = row.stripe_account_id or ""
        failure = None
        try:
            step = next_step(row, state)
            if launch:
                if step != "launch":
                    raise HTTPException(409, "Complete setup and verification before launching.")
                state["checks"] = verify_portal(row, state)
                if not all(state["checks"].values()):
                    state.pop("verification", None)
                    row.status = "waiting"
                    raise HTTPException(409, "A provider check is no longer ready. Check setup again.")
                row.status = "live"
            else:
                row.status = "preparing"
                if step == "launch":
                    row.status = "ready"
                elif provision_step(row, config, state, settings, step):
                    state[step] = True
                    row.status = "ready" if next_step(row, state) == "launch" else "preparing"
            state.pop("last_error", None)
        except (providers.ProvisioningError, HTTPException, KeyError, ValueError) as exc:
            failure = exc if isinstance(exc, HTTPException) else HTTPException(502, str(exc) if isinstance(exc, providers.ProvisioningError) else "A provider returned incomplete setup information. Retry or contact support.")
            state["last_error"] = failure.detail
        finally:
            write_settings(row, settings)
            row.provider_state = json.dumps(state)
            row.operation_token = None
            row.operation_started_at = None
            values = {key: getattr(row, key) for key in (
                "protected_settings", "provider_state", "status", "operation_token", "operation_started_at",
            )}
            db.expunge(row)
            persisted = db.execute(update(HostedPortal).where(
                HostedPortal.id == row.id, HostedPortal.operation_token == operation,
            ).values(**values))
            if persisted.rowcount != 1:
                db.rollback()
                raise HTTPException(409, "Another setup operation took over. Refresh to continue.")
            db.commit()
        if failure:
            raise failure
        from app.modules.hosted_portal_registry import invalidate_registry
        invalidate_registry()
        return public_portal(row)
