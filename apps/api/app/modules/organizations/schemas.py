from typing import Any

from pydantic import BaseModel


class OrganizationCreate(BaseModel):
    name: str
    plan: str = "professional"
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None


class ClientWorkspaceCreate(BaseModel):
    name: str
    client_email: str


class AgencyOwnerAccessUpdate(BaseModel):
    enabled: bool


class OrganizationUpdate(BaseModel):
    name: str
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None


class OrganizationResponse(BaseModel):
    id: int
    name: str
    owner_user_id: str | None = None
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None
    agency_owner_access_enabled: bool = False


class OrganizationWorkspaceResponse(BaseModel):
    id: int
    name: str
    owner_user_id: str
    role: str
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None
    agency_owner_access_enabled: bool = False
    billing_notice: str | None = None


class ClientWorkspaceDeleteResponse(BaseModel):
    deleted: bool
    summary: dict[str, int]


class OrganizationMemberResponse(BaseModel):
    id: int
    organization_id: int
    clerk_user_id: str
    role: str
    email: str | None = None


class OrganizationInviteResponse(BaseModel):
    id: int
    organization_id: int
    email: str
    role: str
    status: str


class OrganizationInviteCreate(BaseModel):
    email: str
    role: str = "client"


class OrganizationMemberCreate(BaseModel):
    clerk_user_id: str
    role: str = "member"


class OrganizationMemberRoleUpdate(BaseModel):
    role: str


class DatasetPreferenceUpdate(BaseModel):
    dataset_id: int

    selected_metric: str | None = None

    metric_targets: dict[str, dict[str, float]] | None = None

    dashboard_preferences: dict[str, dict[str, Any]] | None = None

    dashboard_dataset_ids: dict[str, int] | None = None

    dashboard_views: dict[str, dict[str, dict[str, Any]]] | None = None


class DatasetPreferenceResponse(BaseModel):
    selected_dataset_id: int | None

    selected_metric: str | None = None

    metric_targets: dict[str, dict[str, float]] | None = None

    dashboard_preferences: dict[str, dict[str, Any]] | None = None

    dashboard_dataset_ids: dict[str, int] | None = None

    dashboard_views: dict[str, dict[str, dict[str, Any]]] | None = None


class DashboardPreferenceUpdate(BaseModel):
    selected_dashboard: str


class DashboardPreferenceResponse(BaseModel):
    selected_dashboard: str
