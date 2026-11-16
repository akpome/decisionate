"""Application isolation and durable workspace ownership for HTTP and workers."""

from contextlib import contextmanager
from functools import wraps
from inspect import signature
import os

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from app.application_context import (
    DEFAULT_APPLICATION_ID, application_scope, applications, application_branding, get_application, scoped_setting,
)
from app.db.database import SessionLocal
from app.db.models import WorkspaceApplication
from app.modules.billing.schemas import BillingPlanOption, PublicPlanCatalogResponse


def workspace_application_id(db, workspace_id):
    record = db.get(WorkspaceApplication, workspace_id)
    return record.application_id if record else DEFAULT_APPLICATION_ID


def workspace_belongs_to_application(db, workspace_id):
    from app.modules.hosted_subdomains.context import workspace_in_portal
    return workspace_application_id(db, workspace_id) == get_application().id and workspace_in_portal(db, workspace_id)


def require_workspace_application(db, workspace_id, *, discovery=False):
    if (workspace_application_id(db, workspace_id) != get_application().id
            or (not discovery and not workspace_belongs_to_application(db, workspace_id))):
        raise HTTPException(403, "This workspace belongs to another application.")


def bind_workspace_application(db, workspace_id):
    app = get_application()
    existing = db.get(WorkspaceApplication, workspace_id)
    if existing:
        require_workspace_application(db, workspace_id)
    elif not app.is_default:
        db.add(WorkspaceApplication(workspace_id=workspace_id, application_id=app.id))
        db.flush()


@contextmanager
def workspace_application_scope(workspace_id, db=None, *, include_portal=True):
    from app.modules.hosted_subdomains.context import portal_for_workspace, portal_scope
    if db is None:
        with SessionLocal() as session:
            identity = workspace_application_id(session, workspace_id)
            portal = portal_for_workspace(session, workspace_id) if include_portal and identity == DEFAULT_APPLICATION_ID else None
    else:
        identity = workspace_application_id(db, workspace_id)
        portal = portal_for_workspace(db, workspace_id) if include_portal and identity == DEFAULT_APPLICATION_ID else None
    # Missing deployment registration must fail closed, not switch billing providers.
    with application_scope(identity) as app, portal_scope(portal):
        yield app


def workspace_scoped(parameter="workspace_id", attribute=None):
    """Restore application configuration at a synchronous background-service boundary."""
    def decorate(function):
        parameters = signature(function)

        @wraps(function)
        def call(*args, **kwargs):
            values = parameters.bind(*args, **kwargs).arguments
            value = values.get(parameter)
            workspace_id = getattr(value, attribute, None) if attribute else value
            if not workspace_id:
                return function(*args, **kwargs)
            with workspace_application_scope(workspace_id, values.get("db")):
                return function(*args, **kwargs)
        return call
    return decorate


class ApplicationContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        registry = applications()
        requested = headers.get("x-application-id")
        origin = headers.get("origin", "").rstrip("/")
        from app.modules.hosted_subdomains.context import hostname_from_origin, portal_scope, resolve_portal
        portal_host = hostname_from_origin(origin)
        portal = None
        if portal_host:
            with SessionLocal() as db:
                portal = resolve_portal(db, portal_host)
        api_origin = os.getenv("DECISIONATE_API_URL", "http://localhost:8000").strip().rstrip("/")
        by_origin = next((app.id for app in registry.values() if origin in app.allowed_origins), None)
        if portal_host and not portal:
            by_origin = None
        if portal:
            by_origin = DEFAULT_APPLICATION_ID
        path = scope.get("path", "")
        webhook = path == "/billing/webhook" or path.startswith("/billing/webhook/")
        oauth_callback = path in {"/oauth/callback", "/api/v2/hosted-portals/stripe/callback"}
        if webhook:
            identity = path.removeprefix("/billing/webhook/") if path != "/billing/webhook" else DEFAULT_APPLICATION_ID
        elif oauth_callback:
            # The callback resolves its application from signed/unguessable saved state,
            # never the external provider's Origin or a supplied application header.
            identity = DEFAULT_APPLICATION_ID
        else:
            identity = requested or by_origin or DEFAULT_APPLICATION_ID
        if identity not in registry or (requested and by_origin and requested != by_origin and not oauth_callback):
            return await JSONResponse({"detail": "Unknown or conflicting application."}, status_code=400)(scope, receive, send)
        if origin and origin != api_origin and (not by_origin or identity != by_origin) and not (webhook or oauth_callback):
            return await JSONResponse({"detail": "Origin is not registered for this application."}, status_code=403)(scope, receive, send)
        with application_scope(identity) as application, portal_scope(portal):
            scope.setdefault("state", {})["application_id"] = application.id
            # Global operator controls and the existing marketing automation belong to .ca.
            if (not application.is_default or portal) and path.startswith(("/admin", "/marketing")):
                return await JSONResponse({"detail": "This endpoint is not available for this application."}, status_code=404)(scope, receive, send)
            await self.app(scope, receive, send)


class ApplicationCORSMiddleware(CORSMiddleware):
    def is_allowed_origin(self, origin):
        from app.modules.hosted_subdomains.context import hostname_from_origin, resolve_portal
        hostname = hostname_from_origin(origin)
        if hostname:
            with SessionLocal() as db:
                return resolve_portal(db, hostname) is not None
        if super().is_allowed_origin(origin):
            return True
        from app.modules.hosted_portal_registry import hosted_applications
        return any(origin in app.allowed_origins for app in hosted_applications())


router = APIRouter(prefix="/api/v2/application", tags=["application"])


@router.get("/plans", response_model=PublicPlanCatalogResponse)
def application_plans(response: Response):
    from app.modules.billing.service import get_billing_plan_options
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Origin, X-Application-Id"
    with SessionLocal() as db:
        # Serialize only public fields, never provider credentials or price IDs.
        plans = [BillingPlanOption(**plan).model_dump() for plan in get_billing_plan_options(db)]
    return {"currency": scoped_setting("BILLING_CURRENCY", "CAD").upper(), "plans": plans}


class ApplicationConfigurationResponse(BaseModel):
    id: str
    name: str
    web_url: str
    api_contract_version: str
    billing_currency: str
    branding: dict[str, str]
    features: dict[str, bool]


@router.get("", response_model=ApplicationConfigurationResponse)
def application_configuration(response: Response):
    from app.modules.hosted_subdomains.context import current_portal
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Origin, X-Application-Id"
    app = get_application()
    portal = current_portal()
    return {
        "id": app.id, "name": portal.branding["name"] if portal else app.name, "web_url": portal.origin if portal else app.web_url,
        "api_contract_version": "2",
        "billing_currency": scoped_setting("BILLING_CURRENCY", "CAD").upper(),
        "branding": application_branding(),
        "features": {"marketing_preferences": app.is_default and not portal, "platform_admin": app.is_default and not portal},
    }


def install_api_contract(app):
    """Describe the existing middleware auth contract without replacing endpoints."""
    from fastapi.openapi.utils import get_openapi

    def schema():
        if app.openapi_schema:
            return app.openapi_schema
        result = get_openapi(title=app.title, version=app.version, routes=app.routes)
        result.setdefault("components", {}).setdefault("securitySchemes", {})["BearerAuth"] = {
            "type": "http", "scheme": "bearer", "bearerFormat": "JWT",
            "description": "A session token from the selected application's registered issuer.",
        }
        public = {"/", "/health", "/ready", "/api/v2/application", "/api/v2/application/plans", "/api/v2/hosted-subdomains/resolve", "/maintenance/active", "/marketing/consent", "/marketing/unsubscribe"}
        for path, methods in result["paths"].items():
            callback = path.startswith(("/public/", "/billing/webhook", "/oauth/callback", "/marketing/webhook", "/api/v2/hosted-subdomains/assets/"))
            scheduler = path.endswith(("/send-due", "/sync-due", "/reconcile"))
            for method, operation in methods.items():
                if method not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                    continue
                parameters = operation.setdefault("parameters", [])
                parameters.append({"name": "X-Application-Id", "in": "header", "required": False,
                                   "schema": {"type": "string"},
                                   "description": "Registered application id. Browser Origin selects it automatically; not an authorization credential."})
                if path not in public and not callback and not scheduler:
                    operation.setdefault("security", [{"BearerAuth": []}])
                    parameters.append({"name": "X-Workspace-Id", "in": "header", "required": False,
                                       "schema": {"type": "string"},
                                       "description": "Workspace returned by GET /organizations/workspaces. Membership is checked server-side."})
        app.openapi_schema = result
        return result

    app.openapi = schema
