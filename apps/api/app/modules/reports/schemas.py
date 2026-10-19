from datetime import date

from pydantic import Field, field_validator

from app.modules.correlation.schemas import AnalysisCreate, LagPolicy, StrictModel


class ReportDefinition(AnalysisCreate):
    lag: LagPolicy = Field(default_factory=lambda: LagPolicy(maximum=12))
    business_question: str = Field(min_length=8, max_length=1000)
    included_findings: list[str] | None = Field(default=None, max_length=300)
    source_run_id: str | None = Field(default=None, max_length=80)

    @field_validator("business_question", mode="before")
    @classmethod
    def trim_question(cls, value):
        return value.strip() if isinstance(value, str) else value


class ReportDecision(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    action: str = Field(min_length=3, max_length=5000)
    reasoning: str = Field(min_length=3, max_length=5000)
    expected_outcome: str = Field(min_length=3, max_length=3000)
    outcome_metric: str = Field(min_length=3, max_length=220)
    review_date: date

    @field_validator("title", "action", "reasoning", "expected_outcome", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value
