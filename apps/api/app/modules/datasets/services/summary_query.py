from __future__ import annotations

import math

import pandas as pd


SUMMARY_MARKER_COLUMN = "__decisionate_summary__"
SUMMARY_MONTH_COLUMN = "__decisionate_summary_month__"
SUMMARY_STATISTICS = (
    "mean",
    "min",
    "max",
    "count",
    "sum",
)


def is_summary_dataframe(dataframe: pd.DataFrame):
    return (
        SUMMARY_MARKER_COLUMN in dataframe.columns
        and dataframe[SUMMARY_MARKER_COLUMN]
        .fillna(False)
        .astype(bool)
        .any()
    )


def _to_finite_number(value):
    try:
        numeric_value = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return numeric_value if math.isfinite(numeric_value) else None


def _first_finite_value(row, columns):
    for column in columns:
        if column not in row:
            continue
        value = _to_finite_number(row[column])
        if value is not None:
            return value
    return None


def _metric_columns(dataframe: pd.DataFrame):
    metric_columns = set()
    statistic_suffixes = tuple(
        f"__{statistic}"
        for statistic in SUMMARY_STATISTICS
    )

    for column in dataframe.select_dtypes(
        include="number"
    ).columns:
        column_name = str(column)
        if column_name in {
            SUMMARY_MARKER_COLUMN,
            SUMMARY_MONTH_COLUMN,
        }:
            continue
        if column_name.endswith(statistic_suffixes):
            metric_columns.add(
                column_name.rsplit("__", 1)[0]
            )
            continue
        metric_columns.add(column_name)

    return sorted(metric_columns)


def _summary_state(row, metric):
    if bool(row.get(SUMMARY_MARKER_COLUMN, False)):
        count = _first_finite_value(
            row,
            [f"{metric}__count"],
        )
        total = _first_finite_value(
            row,
            [f"{metric}__sum", metric],
        )
        mean = _first_finite_value(
            row,
            [f"{metric}__mean"],
        )
        resolved_count = count or (
            1 if total is not None or mean is not None else 0
        )
        resolved_total = total
        if resolved_total is None and mean is not None:
            resolved_total = mean * resolved_count

        minimum = _first_finite_value(
            row,
            [f"{metric}__min", metric],
        )
        maximum = _first_finite_value(
            row,
            [f"{metric}__max", metric],
        )

        if resolved_count <= 0 and minimum is None and maximum is None:
            return None

        return {
            "sum": resolved_total or 0.0,
            "count": resolved_count,
            "min": minimum,
            "max": maximum,
        }

    value = _to_finite_number(row.get(metric))
    if value is None:
        return None

    return {
        "sum": value,
        "count": 1,
        "min": value,
        "max": value,
    }


def _merge_states(current, next_state):
    if current is None:
        return dict(next_state)

    return {
        "sum": current["sum"] + next_state["sum"],
        "count": current["count"] + next_state["count"],
        "min": (
            next_state["min"]
            if current["min"] is None
            else current["min"]
            if next_state["min"] is None
            else min(current["min"], next_state["min"])
        ),
        "max": (
            next_state["max"]
            if current["max"] is None
            else current["max"]
            if next_state["max"] is None
            else max(current["max"], next_state["max"])
        ),
    }


def _finalize_state(state, aggregation_type):
    if not state or state["count"] <= 0:
        return 0.0
    if aggregation_type == "avg":
        return state["sum"] / state["count"]
    if aggregation_type == "min":
        return state["min"] or 0.0
    if aggregation_type == "max":
        return state["max"] or 0.0
    if aggregation_type == "count":
        return state["count"]
    return state["sum"]


def aggregate_summary_aware_dataframe(
    dataframe: pd.DataFrame,
    date_column,
    aggregation: str,
    aggregation_type: str,
):
    """Aggregate raw and monthly summary rows without treating summaries as raw rows."""
    if not date_column or not is_summary_dataframe(dataframe):
        return None

    parsed_dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
    )
    valid_dataframe = dataframe.loc[parsed_dates.notna()].copy()
    if valid_dataframe.empty:
        return valid_dataframe

    parsed_dates = parsed_dates.loc[valid_dataframe.index]
    if aggregation == "daily":
        buckets = parsed_dates.dt.normalize()
    elif aggregation == "weekly":
        buckets = parsed_dates.dt.to_period("W-SUN").dt.start_time
    elif aggregation == "quarterly":
        buckets = parsed_dates.dt.to_period("Q").dt.start_time
    else:
        buckets = parsed_dates.dt.to_period("M").dt.start_time

    metric_columns = _metric_columns(valid_dataframe)
    grouped = {}
    for index, bucket in buckets.items():
        bucket_key = pd.Timestamp(bucket)
        bucket_state = grouped.setdefault(
            bucket_key,
            {},
        )
        row = valid_dataframe.loc[index].to_dict()
        for metric in metric_columns:
            state = _summary_state(row, metric)
            if state is not None:
                bucket_state[metric] = _merge_states(
                    bucket_state.get(metric),
                    state,
                )

    rows = []
    for bucket, states in sorted(grouped.items()):
        row = {date_column: bucket}
        for metric in metric_columns:
            row[metric] = _finalize_state(
                states.get(metric),
                aggregation_type,
            )
        rows.append(row)

    return pd.DataFrame(rows)
