from typing import Literal

from pydantic import BaseModel
from pydantic import Field

from app.modules.ai.schemas import AIAnalysis


class WeeklyReportPreferenceUpdate(BaseModel):
    enabled: bool = False
    cadence: str = "weekly"
    delivery_day: str = "monday"
    recipient_emails: list[str] = []
    metric_focus: list[str] = []
    metric_targets: dict[str, float | None] = Field(
        default_factory=dict
    )
    relationship_focus: list[int] = []
    include_recommendations: bool = True
    subject_prefix: str = ""


class WeeklyReportPreferenceResponse(BaseModel):
    enabled: bool
    cadence: str
    delivery_day: str
    recipient_emails: list[str]
    metric_focus: list[str]
    metric_targets: dict[str, float] = Field(
        default_factory=dict
    )
    relationship_focus: list[int] = []
    include_recommendations: bool
    subject_prefix: str = ""
    last_sent_at: str | None = None
    last_send_status: str | None = None
    last_send_error: str | None = None


class WeeklyReportDigestMetric(BaseModel):
    dataset_id: int
    dataset_name: str
    column: str
    total: float | None = None
    average: float | None = None
    minimum: float | None = None
    maximum: float | None = None
    target: float | None = None


class WeeklyReportDigestRelationship(BaseModel):
    id: int
    name: str
    left_dataset_id: int
    right_dataset_id: int
    left_dataset_name: str
    right_dataset_name: str
    left_metric: str
    right_metric: str
    period: str
    aggregation: str
    method: str
    lag_periods: int = 0
    matched_period_count: int
    correlation: float | None = None
    relationship_strength: str
    direction: str
    decision_context: str
    lag_mode: str = "manual"
    delay_description: str | None = None
    lag_credibility: str = "unknown"


class WeeklyReportAIAnalysis(AIAnalysis):
    pass


class WeeklyReportDigestResponse(BaseModel):
    enabled: bool
    cadence: str
    delivery_day: str
    recipient_emails: list[str]
    metric_focus: list[str]
    relationship_focus: list[int] = []
    sender_name: str = ""
    sender_email: str = ""
    reply_to_email: str = ""
    subject_prefix: str = ""
    brand_name: str = "Decisionate"
    workspace_name: str = ""
    brand_logo_url: str | None = None
    brand_primary_color: str = "#0F766E"
    brand_accent_color: str = "#1D4ED8"
    is_managed_client: bool = False
    review_url: str | None = None
    subject: str
    preview_text: str
    dataset_count: int
    metrics: list[WeeklyReportDigestMetric]
    available_metrics: list[WeeklyReportDigestMetric] = Field(
        default_factory=list
    )
    relationships: list[WeeklyReportDigestRelationship] = Field(
        default_factory=list
    )
    recommendations: list[str]
    unavailable_datasets: list[str]
    decision_template_url: str | None = None
    ai_analysis: WeeklyReportAIAnalysis | None = None


class WeeklyReportDeliveryResponse(BaseModel):
    status: str
    workspace_id: str
    delivered_count: int
    recipients: list[str]
    subject: str
    metrics_count: int
    sent_at: str


class WeeklyReportDeliveryLogResponse(BaseModel):
    id: int
    status: str
    recipients: list[str]
    subject: str
    delivered_count: int
    metrics_count: int
    error: str | None = None
    attempted_at: str


class WeeklyReportDeliveryConfigResponse(BaseModel):
    email_delivery_configured: bool
    email_delivery_source: str = "unconfigured"
    email_delivery_provider: str = "unconfigured"
    scheduler_configured: bool
    required_email_environment_keys: list[str]
    optional_email_environment_keys: list[str]
    scheduler_environment_key: str
    scheduler_header_name: str
    send_due_endpoint: str
    ai_provider_configured: bool = False
    ai_provider: str = ""
    ai_model: str | None = None


class WeeklyReportSchedulerWorkspaceResult(BaseModel):
    workspace_id: str
    status: str
    delivered_count: int = 0
    detail: str | None = None


class WeeklyReportSchedulerResponse(BaseModel):
    status: str
    delivery_day: str
    processed_count: int
    sent_count: int
    skipped_count: int
    failed_count: int
    results: list[WeeklyReportSchedulerWorkspaceResult]
