from datetime import date
from typing import Any, Dict, List, Literal

from pydantic import BaseModel
from pydantic import Field


class DatasetCreate(BaseModel):
    file_name: str
    rows: List[Dict[str, Any]]


class DatasetMetricSelectionUpdate(BaseModel):
    selected_metric_columns: List[str] = Field(
        default_factory=list,
        max_length=500,
    )


class DatasetSignedUrlImport(BaseModel):
    url: str = Field(min_length=12, max_length=4096)
    file_name: str | None = Field(default=None, max_length=255)


class DatasetJoinSelection(BaseModel):
    dataset_id: int = Field(ge=1)
    date_column: str | None = None
    metric_column: str | None = None


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
    ] = "monthly"
    aggregation: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] = "sum"
    method: Literal[
        "pearson",
        "spearman",
    ] = "pearson"
    lag_mode: Literal["automatic", "manual"] = "automatic"
    lag_periods: int = Field(
        default=0,
        ge=0,
        le=12,
    )


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
    lag_periods: int
    lag_mode: str = "automatic"
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


class DataSourceConnectionCreate(BaseModel):
    source_type: str
    display_name: str | None = None
    connection_config: Dict[str, Any] | None = None


class DataSourceConnectionUpdate(BaseModel):
    display_name: str | None = None
    connection_config: Dict[str, Any] | None = None


class DataSourceConnectionSync(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
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
    time_of_day: str = "09:00"
    timezone: str = "UTC"
    day_of_week: int = 0
