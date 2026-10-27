from datetime import date
from typing import Any, Dict, List, Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import model_validator
from app.modules.correlation.defaults import (
    DEFAULT_AGGREGATION, DEFAULT_LAG_DIRECTION, DEFAULT_LAG_MODE, DEFAULT_LAG_PERIODS, DEFAULT_METHOD, DEFAULT_MINIMUM_OBSERVATIONS, DEFAULT_PERIOD,
    MAXIMUM_LAG, MAXIMUM_OBSERVATIONS, MINIMUM_OBSERVATIONS,
)
from app.modules.datasets.services.dimension_filters import DimensionFilter


class DatasetCreate(BaseModel):
    file_name: str
    rows: List[Dict[str, Any]]


class DatasetMetricSelectionUpdate(BaseModel):
    selected_metric_columns: List[str] = Field(
        default_factory=list,
        max_length=500,
    )
    business_objective: str | None = Field(
        default=None,
        max_length=80,
    )
    select_recommended_metric_columns: bool = False
    use_curated_recommendations: bool = False
    policy_version: str | None = Field(default=None, max_length=80)


class DatasetSignedUrlImport(BaseModel):
    url: str = Field(min_length=12, max_length=4096)
    file_name: str | None = Field(default=None, max_length=255)


class DatasetJoinSelection(BaseModel):
    dataset_id: int = Field(ge=1)
    dimension_filter: DimensionFilter | None = None
    date_column: str | None = None
    metric_column: str | None = None
    metric_columns: List[str] | None = Field(
        default=None,
        max_length=500,
    )


class DatasetJoinRequest(BaseModel):
    selections: List[DatasetJoinSelection] = Field(
        min_length=2,
        max_length=5,
    )
    start_date: date | None = None
    period_filter: Literal[
        "1m",
        "1q",
        "6m",
        "1y",
        "2y",
        "3y",
        "5y",
        "all",
    ] = "all"
    aggregation: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] = "monthly"
    aggregation_type: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] = "sum"
    dashboard_key: str | None = None


class DatasetRelationshipSelection(BaseModel):
    dataset_id: int = Field(ge=1)
    date_column: str = Field(min_length=1, max_length=120)
    metric_column: str = Field(min_length=1, max_length=120)
    dimension_filter: DimensionFilter | None = None


class DatasetRelationshipRequest(BaseModel):
    name: str = Field(
        default="Cross-source relationship",
        min_length=1,
        max_length=120,
    )
    left: DatasetRelationshipSelection
    right: DatasetRelationshipSelection
    period: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] = DEFAULT_PERIOD
    aggregation: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] = DEFAULT_AGGREGATION
    method: Literal[
        "pearson",
        "spearman",
    ] = DEFAULT_METHOD
    minimum_observations: int = Field(default=DEFAULT_MINIMUM_OBSERVATIONS, ge=MINIMUM_OBSERVATIONS, le=MAXIMUM_OBSERVATIONS)
    maximum_lag: int = Field(default=MAXIMUM_LAG, ge=0, le=MAXIMUM_LAG)
    lag_direction: Literal["a_leads_b", "b_leads_a"] = DEFAULT_LAG_DIRECTION
    lag_mode: Literal["automatic", "manual"] = DEFAULT_LAG_MODE
    lag_periods: int = Field(
        default=DEFAULT_LAG_PERIODS,
        ge=0,
        le=MAXIMUM_LAG,
    )

    @model_validator(mode="after")
    def check_lag_bounds(self):
        if self.lag_mode == "manual" and self.lag_periods > self.maximum_lag:
            raise ValueError("The fixed lag must not exceed Maximum lag")
        return self


class DatasetRelationshipResponse(BaseModel):
    id: int | None = None
    name: str
    left: DatasetRelationshipSelection
    right: DatasetRelationshipSelection
    left_dataset_name: str
    right_dataset_name: str
    period: str
    aggregation: str
    method: str
    minimum_observations: int = DEFAULT_MINIMUM_OBSERVATIONS
    maximum_lag: int = MAXIMUM_LAG
    lag_direction: Literal["a_leads_b", "b_leads_a"] = DEFAULT_LAG_DIRECTION
    lag_periods: int
    lag_mode: str = DEFAULT_LAG_MODE
    matched_period_count: int
    correlation: float | None = None
    relationship_strength: str
    direction: str
    evidence: list[dict]
    decision_context: str
    association_summary: str | None = None
    delay_description: str | None = None
    lag_credibility: str = "unknown"
    lag_candidates: list[dict] = Field(default_factory=list)
    causation_disclaimer: str = (
        "Association does not establish causation."
    )
    status: str = "ready"


class DatasetMultiMetricSelection(BaseModel):
    dataset_id: int = Field(ge=1)
    date_column: str = Field(min_length=1, max_length=120)
    metric_column: str = Field(min_length=1, max_length=120)
    aggregation: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] = "sum"


class DatasetMultiMetricAnalysisRequest(BaseModel):
    metrics: List[DatasetMultiMetricSelection] = Field(
        min_length=1,
        max_length=10,
    )
    start_date: date | None = None
    period_filter: Literal[
        "1m",
        "1q",
        "6m",
        "1y",
        "2y",
        "3y",
        "5y",
        "all",
    ] = "all"
    grouping: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] = "monthly"


EntityType = Literal["customer", "product"]


class EntityMatchingRequest(BaseModel):
    dataset_ids: List[int] = Field(
        min_length=2,
        max_length=10,
    )
    entity_type: EntityType
    key_columns: Dict[str, List[str]] = Field(default_factory=dict)
    metric_columns: Dict[str, List[str]] = Field(default_factory=dict)
    replace_existing: bool = True


class EntityMatchingDatasetMetadata(BaseModel):
    dataset_id: int
    file_name: str
    columns: List[str]
    default_key_columns: List[str]
    metric_columns: List[str]
    default_metric_columns: List[str]


class EntityMatchingMetadataResponse(BaseModel):
    entity_type: EntityType
    datasets: List[EntityMatchingDatasetMetadata]


class EntityMatchingPreviewResponse(BaseModel):
    entity_type: EntityType
    datasets: list[dict]
    candidate_row_count: int
    matched_group_count: int
    matched_row_count: int
    unmatched_row_count: int


class EntityMatchingRunResponse(BaseModel):
    entity_type: EntityType
    dataset_count: int
    source_row_count: int
    matched_row_count: int
    unmatched_row_count: int
    canonical_entity_count: int
    confidence_breakdown: dict[str, int]
    unified_dataset_id: int | None = None
    unified_dataset_name: str | None = None
    unified_dataset_row_count: int | None = None
    entities: list[dict]


class DataSourceConnectionCreate(BaseModel):
    source_type: str
    display_name: str | None = None
    connection_config: Dict[str, Any] | None = None


class DataSourceConnectionUpdate(BaseModel):
    display_name: str | None = None
    connection_config: Dict[str, Any] | None = None


class DataSourceConnectionSync(BaseModel):
    advanced_date_range: bool = False
    start_date: date | None = None
    end_date: date | None = None
    # Internal target used when a multi-object connector run is split into
    # independent child jobs. It is intentionally absent from the UI flow.
    resource_type: str | None = None
    dimensions: List[str] = Field(
        default_factory=lambda: ["date"]
    )
    metrics: List[str] = Field(
        default_factory=lambda: [
            "activeUsers",
            "sessions",
            "totalRevenue",
        ]
    )


class DataSourceConnectionSchedule(BaseModel):
    enabled: bool = True
    interval_hours: int = 24
    time_of_day: str = "00:00"
    timezone: str = "UTC"
    day_of_week: int = 0
