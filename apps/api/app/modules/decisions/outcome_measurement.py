from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from app.modules.datasets.services.charts import find_date_column


def _as_naive_timestamp(value) -> pd.Timestamp | None:
    if value is None:
        return None

    timestamp = pd.Timestamp(value)
    if pd.isna(timestamp):
        return None
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert(None)
    return timestamp


def measure_decision_metric(
    decision,
    dataframe: pd.DataFrame,
) -> dict:
    metric_column = str(decision.metric_column or "").strip()
    if not metric_column:
        raise ValueError(
            "Select a numeric metric on this decision before measuring its outcome"
        )
    if metric_column not in dataframe.columns:
        raise ValueError(
            f"The decision metric '{metric_column}' is not available in the dataset"
        )

    date_column = find_date_column(
        dataframe,
        list(dataframe.columns),
    )
    if date_column is None:
        raise ValueError(
            "A date column is required to compare the decision baseline with its outcome"
        )

    dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
        utc=True,
    ).dt.tz_convert(None)
    values = pd.to_numeric(
        dataframe[metric_column],
        errors="coerce",
    )
    usable = pd.DataFrame({"date": dates, "value": values}).dropna()
    if usable.empty:
        raise ValueError(
            "The selected date and metric columns do not contain usable values"
        )
    usable = usable.sort_values("date")

    decision_date = _as_naive_timestamp(decision.created_at)
    if decision_date is None:
        raise ValueError("The decision does not have a valid creation date")

    before = usable[usable["date"] < decision_date]
    after = usable[usable["date"] > decision_date]
    if before.empty:
        raise ValueError(
            "There is no data on or before the decision date to establish a baseline"
        )
    if after.empty:
        raise ValueError(
            "There is no data after the decision date to measure an outcome"
        )

    review_date = _as_naive_timestamp(decision.review_date)
    measured = after
    if review_date is not None:
        review_window = after[after["date"] >= review_date]
        if not review_window.empty:
            measured = review_window

    baseline_sample = before.tail(3)
    measured_sample = measured.head(3)
    baseline_value = float(baseline_sample["value"].mean())
    measured_value = float(measured_sample["value"].mean())
    delta_percent = None
    if baseline_value != 0:
        delta_percent = float(
            ((measured_value - baseline_value) / abs(baseline_value)) * 100
        )

    return {
        "date_column": str(date_column),
        "metric_column": metric_column,
        "baseline_value": baseline_value,
        "measured_value": measured_value,
        "delta_percent": delta_percent,
        "baseline_period_end": baseline_sample["date"].max().isoformat(),
        "measured_period_start": measured_sample["date"].min().isoformat(),
        "measured_at": datetime.now(UTC).replace(tzinfo=None),
    }
