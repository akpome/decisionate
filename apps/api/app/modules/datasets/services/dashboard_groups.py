"""Compare a selected dashboard metric across values of one source column."""

from datetime import date
from typing import Annotated, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from .curated_metric_analytics import aggregate_metric, frame_policy
from .dimension_filters import DimensionFilter, apply_dimension_filter, dimension_tokens
from .joins import _bucket_dates, _parse_dates, _safe_number
from .metric_selection import filter_dataframe_to_selected_metrics, get_effective_dataset_metric_columns
from .numeric import coerce_numeric_series
from .summary_query import SUMMARY_MARKER_COLUMN, _finalize_state, _merge_states, _summary_state, is_summary_dataframe


MAX_DASHBOARD_GROUPS = 8
ColumnName = Annotated[StrictStr, Field(min_length=1, max_length=200)]


class DashboardGroupFilter(DimensionFilter):
    values: list[StrictStr | None] = Field(min_length=1, max_length=MAX_DASHBOARD_GROUPS)


class DashboardGroupPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filter: DashboardGroupFilter
    metric: ColumnName
    active: bool = True
    targets: list[Annotated[float, Field(gt=0, allow_inf_nan=False)] | None] = Field(
        default_factory=list, max_length=MAX_DASHBOARD_GROUPS,
    )

    @model_validator(mode="after")
    def validate_targets(self):
        if self.targets and len(self.targets) != len(self.filter.values):
            raise ValueError("Group targets must match the selected values")
        return self


class DashboardGroupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filter: DashboardGroupFilter
    metric: ColumnName
    date_column: ColumnName
    start_date: date
    end_date: date
    aggregation: Literal["daily", "weekly", "monthly", "quarterly"]
    aggregation_type: Literal["sum", "avg", "min", "max", "count"]

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date > self.end_date:
            raise ValueError("The start date must be on or before the end date")
        return self


def dashboard_group_series(dataset, frame, selection: DashboardGroupRequest):
    frame = frame.reset_index(drop=True)
    metric = selection.metric
    date_column = selection.date_column
    if metric not in get_effective_dataset_metric_columns(dataset, frame):
        raise ValueError("Choose a metric available on this dashboard.")
    if date_column not in frame or date_column in {metric, selection.filter.column}:
        raise ValueError("Choose an available date column.")

    dates = _parse_dates(frame[date_column])
    first, last = pd.Timestamp(selection.start_date), pd.Timestamp(selection.end_date)
    in_window = dates.between(first, last)
    buckets = _bucket_dates(dates, selection.aggregation)
    normalized = dimension_tokens(dataset, frame, selection.filter.column)
    source = frame
    frame = filter_dataframe_to_selected_metrics(dataset, frame)
    column = selection.filter.column
    if column not in frame and column in source:
        frame = frame.assign(**{column: source[column]})
    if metric not in frame:
        raise ValueError("Choose a numeric metric available on this dashboard.")

    policy = frame_policy(frame)
    descriptor = policy["descriptors"].get(metric) if policy else None
    aggregate = {"avg": "mean"}.get(selection.aggregation_type, selection.aggregation_type)
    if not descriptor:
        frame = frame.assign(**{metric: coerce_numeric_series(frame[metric])})
    series = []
    summarized = False
    for value in selection.filter.values:
        # Check each value on its own: a filter containing several values
        # together can hide a transaction that was split between them.
        group = apply_dimension_filter(dataset, frame, {"column": column, "values": [value]}, metrics=[metric], normalized=normalized)
        group = group.loc[in_window.reindex(group.index)]
        has_summary = is_summary_dataframe(group)
        summarized |= has_summary
        if has_summary:
            is_summary = group[SUMMARY_MARKER_COLUMN].fillna(False).astype(bool)
            group_dates = dates.reindex(group.index)
            complete_month = group_dates.dt.to_period("M")
            keep_summary = (complete_month.dt.start_time >= first) & (complete_month.dt.end_time.dt.normalize() <= last)
            group = group.loc[~is_summary | (keep_summary & (selection.aggregation in {"monthly", "quarterly"}))]
        by_period = buckets.reindex(group.index)
        if descriptor:
            ordered = group.loc[dates.reindex(group.index).sort_values(kind="stable").index]
            values = [(period, aggregate_metric(rows, descriptor)) for period, rows in ordered.groupby(by_period, sort=True)]
        elif has_summary:
            fields = [name for name in group if name in {metric, SUMMARY_MARKER_COLUMN} or name.startswith(f"{metric}__")]
            values = []
            for period, rows in group[fields].groupby(by_period, sort=True):
                state = None
                for row in rows.to_dict("records"):
                    if part := _summary_state(row, metric):
                        state = _merge_states(state, part)
                if state:
                    values.append((period, _finalize_state(state, selection.aggregation_type)))
        else:
            valid = group[metric].dropna().groupby(by_period, sort=True)
            values = valid.agg(aggregate).items()
        series.append({
            "value": value,
            "points": [{"period": period.date().isoformat(), "amount": amount}
                       for period, raw in values
                       if raw is not None and (amount := _safe_number(raw)) is not None],
        })
    return {"series": series, "has_summarized_data": summarized,
            "metric_aggregation": descriptor.get("aggregation") if descriptor else None}
