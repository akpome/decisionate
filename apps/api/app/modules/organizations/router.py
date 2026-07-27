import json
import math
import re

from fastapi import APIRouter, HTTPException, Request

from app.db.database import SessionLocal
from app.db.models import (
    Organization,
    OrganizationInvite,
    OrganizationMember,
    UserPreference,
)
from app.modules.auth_context import (
    get_auth_context,
)

from app.modules.organizations.schemas import (
    OrganizationCreate,
    OrganizationInviteCreate,
    OrganizationInviteResponse,
    OrganizationMemberCreate,
    OrganizationMemberResponse,
    OrganizationMemberRoleUpdate,
    OrganizationWorkspaceResponse,
    OrganizationUpdate,
    DashboardPreferenceUpdate,
    DashboardPreferenceResponse,
    DatasetPreferenceUpdate,
    DatasetPreferenceResponse,
)

router = APIRouter()
MAX_DASHBOARD_TITLE_LENGTH = 120
MAX_DASHBOARD_SUBTITLE_LENGTH = 220
MAX_DASHBOARD_CHART_TITLE_LENGTH = 80
DEFAULT_SELECTED_DASHBOARD = "general-business"
VALID_SELECTED_DASHBOARDS = {
    DEFAULT_SELECTED_DASHBOARD,
    "marketing-performance",
    "sales-performance",
    "decision-performance",
    "retail-performance",
    "restaurant-performance",
    "professional-services",
    "healthcare-practice",
    "real-estate",
    "nonprofit-performance",
}
DATASET_METRIC_MAPPING_DASHBOARDS = VALID_SELECTED_DASHBOARDS - {
    DEFAULT_SELECTED_DASHBOARD,
    "decision-performance",
}
DASHBOARD_CHART_TITLE_KEYS = {
    "trend",
    "mix",
    "operations",
    "outcome",
}


def find_user_preference(
    db,
    user_id: str,
    workspace_id: str,
):
    preference = find_exact_user_preference(
        db,
        user_id,
        workspace_id,
    )

    if preference:
        return preference

    return (
        db.query(UserPreference)
        .filter(
            UserPreference.clerk_user_id == user_id,
            UserPreference.workspace_id.is_(None),
        )
        .first()
    )


def find_exact_user_preference(
    db,
    user_id: str,
    workspace_id: str,
):
    if workspace_id:
        return (
            db.query(UserPreference)
            .filter(
                UserPreference.clerk_user_id == user_id,
                UserPreference.workspace_id == workspace_id,
            )
            .first()
        )

    return (
        db.query(UserPreference)
        .filter(
            UserPreference.clerk_user_id == user_id,
            UserPreference.workspace_id.is_(None),
        )
        .first()
    )


def parse_preference_json_object(
    value: str | None,
):
    if not value:
        return None

    if isinstance(
        value,
        dict,
    ):
        return value

    if not isinstance(
        value,
        str,
    ):
        return None

    try:
        parsed_value = json.loads(
            value
        )
    except json.JSONDecodeError:
        return None

    if isinstance(
        parsed_value,
        dict,
    ):
        return parsed_value

    return None


def clean_optional_selected_metric(
    value: str | None,
) -> str | None:
    if value is None:
        return None

    if not isinstance(
        value,
        str,
    ):
        return None

    clean_value = value.strip()

    return clean_value or None


def clean_preference_dataset_id(
    dataset_id: int,
) -> int:
    if (
        isinstance(
            dataset_id,
            bool,
        )
        or not isinstance(
            dataset_id,
            int,
        )
        or dataset_id <= 0
    ):
        raise HTTPException(
            status_code=400,
            detail="Dataset id must be a positive integer",
        )

    return dataset_id


def clean_preference_dataset_key(
    dataset_key: str,
) -> str | None:
    try:
        dataset_id = int(
            str(dataset_key).strip()
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    if dataset_id <= 0:
        return None

    return str(dataset_id)


def is_dashboard_start_date(
    value: str,
) -> bool:
    return re.fullmatch(
        r"\d{4}-\d{2}-\d{2}",
        value,
    ) is not None


def clean_metric_targets(
    metric_targets: dict[str, dict[str, float]] | None,
):
    if metric_targets is None:
        return None

    clean_targets = {}

    for dataset_key, targets in metric_targets.items():
        clean_dataset_key = clean_preference_dataset_key(
            dataset_key
        )

        if not clean_dataset_key or not isinstance(
            targets,
            dict,
        ):
            continue

        clean_dataset_targets = {}

        for metric, value in targets.items():
            clean_metric = str(metric).strip()

            if not clean_metric:
                continue

            try:
                numeric_value = float(value)
            except (
                TypeError,
                ValueError,
                OverflowError,
            ):
                continue

            if math.isfinite(numeric_value):
                clean_dataset_targets[clean_metric] = numeric_value

        clean_targets[clean_dataset_key] = clean_dataset_targets

    return clean_targets or None


def clean_dashboard_preferences(
    dashboard_preferences: dict[str, dict] | None,
):
    if dashboard_preferences is None:
        return None

    clean_preferences = {}

    for dataset_key, preference in dashboard_preferences.items():
        clean_dataset_key = clean_preference_dataset_key(
            dataset_key
        )

        if not clean_dataset_key or not isinstance(
            preference,
            dict,
        ):
            continue

        clean_preference = {}
        title = clean_dashboard_preference_text(
            preference.get("title"),
            MAX_DASHBOARD_TITLE_LENGTH,
        )
        subtitle = clean_dashboard_preference_text(
            preference.get("subtitle"),
            MAX_DASHBOARD_SUBTITLE_LENGTH,
        )

        if title:
            clean_preference["title"] = title

        if subtitle:
            clean_preference["subtitle"] = subtitle

        selected_metrics = preference.get(
            "selectedMetrics"
        )

        if isinstance(selected_metrics, list):
            clean_metrics = list(
                dict.fromkeys(
                    metric.strip()
                    for metric in selected_metrics
                    if isinstance(metric, str)
                    and metric.strip()
                )
            )

            if clean_metrics:
                clean_preference["selectedMetrics"] = clean_metrics

        controlled_fields = {
            "aggregation": {
                "daily",
                "weekly",
                "quarterly",
                "monthly",
            },
            "chartType": {
                "line",
                "bar",
                "area",
            },
            "scaleMode": {
                "actual",
                "indexed",
            },
            "periodFilter": {
                "1m",
                "1q",
                "6m",
                "1y",
                "2y",
                "3y",
                "5y",
                "all",
            },
            "dashboardTemplate": {
                "executive",
                "performance",
                "comparison",
            },
        }

        for key, allowed_values in controlled_fields.items():
            value = preference.get(key)

            if (
                isinstance(value, str)
                and value.strip() in allowed_values
            ):
                clean_preference[key] = value.strip()

        start_date = preference.get("startDate")

        if isinstance(start_date, str):
            clean_start_date = start_date.strip()

            if is_dashboard_start_date(
                clean_start_date
            ):
                clean_preference["startDate"] = clean_start_date

        metric_mappings = preference.get(
            "metricMappings"
        )

        if isinstance(metric_mappings, dict):
            clean_mappings = {}

            for dashboard_key, mapping in metric_mappings.items():
                if not isinstance(dashboard_key, str) or not isinstance(
                    mapping,
                    dict,
                ):
                    continue

                clean_dashboard_key = dashboard_key.strip()

                if (
                    clean_dashboard_key
                    not in DATASET_METRIC_MAPPING_DASHBOARDS
                ):
                    continue

                clean_mapping = clean_dashboard_metric_mapping(
                    mapping
                )

                if clean_mapping:
                    clean_mappings[clean_dashboard_key] = clean_mapping

            if clean_mappings:
                clean_preference["metricMappings"] = clean_mappings

        chart_titles = preference.get(
            "chartTitles"
        )

        if isinstance(chart_titles, dict):
            clean_chart_titles = {}

            for dashboard_key, titles in chart_titles.items():
                if not isinstance(dashboard_key, str) or not isinstance(
                    titles,
                    dict,
                ):
                    continue

                clean_dashboard_key = dashboard_key.strip()

                if (
                    clean_dashboard_key not in VALID_SELECTED_DASHBOARDS
                    or clean_dashboard_key == DEFAULT_SELECTED_DASHBOARD
                ):
                    continue

                clean_titles = {}

                for title_key in DASHBOARD_CHART_TITLE_KEYS:
                    clean_title = clean_dashboard_preference_text(
                        titles.get(title_key),
                        MAX_DASHBOARD_CHART_TITLE_LENGTH,
                    )

                    if clean_title:
                        clean_titles[title_key] = clean_title

                if clean_titles:
                    clean_chart_titles[clean_dashboard_key] = clean_titles

            if clean_chart_titles:
                clean_preference["chartTitles"] = clean_chart_titles

        clean_preferences[clean_dataset_key] = clean_preference

    return clean_preferences or None


def clean_dashboard_metric_mapping(
    mapping: dict,
):
    clean_mapping = {}

    for key in (
        "primary",
        "category",
        "stage",
        "date",
    ):
        value = mapping.get(key)

        if isinstance(value, str) and value.strip():
            clean_mapping[key] = value.strip()[:120]

    return clean_mapping


def clean_dashboard_preference_text(
    value,
    max_length: int,
):
    if not isinstance(value, str):
        return None

    clean_value = re.sub(
        r"\s+",
        " ",
        value,
    ).strip()

    if not clean_value:
        return None

    return clean_value[:max_length]


def serialize_user_preference(
    preference: UserPreference | None,
):
    dashboard_preferences = clean_dashboard_preferences(
        parse_preference_json_object(
            preference.dashboard_preferences
            if preference
            else None
        )
    )

    return {
        "selected_dataset_id": (
            preference.selected_dataset_id
            if preference
            else None
        ),
        "selected_metric": (
            clean_optional_selected_metric(
                preference.selected_metric
            )
            if preference
            else None
        ),
        "metric_targets": parse_preference_json_object(
            preference.metric_targets
            if preference
            else None
        ),
        "dashboard_preferences": dashboard_preferences,
    }


def clean_selected_dashboard(
    selected_dashboard: str | None,
):
    clean_value = str(
        selected_dashboard or ""
    ).strip()

    if clean_value not in VALID_SELECTED_DASHBOARDS:
        raise HTTPException(
            status_code=400,
            detail="Invalid dashboard selection",
        )

    return clean_value


def serialize_dashboard_preference(
    preference: UserPreference | None,
):
    selected_dashboard = (
        preference.selected_dashboard
        if preference
        else None
    )

    if selected_dashboard in VALID_SELECTED_DASHBOARDS:
        return {
            "selected_dashboard": selected_dashboard,
        }

    return {
        "selected_dashboard": DEFAULT_SELECTED_DASHBOARD,
    }


def clean_organization_name(
    name: str,
) -> str:
    if not isinstance(
        name,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail="Organization name must be text",
        )

    clean_name = name.strip()

    if not clean_name:
        raise HTTPException(
            status_code=400,
            detail="Organization name is required",
        )

    return clean_name


def clean_optional_organization_text(
    value,
    field_label: str,
    max_length: int,
):
    if value is None:
        return None

    if not isinstance(
        value,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"{field_label} must be text",
        )

    clean_value = value.strip()

    if not clean_value:
        return None

    if len(clean_value) > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"{field_label} is too long",
        )

    return clean_value


def clean_optional_logo_url(
    value,
):
    max_logo_value_length = 250_000
    supported_inline_logo_prefixes = (
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/jpg;base64,",
        "data:image/webp;base64,",
        "data:image/gif;base64,",
        "data:image/svg+xml;base64,",
    )
    clean_value = clean_optional_organization_text(
        value,
        "Logo URL",
        max_logo_value_length,
    )

    if clean_value is None:
        return None

    clean_value_lower = clean_value.lower()

    if not (
        clean_value.startswith("https://")
        or clean_value.startswith("http://")
        or any(
            clean_value_lower.startswith(prefix)
            for prefix in supported_inline_logo_prefixes
        )
    ):
        raise HTTPException(
            status_code=400,
            detail="Logo must be an HTTP(S) image URL or a supported uploaded image.",
        )

    return clean_value


def clean_optional_brand_color(
    value,
    field_label: str,
):
    clean_value = clean_optional_organization_text(
        value,
        field_label,
        7,
    )

    if clean_value is None:
        return None

    if not re.fullmatch(
        r"#[0-9a-fA-F]{6}",
        clean_value,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"{field_label} must be a hex color like #2563EB",
        )

    return clean_value.upper()


def apply_organization_branding(
    organization: Organization,
    payload,
):
    organization.logo_url = clean_optional_logo_url(
        payload.logo_url,
    )
    organization.primary_color = clean_optional_brand_color(
        payload.primary_color,
        "Primary color",
    )
    organization.accent_color = clean_optional_brand_color(
        payload.accent_color,
        "Accent color",
    )
    organization.report_display_name = clean_optional_organization_text(
        payload.report_display_name,
        "Report display name",
        120,
    )


def build_organization_response(
    organization: Organization,
):
    return {
        "id": organization.id,
        "name": organization.name,
        "logo_url": organization.logo_url,
        "primary_color": organization.primary_color,
        "accent_color": organization.accent_color,
        "report_display_name": organization.report_display_name,
    }


def ensure_owner_membership(
    db,
    organization: Organization,
    user_id: str,
):
    existing_member = (
        db.query(OrganizationMember)
        .filter(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.clerk_user_id == user_id,
        )
        .first()
    )

    if existing_member:
        if existing_member.role != "owner":
            existing_member.role = "owner"

        return existing_member

    member = OrganizationMember(
        organization_id=organization.id,
        clerk_user_id=user_id,
        role="owner",
    )

    db.add(member)

    return member


def get_owned_organization_or_404(
    db,
    user_id: str,
):
    organization = (
        db.query(Organization)
        .filter(
            Organization.owner_user_id == user_id
        )
        .first()
    )

    if not organization:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    return organization


def clean_member_user_id(
    user_id: str,
) -> str:
    if not isinstance(
        user_id,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail="Member user id must be text",
        )

    clean_user_id = user_id.strip()

    if not clean_user_id:
        raise HTTPException(
            status_code=400,
            detail="Member user id is required",
        )

    return clean_user_id


def clean_invite_email(
    email: str,
) -> str:
    if not isinstance(
        email,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail="Invite email must be text",
        )

    clean_email = email.strip().lower()

    if not clean_email:
        raise HTTPException(
            status_code=400,
            detail="Invite email is required",
        )

    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        clean_email,
    ):
        raise HTTPException(
            status_code=400,
            detail="Invite email must be a valid email address",
        )

    return clean_email


def clean_member_role(
    role: str,
) -> str:
    if not isinstance(
        role,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid member role",
        )

    clean_role = role.strip().lower()
    allowed_roles = {
        "member",
        "client",
    }

    if clean_role not in allowed_roles:
        raise HTTPException(
            status_code=400,
            detail="Invalid member role",
        )

    return clean_role


# =========================
# Organization Routes
# =========================


@router.get(
    "/workspaces",
    response_model=list[OrganizationWorkspaceResponse],
)
async def get_accessible_workspaces(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        owned_organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == user_id
            )
            .first()
        )

        if owned_organization:
            ensure_owner_membership(
                db,
                owned_organization,
                user_id,
            )
            db.commit()

        memberships = (
            db.query(
                Organization,
                OrganizationMember,
            )
            .join(
                OrganizationMember,
                OrganizationMember.organization_id == Organization.id,
            )
            .filter(
                OrganizationMember.clerk_user_id == user_id,
            )
            .order_by(
                Organization.name.asc(),
                Organization.id.asc(),
            )
            .all()
        )

        workspaces_by_owner: dict[str, OrganizationWorkspaceResponse] = {}

        for organization, membership in memberships:
            workspaces_by_owner[organization.owner_user_id] = (
                OrganizationWorkspaceResponse(
                    id=organization.id,
                    name=organization.name,
                    owner_user_id=organization.owner_user_id,
                    role=membership.role,
                    logo_url=organization.logo_url,
                    primary_color=organization.primary_color,
                    accent_color=organization.accent_color,
                    report_display_name=organization.report_display_name,
                )
            )

        return list(
            workspaces_by_owner.values()
        )

    finally:
        db.close()


@router.post("/")
async def create_organization(
    request: Request,
    organization: OrganizationCreate,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        existing = (
            db.query(Organization).filter(Organization.owner_user_id == user_id).first()
        )

        if existing:
            raise HTTPException(
                status_code=400,
                detail="Organization already exists",
            )

        organization_record = Organization(
            name=clean_organization_name(
                organization.name,
            ),
            owner_user_id=user_id,
        )
        apply_organization_branding(
            organization_record,
            organization,
        )

        db.add(organization_record)

        db.flush()

        ensure_owner_membership(
            db,
            organization_record,
            user_id,
        )

        db.commit()

        db.refresh(organization_record)

        return build_organization_response(
            organization_record,
        )

    finally:
        db.close()


@router.get("/me")
async def get_my_organization(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = (
            db.query(Organization).filter(Organization.owner_user_id == user_id).first()
        )

        if not organization:
            return None

        ensure_owner_membership(
            db,
            organization,
            user_id,
        )

        db.commit()

        return build_organization_response(
            organization,
        )

    finally:
        db.close()


@router.get(
    "/members",
    response_model=list[OrganizationMemberResponse],
)
async def get_organization_members(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == user_id
            )
            .first()
        )

        if not organization:
            return []

        ensure_owner_membership(
            db,
            organization,
            user_id,
        )

        db.commit()

        return (
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

    finally:
        db.close()


@router.post(
    "/members",
    response_model=OrganizationMemberResponse,
)
async def add_organization_member(
    request: Request,
    payload: OrganizationMemberCreate,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = get_owned_organization_or_404(
            db,
            user_id,
        )
        member_user_id = clean_member_user_id(
            payload.clerk_user_id,
        )
        member_role = clean_member_role(
            payload.role,
        )

        if member_user_id == user_id:
            member_role = "owner"

        existing_member = (
            db.query(OrganizationMember)
            .filter(
                OrganizationMember.organization_id == organization.id,
                OrganizationMember.clerk_user_id == member_user_id,
            )
            .first()
        )

        if existing_member:
            existing_member.role = member_role
            db.commit()
            db.refresh(existing_member)

            return existing_member

        member = OrganizationMember(
            organization_id=organization.id,
            clerk_user_id=member_user_id,
            role=member_role,
        )

        db.add(member)

        db.commit()

        db.refresh(member)

        return member

    finally:
        db.close()


@router.get(
    "/invites",
    response_model=list[OrganizationInviteResponse],
)
async def get_organization_invites(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == user_id
            )
            .first()
        )

        if not organization:
            return []

        return (
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

    finally:
        db.close()


@router.post(
    "/invites",
    response_model=OrganizationInviteResponse,
)
async def add_organization_invite(
    request: Request,
    payload: OrganizationInviteCreate,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = get_owned_organization_or_404(
            db,
            user_id,
        )
        invite_email = clean_invite_email(
            payload.email,
        )
        invite_role = clean_member_role(
            payload.role,
        )

        existing_invite = (
            db.query(OrganizationInvite)
            .filter(
                OrganizationInvite.organization_id == organization.id,
                OrganizationInvite.email == invite_email,
            )
            .first()
        )

        if existing_invite:
            existing_invite.role = invite_role
            existing_invite.status = "pending"
            db.commit()
            db.refresh(existing_invite)

            return existing_invite

        invite = OrganizationInvite(
            organization_id=organization.id,
            email=invite_email,
            role=invite_role,
            status="pending",
        )

        db.add(invite)

        db.commit()

        db.refresh(invite)

        return invite

    finally:
        db.close()


# =========================
# Organization Member Role And Removal Routes For Owner Workspace Management
# =========================

@router.patch(
    "/members/{member_id}",
    response_model=OrganizationMemberResponse,
)
async def update_organization_member_role(
    member_id: int,
    request: Request,
    payload: OrganizationMemberRoleUpdate,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = get_owned_organization_or_404(
            db,
            user_id,
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
                detail="Owner role cannot be changed",
            )

        member.role = clean_member_role(
            payload.role,
        )

        db.commit()
        db.refresh(member)

        return member

    finally:
        db.close()


@router.delete(
    "/invites/{invite_id}",
)
async def remove_organization_invite(
    invite_id: int,
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = get_owned_organization_or_404(
            db,
            user_id,
        )
        invite = (
            db.query(OrganizationInvite)
            .filter(
                OrganizationInvite.id == invite_id,
                OrganizationInvite.organization_id == organization.id,
            )
            .first()
        )

        if not invite:
            raise HTTPException(
                status_code=404,
                detail="Organization invite not found",
            )

        db.delete(invite)
        db.commit()

        return {
            "ok": True,
        }

    finally:
        db.close()


@router.delete(
    "/members/{member_id}",
)
async def remove_organization_member(
    member_id: int,
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = get_owned_organization_or_404(
            db,
            user_id,
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
                detail="Owner cannot be removed",
            )

        db.delete(member)
        db.commit()

        return {
            "removed": True,
        }

    finally:
        db.close()


@router.patch("/me")
async def update_my_organization(
    request: Request,
    payload: OrganizationUpdate,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id

    db = SessionLocal()

    try:
        organization = (
            db.query(Organization)
            .filter(
                Organization.owner_user_id == user_id
            )
            .first()
        )

        if not organization:
            raise HTTPException(
                status_code=404,
                detail="Organization not found",
            )

        organization.name = clean_organization_name(
            payload.name,
        )
        apply_organization_branding(
            organization,
            payload,
        )

        db.commit()

        db.refresh(organization)

        return build_organization_response(
            organization,
        )

    finally:
        db.close()


# =========================
# Dataset Preferences
# =========================

@router.get(
    "/preferences/dashboard",
    response_model=DashboardPreferenceResponse,
)
async def get_dashboard_preference(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )

    db = SessionLocal()

    try:
        preference = find_user_preference(
            db,
            auth_context.user_id,
            auth_context.workspace_id,
        )

        return serialize_dashboard_preference(preference)

    finally:
        db.close()


@router.patch(
    "/preferences/dashboard",
    response_model=DashboardPreferenceResponse,
)
async def update_dashboard_preference(
    request: Request,
    payload: DashboardPreferenceUpdate,
):
    auth_context = get_auth_context(
        request,
    )
    selected_dashboard = clean_selected_dashboard(
        payload.selected_dashboard,
    )

    db = SessionLocal()

    try:
        preference = find_exact_user_preference(
            db,
            auth_context.user_id,
            auth_context.workspace_id,
        )

        if not preference:
            preference = UserPreference(
                clerk_user_id=auth_context.user_id,
                workspace_id=auth_context.workspace_id,
                selected_dashboard=selected_dashboard,
            )
            db.add(preference)
        else:
            preference.selected_dashboard = selected_dashboard

        db.commit()

        return serialize_dashboard_preference(preference)

    finally:
        db.close()


@router.get(
    "/preferences/dataset",
    response_model=DatasetPreferenceResponse,
)
async def get_dataset_preference(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id
    workspace_id = auth_context.workspace_id

    db = SessionLocal()

    try:
        preference = find_user_preference(
            db,
            user_id,
            workspace_id,
        )

        return serialize_user_preference(preference)

    finally:
        db.close()


@router.post(
    "/preferences/dataset",
    response_model=DatasetPreferenceResponse,
)
async def update_dataset_preference(
    request: Request,
    payload: DatasetPreferenceUpdate,
):
    auth_context = get_auth_context(
        request,
    )
    user_id = auth_context.user_id
    workspace_id = auth_context.workspace_id

    db = SessionLocal()

    try:
        clean_dataset_id = clean_preference_dataset_id(
            payload.dataset_id
        )
        clean_metric_targets_value = clean_metric_targets(
            payload.metric_targets
        )
        clean_dashboard_preferences_value = clean_dashboard_preferences(
            payload.dashboard_preferences
        )

        preference = find_exact_user_preference(
            db,
            user_id,
            workspace_id,
        )

        if not preference:
            preference = UserPreference(
                clerk_user_id=user_id,
                workspace_id=workspace_id,
                selected_dataset_id=clean_dataset_id,
                selected_metric=clean_optional_selected_metric(
                    payload.selected_metric
                ),
                metric_targets=(
                    json.dumps(clean_metric_targets_value)
                    if clean_metric_targets_value is not None
                    else None
                ),
                dashboard_preferences=(
                    json.dumps(clean_dashboard_preferences_value)
                    if clean_dashboard_preferences_value is not None
                    else None
                ),
            )

            db.add(preference)

        else:
            preference.selected_dataset_id = clean_dataset_id

            if "selected_metric" in payload.model_fields_set:
                preference.selected_metric = clean_optional_selected_metric(
                    payload.selected_metric
                )

            if "metric_targets" in payload.model_fields_set:
                preference.metric_targets = (
                    json.dumps(clean_metric_targets_value)
                    if clean_metric_targets_value is not None
                    else None
                )

            if "dashboard_preferences" in payload.model_fields_set:
                preference.dashboard_preferences = (
                    json.dumps(clean_dashboard_preferences_value)
                    if clean_dashboard_preferences_value is not None
                    else None
                )

        db.commit()

        return serialize_user_preference(preference)

    finally:
        db.close()
