from datetime import date
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.modules.correlation.schemas import AnalysisCreate, LagPolicy, MetricRef, ResultFilters, StrictModel
from app.modules.datasets.services.dimension_filters import DatasetDimensionFilter


MINIMUM_REPORT_OBSERVATIONS = 24


class ReportFilters(ResultFilters):
    minimum_observations: int = Field(default=MINIMUM_REPORT_OBSERVATIONS, ge=MINIMUM_REPORT_OBSERVATIONS, le=3653)


class ReportMetricKey(StrictModel):
    dataset_id: int = Field(ge=1)
    metric_key: str = Field(min_length=1, max_length=200)


class ReportMetricPair(StrictModel):
    metric_a: ReportMetricKey
    metric_b: ReportMetricKey


class ReportPairDirection(ReportMetricPair):
    direction: Literal["a_leads_b", "b_leads_a", "same_period"]

    @field_validator("direction", mode="before")
    @classmethod
    def normalize_legacy_direction(cls, value):
        return "same_period" if value == "both" else value


class ReportDefinition(AnalysisCreate):
    scope: Literal["single", "multi"] = "multi"
    metrics: list[MetricRef] = Field(min_length=1, max_length=25)
    dimension_filters: list[DatasetDimensionFilter] = Field(default_factory=list, max_length=25)
    seasonal_business: bool = False
    include_ai_analysis: bool = True
    filters: ReportFilters = Field(default_factory=ReportFilters)
    lag: LagPolicy = Field(default_factory=lambda: LagPolicy(maximum=12))
    business_question: str = Field(min_length=8, max_length=1000)
    included_findings: list[str] | None = Field(default=None, max_length=300)
    source_run_id: str | None = Field(default=None, max_length=80)
    pair_directions: list[ReportPairDirection] | None = Field(default=None, max_length=300)
    excluded_pairs: list[ReportMetricPair] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def check_metrics(self):
        # Override only the report contract; advanced correlation still requires two sources.
        identities = {(item.dataset_id, item.metric_key) for item in self.metrics}
        if len(identities) != len(self.metrics):
            raise ValueError("Select each dataset metric only once")
        datasets = {item.dataset_id for item in self.metrics}
        filtered = [item.dataset_id for item in self.dimension_filters]
        if len(set(filtered)) != len(filtered) or not set(filtered).issubset(datasets):
            raise ValueError("Choose at most one dimension filter per selected dataset")
        if self.scope == "single":
            if len(datasets) != 1:
                raise ValueError("Single dataset reports require exactly one dataset")
            if self.lag.enabled or self.pair_directions or self.excluded_pairs:
                raise ValueError("Relationship timing is only available for multi dataset reports")
        elif len(datasets) < 2:
            raise ValueError("Select metrics from at least two datasets")
        if not self.name.strip():
            raise ValueError("An analysis name is required")
        return self

    @model_validator(mode="after")
    def check_pair_directions(self):
        selected = {(item.dataset_id, item.metric_key) for item in self.metrics}
        for policies in (self.pair_directions or [], self.excluded_pairs):
            seen = set()
            for pair in policies:
                left = (pair.metric_a.dataset_id, pair.metric_a.metric_key)
                right = (pair.metric_b.dataset_id, pair.metric_b.metric_key)
                identity = frozenset((left, right))
                if left not in selected or right not in selected:
                    raise ValueError("Relationship pairs must use selected metrics")
                if left[0] == right[0]:
                    raise ValueError("Relationship pairs must join different datasets")
                if identity in seen:
                    raise ValueError("Select each relationship pair only once per setting")
                seen.add(identity)
        return self

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
