from typing import Literal

from pydantic import BaseModel

from app.modules.ai.schemas import AIAnalysis


class WeeklyReportPreferenceUpdate(BaseModel):
    enabled: bool = False
    cadence: str = "weekly"
    delivery_day: str = "monday"
    recipient_emails: list[str] = []
    metric_focus: list[str] = []
    include_recommendations: bool = True
    sender_name: str = ""
    sender_email: str = ""
    reply_to_email: str = ""
    subject_prefix: str = ""
    smtp_host: str = ""
    smtp_port: int | None = None
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_clear_password: bool = False
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False


class WeeklyReportPreferenceResponse(BaseModel):
    enabled: bool
    cadence: str
    delivery_day: str
    recipient_emails: list[str]
    metric_focus: list[str]
    include_recommendations: bool
    sender_name: str = ""
    sender_email: str = ""
    reply_to_email: str = ""
    subject_prefix: str = ""
    smtp_host: str = ""
    smtp_port: int | None = None
    smtp_username: str = ""
    smtp_password_set: bool = False
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
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


class WeeklyReportAIAnalysis(AIAnalysis):
    pass


class WeeklyReportDigestResponse(BaseModel):
    enabled: bool
    cadence: str
    delivery_day: str
    recipient_emails: list[str]
    metric_focus: list[str]
    sender_name: str = ""
    sender_email: str = ""
    reply_to_email: str = ""
    subject_prefix: str = ""
    brand_name: str = "Decisionate"
    subject: str
    preview_text: str
    dataset_count: int
    metrics: list[WeeklyReportDigestMetric]
    recommendations: list[str]
    unavailable_datasets: list[str]
    ai_analysis: WeeklyReportAIAnalysis | None = None


class WeeklyReportDeliveryResponse(BaseModel):
    status: str
    workspace_id: str
    delivered_count: int
    recipients: list[str]
    subject: str
    metrics_count: int
    sent_at: str


class WeeklyReportDeliveryConfigResponse(BaseModel):
    email_delivery_configured: bool
    scheduler_configured: bool
    required_email_environment_keys: list[str]
    optional_email_environment_keys: list[str]
    scheduler_environment_key: str
    scheduler_header_name: str
    send_due_endpoint: str
    ai_provider_configured: bool = False
    ai_provider: str = "openai"
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
