from pydantic import BaseModel


class WeeklyReportPreferenceUpdate(BaseModel):
    enabled: bool = False
    cadence: str = "weekly"
    delivery_day: str = "monday"
    recipient_emails: list[str] = []
    metric_focus: list[str] = []
    include_recommendations: bool = True


class WeeklyReportPreferenceResponse(BaseModel):
    enabled: bool
    cadence: str
    delivery_day: str
    recipient_emails: list[str]
    metric_focus: list[str]
    include_recommendations: bool
