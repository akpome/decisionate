from datetime import datetime

from pydantic import BaseModel


class BillingPlanOption(BaseModel):
    plan: str
    name: str
    billing_model: str
    monthly_price_cents: int | None = None
    annual_price_cents: int | None = None
    included_client_workspaces: int | None = None
    ai_credit_limit: int
    configured: bool
    monthly_configured: bool = False
    annual_configured: bool = False


class BillingStatusResponse(BaseModel):
    configured: bool
    provider: str
    workspace_id: str
    plan: str
    status: str
    price_id: str | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    customer_portal_available: bool = False
    plan_name: str = "Free"
    billing_model: str = "direct"
    monthly_price_cents: int | None = None
    included_client_workspaces: int | None = 0
    client_workspace_limit: int | None = 0
    client_workspaces_used: int = 0
    additional_client_workspaces: int = 0
    additional_client_workspace_price_cents: int = 2000
    additional_client_workspace_annual_price_cents: int = 20000
    additional_ai_credit_packs: int = 0
    ai_credit_pack_size: int = 5000
    ai_credit_pack_configured: bool = False
    additional_client_workspace_ai_credits: int = 2500
    included_ai_credits: int = 0
    ai_credits_used: int = 0
    ai_credits_remaining: int = 0
    access_status: str = "untracked"
    access_allowed: bool = True
    requires_billing_action: bool = False
    grace_period_end: datetime | None = None
    days_remaining: int | None = None
    access_reason: str = ""
    plan_options: list[BillingPlanOption] = []


class BillingAccessResponse(BaseModel):
    workspace_id: str
    billing_workspace_id: str
    plan: str
    status: str
    access_allowed: bool
    requires_billing_action: bool
    current_period_end: datetime | None = None
    grace_period_end: datetime | None = None
    days_remaining: int | None = None
    reason: str


class BillingLifecycleSchedulerResponse(BaseModel):
    processed: int
    notified: int
    skipped: int
    failed: int
    data_purged: int = 0
    data_purge_failed: int = 0
    results: list[dict] = []


class BillingCheckoutRequest(BaseModel):
    plan: str = "professional"
    billing_interval: str = "month"
    additional_client_workspaces: int = 0
    additional_ai_credit_packs: int = 0


class BillingCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class BillingPortalResponse(BaseModel):
    portal_url: str
