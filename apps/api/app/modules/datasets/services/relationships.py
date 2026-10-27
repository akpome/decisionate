"""Evidence-based relationships between metrics from separate datasets."""

from __future__ import annotations

import math
from collections import Counter

import pandas as pd

from app.modules.datasets.services.joins import (
    _bucket_dates,
    _infer_explicit_year,
    _parse_dates,
    resolve_column,
)
from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
    is_identifier_column,
)
from app.modules.datasets.services.curated_metric_analytics import aggregate_curated_dataframe, frame_policy
from app.modules.datasets.services.dimension_filters import DimensionFilter, apply_dimension_filter
from app.modules.datasets.services.metric_selection import filter_dataframe_to_selected_metrics
from app.modules.correlation.defaults import (
    DEFAULT_AGGREGATION, DEFAULT_LAG_MODE, DEFAULT_LAG_PERIODS, DEFAULT_METHOD, DEFAULT_PERIOD,
    MAXIMUM_LAG, MAXIMUM_OBSERVATIONS, MINIMUM_ABS_COEFFICIENT, MINIMUM_OBSERVATIONS,
)


RELATIONSHIP_PERIODS = {
    "daily",
    "weekly",
    "monthly",
    "quarterly",
}

RELATIONSHIP_AGGREGATIONS = {
    "sum": "sum",
    "count": "count",
    "avg": "mean",
    "min": "min",
    "max": "max",
}

AUTO_MIN_ABSOLUTE_CORRELATION = MINIMUM_ABS_COEFFICIENT
AUTO_NEIGHBOR_MIN_ABSOLUTE_CORRELATION = 0.20


def relationship_definition_from_record(record, *, include_filters=True):
    selections = {}
    for side in ("left", "right"):
        saved = getattr(record, f"{side}_dimension_filter", None) if include_filters else None
        selections[side] = {
            "dataset_id": getattr(record, f"{side}_dataset_id"),
            "date_column": getattr(record, f"{side}_date_column"),
            "metric_column": getattr(record, f"{side}_metric"),
            "dimension_filter": DimensionFilter.model_validate_json(saved).model_dump() if saved is not None else None,
        }
    return {"name": record.name, **selections, "period": record.period, "aggregation": record.aggregation,
            "minimum_observations": getattr(record, "minimum_observations", None) or MINIMUM_OBSERVATIONS,
            "maximum_lag": MAXIMUM_LAG if getattr(record, "maximum_lag", None) is None else record.maximum_lag,
            "method": record.method, "lag_mode": getattr(record, "lag_mode", None) or "manual", "lag_periods": record.lag_periods}


def _safe_float(value) -> float | None:
    if pd.isna(value):
        return None

    result = float(value)
    return result if math.isfinite(result) else None


def _calculate_correlation(
    left: pd.Series,
    right: pd.Series,
    method: str,
) -> float | None:
    """Calculate correlation without requiring optional SciPy support.

    Pandas delegates Spearman correlation to SciPy, which is not part of the
    API runtime dependencies. Ranking both series first is the equivalent
    Spearman calculation and keeps relationship previews self-contained.
    """
    if method == "spearman":
        left = left.rank(method="average")
        right = right.rank(method="average")
        method = "pearson"

    return _safe_float(left.corr(right, method=method))


def _relationship_strength(correlation: float | None) -> str:
    if correlation is None:
        return "insufficient evidence"

    absolute = abs(correlation)
    if absolute >= 0.7:
        return "strong"
    if absolute >= 0.4:
        return "moderate"
    return "weak"


def _relationship_direction(correlation: float | None) -> str:
    if correlation is None:
        return "undetermined"
    if correlation >= 0.05:
        return "positive"
    if correlation <= -0.05:
        return "negative"
    return "neutral"


def _select_numeric_column(
    dataframe: pd.DataFrame,
    requested: str,
    label: str,
) -> object:
    column = resolve_column(dataframe, requested, label)
    numeric_columns = {
        str(name)
        for name, _series in get_numeric_columns(dataframe)
        if not is_identifier_column(name)
    }
    if str(column) not in numeric_columns:
        raise ValueError(
            f"{label} '{requested}' must be a numeric metric"
        )
    return column


def _build_metric_series(
    dataset,
    dataframe: pd.DataFrame,
    selection: dict,
    period: str,
    aggregation: str,
    reference_year: int | None,
) -> pd.DataFrame:
    selection_filter = selection.get("dimension_filter")
    if selection_filter is not None:
        source = dataframe
        dataframe = filter_dataframe_to_selected_metrics(dataset, source)
        # Retain grouping fields without making unselected measures eligible.
        column = selection_filter["column"]
        if column in source and column not in dataframe:
            dataframe = dataframe.copy()
            dataframe[column] = source[column]
    date_column = resolve_column(
        dataframe,
        selection.get("date_column"),
        f"Date column for {dataset.file_name}",
    )
    metric_column = _select_numeric_column(
        dataframe,
        selection.get("metric_column"),
        f"Metric for {dataset.file_name}",
    )
    if selection_filter is not None:
        dataframe = apply_dimension_filter(dataset, dataframe, selection_filter, metrics=[str(metric_column)])
    parsed_dates = _parse_dates(
        dataframe[date_column],
        reference_year=reference_year,
    )
    if frame_policy(dataframe):
        scoped = dataframe.copy()
        scoped[date_column] = parsed_dates
        grouped = aggregate_curated_dataframe(scoped, date_column, period)
        return grouped[[date_column, metric_column]].rename(columns={date_column: "period", metric_column: "value"})
    values = coerce_numeric_series(dataframe[metric_column])
    working = pd.DataFrame({
        "date": parsed_dates,
        "value": values,
    }).dropna(subset=["date"])
    working["period"] = _bucket_dates(
        working["date"],
        period,
    )
    aggregate = RELATIONSHIP_AGGREGATIONS[aggregation]
    grouped = (
        working.groupby("period", sort=True)["value"]
        .agg(aggregate)
        .rename("value")
        .reset_index()
    )
    if aggregation == "count":
        grouped = (
            working.groupby("period", sort=True)["value"]
            .count()
            .rename("value")
            .reset_index()
        )
    return grouped


def _apply_lag(aligned: pd.DataFrame, lag_periods: int) -> pd.DataFrame:
    if not lag_periods:
        return aligned.copy()
    if len(aligned) <= lag_periods:
        return aligned.iloc[0:0].copy()
    return pd.DataFrame({
        "period": aligned["period"].iloc[:-lag_periods].tolist(),
        "left_value": aligned["left_value"].iloc[:-lag_periods].tolist(),
        "right_value": aligned["right_value"].iloc[lag_periods:].tolist(),
    })


def _calculate_lag_result(
    aligned: pd.DataFrame,
    method: str,
    lag_periods: int,
    minimum_observations: int = MINIMUM_OBSERVATIONS,
) -> dict:
    lagged = _apply_lag(aligned, lag_periods).dropna(
        subset=["left_value", "right_value"]
    ).reset_index(drop=True)
    correlation = None
    if len(lagged) >= minimum_observations:
        correlation = _calculate_correlation(
            lagged["left_value"],
            lagged["right_value"],
            method,
        )
    return {
        "lag_periods": lag_periods,
        "matched_period_count": int(len(lagged)),
        "correlation": correlation,
        "aligned": lagged,
    }


def _is_same_direction(left: float | None, right: float | None) -> bool:
    if left is None or right is None:
        return False
    if abs(left) < 0.05 or abs(right) < 0.05:
        return False
    return (left > 0) == (right > 0)


def _score_lag_candidates(candidates: list[dict], minimum_observations: int = MINIMUM_OBSERVATIONS) -> list[dict]:
    by_lag = {
        item["lag_periods"]: item
        for item in candidates
    }
    scored = []
    for candidate in candidates:
        correlation = candidate["correlation"]
        neighbors = [
            by_lag[lag]
            for lag in (
                candidate["lag_periods"] - 1,
                candidate["lag_periods"] + 1,
            )
            if lag in by_lag
        ]
        usable_neighbors = [
            item
            for item in neighbors
            if item["correlation"] is not None
        ]
        same_direction_neighbors = [
            item
            for item in usable_neighbors
            if _is_same_direction(correlation, item["correlation"])
            and item["matched_period_count"] >= minimum_observations
            and abs(item["correlation"]) >= AUTO_NEIGHBOR_MIN_ABSOLUTE_CORRELATION
        ]
        stability = (
            len(same_direction_neighbors) / len(usable_neighbors)
            if usable_neighbors
            else 0.0
        )
        sufficient = candidate["matched_period_count"] >= minimum_observations
        meaningful = (
            correlation is not None
            and abs(correlation) >= AUTO_MIN_ABSOLUTE_CORRELATION
        )
        stable = bool(same_direction_neighbors) and stability >= 0.5
        coverage = min(
            1.0,
            candidate["matched_period_count"] / (minimum_observations * 2),
        )
        score = (
            (abs(correlation) if correlation is not None else 0.0) * 0.7
            + stability * 0.2
            + coverage * 0.1
        )
        scored.append({
            key: value
            for key, value in candidate.items()
            if key != "aligned"
        } | {
            "neighbor_count": len(usable_neighbors),
            "same_direction_neighbor_count": len(same_direction_neighbors),
            "stability": round(stability, 3),
            "credible": sufficient and meaningful and stable,
            "score": round(score, 4),
        })
    return scored


def _delay_description(period: str, lag_periods: int) -> str:
    if lag_periods == 0:
        return "in the same period"
    labels = {
        "daily": "day",
        "weekly": "week",
        "monthly": "month",
        "quarterly": "quarter",
    }
    label = labels[period]
    suffix = "" if lag_periods == 1 else "s"
    return f"approximately {lag_periods} {label}{suffix} later"


def _relationship_summary(
    left_label: str,
    right_label: str,
    strength: str,
    direction: str,
    delay_description: str,
    matched_period_count: int,
    credibility: str,
    minimum_observations: int,
) -> str:
    if credibility == "credible":
        opening = f"{strength.capitalize()} {direction} association."
        detail = (
            f"Changes in {left_label} have historically been most strongly "
            f"associated with {right_label} {delay_description}."
        )
    elif credibility == "manual":
        opening = f"Observed {strength} {direction} association in the selected comparison."
        detail = f"{left_label} and {right_label} were compared {delay_description}. This fixed comparison does not establish the best timing."
    elif credibility == "limited_evidence":
        opening = f"Observed {strength} {direction} association with limited evidence."
        detail = (
            f"The strongest observed alignment between {left_label} and "
            f"{right_label} appears {delay_description}, but nearby timing "
            "does not provide enough support for a confident timing conclusion."
        )
    else:
        opening = "Insufficient evidence for a reliable association."
        detail = (f"There is not enough matched history to describe how {left_label} "
                  f"and {right_label} move together. At least {minimum_observations} matched observations are required."
                  if matched_period_count < minimum_observations else
                  "Correlation could not be established from the matched values. Check metric variation and data quality.")
    return (
        f"{opening} {detail} Historical periods compared: "
        f"{matched_period_count}. Association does not establish causation."
    )


def build_dataset_relationship(
    dataset_frames: list[tuple[object, pd.DataFrame]],
    definition: dict,
    relationship_id: int | None = None,
) -> dict:
    period = str(definition.get("period") or DEFAULT_PERIOD).lower()
    aggregation = str(definition.get("aggregation") or DEFAULT_AGGREGATION).lower()
    method = str(definition.get("method") or DEFAULT_METHOD).lower()
    lag_mode = str(definition.get("lag_mode") or DEFAULT_LAG_MODE).lower()
    requested_lag = int(definition.get("lag_periods") or DEFAULT_LAG_PERIODS)
    minimum_observations = int(definition.get("minimum_observations", MINIMUM_OBSERVATIONS))
    maximum_lag = int(definition.get("maximum_lag", MAXIMUM_LAG))

    if period not in RELATIONSHIP_PERIODS:
        raise ValueError("Unsupported relationship period")
    if aggregation not in RELATIONSHIP_AGGREGATIONS:
        raise ValueError("Unsupported relationship aggregation")
    if method not in {"pearson", "spearman"}:
        raise ValueError("Unsupported relationship method")
    if lag_mode not in {"automatic", "manual"}:
        raise ValueError("Unsupported relationship timing mode")
    if requested_lag < 0 or requested_lag > MAXIMUM_LAG:
        raise ValueError("Relationship lag must be between 0 and 12 periods")
    # Historical internal runs can retain smaller samples; current API schemas enforce the shared floor.
    if not 2 <= minimum_observations <= MAXIMUM_OBSERVATIONS:
        raise ValueError("Unsupported minimum historical observations")
    if not 0 <= maximum_lag <= MAXIMUM_LAG or lag_mode == "manual" and requested_lag > maximum_lag:
        raise ValueError("The relationship lag must not exceed Maximum lag (0 to 12 periods)")
    if len(dataset_frames) != 2:
        raise ValueError("A relationship requires exactly two datasets")

    left = definition["left"]
    right = definition["right"]
    if int(left["dataset_id"]) == int(right["dataset_id"]):
        raise ValueError("Choose two different datasets")

    frame_by_id = {
        int(dataset.id): (dataset, dataframe)
        for dataset, dataframe in dataset_frames
    }
    if int(left["dataset_id"]) not in frame_by_id:
        raise ValueError("The left dataset is unavailable")
    if int(right["dataset_id"]) not in frame_by_id:
        raise ValueError("The right dataset is unavailable")

    explicit_years = []
    for selection in (left, right):
        _dataset, dataframe = frame_by_id[int(selection["dataset_id"])]
        date_column = resolve_column(
            dataframe,
            selection.get("date_column"),
            "Relationship date column",
        )
        explicit_year = _infer_explicit_year(dataframe[date_column])
        if explicit_year is not None:
            explicit_years.append(explicit_year)

    reference_year = (
        Counter(explicit_years).most_common(1)[0][0]
        if explicit_years
        else None
    )
    left_dataset, left_frame = frame_by_id[int(left["dataset_id"])]
    right_dataset, right_frame = frame_by_id[int(right["dataset_id"])]
    left_series = _build_metric_series(
        left_dataset,
        left_frame,
        left,
        period,
        aggregation,
        reference_year,
    ).rename(columns={"value": "left_value"})
    right_series = _build_metric_series(
        right_dataset,
        right_frame,
        right,
        period,
        aggregation,
        reference_year,
    ).rename(columns={"value": "right_value"})
    aligned = left_series.merge(
        right_series,
        on="period",
        how="inner",
    ).sort_values("period").reset_index(drop=True)

    if lag_mode == "automatic":
        raw_candidates = [
            _calculate_lag_result(aligned, method, lag, minimum_observations)
            for lag in range(maximum_lag + 1)
        ]
        candidates = _score_lag_candidates(raw_candidates, minimum_observations)
        credible_candidates = [
            item
            for item in candidates
            if item["credible"]
        ]
        selected_candidate = max(
            credible_candidates or candidates,
            key=lambda item: (
                item["score"],
                abs(item["correlation"] or 0.0),
                item["matched_period_count"],
                -item["lag_periods"],
            ),
            default={
                "lag_periods": 0,
                "matched_period_count": 0,
                "correlation": None,
                "credible": False,
                "score": 0.0,
            },
        )
        selected_raw = next(
            (
                item
                for item in raw_candidates
                if item["lag_periods"] == selected_candidate["lag_periods"]
            ),
            raw_candidates[0],
        )
        credibility = (
            "credible"
            if selected_candidate.get("credible")
            else (
                "limited_evidence"
                if selected_candidate.get("correlation") is not None
                else "insufficient_data"
            )
        )
    else:
        selected_raw = _calculate_lag_result(
            aligned,
            method,
            requested_lag,
            minimum_observations,
        )
        selected_candidate = {
            key: value
            for key, value in selected_raw.items()
            if key != "aligned"
        }
        selected_candidate.update({
            "credible": None,
            "score": None,
        })
        candidates = [selected_candidate]
        credibility = "manual" if selected_raw["correlation"] is not None else "insufficient_data"

    selected_aligned = selected_raw["aligned"]
    correlation = selected_raw["correlation"]
    lag_periods = selected_raw["lag_periods"]
    evidence = [
        {
            "period": str(row.period.date()),
            "left_value": _safe_float(row.left_value),
            "right_value": _safe_float(row.right_value),
        }
        for row in selected_aligned.tail(24).itertuples(index=False)
    ]
    left_label = f"{left_dataset.file_name} · {left['metric_column']}"
    right_label = f"{right_dataset.file_name} · {right['metric_column']}"
    strength = _relationship_strength(correlation)
    direction = _relationship_direction(correlation)
    delay_description = _delay_description(period, lag_periods)
    correlation_text = (
        f"{correlation:.2f}"
        if correlation is not None
        else "not available"
    )
    association_summary = _relationship_summary(
        left_label,
        right_label,
        strength,
        direction,
        delay_description,
        len(selected_aligned),
        credibility,
        minimum_observations,
    )
    decision_context = (
        f"{left_label} and {right_label} were compared using {method} "
        f"correlation over {len(selected_aligned)} shared {period} periods "
        f"with {aggregation} aggregation. Observed correlation: "
        f"{correlation_text} ({strength}, {direction}). "
        f"Timing: {delay_description}. {association_summary}"
    )
    scopes = []
    for dataset, selection in ((left_dataset, left), (right_dataset, right)):
        selected = selection.get("dimension_filter")
        if selected is not None:
            labels = ["Missing" if value is None else "Empty string" if value == "" else value for value in selected["values"]]
            scopes.append(f"{dataset.file_name} / {selected['column']}: {', '.join(labels)}")
    if scopes:
        decision_context += " Filters: " + "; ".join(scopes) + "."

    return {
        "id": relationship_id,
        "name": str(definition.get("name") or "Cross-source relationship").strip(),
        "left": left,
        "right": right,
        "left_dataset_name": left_dataset.file_name,
        "right_dataset_name": right_dataset.file_name,
        "period": period,
        "aggregation": aggregation,
        "method": method,
        "minimum_observations": minimum_observations,
        "maximum_lag": maximum_lag,
        "lag_mode": lag_mode,
        "lag_periods": lag_periods,
        "matched_period_count": int(len(selected_aligned)),
        "correlation": correlation,
        "relationship_strength": strength,
        "direction": direction,
        "evidence": evidence,
        "decision_context": decision_context,
        "association_summary": association_summary,
        "delay_description": delay_description,
        "lag_credibility": credibility,
        "lag_candidates": candidates,
        "causation_disclaimer": "Association does not establish causation.",
        "status": "ready" if correlation is not None else "insufficient_data",
    }
