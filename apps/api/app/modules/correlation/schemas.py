from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .defaults import DEFAULT_METHOD, DEFAULT_PERIOD, MAXIMUM_LAG, MINIMUM_ABS_COEFFICIENT, MINIMUM_OBSERVATIONS


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MetricRef(StrictModel):
    dataset_id: int = Field(ge=1)
    metric_key: str = Field(min_length=1, max_length=200)
    date_column: str = Field(min_length=1, max_length=200)
    aggregation: Literal["sum", "avg", "min", "max", "count", "last", "policy"] = "sum"


class DateRange(StrictModel):
    start: date
    end: date

    @model_validator(mode="after")
    def check_range(self):
        if self.end < self.start or (self.end - self.start).days > 3653:
            raise ValueError("Choose an ordered date range of at most ten years")
        return self


class LagPolicy(StrictModel):
    enabled: bool = False
    minimum: int = Field(default=0, ge=0, le=60)
    maximum: int = Field(default=MAXIMUM_LAG, ge=0, le=60)
    direction: Literal["a_leads_b", "b_leads_a"] = "a_leads_b"

    @model_validator(mode="after")
    def check_bounds(self):
        if self.minimum > self.maximum:
            raise ValueError("Minimum lag exceeds maximum lag")
        return self


class ResultFilters(StrictModel):
    minimum_abs_coefficient: float = Field(default=MINIMUM_ABS_COEFFICIENT, ge=0, le=1, allow_inf_nan=False)
    minimum_observations: int = Field(default=MINIMUM_OBSERVATIONS, ge=2, le=3653)


class AnalysisCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    metrics: list[MetricRef] = Field(min_length=2, max_length=50)
    method: Literal["pearson", "spearman"] = DEFAULT_METHOD
    grain: Literal["daily", "weekly", "monthly", "quarterly"] = DEFAULT_PERIOD
    date_range: DateRange
    lag: LagPolicy = Field(default_factory=LagPolicy)
    filters: ResultFilters = Field(default_factory=ResultFilters)
    correction: Literal["benjamini_hochberg"] = "benjamini_hochberg"
    advanced: bool = False

    @field_validator("grain", mode="before")
    @classmethod
    def normalize_grain(cls, value):
        return {"day": "daily", "week": "weekly", "month": "monthly", "quarter": "quarterly"}.get(value, value)

    @model_validator(mode="after")
    def check_metrics(self):
        identities = {(item.dataset_id, item.metric_key) for item in self.metrics}
        if len(identities) != len(self.metrics):
            raise ValueError("Select each dataset metric only once")
        if len({item.dataset_id for item in self.metrics}) < 2:
            raise ValueError("Select metrics from at least two datasets")
        if len(self.metrics) > (50 if self.advanced else 25):
            raise ValueError("More than 25 metrics requires advanced mode")
        if not self.name.strip():
            raise ValueError("An analysis name is required")
        return self
