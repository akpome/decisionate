"""Compare a selected dashboard metric across values of one source column."""

from datetime import date
from hashlib import sha256
from math import isclose
from typing import Annotated, Literal

import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from .curated_metric_analytics import aggregate_metric, frame_policy
from .dimension_filters import DimensionFilter, apply_dimension_filter, dimension_columns, dimension_options, dimension_tokens
from .joins import _bucket_dates, _parse_dates, _safe_number, build_join_dataset_metadata, build_joined_dataset
from .metric_selection import filter_dataframe_to_selected_metrics, get_effective_dataset_metric_columns, parse_dataset_source_config
from .numeric import coerce_numeric_series
from .summary_query import SUMMARY_MARKER_COLUMN, _finalize_state, _merge_states, _summary_state, is_summary_dataframe


MAX_DASHBOARD_GROUPS = 8
JOIN_SOURCE_COLUMN_PREFIX = "__join_source_"
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


def joined_dashboard_group_series(dataset, frame, selection: DashboardGroupRequest, load_source):
    if selection.date_column != "period" or selection.aggregation != "monthly":
        raise ValueError("Joined data can only be compared by month.")
    definition = parse_dataset_source_config(dataset).get("join_definition")
    definition = definition if isinstance(definition, dict) else {}
    if "period" not in frame or selection.metric not in frame:
        raise ValueError("This joined metric is unavailable. Rebuild the join and try again.")

    if selection.filter.column in {item["column"] for item in dimension_columns(dataset, frame)}:
        # Each saved row already represents one month. Group the saved value
        # as-is, rather than reapplying the join's aggregate (e.g. Count).
        result = dashboard_group_series(dataset, frame, selection.model_copy(update={"aggregation_type": "sum"}))
        result["metric_aggregation"] = _join_aggregation_label(definition.get("aggregation_type", "sum"))
        return result

    sources = definition.get("selections")
    if not sources:
        raise ValueError("This joined metric is unavailable. Rebuild the join and try again.")

    frames = []
    group_filter = selection.filter
    group_source_id = None
    dimension_label = None
    source_key = group_filter.column.startswith(JOIN_SOURCE_COLUMN_PREFIX)
    for source in sources:
        original, records = load_source(source["dataset_id"])
        metadata = {} if source.get("date_column") else build_join_dataset_metadata(original, records)
        frames.append((original, records, metadata))
        if source_key and group_filter.column.startswith(f"{JOIN_SOURCE_COLUMN_PREFIX}{original.id}_"):
            for item in _join_source_dimensions(source, original, records):
                if _join_source_column_key(original.id, item["column"]) == group_filter.column:
                    group_filter = group_filter.model_copy(update={"column": item["column"]})
                    group_source_id = original.id
                    dimension_label = _join_source_dimension_label(original, item)
                    break
    if source_key and group_source_id is None:
        raise ValueError("The selected dimension column is unavailable")

    aggregation_type = definition.get("aggregation_type", "sum")
    rebuilt = build_joined_dataset(
        frames, sources, definition.get("start_date"), definition.get("period_filter", "all"),
        definition.get("aggregation", "monthly"), aggregation_type, end_date=definition.get("end_date"),
        group_comparison=(selection.metric, group_filter, group_source_id),
    )
    if not any(item["label"] == selection.metric and item["column_type"] == "numeric" for item in rebuilt["datasets"]):
        raise ValueError("This joined metric is unavailable. Rebuild the join and try again.")

    first, last = selection.start_date.isoformat(), selection.end_date.isoformat()
    periods = _parse_dates(frame["period"]).dt.strftime("%Y-%m-%d")
    saved_totals = {period: amount for period, amount in zip(periods, frame[selection.metric])
                    if isinstance(period, str) and first <= period <= last}
    current_totals = {row["period"]: row[selection.metric] for row in rebuilt["rows"]}
    for period, amount in saved_totals.items():
        current = current_totals.get(period)
        same_total = current is None if pd.isna(amount) else current is not None and isclose(amount, current, rel_tol=1e-9, abs_tol=1e-9)
        if period not in current_totals or not same_total:
            raise ValueError("The original data has changed. Rebuild the join to compare its groups.")

    if rebuilt["group_series"] is not None:
        series = [{"value": group["value"], "points": [
            point for point in group["points"] if point["period"] in saved_totals
        ]} for group in rebuilt["group_series"]]
        coverage = {}
    elif group_source_id is not None:
        labels = rebuilt["group_period_values"]
        points = {value: [] for value in group_filter.values}
        omitted_months = 0
        for period, raw in sorted(saved_totals.items()):
            amount = _safe_number(raw)
            if amount is None:
                continue
            if period not in labels:
                omitted_months += 1
            elif labels[period] in points:
                points[labels[period]].append({"period": period, "amount": amount})
        series = [{"value": value, "points": values} for value, values in points.items()]
        coverage = {"cross_source_months_omitted": omitted_months}
    else:
        raise ValueError("This joined metric is unavailable. Rebuild the join and try again.")

    return {
        "series": series,
        "has_summarized_data": False,
        "metric_aggregation": _join_aggregation_label(aggregation_type),
        **({"dimension_label": dimension_label} if dimension_label else {}),
        **coverage,
    }


def _join_aggregation_label(aggregation_type):
    return {"avg": "Average", "min": "Minimum", "max": "Maximum"}.get(aggregation_type, aggregation_type.capitalize())


def _load_join_source(db, dataset, identity):
    from .dataset_loader import load_dataset

    try:
        original = load_dataset(db, identity)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        raise ValueError("A source for this join is unavailable.") from error
    if (original.workspace_id or original.user_id) != (dataset.workspace_id or dataset.user_id) or original.source_type == "joined":
        raise ValueError("A source for this join is unavailable.")
    return original


def _join_source_dimensions(selection, dataset, frame):
    return [item for item in dimension_columns(dataset, frame) if item["column"] != selection.get("date_column")]


def _join_source_column_key(identity, column):
    # Keep saved filter keys within the column length limit even for long source names.
    return f"{JOIN_SOURCE_COLUMN_PREFIX}{identity}_{sha256(column.encode('utf-8')).hexdigest()}"


def _join_source_dimension_label(dataset, item):
    return f"{dataset.file_name} / {item['label']}"


def joined_dashboard_dimension_options(db, dataset, frame, metric, column, search, offset):
    from .dataset_loader import load_dataframe_from_dataset

    joined_columns = dimension_columns(dataset, frame)
    joined_result = {"columns": joined_columns, "values": [], "next_offset": None}
    is_joined_column = column in {item["column"] for item in joined_columns}
    if is_joined_column:
        joined_result = dimension_options(dataset, frame, column, search, offset)

    config = parse_dataset_source_config(dataset)
    definition = config.get("join_definition")
    sources = (definition.get("selections") or []) if isinstance(definition, dict) else []
    legacy_column = column and not is_joined_column and not column.startswith(JOIN_SOURCE_COLUMN_PREFIX)
    metric_sources = config.get("join_metric_sources")
    identity = metric_sources.get(metric) if isinstance(metric_sources, dict) else None
    file_name, _, metric_name = (metric or "").rpartition(" · ")
    originals = []
    matches = []
    for source in sources:
        try:
            original = _load_join_source(db, dataset, source["dataset_id"])
        except ValueError:
            continue
        originals.append((source, original))
        if legacy_column and metric in frame:
            names = source.get("metric_columns") or ([source["metric_column"]] if source.get("metric_column") else None)
            # Older joins did not store a metric-to-source map.
            if (original.id == identity if identity is not None
                    else original.file_name == file_name and (names is None or metric_name in names)):
                matches.append(original.id)

    metric_source_id = matches[0] if len(matches) == 1 else None
    source_columns = []
    for source, original in originals:
        try:
            records = load_dataframe_from_dataset(original, apply_metric_selection=False)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            continue
        for item in _join_source_dimensions(source, original, records):
            name = item["column"]
            # New choices have stable keys. Accept old raw names only when restoring one for its metric's source.
            key = name if name == column and original.id == metric_source_id else _join_source_column_key(original.id, name)
            source_columns.append({"column": key, "label": _join_source_dimension_label(original, item)})
            if column == key and not is_joined_column:
                joined_result = dimension_options(original, records, name, search, offset)

    if column and not is_joined_column and not any(item["column"] == column for item in source_columns):
        raise ValueError("The selected dimension column is unavailable")

    return {
        **joined_result,
        "columns": [{**item, "label": f"{item['label']} (joined months)"} for item in joined_columns]
        + source_columns,
    }


def dashboard_group_series_for_dataset(db, dataset, frame, selection):
    if dataset.source_type != "joined":
        return dashboard_group_series(dataset, frame, selection)

    from .dataset_loader import load_dataframe_from_dataset

    def load_source(identity):
        original = _load_join_source(db, dataset, identity)
        return original, load_dataframe_from_dataset(original, apply_metric_selection=False)

    return joined_dashboard_group_series(dataset, frame, selection, load_source)
