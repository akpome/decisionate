from typing import Any

from pydantic import BaseModel


class OrganizationCreate(BaseModel):
    name: str
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None


class OrganizationUpdate(BaseModel):
    name: str
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None


class OrganizationResponse(BaseModel):
    id: int
    name: str
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None


class OrganizationWorkspaceResponse(BaseModel):
    id: int
    name: str
    owner_user_id: str
    role: str
    logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    report_display_name: str | None = None


class OrganizationMemberResponse(BaseModel):
    id: int
    organization_id: int
    clerk_user_id: str
    role: str


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


class DatasetPreferenceResponse(BaseModel):
    selected_dataset_id: int | None

    selected_metric: str | None = None

    metric_targets: dict[str, dict[str, float]] | None = None

    dashboard_preferences: dict[str, dict[str, Any]] | None = None
