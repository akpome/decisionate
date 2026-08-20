import json
import os
import re
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy import and_, case, func, or_

from app.db.database import Base, SessionLocal
from app.infrastructure.object_storage import get_object_storage
from app.db.models import (
    AIUsageEvent,
    AppUser,
    AuthIdentity,
    DashboardShare,
    DataSourceConnection,
    Dataset,
    DatasetJoinCache,
    DatasetRelationship,
    Organization,
    OrganizationInvite,
    OrganizationMember,
    OAuthConnectionState,
    OAuthCredential,
    PlatformBillingSettings,
    PlatformEmailSettings,
    PlatformAdminRole,
    UserPreference,
    WeeklyReportDeliveryLog,
    WeeklyReportPreference,
    UsageActivityEvent,
    WorkspaceSubscription,
    utc_now,
)
from app.modules.ai.service import build_ai_status
from app.modules.alerts.email_delivery import (
    get_platform_email_settings,
    is_email_delivery_configured,
)
from app.modules.auth_context import get_auth_context
from app.modules.billing.service import (
    AGENCY_PLAN,
    PROFESSIONAL_PLAN,
    get_billing_config,
    get_ai_credit_allocations,
    get_ai_credit_pack_size,
    normalize_billing_plan,
)
from app.modules.identity.service import (
    find_internal_user_id,
    link_external_identity,
    new_internal_user_id,
    resolve_external_identity,
    resolve_user_reference,
)
from app.modules.datasets.services.analytics_engine import (
    build_analytics_engine_status,
)
from app.security.secrets import encrypt_secret
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision


router = APIRouter()

PLATFORM_ADMIN_PERMISSION_DEFINITIONS = (
    {"key": "overview", "label": "Overview and platform analysis"},
    {"key": "workspaces", "label": "Workspaces and membership"},
    {"key": "users", "label": "Users"},
    {"key": "audit", "label": "Audit history"},
    {"key": "alerts", "label": "Alert deliveries"},
    {"key": "analytics", "label": "Usage activity"},
    {"key": "email_settings", "label": "Decisionate email settings"},
    {"key": "credit_settings", "label": "AI credit allocations"},
)
PLATFORM_ADMIN_PERMISSION_KEYS = frozenset(
    definition["key"]
    for definition in PLATFORM_ADMIN_PERMISSION_DEFINITIONS
)


class PlatformAdminAuditEvent(Base):
    __tablename__ = "platform_admin_audit_events"

    id = Column(Integer, primary_key=True, index=True)
    admin_user_id = Column(String, nullable=False, index=True)
    organization_id = Column(Integer, nullable=True, index=True)
    target_user_id = Column(String, nullable=True)
    target_email = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now, index=True)


class PlatformAdminOverviewResponse(BaseModel):
    organization_count: int
    member_count: int
    dataset_count: int
    decision_count: int
    recommendation_count: int
    evaluated_recommendation_count: int
    successful_recommendation_count: int
    recommendation_success_rate: float | None
    evaluated_decision_count: int
    lesson_count: int
    alert_delivery_count: int
    failed_alert_delivery_count: int
    usage_event_count: int
    alert_status: dict
    ai_status: dict
    analytics_status: dict


class PlatformAdminAccessResponse(BaseModel):
    allowed: bool
    full_access: bool = False
    permissions: list[str] = Field(default_factory=list)
    available_permissions: list[dict[str, str]] = Field(
        default_factory=list,
    )


class PlatformAdminOrganizationResponse(BaseModel):
    id: int
    name: str
    owner_user_id: str
    owner_email: str | None = None
    created_at: str | None
    plan: str
    subscription_status: str
    billing_expires_at: str | None = None
    member_count: int
    dataset_count: int
    decision_count: int
    evaluated_decision_count: int


class PlatformAdminOrganizationCreate(BaseModel):
    name: str
    owner_email: str
    plan: str = "free"
    billing_expires_at: datetime | None = None
    member_emails: list[str] = Field(default_factory=list)


class PlatformAdminSubscriptionUpdate(BaseModel):
    plan: str = "free"
    billing_expires_at: datetime | None = None


class PlatformAdminUserResponse(BaseModel):
    clerk_user_id: str
    email: str | None = None
    organization_count: int
    organization_names: list[str]
    roles: list[str]
    owner: bool
    protected: bool = False
    platform_admin: bool = False
    platform_admin_permissions: list[str] = Field(default_factory=list)


class PlatformAdminMemberResponse(BaseModel):
    id: int
    clerk_user_id: str
    email: str | None = None
    role: str
    created_at: str | None


class PlatformAdminMemberRoleUpdate(BaseModel):
    role: str


class PlatformAdminMemberCreate(BaseModel):
    clerk_user_id: str
    role: str = "member"


class PlatformAdminIdentityLinkRequest(BaseModel):
    target_user_id: str


class PlatformAdminIdentityLinkResponse(BaseModel):
    internal_user_id: str


class PlatformAdminAdministratorCreate(BaseModel):
    user_references: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)


class PlatformAdminAdministratorRecord(BaseModel):
    user_id: str
    email: str | None = None
    permissions: list[str]


class PlatformAdminAdministratorResponse(BaseModel):
    administrators: list[PlatformAdminAdministratorRecord]


class PlatformAdminDeleteConfirmation(BaseModel):
    confirmation: str


class PlatformAdminUserDeleteRequest(PlatformAdminDeleteConfirmation):
    user_id: str


class PlatformAdminDeleteResponse(BaseModel):
    deleted: bool
    summary: dict[str, int]


class PlatformAdminInviteResponse(BaseModel):
    id: int
    email: str
    role: str
    status: str
    created_at: str | None


class PlatformAdminInviteCreate(BaseModel):
    email: str
    role: str = "client"


class PlatformAdminAuditEventResponse(BaseModel):
    id: int
    admin_user_id: str
    organization_id: int | None
    target_user_id: str | None
    target_email: str | None
    action: str
    details: str | None
    created_at: str | None


class PlatformAdminAlertDeliveryResponse(BaseModel):
    id: int
    workspace_id: str
    organization_name: str | None
    status: str
    recipients: list[str]
    subject: str
    delivered_count: int
    metrics_count: int
    error: str | None
    attempted_at: str | None


class PlatformAdminUsageRouteResponse(BaseModel):
    route: str
    method: str
    event_count: int
    successful_count: int
    failed_count: int


class PlatformAdminUsageEventResponse(BaseModel):
    id: int
    actor_user_id: str | None
    workspace_id: str | None
    organization_name: str | None
    route: str
    method: str
    status_code: int
    duration_ms: int
    created_at: str | None


class PlatformAdminAICreditSegmentResponse(BaseModel):
    segment: str
    credits: int
    requests: int
    active_users: int
    workspaces: int


class PlatformAdminAICreditUserResponse(BaseModel):
    user_id: str
    segment: str
    credits: int
    requests: int
    workspaces: int
    attributed: bool


class PlatformAdminAICreditWorkspaceResponse(BaseModel):
    workspace_id: str
    organization_name: str | None
    segment: str
    credits: int
    requests: int
    active_users: int


class PlatformAdminUsageResponse(BaseModel):
    period_days: int
    period_start: str
    period_end: str
    total_events: int
    successful_events: int
    failed_events: int
    active_users: int
    active_workspaces: int
    average_duration_ms: int
    ai_requests: int
    ai_tokens: int
    ai_credits: int
    ai_credit_segments: list[PlatformAdminAICreditSegmentResponse]
    ai_credit_users: list[PlatformAdminAICreditUserResponse]
    ai_credit_workspaces: list[PlatformAdminAICreditWorkspaceResponse]
    top_routes: list[PlatformAdminUsageRouteResponse]
    recent_events: list[PlatformAdminUsageEventResponse]


class PlatformAdminEmailSettingsResponse(BaseModel):
    configured: bool
    source: str
    provider: str
    resend_from_email: str
    resend_from_name: str
    resend_api_key_set: bool
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password_set: bool
    smtp_from_email: str
    smtp_from_name: str
    smtp_use_tls: bool
    smtp_use_ssl: bool
    smtp_timeout_seconds: int


class PlatformAdminEmailSettingsUpdate(BaseModel):
    provider: str = "smtp"
    resend_api_key: str | None = None
    clear_resend_api_key: bool = False
    resend_from_email: str = ""
    resend_from_name: str = "Decisionate"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str | None = None
    clear_password: bool = False
    smtp_from_email: str = ""
    smtp_from_name: str = "Decisionate"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False


class PlatformAdminCreditSettingsResponse(BaseModel):
    source: str
    free_ai_credits: int
    professional_ai_credits: int
    agency_ai_credits: int
    agency_client_ai_credits: int
    additional_client_workspace_ai_credits: int
    ai_credit_pack_size: int
    updated_at: str | None


class PlatformAdminCreditSettingsUpdate(BaseModel):
    free_ai_credits: int | None = None
    professional_ai_credits: int | None = None
    agency_ai_credits: int | None = None
    agency_client_ai_credits: int | None = None
    additional_client_workspace_ai_credits: int | None = None
    ai_credit_pack_size: int | None = None


def configured_platform_admin_references() -> set[str]:
    return {
        user_id.strip()
        for user_id in os.getenv(
            "DECISIONATE_PLATFORM_ADMIN_USER_IDS",
            "",
        ).split(",")
        if user_id.strip()
    }


def configured_platform_admin_emails() -> set[str]:
    return {
        email.strip().lower()
        for email in os.getenv(
            "DECISIONATE_PLATFORM_ADMIN_EMAILS",
            "",
        ).split(",")
        if email.strip()
    }


def ensure_platform_admin_roles() -> None:
    configured_ids = configured_platform_admin_references()
    if not configured_ids:
        return

    db = SessionLocal()
    try:
        for configured_id in configured_ids:
            internal_user_id = find_internal_user_id(
                db,
                configured_id,
            )
            if not internal_user_id:
                internal_user_id = resolve_external_identity(
                    configured_id,
                )

            existing_role = (
                db.query(PlatformAdminRole)
                .filter(PlatformAdminRole.user_id == internal_user_id)
                .first()
            )
            if existing_role is None:
                db.add(
                    PlatformAdminRole(
                        user_id=internal_user_id,
                    )
                )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_platform_admin_user_ids() -> set[str]:
    configured_ids = configured_platform_admin_references()
    configured_emails = configured_platform_admin_emails()
    db = SessionLocal()
    try:
        role_ids = {
            role.user_id
            for role in db.query(PlatformAdminRole).all()
        }
        for configured_id in configured_ids:
            role_ids.add(
                find_internal_user_id(
                    db,
                    configured_id,
                )
                or configured_id
            )
        if configured_emails:
            role_ids.update(
                user.id
                for user in (
                    db.query(AppUser)
                    .filter(
                        func.lower(AppUser.email).in_(
                            configured_emails
                        )
                    )
                    .all()
                )
            )
            role_ids.update(
                identity.user_id
                for identity in (
                    db.query(AuthIdentity)
                    .filter(
                        func.lower(AuthIdentity.email).in_(
                            configured_emails
                        )
                    )
                    .all()
                )
            )
        if role_ids:
            return role_ids
    finally:
        db.close()

    # Bootstrap fallback for a database created before internal grants existed.
    if not configured_ids:
        return set()

    db = SessionLocal()
    try:
        resolved_ids = set()
        for configured_id in configured_ids:
            resolved_ids.add(
                find_internal_user_id(
                    db,
                    configured_id,
                )
                or configured_id
            )
        return resolved_ids
    finally:
        db.close()


def platform_admin_role(db, user_id: str):
    return (
        db.query(PlatformAdminRole)
        .filter(PlatformAdminRole.user_id == user_id)
        .first()
    )


def platform_admin_is_full_access(db, user_id: str) -> bool:
    role = platform_admin_role(db, user_id)
    if role is None:
        return user_id in get_platform_admin_user_ids()

    # Existing platform-admin grants predate scoped access and remain full
    # access until explicitly replaced by a permissions JSON document.
    return not str(role.permissions or "").strip()


def platform_admin_permission_set(db, user_id: str) -> set[str]:
    if platform_admin_is_full_access(db, user_id):
        return set(PLATFORM_ADMIN_PERMISSION_KEYS)

    role = platform_admin_role(db, user_id)
    if role is None:
        return set()
    try:
        permissions = json.loads(role.permissions or "[]")
    except (TypeError, json.JSONDecodeError):
        return set()

    if not isinstance(permissions, list):
        return set()
    return {
        str(permission).strip()
        for permission in permissions
        if str(permission).strip() in PLATFORM_ADMIN_PERMISSION_KEYS
    }


def platform_admin_permission_for_path(path: str) -> str | None:
    clean_path = path.rstrip("/") or "/"
    if clean_path == "/admin/access":
        return None
    if clean_path == "/admin/overview":
        return "overview"
    if clean_path.startswith("/admin/organizations"):
        return "workspaces"
    if clean_path.startswith("/admin/users") or clean_path.startswith(
        "/admin/identity-links"
    ):
        return "users"
    if clean_path.startswith("/admin/audit-events"):
        return "audit"
    if clean_path.startswith("/admin/alert-deliveries"):
        return "alerts"
    if clean_path.startswith("/admin/usage-activity"):
        return "analytics"
    if clean_path.startswith("/admin/email-settings"):
        return "email_settings"
    if clean_path.startswith("/admin/credit-settings"):
        return "credit_settings"
    if clean_path.startswith("/admin/administrators"):
        return "administrators"
    return None


def require_platform_admin(request: Request):
    auth_context = get_auth_context(request)
    if auth_context.user_id not in get_platform_admin_user_ids():
        raise HTTPException(
            status_code=403,
            detail="Platform admin access required",
        )

    required_permission = platform_admin_permission_for_path(
        request.url.path,
    )
    if required_permission:
        db = SessionLocal()
        try:
            if (
                not platform_admin_is_full_access(
                    db,
                    auth_context.user_id,
                )
                and required_permission
                not in platform_admin_permission_set(
                    db,
                    auth_context.user_id,
                )
            ):
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Platform admin permission required: "
                        f"{required_permission}"
                    ),
                )
        finally:
            db.close()

    return auth_context


def require_platform_admin_full_access(request: Request):
    auth_context = require_platform_admin(request)
    db = SessionLocal()
    try:
        if not platform_admin_is_full_access(db, auth_context.user_id):
            raise HTTPException(
                status_code=403,
                detail="Full platform admin access required",
            )
    finally:
        db.close()
    return auth_context


@router.get(
    "/access",
    response_model=PlatformAdminAccessResponse,
)
async def get_platform_admin_access(
    request: Request,
):
    auth_context = get_auth_context(request)
    allowed = auth_context.user_id in get_platform_admin_user_ids()
    if not allowed:
        return PlatformAdminAccessResponse(allowed=False)

    db = SessionLocal()
    try:
        full_access = platform_admin_is_full_access(
            db,
            auth_context.user_id,
        )
        return PlatformAdminAccessResponse(
            allowed=True,
            full_access=full_access,
            permissions=sorted(
                platform_admin_permission_set(
                    db,
                    auth_context.user_id,
                )
            ),
            available_permissions=list(
                PLATFORM_ADMIN_PERMISSION_DEFINITIONS
            ),
        )
    finally:
        db.close()


def serialize_platform_admin_email_settings() -> PlatformAdminEmailSettingsResponse:
    settings = get_platform_email_settings()
    return PlatformAdminEmailSettingsResponse(
        configured=bool(settings["configured"]),
        source=str(settings["source"]),
        provider=str(settings["provider"]),
        resend_from_email=str(settings["resend_from_email"]),
        resend_from_name=str(settings["resend_from_name"]),
        resend_api_key_set=bool(settings["resend_api_key"]),
        smtp_host=str(settings["smtp_host"]),
        smtp_port=int(settings["smtp_port"]),
        smtp_username=str(settings["smtp_username"]),
        smtp_password_set=bool(settings["smtp_password"]),
        smtp_from_email=str(settings["smtp_from_email"]),
        smtp_from_name=(
            str(settings["smtp_from_name"])
            or "Decisionate"
        ),
        smtp_use_tls=bool(settings["smtp_use_tls"]),
        smtp_use_ssl=bool(settings["smtp_use_ssl"]),
        smtp_timeout_seconds=int(settings["smtp_timeout_seconds"]),
    )


def serialize_platform_admin_credit_settings() -> PlatformAdminCreditSettingsResponse:
    db = SessionLocal()
    try:
        settings = (
            db.query(PlatformBillingSettings)
            .filter(PlatformBillingSettings.id == 1)
            .first()
        )
        allocations = get_ai_credit_allocations()
        return PlatformAdminCreditSettingsResponse(
            source="database" if settings else "environment/default",
            free_ai_credits=allocations["free"],
            professional_ai_credits=allocations[PROFESSIONAL_PLAN],
            agency_ai_credits=allocations[AGENCY_PLAN],
            agency_client_ai_credits=allocations["agency_client"],
            additional_client_workspace_ai_credits=allocations[
                "additional_client_workspace"
            ],
            ai_credit_pack_size=get_ai_credit_pack_size(),
            updated_at=(
                settings.updated_at.isoformat()
                if settings and settings.updated_at
                else None
            ),
        )
    finally:
        db.close()


def clean_platform_admin_email(value: str) -> str:
    clean_value = str(value or "").strip().lower()
    if clean_value and not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        clean_value,
    ):
        raise HTTPException(
            status_code=400,
            detail="SMTP sender must be a valid email address",
        )

    return clean_value


@router.get(
    "/email-settings",
    response_model=PlatformAdminEmailSettingsResponse,
)
async def get_platform_admin_email_settings(request: Request):
    require_platform_admin(request)
    return serialize_platform_admin_email_settings()


@router.patch(
    "/email-settings",
    response_model=PlatformAdminEmailSettingsResponse,
)
async def update_platform_admin_email_settings(
    payload: PlatformAdminEmailSettingsUpdate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    if payload.provider not in {"smtp", "resend"}:
        raise HTTPException(
            status_code=400,
            detail="Email provider must be smtp or resend",
        )
    if payload.smtp_port < 1 or payload.smtp_port > 65535:
        raise HTTPException(
            status_code=400,
            detail="SMTP port must be between 1 and 65535",
        )
    if payload.smtp_use_tls and payload.smtp_use_ssl:
        raise HTTPException(
            status_code=400,
            detail="Choose TLS or SSL, not both",
        )

    smtp_from_email = clean_platform_admin_email(
        payload.smtp_from_email
    )
    db = SessionLocal()
    try:
        settings = (
            db.query(PlatformEmailSettings)
            .filter(PlatformEmailSettings.id == 1)
            .first()
        )
        if settings is None:
            settings = PlatformEmailSettings(id=1)
            db.add(settings)

        settings.provider = payload.provider
        if payload.clear_resend_api_key:
            settings.resend_api_key = None
        elif payload.resend_api_key is not None and payload.resend_api_key != "":
            settings.resend_api_key = encrypt_secret(payload.resend_api_key)
        settings.resend_from_email = clean_platform_admin_email(
            payload.resend_from_email
        ) or None
        settings.resend_from_name = (
            str(payload.resend_from_name or "").strip()
            or "Decisionate"
        )
        settings.smtp_host = str(payload.smtp_host or "").strip() or None
        settings.smtp_port = payload.smtp_port
        settings.smtp_username = (
            str(payload.smtp_username or "").strip() or None
        )
        if payload.clear_password:
            settings.smtp_password = None
        elif payload.smtp_password is not None and payload.smtp_password != "":
            settings.smtp_password = encrypt_secret(payload.smtp_password)
        settings.smtp_from_email = smtp_from_email or None
        settings.smtp_from_name = (
            str(payload.smtp_from_name or "").strip()
            or "Decisionate"
        )
        settings.smtp_use_tls = int(payload.smtp_use_tls)
        settings.smtp_use_ssl = int(payload.smtp_use_ssl)
        settings.updated_by_user_id = auth_context.user_id
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="platform_email_settings_updated",
            details=(
                f"source=database, host={settings.smtp_host or 'environment'}, "
                f"sender={settings.smtp_from_email or 'environment'}"
            ),
        )
        db.commit()
    finally:
        db.close()

    return serialize_platform_admin_email_settings()


@router.get(
    "/credit-settings",
    response_model=PlatformAdminCreditSettingsResponse,
)
async def get_platform_admin_credit_settings(request: Request):
    require_platform_admin(request)
    return serialize_platform_admin_credit_settings()


@router.patch(
    "/credit-settings",
    response_model=PlatformAdminCreditSettingsResponse,
)
async def update_platform_admin_credit_settings(
    payload: PlatformAdminCreditSettingsUpdate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    for field_name, value in payload.dict().items():
        if value is not None and value < 0:
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} cannot be negative",
            )

    db = SessionLocal()
    try:
        settings = (
            db.query(PlatformBillingSettings)
            .filter(PlatformBillingSettings.id == 1)
            .first()
        )
        if settings is None:
            settings = PlatformBillingSettings(id=1)
            db.add(settings)

        current_allocations = get_ai_credit_allocations()
        values = {
            "free_ai_credits": current_allocations["free"],
            "professional_ai_credits": current_allocations[
                PROFESSIONAL_PLAN
            ],
            "agency_ai_credits": current_allocations[AGENCY_PLAN],
            "agency_client_ai_credits": current_allocations[
                "agency_client"
            ],
            "additional_client_workspace_ai_credits": current_allocations[
                "additional_client_workspace"
            ],
            "ai_credit_pack_size": get_ai_credit_pack_size(),
        }
        for field_name, current_value in values.items():
            submitted_value = getattr(payload, field_name)
            setattr(
                settings,
                field_name,
                submitted_value
                if submitted_value is not None
                else current_value,
            )
        settings.updated_by_user_id = auth_context.user_id
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="platform_credit_settings_updated",
            details=json.dumps(values),
        )
        db.commit()
    finally:
        db.close()

    return serialize_platform_admin_credit_settings()


def has_meaningful_text(column):
    return and_(
        column.is_not(None),
        func.length(func.trim(column)) > 0,
    )


def count_platform_admin_members(db, organization_id: int | None = None) -> int:
    member_query = db.query(func.count(OrganizationMember.id))
    owner_query = (
        db.query(func.count(Organization.id))
        .outerjoin(
            OrganizationMember,
            and_(
                OrganizationMember.organization_id == Organization.id,
                OrganizationMember.clerk_user_id == Organization.owner_user_id,
            ),
        )
        .filter(OrganizationMember.id.is_(None))
    )

    if organization_id is not None:
        member_query = member_query.filter(
            OrganizationMember.organization_id == organization_id
        )
        owner_query = owner_query.filter(Organization.id == organization_id)

    return (
        member_query.scalar() or 0
    ) + (
        owner_query.scalar() or 0
    )


@router.get(
    "/overview",
    response_model=PlatformAdminOverviewResponse,
)
async def get_platform_admin_overview(
    request: Request,
):
    require_platform_admin(request)
    db = SessionLocal()

    try:
        evaluated_decision_filter = and_(
            has_meaningful_text(Decision.expected_outcome),
            has_meaningful_text(Decision.outcome_status),
        )
        recommendation_filter = has_meaningful_text(
            Decision.recommendation_text
        )
        evaluated_recommendation_filter = and_(
            recommendation_filter,
            evaluated_decision_filter,
        )
        evaluated_recommendation_count = (
            db.query(func.count(Decision.id))
            .filter(evaluated_recommendation_filter)
            .scalar()
            or 0
        )
        successful_recommendation_count = (
            db.query(func.count(Decision.id))
            .filter(
                recommendation_filter,
                evaluated_decision_filter,
                Decision.outcome_status == "successful",
            )
            .scalar()
            or 0
        )
        recommendation_success_rate = (
            round(
                successful_recommendation_count
                / evaluated_recommendation_count
                * 100,
                1,
            )
            if evaluated_recommendation_count
            else None
        )
        usage_event_count = (
            db.query(func.count(UsageActivityEvent.id))
            .filter(
                UsageActivityEvent.created_at
                >= utc_now() - timedelta(days=30),
            )
            .scalar()
            or 0
        )

        try:
            analytics_status = build_analytics_engine_status()
        except (OSError, ValueError) as error:
            analytics_status = {
                "engine": "unavailable",
                "storage_format": "unknown",
                "error": str(error),
            }

        return PlatformAdminOverviewResponse(
            organization_count=(
                db.query(func.count(Organization.id)).scalar()
                or 0
            ),
            member_count=(
                count_platform_admin_members(db)
            ),
            dataset_count=(
                db.query(func.count(Dataset.id)).scalar()
                or 0
            ),
            decision_count=(
                db.query(func.count(Decision.id)).scalar()
                or 0
            ),
            recommendation_count=(
                db.query(func.count(Decision.id))
                .filter(recommendation_filter)
                .scalar()
                or 0
            ),
            evaluated_recommendation_count=(
                evaluated_recommendation_count
            ),
            successful_recommendation_count=(
                successful_recommendation_count
            ),
            recommendation_success_rate=(
                recommendation_success_rate
            ),
            evaluated_decision_count=(
                db.query(func.count(Decision.id))
                .filter(evaluated_decision_filter)
                .scalar()
                or 0
            ),
            lesson_count=(
                db.query(func.count(Decision.id))
                .filter(
                    has_meaningful_text(Decision.lessons_learned)
                )
                .scalar()
                or 0
            ),
            alert_delivery_count=(
                db.query(func.count(WeeklyReportDeliveryLog.id)).scalar()
                or 0
            ),
            failed_alert_delivery_count=(
                db.query(func.count(WeeklyReportDeliveryLog.id))
                .filter(
                    WeeklyReportDeliveryLog.status.in_(
                        ["failed", "test_failed"]
                    )
                )
                .scalar()
                or 0
            ),
            usage_event_count=usage_event_count,
            alert_status={
                "server_smtp_configured": (
                    is_email_delivery_configured()
                ),
                "scheduler_configured": bool(
                    os.getenv(
                        "ALERTS_SCHEDULER_SECRET",
                        "",
                    ).strip()
                ),
            },
            ai_status=build_ai_status(),
            analytics_status=analytics_status,
        )
    finally:
        db.close()


@router.post(
    "/administrators",
    response_model=PlatformAdminAdministratorResponse,
)
async def add_platform_admin_administrators(
    payload: PlatformAdminAdministratorCreate,
    request: Request,
):
    auth_context = require_platform_admin_full_access(request)
    references = list(
        dict.fromkeys(
            str(reference).strip()
            for reference in payload.user_references
            if str(reference).strip()
        )
    )
    if not references:
        raise HTTPException(
            status_code=400,
            detail="Enter at least one user email or internal/provider user reference",
        )

    permissions = sorted(
        {
            str(permission).strip()
            for permission in payload.permissions
            if str(permission).strip()
        }
    )
    unknown_permissions = [
        permission
        for permission in permissions
        if permission not in PLATFORM_ADMIN_PERMISSION_KEYS
    ]
    if unknown_permissions or not permissions:
        raise HTTPException(
            status_code=400,
            detail="Select at least one valid platform admin card",
        )

    db = SessionLocal()
    try:
        records: list[PlatformAdminAdministratorRecord] = []
        seen_user_ids: set[str] = set()
        owner_user_ids = platform_owner_user_ids(db, auth_context.user_id)

        for reference in references:
            target_user_id: str | None = None
            target_email: str | None = None
            if "@" in reference:
                target_email = reference.lower()
                if not re.fullmatch(
                    r"[^@\s]+@[^@\s]+\.[^@\s]+",
                    target_email,
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Enter a valid user email address: {reference}",
                    )
                target_user = (
                    db.query(AppUser)
                    .filter(func.lower(AppUser.email) == target_email)
                    .first()
                )
                if target_user is None:
                    target_user = AppUser(
                        id=new_internal_user_id(),
                        email=target_email,
                    )
                    db.add(target_user)
                    db.flush()
                target_user_id = target_user.id
            else:
                target_user_id = find_internal_user_id(
                    db,
                    reference,
                    provider=auth_context.auth_provider,
                )
                if target_user_id:
                    target_user = (
                        db.query(AppUser)
                        .filter(AppUser.id == target_user_id)
                        .first()
                    )
                    target_email = target_user.email if target_user else None

            if not target_user_id:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        "User not found. Add the user's email address or "
                        f"internal/provider reference: {reference}"
                    ),
                )
            if target_user_id in owner_user_ids:
                raise HTTPException(
                    status_code=409,
                    detail="The platform owner cannot be assigned limited access",
                )
            if target_user_id in seen_user_ids:
                continue
            seen_user_ids.add(target_user_id)

            role = platform_admin_role(db, target_user_id)
            if role is None:
                role = PlatformAdminRole(
                    user_id=target_user_id,
                    granted_by_user_id=auth_context.user_id,
                )
                db.add(role)
            else:
                role.granted_by_user_id = auth_context.user_id
            role.permissions = json.dumps(permissions)
            record_platform_admin_audit(
                db,
                admin_user_id=auth_context.user_id,
                target_user_id=target_user_id,
                target_email=target_email,
                action="platform_admin_access_updated",
                details=json.dumps({"permissions": permissions}),
            )
            records.append(
                PlatformAdminAdministratorRecord(
                    user_id=target_user_id,
                    email=target_email,
                    permissions=permissions,
                )
            )

        if not records:
            raise HTTPException(
                status_code=400,
                detail="No unique users were supplied",
            )
        db.commit()
        return PlatformAdminAdministratorResponse(administrators=records)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.get(
    "/organizations",
    response_model=list[PlatformAdminOrganizationResponse],
)
async def get_platform_admin_organizations(
    request: Request,
):
    require_platform_admin(request)
    db = SessionLocal()

    try:
        organizations = (
            db.query(Organization)
            .order_by(
                Organization.created_at.desc(),
                Organization.id.desc(),
            )
            .all()
        )
        responses = []

        for organization in organizations:
            workspace_id = organization.owner_user_id
            is_client_workspace = ":client:" in workspace_id
            subscription = (
                db.query(WorkspaceSubscription)
                .filter(
                    WorkspaceSubscription.workspace_id == workspace_id,
                )
                .first()
            )
            dataset_filter = or_(
                Dataset.workspace_id == workspace_id,
                and_(
                    Dataset.workspace_id.is_(None),
                    Dataset.user_id == workspace_id,
                ),
            )
            decision_filter = or_(
                Decision.workspace_id == workspace_id,
                and_(
                    Decision.workspace_id.is_(None),
                    Decision.clerk_user_id == workspace_id,
                ),
            )
            evaluated_decision_filter = and_(
                decision_filter,
                has_meaningful_text(
                    Decision.expected_outcome
                ),
                has_meaningful_text(
                    Decision.outcome_status
                ),
            )

            responses.append(
                PlatformAdminOrganizationResponse(
                    id=organization.id,
                    name=organization.name,
                    owner_user_id=workspace_id,
                    owner_email=platform_admin_user_email(
                        db,
                        workspace_id,
                    ),
                    created_at=(
                        organization.created_at.isoformat()
                        if organization.created_at
                        else None
                    ),
                    plan=(
                        "client"
                        if is_client_workspace
                        else normalize_billing_plan(
                            subscription.plan if subscription else "free",
                        )
                    ),
                    subscription_status=(
                        "managed"
                        if is_client_workspace
                        else (
                            subscription.status
                            if subscription
                            else "untracked"
                        )
                    ),
                    billing_expires_at=(
                        None
                        if is_client_workspace
                        else (
                            subscription.current_period_end.isoformat()
                            if subscription and subscription.current_period_end
                            else None
                        )
                    ),
                    member_count=(
                        count_platform_admin_members(db, organization.id)
                    ),
                    dataset_count=(
                        db.query(func.count(Dataset.id))
                        .filter(dataset_filter)
                        .scalar()
                        or 0
                    ),
                    decision_count=(
                        db.query(func.count(Decision.id))
                        .filter(decision_filter)
                        .scalar()
                        or 0
                    ),
                    evaluated_decision_count=(
                        db.query(func.count(Decision.id))
                        .filter(evaluated_decision_filter)
                        .scalar()
                        or 0
                    ),
                )
            )

        return responses
    finally:
        db.close()


def platform_admin_user_email(db, user_id: str) -> str | None:
    user = (
        db.query(AppUser)
        .filter(AppUser.id == user_id)
        .first()
    )
    if user and user.email:
        return user.email

    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.user_id == user_id,
            AuthIdentity.email.isnot(None),
        )
        .order_by(AuthIdentity.id.asc())
        .first()
    )
    return identity.email if identity else None


def normalize_platform_admin_expiry(
    value: datetime | None,
) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def get_or_create_platform_admin_owner(
    db,
    email: str,
) -> AppUser:
    matches = (
        db.query(AppUser)
        .filter(func.lower(AppUser.email) == email)
        .limit(2)
        .all()
    )
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail="More than one internal account uses this owner email",
        )
    if matches:
        return matches[0]

    owner = AppUser(
        id=new_internal_user_id(),
        email=email,
    )
    db.add(owner)
    db.flush()
    return owner


def serialize_platform_admin_organization(
    db,
    organization: Organization,
):
    workspace_id = organization.owner_user_id
    is_client_workspace = ":client:" in workspace_id
    subscription = (
        db.query(WorkspaceSubscription)
        .filter(
            WorkspaceSubscription.workspace_id == workspace_id,
        )
        .first()
    )
    dataset_filter = or_(
        Dataset.workspace_id == workspace_id,
        and_(
            Dataset.workspace_id.is_(None),
            Dataset.user_id == workspace_id,
        ),
    )
    decision_filter = or_(
        Decision.workspace_id == workspace_id,
        and_(
            Decision.workspace_id.is_(None),
            Decision.clerk_user_id == workspace_id,
        ),
    )
    evaluated_decision_filter = and_(
        decision_filter,
        has_meaningful_text(Decision.expected_outcome),
        has_meaningful_text(Decision.outcome_status),
    )
    return PlatformAdminOrganizationResponse(
        id=organization.id,
        name=organization.name,
        owner_user_id=workspace_id,
        owner_email=platform_admin_user_email(
            db,
            organization.owner_user_id,
        ),
        created_at=(
            organization.created_at.isoformat()
            if organization.created_at
            else None
        ),
        plan=(
            "client"
            if is_client_workspace
            else normalize_billing_plan(
                subscription.plan if subscription else "free",
            )
        ),
        subscription_status=(
            "managed"
            if is_client_workspace
            else (
                subscription.status if subscription else "untracked"
            )
        ),
        billing_expires_at=(
            None
            if is_client_workspace
            else (
                subscription.current_period_end.isoformat()
                if subscription and subscription.current_period_end
                else None
            )
        ),
        member_count=count_platform_admin_members(db, organization.id),
        dataset_count=(
            db.query(func.count(Dataset.id))
            .filter(dataset_filter)
            .scalar()
            or 0
        ),
        decision_count=(
            db.query(func.count(Decision.id))
            .filter(decision_filter)
            .scalar()
            or 0
        ),
        evaluated_decision_count=(
            db.query(func.count(Decision.id))
            .filter(evaluated_decision_filter)
            .scalar()
            or 0
        ),
    )


@router.post(
    "/organizations",
    response_model=PlatformAdminOrganizationResponse,
)
async def create_platform_admin_organization(
    payload: PlatformAdminOrganizationCreate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    name = str(payload.name or "").strip()
    if not name:
        raise HTTPException(
            status_code=400,
            detail="Workspace name is required",
        )
    if len(name) > 160:
        raise HTTPException(
            status_code=400,
            detail="Workspace name must be 160 characters or fewer",
        )

    owner_email = clean_platform_admin_invite_email(payload.owner_email)
    plan = normalize_billing_plan(payload.plan)
    expiry = normalize_platform_admin_expiry(payload.billing_expires_at)
    member_emails = []
    for member_email in payload.member_emails:
        clean_email = clean_platform_admin_invite_email(member_email)
        if clean_email != owner_email and clean_email not in member_emails:
            member_emails.append(clean_email)

    db = SessionLocal()
    try:
        owner = get_or_create_platform_admin_owner(db, owner_email)
        existing_owned_workspace = (
            db.query(Organization)
            .filter(Organization.owner_user_id == owner.id)
            .first()
        )
        if existing_owned_workspace:
            raise HTTPException(
                status_code=409,
                detail="This owner already owns a workspace",
            )

        organization = Organization(
            name=name,
            owner_user_id=owner.id,
        )
        db.add(organization)
        db.flush()
        db.add(
            OrganizationMember(
                organization_id=organization.id,
                clerk_user_id=owner.id,
                role="owner",
            )
        )

        subscription_status = (
            "trialing"
            if plan == "free" and expiry is not None
            else "active"
        )
        db.add(
            WorkspaceSubscription(
                workspace_id=owner.id,
                provider=get_billing_config().get("provider") or "manual",
                plan=plan,
                status=subscription_status,
                current_period_start=utc_now(),
                current_period_end=expiry,
            )
        )

        db.add(
            OrganizationInvite(
                organization_id=organization.id,
                email=owner_email,
                role="owner",
                status="pending",
            )
        )
        for member_email in member_emails:
            db.add(
                OrganizationInvite(
                    organization_id=organization.id,
                    email=member_email,
                    role="member",
                    status="pending",
                )
            )

        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="workspace_provisioned",
            organization_id=organization.id,
            target_user_id=owner.id,
            target_email=owner_email,
            details=json.dumps({
                "plan": plan,
                "billing_expires_at": (
                    expiry.isoformat() if expiry else None
                ),
                "member_invites": len(member_emails),
            }),
        )
        db.commit()
        db.refresh(organization)

        return serialize_platform_admin_organization(db, organization)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.patch(
    "/organizations/{organization_id}/subscription",
    response_model=PlatformAdminOrganizationResponse,
)
async def update_platform_admin_subscription(
    organization_id: int,
    payload: PlatformAdminSubscriptionUpdate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    plan = normalize_billing_plan(payload.plan)
    expiry = normalize_platform_admin_expiry(payload.billing_expires_at)
    db = SessionLocal()
    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if organization is None:
            raise HTTPException(
                status_code=404,
                detail="Workspace not found",
            )

        subscription = (
            db.query(WorkspaceSubscription)
            .filter(
                WorkspaceSubscription.workspace_id == organization.owner_user_id,
            )
            .first()
        )
        if subscription is None:
            subscription = WorkspaceSubscription(
                workspace_id=organization.owner_user_id,
                provider=get_billing_config().get("provider") or "manual",
            )
            db.add(subscription)

        subscription.plan = plan
        subscription.status = (
            "trialing"
            if plan == "free" and expiry is not None
            else "active"
        )
        subscription.current_period_start = (
            subscription.current_period_start or utc_now()
        )
        subscription.current_period_end = expiry
        subscription.data_purged_at = None
        subscription.canceled_at = None
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="workspace_billing_updated",
            organization_id=organization.id,
            target_user_id=organization.owner_user_id,
            details=json.dumps({
                "plan": plan,
                "billing_expires_at": (
                    expiry.isoformat() if expiry else None
                ),
            }),
        )
        db.commit()
        db.refresh(organization)
        return serialize_platform_admin_organization(db, organization)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.post(
    "/organizations/{organization_id}/delete",
    response_model=PlatformAdminDeleteResponse,
)
async def delete_platform_admin_organization(
    organization_id: int,
    payload: PlatformAdminDeleteConfirmation,
    request: Request,
):
    auth_context = require_platform_admin(request)
    if payload.confirmation.strip() != "DELETE WORKSPACE":
        raise HTTPException(
            status_code=400,
            detail="Type DELETE WORKSPACE to confirm this action",
        )

    db = SessionLocal()
    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if organization is None:
            raise HTTPException(
                status_code=404,
                detail="Workspace not found",
            )

        client_owner_prefix = f"{organization.owner_user_id}:client:"
        related_organizations = [
            candidate
            for candidate in db.query(Organization).all()
            if candidate.id == organization.id
            or candidate.owner_user_id.startswith(client_owner_prefix)
        ]
        # Delete nested client workspaces before their agency workspace. This
        # lets the final owner/member cleanup see that no child workspace is
        # still keeping the agency account alive.
        related_organizations.sort(
            key=lambda candidate: candidate.owner_user_id.count(":client:"),
            reverse=True,
        )
        summary: dict[str, int] = {}
        for related_organization in related_organizations:
            workspace_summary = delete_workspace_records(
                db,
                related_organization.owner_user_id,
                related_organization.id,
            )
            for key, value in workspace_summary.items():
                summary[key] = summary.get(key, 0) + value
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            organization_id=organization_id,
            target_user_id=organization.owner_user_id,
            action="workspace_deleted",
            details=json.dumps(summary),
        )
        db.commit()
        return PlatformAdminDeleteResponse(
            deleted=True,
            summary=summary,
        )
    finally:
        db.close()


@router.get(
    "/users",
    response_model=list[PlatformAdminUserResponse],
)
async def get_platform_admin_users(
    request: Request,
    search: str | None = None,
    limit: int = 100,
):
    auth_context = require_platform_admin(request)
    db = SessionLocal()

    try:
        clean_search = str(search or "").strip().lower()
        safe_limit = min(max(limit, 1), 200)
        organizations = db.query(Organization).all()
        organization_by_id = {
            organization.id: organization
            for organization in organizations
        }
        protected_user_ids = platform_owner_user_ids(
            db,
            auth_context.user_id,
        )
        identity_emails: dict[str, str] = {}
        for identity in (
            db.query(AuthIdentity)
            .order_by(
                AuthIdentity.last_seen_at.desc(),
                AuthIdentity.id.desc(),
            )
            .all()
        ):
            identity_email = str(identity.email or "").strip()
            if identity_email and identity.user_id not in identity_emails:
                identity_emails[identity.user_id] = identity_email
        users: dict[str, dict] = {}

        for app_user in db.query(AppUser).all():
            users[app_user.id] = {
                "email": app_user.email or identity_emails.get(app_user.id),
                "organization_names": set(),
                "roles": set(),
                "owner": False,
                "protected": app_user.id in protected_user_ids,
            }

        for organization in organizations:
            owner_record = users.setdefault(
                organization.owner_user_id,
                {
                    "organization_names": set(),
                    "roles": set(),
                    "owner": False,
                    "email": None,
                    "protected": organization.owner_user_id
                    in protected_user_ids,
                },
            )
            owner_record["organization_names"].add(organization.name)
            owner_record["roles"].add("owner")
            owner_record["owner"] = True

        for member in db.query(OrganizationMember).all():
            organization = organization_by_id.get(member.organization_id)
            if not organization:
                continue

            user_record = users.setdefault(
                member.clerk_user_id,
                {
                    "organization_names": set(),
                    "roles": set(),
                    "owner": False,
                    "email": None,
                    "protected": member.clerk_user_id
                    in protected_user_ids,
                },
            )
            user_record["organization_names"].add(organization.name)
            user_record["roles"].add(
                "owner"
                if member.clerk_user_id == organization.owner_user_id
                else member.role
            )
            if member.clerk_user_id == organization.owner_user_id:
                user_record["owner"] = True

        for admin_role in db.query(PlatformAdminRole).all():
            admin_record = users.setdefault(
                admin_role.user_id,
                {
                    "organization_names": set(),
                    "roles": set(),
                    "owner": False,
                    "email": platform_admin_user_email(
                        db,
                        admin_role.user_id,
                    ),
                    "protected": admin_role.user_id
                    in protected_user_ids,
                },
            )
            admin_record["roles"].add("platform_admin")
            admin_record["platform_admin"] = True
            admin_record["platform_admin_permissions"] = sorted(
                platform_admin_permission_set(
                    db,
                    admin_role.user_id,
                )
            )

        current_user_record = users.get(auth_context.user_id)
        if (
            current_user_record is not None and
            not current_user_record.get("email") and
            auth_context.email
        ):
            current_user_record["email"] = auth_context.email

        responses = []
        for clerk_user_id, user_record in users.items():
            if clean_search:
                searchable_values = [
                    clerk_user_id,
                    str(user_record.get("email") or ""),
                    *user_record["organization_names"],
                    *user_record["roles"],
                ]
                if not any(
                    clean_search in value.lower()
                    for value in searchable_values
                ):
                    continue

            responses.append(
                PlatformAdminUserResponse(
                    clerk_user_id=clerk_user_id,
                    email=user_record.get("email"),
                    organization_count=len(
                        user_record["organization_names"]
                    ),
                    organization_names=sorted(
                        user_record["organization_names"]
                    ),
                    roles=sorted(user_record["roles"]),
                    owner=bool(user_record["owner"]),
                    protected=bool(user_record["protected"]),
                    platform_admin=bool(
                        user_record.get("platform_admin")
                    ),
                    platform_admin_permissions=list(
                        user_record.get(
                            "platform_admin_permissions",
                            [],
                        )
                    ),
                )
            )

        return sorted(
            responses,
            key=lambda user: user.clerk_user_id.lower(),
        )[:safe_limit]
    finally:
        db.close()


@router.post(
    "/users/delete",
    response_model=PlatformAdminDeleteResponse,
)
async def delete_platform_admin_user(
    payload: PlatformAdminUserDeleteRequest,
    request: Request,
):
    auth_context = require_platform_admin(request)
    if payload.confirmation.strip() != "DELETE USER":
        raise HTTPException(
            status_code=400,
            detail="Type DELETE USER to confirm this action",
        )

    db = SessionLocal()
    try:
        target_user_id = find_internal_user_id(
            db,
            payload.user_id,
            provider=auth_context.auth_provider,
        )
        if not target_user_id:
            raise HTTPException(
                status_code=404,
                detail="User not found",
            )
        if target_user_id in platform_owner_user_ids(
            db,
            auth_context.user_id,
        ):
            raise HTTPException(
                status_code=409,
                detail="The platform owner account cannot be deleted",
            )

        target_user = (
            db.query(AppUser)
            .filter(AppUser.id == target_user_id)
            .first()
        )
        target_email = target_user.email if target_user else None
        summary = delete_internal_user_records(
            db,
            target_user_id,
        )
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            target_user_id=target_user_id,
            target_email=target_email,
            action="user_deleted",
            details=json.dumps(summary),
        )
        db.commit()
        return PlatformAdminDeleteResponse(
            deleted=True,
            summary=summary,
        )
    finally:
        db.close()


@router.post(
    "/identity-links",
    response_model=PlatformAdminIdentityLinkResponse,
)
async def link_platform_admin_identity(
    payload: PlatformAdminIdentityLinkRequest,
    request: Request,
):
    auth_context = require_platform_admin(request)
    external_user_id = str(
        auth_context.external_user_id or ""
    ).strip()
    target_reference = str(payload.target_user_id or "").strip()

    if not external_user_id:
        raise HTTPException(
            status_code=400,
            detail="The authenticated provider identity is unavailable",
        )
    if not target_reference:
        raise HTTPException(
            status_code=400,
            detail="An internal user reference is required",
        )

    db = SessionLocal()
    try:
        target_user_id = find_internal_user_id(
            db,
            target_reference,
            provider=auth_context.auth_provider,
        )
    finally:
        db.close()

    if not target_user_id:
        raise HTTPException(
            status_code=404,
            detail="Internal user not found",
        )

    linked_user_id = link_external_identity(
        external_user_id,
        target_user_id,
        email=auth_context.email,
        provider=auth_context.auth_provider,
    )

    db = SessionLocal()
    try:
        if auth_context.user_id != linked_user_id:
            current_admin_role = (
                db.query(PlatformAdminRole)
                .filter(
                    PlatformAdminRole.user_id == auth_context.user_id,
                )
                .first()
            )
            target_admin_role = (
                db.query(PlatformAdminRole)
                .filter(
                    PlatformAdminRole.user_id == linked_user_id,
                )
                .first()
            )
            if current_admin_role and target_admin_role is None:
                db.add(
                    PlatformAdminRole(
                        user_id=linked_user_id,
                        granted_by_user_id=auth_context.user_id,
                        permissions=current_admin_role.permissions,
                    )
                )
            if current_admin_role:
                db.delete(current_admin_role)

        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="identity_linked",
            target_user_id=linked_user_id,
            details=(
                f"provider={auth_context.auth_provider};"
                f"external_subject={external_user_id}"
            ),
        )
        db.commit()
    finally:
        db.close()

    return PlatformAdminIdentityLinkResponse(
        internal_user_id=linked_user_id,
    )


@router.get(
    "/organizations/{organization_id}/members",
    response_model=list[PlatformAdminMemberResponse],
)
async def get_platform_admin_organization_members(
    organization_id: int,
    request: Request,
):
    require_platform_admin(request)
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        members = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == organization.id,
            )
            .order_by(
                OrganizationMember.created_at.asc(),
                OrganizationMember.id.asc(),
            )
            .all()
        )

        member_responses = []
        owner_member = next(
            (
                member
                for member in members
                if member.clerk_user_id == organization.owner_user_id
            ),
            None,
        )

        if owner_member is None:
            member_responses.append(
                PlatformAdminMemberResponse(
                    id=0,
                    clerk_user_id=organization.owner_user_id,
                    email=platform_admin_user_email(
                        db,
                        organization.owner_user_id,
                    ),
                    role="owner",
                    created_at=(
                        organization.created_at.isoformat()
                        if organization.created_at
                        else None
                    ),
                )
            )

        for member in members:
            member_responses.append(
                PlatformAdminMemberResponse(
                    id=member.id,
                    clerk_user_id=member.clerk_user_id,
                    email=platform_admin_user_email(
                        db,
                        member.clerk_user_id,
                    ),
                    role=(
                        "owner"
                        if member.clerk_user_id == organization.owner_user_id
                        else member.role
                    ),
                    created_at=(
                        member.created_at.isoformat()
                        if member.created_at
                        else None
                    ),
                )
            )

        return member_responses
    finally:
        db.close()


def clean_platform_admin_member_role(role: str) -> str:
    clean_role = str(role or "").strip().lower()
    if clean_role not in {"member", "client"}:
        raise HTTPException(
            status_code=400,
            detail="Member role must be member or client",
        )

    return clean_role


def clean_platform_admin_invite_email(email: str) -> str:
    clean_email = str(email or "").strip().lower()
    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        clean_email,
    ):
        raise HTTPException(
            status_code=400,
            detail="Invite email must be valid",
        )

    return clean_email


def serialize_platform_admin_invite(invite):
    return PlatformAdminInviteResponse(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        created_at=(
            invite.created_at.isoformat()
            if invite.created_at
            else None
        ),
    )


def record_platform_admin_audit(
    db,
    *,
    admin_user_id: str,
    action: str,
    organization_id: int | None = None,
    target_user_id: str | None = None,
    target_email: str | None = None,
    details: str | None = None,
):
    db.add(
        PlatformAdminAuditEvent(
            admin_user_id=admin_user_id,
            organization_id=organization_id,
            target_user_id=target_user_id,
            target_email=target_email,
            action=action,
            details=details,
        )
    )


def platform_owner_user_ids(
    db,
    current_user_id: str | None = None,
) -> set[str]:
    protected_ids = {
        str(current_user_id or "").strip()
    } - {""}

    for configured_reference in configured_platform_admin_references():
        internal_user_id = find_internal_user_id(
            db,
            configured_reference,
        )
        if internal_user_id:
            protected_ids.add(internal_user_id)

    return protected_ids


def remove_dataset_file_for_admin(
    file_path: str | None,
):
    if not file_path or file_path == "manual_upload":
        return

    try:
        get_object_storage().delete(file_path)
    except OSError:
        # A missing or externally managed source file should not prevent
        # deletion of its database record.
        return


def delete_workspace_records(
    db,
    workspace_id: str,
    organization_id: int | None = None,
) -> dict[str, int]:
    clean_workspace_id = str(workspace_id or "").strip()
    summary = {
        "workspaces": 1 if organization_id is not None else 0,
        "users": 0,
        "users_deleted": 0,
        "datasets": 0,
        "decisions": 0,
        "connections": 0,
        "join_caches": 0,
        "relationships": 0,
    }

    if organization_id is not None:
        member_user_ids = {
            member.clerk_user_id
            for member in db.query(OrganizationMember).filter(
                OrganizationMember.organization_id == organization_id
            ).all()
        }
        # Legacy workspaces may not have an explicit owner membership row.
        # Include the owner so their internal account is cleaned up when it
        # belongs only to this workspace.
        member_user_ids.add(
            clean_workspace_id,
        )
        summary["users"] = len(member_user_ids)

    datasets = (
        db.query(Dataset)
        .filter(
            or_(
                Dataset.workspace_id == clean_workspace_id,
                and_(
                    Dataset.workspace_id.is_(None),
                    Dataset.user_id == clean_workspace_id,
                ),
            )
        )
        .all()
    )
    dataset_ids = [dataset.id for dataset in datasets]
    for dataset in datasets:
        remove_dataset_file_for_admin(dataset.file_path)

    if dataset_ids:
        db.query(DashboardShare).filter(
            DashboardShare.dataset_id.in_(dataset_ids)
        ).delete(synchronize_session=False)

    decisions = (
        db.query(Decision)
        .filter(
            or_(
                Decision.workspace_id == clean_workspace_id,
                and_(
                    Decision.workspace_id.is_(None),
                    Decision.clerk_user_id == clean_workspace_id,
                ),
            )
        )
        .all()
    )
    decision_ids = [decision.id for decision in decisions]
    decision_activity_filter = or_(
        DecisionActivity.workspace_id == clean_workspace_id,
        and_(
            DecisionActivity.workspace_id.is_(None),
            DecisionActivity.actor_user_id == clean_workspace_id,
        ),
    )
    if decision_ids:
        decision_activity_filter = or_(
            decision_activity_filter,
            DecisionActivity.decision_id.in_(decision_ids),
        )
    db.query(DecisionActivity).filter(
        decision_activity_filter
    ).delete(synchronize_session=False)

    summary["datasets"] = len(datasets)
    summary["decisions"] = len(decisions)
    if decision_ids:
        db.query(Decision).filter(
            Decision.id.in_(decision_ids)
        ).delete(synchronize_session=False)
    if dataset_ids:
        db.query(Dataset).filter(
            Dataset.id.in_(dataset_ids)
        ).delete(synchronize_session=False)

    join_cache_filter = or_(
        DatasetJoinCache.workspace_id == clean_workspace_id,
        and_(
            DatasetJoinCache.workspace_id.is_(None),
            DatasetJoinCache.user_id == clean_workspace_id,
        ),
    )
    relationship_filter = or_(
        DatasetRelationship.workspace_id == clean_workspace_id,
        and_(
            DatasetRelationship.workspace_id.is_(None),
            DatasetRelationship.user_id == clean_workspace_id,
        ),
    )
    summary["join_caches"] = db.query(DatasetJoinCache).filter(
        join_cache_filter
    ).delete(synchronize_session=False)
    summary["relationships"] = db.query(DatasetRelationship).filter(
        relationship_filter
    ).delete(synchronize_session=False)

    connection_filters = (
        db.query(DataSourceConnection)
        .filter(
            or_(
                DataSourceConnection.workspace_id == clean_workspace_id,
                and_(
                    DataSourceConnection.workspace_id.is_(None),
                    DataSourceConnection.user_id == clean_workspace_id,
                ),
            )
        )
        .all()
    )
    connection_ids = [connection.id for connection in connection_filters]
    summary["connections"] = len(connection_filters)
    if connection_ids:
        db.query(OAuthConnectionState).filter(
            OAuthConnectionState.connection_id.in_(connection_ids)
        ).delete(synchronize_session=False)
        db.query(OAuthCredential).filter(
            OAuthCredential.connection_id.in_(connection_ids)
        ).delete(synchronize_session=False)
    db.query(DataSourceConnection).filter(
        or_(
            DataSourceConnection.workspace_id == clean_workspace_id,
            and_(
                DataSourceConnection.workspace_id.is_(None),
                DataSourceConnection.user_id == clean_workspace_id,
            ),
        )
    ).delete(synchronize_session=False)

    for model in (
        OAuthConnectionState,
        OAuthCredential,
        WorkspaceSubscription,
        AIUsageEvent,
        UsageActivityEvent,
        WeeklyReportPreference,
        WeeklyReportDeliveryLog,
    ):
        if model in (OAuthConnectionState, OAuthCredential):
            db.query(model).filter(
                model.workspace_id == clean_workspace_id
            ).delete(synchronize_session=False)
        else:
            db.query(model).filter(
                model.workspace_id == clean_workspace_id
            ).delete(synchronize_session=False)

    db.query(UserPreference).filter(
        or_(
            UserPreference.workspace_id == clean_workspace_id,
            UserPreference.clerk_user_id == clean_workspace_id,
        )
    ).delete(synchronize_session=False)

    if organization_id is not None:
        db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == organization_id
        ).delete(synchronize_session=False)
        db.query(OrganizationInvite).filter(
            OrganizationInvite.organization_id == organization_id
        ).delete(synchronize_session=False)
        db.query(Organization).filter(
            Organization.id == organization_id
        ).delete(synchronize_session=False)

        for member_user_id in member_user_ids:
            still_has_membership = (
                db.query(OrganizationMember)
                .filter(
                    OrganizationMember.clerk_user_id == member_user_id
                )
                .first()
                is not None
            )
            still_owns_workspace = (
                db.query(Organization)
                .filter(
                    Organization.owner_user_id == member_user_id
                )
                .first()
                is not None
            )
            is_platform_admin = (
                db.query(PlatformAdminRole)
                .filter(
                    PlatformAdminRole.user_id == member_user_id
                )
                .first()
                is not None
            )

            if (
                still_has_membership
                or still_owns_workspace
                or is_platform_admin
            ):
                continue

            db.query(AuthIdentity).filter(
                AuthIdentity.user_id == member_user_id
            ).delete(synchronize_session=False)
            db.query(AppUser).filter(
                AppUser.id == member_user_id
            ).delete(synchronize_session=False)
            summary["users_deleted"] += 1

    return summary


def delete_internal_user_records(
    db,
    user_id: str,
) -> dict[str, int]:
    summary = {
        "workspaces": 0,
        "users": 0,
        "users_deleted": 0,
        "datasets": 0,
        "decisions": 0,
        "connections": 0,
        "join_caches": 0,
        "relationships": 0,
    }
    owned_organizations = (
        db.query(Organization)
        .filter(
            or_(
                Organization.owner_user_id == user_id,
                Organization.owner_user_id.like(f"{user_id}:client:%"),
            )
        )
        .all()
    )
    for organization in owned_organizations:
        workspace_summary = delete_workspace_records(
            db,
            organization.owner_user_id,
            organization.id,
        )
        for key, value in workspace_summary.items():
            summary[key] += value

    personal_summary = delete_workspace_records(
        db,
        user_id,
    )
    for key, value in personal_summary.items():
        summary[key] += value

    db.query(OrganizationMember).filter(
        OrganizationMember.clerk_user_id == user_id
    ).delete(synchronize_session=False)
    db.query(AuthIdentity).filter(
        AuthIdentity.user_id == user_id
    ).delete(synchronize_session=False)
    db.query(PlatformAdminRole).filter(
        PlatformAdminRole.user_id == user_id
    ).delete(synchronize_session=False)
    db.query(AppUser).filter(
        AppUser.id == user_id
    ).delete(synchronize_session=False)
    summary["users"] = 1
    return summary


def parse_platform_admin_recipients(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []

    return [
        recipient
        for recipient in parsed
        if isinstance(recipient, str)
    ]


@router.get(
    "/audit-events",
    response_model=list[PlatformAdminAuditEventResponse],
)
async def get_platform_admin_audit_events(
    request: Request,
    limit: int = 100,
):
    require_platform_admin(request)
    db = SessionLocal()

    try:
        safe_limit = None if limit <= 0 else min(limit, 5000)
        event_query = (
            db.query(PlatformAdminAuditEvent)
            .order_by(
                PlatformAdminAuditEvent.created_at.desc(),
                PlatformAdminAuditEvent.id.desc(),
            )
        )
        events = (
            event_query.all()
            if safe_limit is None
            else event_query.limit(safe_limit).all()
        )
        return [
            PlatformAdminAuditEventResponse(
                id=event.id,
                admin_user_id=event.admin_user_id,
                organization_id=event.organization_id,
                target_user_id=event.target_user_id,
                target_email=event.target_email,
                action=event.action,
                details=event.details,
                created_at=(
                    event.created_at.isoformat()
                    if event.created_at
                    else None
                ),
            )
            for event in events
        ]
    finally:
        db.close()


@router.get(
    "/alert-deliveries",
    response_model=list[PlatformAdminAlertDeliveryResponse],
)
async def get_platform_admin_alert_deliveries(
    request: Request,
    status: str | None = None,
    limit: int = 50,
):
    require_platform_admin(request)
    allowed_statuses = {
        "sent",
        "test_sent",
        "failed",
        "test_failed",
        "skipped",
    }
    clean_status = str(status or "").strip().lower()
    if clean_status and clean_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Unsupported alert delivery status",
        )

    db = SessionLocal()

    try:
        safe_limit = None if limit <= 0 else min(limit, 5000)
        query = db.query(WeeklyReportDeliveryLog)
        if clean_status:
            query = query.filter(
                WeeklyReportDeliveryLog.status == clean_status
            )

        log_query = (
            query.order_by(
                WeeklyReportDeliveryLog.attempted_at.desc(),
                WeeklyReportDeliveryLog.id.desc(),
            )
        )
        logs = (
            log_query.all()
            if safe_limit is None
            else log_query.limit(safe_limit).all()
        )
        organizations = {
            organization.owner_user_id: organization.name
            for organization in db.query(Organization).all()
        }

        return [
            PlatformAdminAlertDeliveryResponse(
                id=log.id,
                workspace_id=log.workspace_id,
                organization_name=organizations.get(log.workspace_id),
                status=log.status,
                recipients=parse_platform_admin_recipients(
                    log.recipient_emails
                ),
                subject=log.subject or "",
                delivered_count=log.delivered_count or 0,
                metrics_count=log.metrics_count or 0,
                error=log.error,
                attempted_at=(
                    log.attempted_at.isoformat()
                    if log.attempted_at
                    else None
                ),
            )
            for log in logs
        ]
    finally:
        db.close()


@router.get(
    "/usage-activity",
    response_model=PlatformAdminUsageResponse,
)
async def get_platform_admin_usage_activity(
    request: Request,
    days: int = 30,
    workspace_id: str | None = None,
    actor_user_id: str | None = None,
    limit: int = 200,
):
    require_platform_admin(request)
    safe_days = min(max(days, 1), 3650)
    safe_limit = None if limit <= 0 else min(limit, 5000)
    period_end = utc_now()
    period_start = period_end - timedelta(days=safe_days)
    filters = [
        UsageActivityEvent.created_at >= period_start,
    ]

    clean_workspace_id = str(workspace_id or "").strip()
    if clean_workspace_id:
        filters.append(
            UsageActivityEvent.workspace_id == clean_workspace_id,
        )

    clean_actor_user_id = str(actor_user_id or "").strip()
    if clean_actor_user_id:
        filters.append(
            UsageActivityEvent.actor_user_id == clean_actor_user_id,
        )

    db = SessionLocal()
    try:
        total_events = (
            db.query(func.count(UsageActivityEvent.id))
            .filter(*filters)
            .scalar()
            or 0
        )
        successful_events = (
            db.query(func.count(UsageActivityEvent.id))
            .filter(
                *filters,
                UsageActivityEvent.status_code < 400,
            )
            .scalar()
            or 0
        )
        failed_events = (
            db.query(func.count(UsageActivityEvent.id))
            .filter(
                *filters,
                UsageActivityEvent.status_code >= 400,
            )
            .scalar()
            or 0
        )
        active_users = (
            db.query(func.count(func.distinct(UsageActivityEvent.actor_user_id)))
            .filter(*filters)
            .scalar()
            or 0
        )
        active_workspaces = (
            db.query(func.count(func.distinct(UsageActivityEvent.workspace_id)))
            .filter(*filters)
            .scalar()
            or 0
        )
        average_duration = (
            db.query(func.avg(UsageActivityEvent.duration_ms))
            .filter(*filters)
            .scalar()
        )
        ai_filters = [
            AIUsageEvent.created_at >= period_start,
            AIUsageEvent.status == "completed",
        ]
        if clean_workspace_id:
            ai_filters.append(
                AIUsageEvent.workspace_id == clean_workspace_id,
            )
        if clean_actor_user_id:
            ai_filters.append(
                AIUsageEvent.actor_user_id == clean_actor_user_id,
            )
        ai_requests = (
            db.query(func.count(AIUsageEvent.id))
            .filter(*ai_filters)
            .scalar()
            or 0
        )
        ai_tokens = (
            db.query(func.coalesce(func.sum(AIUsageEvent.total_tokens), 0))
            .filter(*ai_filters)
            .scalar()
            or 0
        )
        ai_credits = (
            db.query(func.coalesce(func.sum(AIUsageEvent.credits), 0))
            .filter(*ai_filters)
            .scalar()
            or 0
        )

        organizations = {
            organization.owner_user_id: organization.name
            for organization in db.query(Organization).all()
        }
        subscriptions = {
            subscription.workspace_id: subscription.plan
            for subscription in db.query(WorkspaceSubscription).all()
        }
        ai_credit_rows = (
            db.query(
                AIUsageEvent.workspace_id,
                AIUsageEvent.actor_user_id,
                func.count(AIUsageEvent.id),
                func.coalesce(func.sum(AIUsageEvent.credits), 0),
            )
            .filter(*ai_filters)
            .group_by(
                AIUsageEvent.workspace_id,
                AIUsageEvent.actor_user_id,
            )
            .all()
        )

        segment_order = (
            "Professional",
            "Agency",
            "Agency client",
            "Free",
        )
        segment_totals = {
            segment: {
                "credits": 0,
                "requests": 0,
                "active_users": set(),
                "workspaces": set(),
            }
            for segment in segment_order
        }
        user_totals = {}
        workspace_totals = {}

        for (
            usage_workspace_id,
            usage_actor_user_id,
            request_count,
            credit_total,
        ) in ai_credit_rows:
            clean_usage_workspace_id = str(
                usage_workspace_id or ""
            ).strip()
            if not clean_usage_workspace_id:
                continue

            if ":client:" in clean_usage_workspace_id:
                segment = "Agency client"
            else:
                normalized_plan = normalize_billing_plan(
                    subscriptions.get(clean_usage_workspace_id)
                )
                if normalized_plan == PROFESSIONAL_PLAN:
                    segment = "Professional"
                elif normalized_plan == AGENCY_PLAN:
                    segment = "Agency"
                else:
                    segment = "Free"

            request_count = int(request_count or 0)
            credit_total = int(credit_total or 0)
            segment_total = segment_totals[segment]
            segment_total["credits"] += credit_total
            segment_total["requests"] += request_count
            segment_total["workspaces"].add(clean_usage_workspace_id)

            clean_actor_user_id = str(
                usage_actor_user_id or ""
            ).strip()
            if clean_actor_user_id:
                segment_total["active_users"].add(
                    clean_actor_user_id
                )

            workspace_total = workspace_totals.setdefault(
                clean_usage_workspace_id,
                {
                    "organization_name": organizations.get(
                        clean_usage_workspace_id
                    ),
                    "segment": segment,
                    "credits": 0,
                    "requests": 0,
                    "active_users": set(),
                },
            )
            workspace_total["credits"] += credit_total
            workspace_total["requests"] += request_count
            if clean_actor_user_id:
                workspace_total["active_users"].add(
                    clean_actor_user_id
                )

            user_key = clean_actor_user_id or clean_usage_workspace_id
            user_total = user_totals.setdefault(
                (user_key, segment),
                {
                    "credits": 0,
                    "requests": 0,
                    "workspaces": set(),
                    "attributed": bool(clean_actor_user_id),
                },
            )
            user_total["credits"] += credit_total
            user_total["requests"] += request_count
            user_total["workspaces"].add(clean_usage_workspace_id)

        ai_credit_segment_responses = [
            PlatformAdminAICreditSegmentResponse(
                segment=segment,
                credits=segment_totals[segment]["credits"],
                requests=segment_totals[segment]["requests"],
                active_users=len(
                    segment_totals[segment]["active_users"]
                ),
                workspaces=len(
                    segment_totals[segment]["workspaces"]
                ),
            )
            for segment in segment_order
        ]
        ai_credit_user_responses = [
            PlatformAdminAICreditUserResponse(
                user_id=user_id,
                segment=segment,
                credits=values["credits"],
                requests=values["requests"],
                workspaces=len(values["workspaces"]),
                attributed=values["attributed"],
            )
            for (user_id, segment), values in sorted(
                user_totals.items(),
                key=lambda item: item[1]["credits"],
                reverse=True,
            )[:50]
        ]
        ai_credit_workspace_responses = [
            PlatformAdminAICreditWorkspaceResponse(
                workspace_id=workspace_id,
                organization_name=values["organization_name"],
                segment=values["segment"],
                credits=values["credits"],
                requests=values["requests"],
                active_users=len(values["active_users"]),
            )
            for workspace_id, values in sorted(
                workspace_totals.items(),
                key=lambda item: item[1]["credits"],
                reverse=True,
            )[:50]
        ]

        route_rows = (
            db.query(
                UsageActivityEvent.route,
                UsageActivityEvent.method,
                func.count(UsageActivityEvent.id),
                func.sum(
                    case(
                        (UsageActivityEvent.status_code < 400, 1),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (UsageActivityEvent.status_code >= 400, 1),
                        else_=0,
                    )
                ),
            )
            .filter(*filters)
            .group_by(
                UsageActivityEvent.route,
                UsageActivityEvent.method,
            )
            .order_by(
                func.count(UsageActivityEvent.id).desc(),
                UsageActivityEvent.route.asc(),
            )
            .limit(20)
            .all()
        )
        recent_event_query = (
            db.query(UsageActivityEvent)
            .filter(*filters)
            .order_by(
                UsageActivityEvent.created_at.desc(),
                UsageActivityEvent.id.desc(),
            )
        )
        recent_events = (
            recent_event_query.all()
            if safe_limit is None
            else recent_event_query.limit(safe_limit).all()
        )

        return PlatformAdminUsageResponse(
            period_days=safe_days,
            period_start=period_start.isoformat(),
            period_end=period_end.isoformat(),
            total_events=total_events,
            successful_events=successful_events,
            failed_events=failed_events,
            active_users=active_users,
            active_workspaces=active_workspaces,
            average_duration_ms=round(average_duration or 0),
            ai_requests=int(ai_requests),
            ai_tokens=int(ai_tokens),
            ai_credits=int(ai_credits),
            ai_credit_segments=ai_credit_segment_responses,
            ai_credit_users=ai_credit_user_responses,
            ai_credit_workspaces=ai_credit_workspace_responses,
            top_routes=[
                PlatformAdminUsageRouteResponse(
                    route=str(route),
                    method=str(method),
                    event_count=int(event_count or 0),
                    successful_count=int(successful_count or 0),
                    failed_count=int(failed_count or 0),
                )
                for (
                    route,
                    method,
                    event_count,
                    successful_count,
                    failed_count,
                ) in route_rows
            ],
            recent_events=[
                PlatformAdminUsageEventResponse(
                    id=event.id,
                    actor_user_id=event.actor_user_id,
                    workspace_id=event.workspace_id,
                    organization_name=organizations.get(
                        event.workspace_id
                    ),
                    route=event.route,
                    method=event.method,
                    status_code=event.status_code,
                    duration_ms=event.duration_ms,
                    created_at=(
                        event.created_at.isoformat()
                        if event.created_at
                        else None
                    ),
                )
                for event in recent_events
            ],
        )
    finally:
        db.close()


@router.get(
    "/organizations/{organization_id}/invites",
    response_model=list[PlatformAdminInviteResponse],
)
async def get_platform_admin_organization_invites(
    organization_id: int,
    request: Request,
):
    require_platform_admin(request)
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        invites = (
            db.query(OrganizationInvite)
            .filter(
                OrganizationInvite.organization_id == organization.id,
                OrganizationInvite.status == "pending",
            )
            .order_by(
                OrganizationInvite.created_at.asc(),
                OrganizationInvite.id.asc(),
            )
            .all()
        )
        return [
            serialize_platform_admin_invite(invite)
            for invite in invites
        ]
    finally:
        db.close()


@router.post(
    "/organizations/{organization_id}/invites",
    response_model=PlatformAdminInviteResponse,
)
async def add_platform_admin_organization_invite(
    organization_id: int,
    payload: PlatformAdminInviteCreate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        email = clean_platform_admin_invite_email(payload.email)
        role = clean_platform_admin_member_role(payload.role)
        existing_invite = (
            db.query(OrganizationInvite)
            .filter(
                OrganizationInvite.organization_id == organization.id,
                OrganizationInvite.email == email,
            )
            .first()
        )

        if existing_invite:
            existing_invite.role = role
            existing_invite.status = "pending"
            record_platform_admin_audit(
                db,
                admin_user_id=auth_context.user_id,
                action="invite_updated",
                organization_id=organization.id,
                target_email=email,
                details=f"role={role}",
            )
            db.commit()
            db.refresh(existing_invite)
            return serialize_platform_admin_invite(existing_invite)

        invite = OrganizationInvite(
            organization_id=organization.id,
            email=email,
            role=role,
            status="pending",
        )
        db.add(invite)
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="invite_created",
            organization_id=organization.id,
            target_email=email,
            details=f"role={role}",
        )
        db.commit()
        db.refresh(invite)
        return serialize_platform_admin_invite(invite)
    finally:
        db.close()


@router.delete(
    "/organizations/{organization_id}/invites/{invite_id}",
)
async def remove_platform_admin_organization_invite(
    organization_id: int,
    invite_id: int,
    request: Request,
):
    auth_context = require_platform_admin(request)
    db = SessionLocal()

    try:
        invite = (
            db.query(OrganizationInvite)
            .filter(
                OrganizationInvite.id == invite_id,
                OrganizationInvite.organization_id == organization_id,
                OrganizationInvite.status == "pending",
            )
            .first()
        )
        if not invite:
            raise HTTPException(
                status_code=404,
                detail="Pending invite not found",
            )

        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="invite_cancelled",
            organization_id=organization_id,
            target_email=invite.email,
        )
        db.delete(invite)
        db.commit()
        return {"removed": True}
    finally:
        db.close()


@router.post(
    "/organizations/{organization_id}/members",
    response_model=PlatformAdminMemberResponse,
)
async def add_platform_admin_member(
    organization_id: int,
    payload: PlatformAdminMemberCreate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        member_reference = str(payload.clerk_user_id or "").strip()
        if not member_reference:
            raise HTTPException(
                status_code=400,
                detail="Clerk user id is required",
            )
        try:
            member_user_id = resolve_user_reference(
                member_reference,
            )
        except ValueError as error:
            raise HTTPException(
                status_code=400,
                detail=str(error),
            ) from error
        if member_user_id == organization.owner_user_id:
            raise HTTPException(
                status_code=400,
                detail="The workspace owner is already a protected member",
            )

        existing_member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == organization.id,
                OrganizationMember.clerk_user_id == member_user_id,
            )
            .first()
        )
        if existing_member:
            raise HTTPException(
                status_code=409,
                detail="User is already a member of this workspace",
            )

        role = clean_platform_admin_member_role(payload.role)
        member = OrganizationMember(
            organization_id=organization.id,
            clerk_user_id=member_user_id,
            role=role,
        )
        db.add(member)
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="member_added",
            organization_id=organization.id,
            target_user_id=member_user_id,
            details=f"role={role}",
        )
        db.commit()
        db.refresh(member)

        return PlatformAdminMemberResponse(
            id=member.id,
            clerk_user_id=member.clerk_user_id,
            email=platform_admin_user_email(
                db,
                member.clerk_user_id,
            ),
            role=member.role,
            created_at=(
                member.created_at.isoformat()
                if member.created_at
                else None
            ),
        )
    finally:
        db.close()


@router.patch(
    "/organizations/{organization_id}/members/{member_id}",
    response_model=PlatformAdminMemberResponse,
)
async def update_platform_admin_member_role(
    organization_id: int,
    member_id: int,
    payload: PlatformAdminMemberRoleUpdate,
    request: Request,
):
    auth_context = require_platform_admin(request)
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.id == member_id,
                OrganizationMember.organization_id == organization.id,
            )
            .first()
        )
        if not member:
            raise HTTPException(
                status_code=404,
                detail="Organization member not found",
            )
        if member.clerk_user_id == organization.owner_user_id:
            raise HTTPException(
                status_code=400,
                detail="The workspace owner role cannot be changed",
            )

        role = clean_platform_admin_member_role(payload.role)
        member.role = role
        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="member_role_updated",
            organization_id=organization.id,
            target_user_id=member.clerk_user_id,
            details=f"role={role}",
        )
        db.commit()
        db.refresh(member)

        return PlatformAdminMemberResponse(
            id=member.id,
            clerk_user_id=member.clerk_user_id,
            email=platform_admin_user_email(
                db,
                member.clerk_user_id,
            ),
            role=member.role,
            created_at=(
                member.created_at.isoformat()
                if member.created_at
                else None
            ),
        )
    finally:
        db.close()


@router.delete(
    "/organizations/{organization_id}/members/{member_id}",
)
async def remove_platform_admin_member(
    organization_id: int,
    member_id: int,
    request: Request,
):
    auth_context = require_platform_admin(request)
    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(Organization.id == organization_id)
            .first()
        )
        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.id == member_id,
                OrganizationMember.organization_id == organization.id,
            )
            .first()
        )
        if not member:
            raise HTTPException(
                status_code=404,
                detail="Organization member not found",
            )
        if member.clerk_user_id == organization.owner_user_id:
            raise HTTPException(
                status_code=400,
                detail="The workspace owner cannot be removed",
            )

        record_platform_admin_audit(
            db,
            admin_user_id=auth_context.user_id,
            action="member_removed",
            organization_id=organization.id,
            target_user_id=member.clerk_user_id,
        )
        db.delete(member)
        db.commit()
        return {"removed": True}
    finally:
        db.close()
