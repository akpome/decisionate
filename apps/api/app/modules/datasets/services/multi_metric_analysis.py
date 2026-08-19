"""Cross-dataset metric analysis without physically joining source tables."""

from __future__ import annotations

import math
from collections import Counter

import pandas as pd

from app.modules.ai.service import generate_structured_analysis
from app.modules.datasets.services.joins import (
    _bucket_dates,
    _infer_explicit_year,
    _parse_dates,
    resolve_column,
)
from app.modules.datasets.services.numeric import coerce_numeric_series


AGGREGATIONS = {
    "sum": "sum",
    "count": "count",
    "avg": "mean",
    "min": "min",
    "max": "max",
}

PERIOD_FILTER_MONTHS = {
    "1m": 1,
    "1q": 3,
    "6m": 6,
    "1y": 12,
    "2y": 24,
    "3y": 36,
    "5y": 60,
}


def _finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _selection_label(dataset, selection: dict) -> str:
    return (
        f"{getattr(dataset, 'file_name', 'Dataset')}"
        f" -> {selection['metric_column']}"
    )


def _parse_requested_start(value, reference_year: int | None):
    if not str(value or "").strip():
        return None
    with pd.option_context("mode.chained_assignment", None):
        parsed = pd.to_datetime(
            str(value),
            errors="coerce",
        )
    if pd.isna(parsed):
        return None
    if reference_year and parsed.year == 2000:
        parsed = parsed.replace(year=reference_year)
    return parsed.normalize()


def _build_metric_frame(
    dataset,
    dataframe: pd.DataFrame,
    selection: dict,
    grouping: str,
    reference_year: int | None,
) -> pd.DataFrame:
    date_column = resolve_column(
        dataframe,
        selection.get("date_column"),
        f"Date column for {getattr(dataset, 'file_name', 'dataset')}",
    )
    metric_column = resolve_column(
        dataframe,
        selection.get("metric_column"),
        f"Metric for {getattr(dataset, 'file_name', 'dataset')}",
    )
    numeric_values = coerce_numeric_series(dataframe[metric_column])
    parsed_dates = _parse_dates(
        dataframe[date_column],
        reference_year=reference_year,
    )
    frame = pd.DataFrame({
        "date": parsed_dates,
        "value": numeric_values,
    }).dropna(subset=["date", "value"])
    frame["period"] = _bucket_dates(frame["date"], grouping)
    return frame


def _aggregate_metric(frame: pd.DataFrame, aggregation: str):
    function = AGGREGATIONS.get(aggregation)
    if not function:
        raise ValueError("Unsupported metric aggregation")
    return (
        frame.groupby("period", sort=True)["value"]
        .agg(function)
        .rename("value")
        .reset_index()
    )


def _metric_summary(
    dataset,
    selection: dict,
    aggregated: pd.DataFrame,
) -> dict:
    values = aggregated["value"].dropna()
    first = _finite(values.iloc[0]) if not values.empty else None
    last = _finite(values.iloc[-1]) if not values.empty else None
    change_percent = None
    if first not in (None, 0) and last is not None:
        change_percent = _finite(((last - first) / abs(first)) * 100)

    return {
        "dataset_id": int(selection["dataset_id"]),
        "dataset_name": getattr(dataset, "file_name", "Dataset"),
        "metric": str(selection["metric_column"]),
        "label": _selection_label(dataset, selection),
        "aggregation": str(selection.get("aggregation") or "sum"),
        "period_count": int(len(values)),
        "total": _finite(values.sum()) if not values.empty else None,
        "average": _finite(values.mean()) if not values.empty else None,
        "minimum": _finite(values.min()) if not values.empty else None,
        "maximum": _finite(values.max()) if not values.empty else None,
        "first_value": first,
        "last_value": last,
        "change_percent": change_percent,
    }


def build_multi_metric_analysis(
    dataset_frames: list[tuple[object, pd.DataFrame]],
    definition: dict,
) -> dict:
    metrics = definition.get("metrics") or []
    grouping = str(definition.get("grouping") or "monthly").lower()
    period_filter = str(definition.get("period_filter") or "all").lower()
    if grouping not in {"daily", "weekly", "monthly", "quarterly"}:
        raise ValueError("Unsupported analysis grouping")
    if period_filter not in {"all", *PERIOD_FILTER_MONTHS}:
        raise ValueError("Unsupported analysis period")
    if not 1 <= len(metrics) <= 10:
        raise ValueError("Select between one and ten metrics")
    selection_keys = {
        (
            int(item["dataset_id"]),
            str(item.get("metric_column") or "").strip().lower(),
        )
        for item in metrics
    }
    if len(selection_keys) != len(metrics):
        raise ValueError("Select each dataset metric only once")

    frame_by_id = {
        int(dataset.id): (dataset, dataframe)
        for dataset, dataframe in dataset_frames
    }
    if len({int(item["dataset_id"]) for item in metrics}) > len(frame_by_id):
        raise ValueError("A selected dataset is unavailable")

    explicit_years = []
    for item in metrics:
        dataset_frame = frame_by_id.get(int(item["dataset_id"]))
        if not dataset_frame:
            raise ValueError("A selected dataset is unavailable")
        _dataset, dataframe = dataset_frame
        date_column = resolve_column(
            dataframe,
            item.get("date_column"),
            "Analysis date column",
        )
        explicit_year = _infer_explicit_year(dataframe[date_column])
        if explicit_year is not None:
            explicit_years.append(explicit_year)
        if str(item.get("aggregation") or "sum").lower() not in AGGREGATIONS:
            raise ValueError("Unsupported metric aggregation")

    reference_year = (
        Counter(explicit_years).most_common(1)[0][0]
        if explicit_years
        else None
    )

    metric_frames = []
    for item in metrics:
        dataset, dataframe = frame_by_id[int(item["dataset_id"])]
        metric_frame = _build_metric_frame(
            dataset,
            dataframe,
            item,
            grouping,
            reference_year,
        )
        if metric_frame.empty:
            raise ValueError(
                f"No usable dated values were found for {_selection_label(dataset, item)}"
            )
        metric_frames.append((dataset, item, metric_frame))

    common_start = max(frame["date"].min() for _dataset, _item, frame in metric_frames)
    common_end = min(frame["date"].max() for _dataset, _item, frame in metric_frames)
    requested_start = _parse_requested_start(
        definition.get("start_date"),
        reference_year,
    )
    effective_start = max(common_start, requested_start) if requested_start is not None else common_start
    effective_end = common_end
    months = PERIOD_FILTER_MONTHS.get(period_filter)
    if months:
        effective_end = min(
            common_end,
            effective_start + pd.DateOffset(months=months) - pd.Timedelta(days=1),
        )

    if effective_end < effective_start:
        raise ValueError("The selected metrics have no shared time window")

    summaries = []
    grouped_frames = []
    for dataset, item, frame in metric_frames:
        scoped = frame.loc[
            (frame["date"] >= effective_start)
            & (frame["date"] <= effective_end)
        ]
        aggregated = _aggregate_metric(
            scoped,
            str(item.get("aggregation") or "sum").lower(),
        )
        summaries.append(_metric_summary(dataset, item, aggregated))
        label = _selection_label(dataset, item)
        grouped_frames.append(
            aggregated.rename(columns={"value": label})
            .set_index("period")
        )

    bundle = pd.concat(grouped_frames, axis=1, join="outer").sort_index()
    rows = []
    for period, row in bundle.tail(60).iterrows():
        rows.append({
            "period": str(period.date()),
            **{
                str(column): _finite(value)
                for column, value in row.items()
            },
        })

    return {
        "period_filter": period_filter,
        "grouping": grouping,
        "start_date": effective_start.date().isoformat(),
        "end_date": effective_end.date().isoformat(),
        "metric_count": len(summaries),
        "period_count": int(len(bundle.index)),
        "metrics": summaries,
        "rows": rows,
        "decision_context": (
            "Selected metrics were queried independently from their source "
            "datasets, normalized to a common time window, and aggregated "
            "before being analyzed. This is an evidence summary; timing "
            "associations do not establish causation."
        ),
    }


def generate_multi_metric_ai_analysis(
    result: dict,
    learning_context: dict | None = None,
    workspace_id: str | None = None,
    actor_user_id: str | None = None,
):
    labels = [item["label"] for item in result["metrics"]]
    facts = {
        "common_time_window": {
            "start_date": result["start_date"],
            "end_date": result["end_date"],
            "grouping": result["grouping"],
        },
        "metrics": result["metrics"],
        "periodic_values": result["rows"][-24:],
    }
    if learning_context:
        facts["historical_decision_learning"] = learning_context

    return generate_structured_analysis(
        context="multi-dataset decision intelligence analysis",
        facts=facts,
        fallback_summary=(
            f"Compared {len(labels)} selected metrics across the shared "
            f"{result['grouping']} periods from {result['start_date']} "
            f"to {result['end_date']}."
        ),
        fallback_recommendations=[
            f"Review {label} against its latest grouped value and target."
            for label in labels[:5]
        ],
        fallback_risks=[
            "The metrics were aligned in time, but the observed movements "
            "do not prove that one metric caused another."
        ],
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
    )
