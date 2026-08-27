from __future__ import annotations

import math

import pandas as pd

from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
)
from app.modules.datasets.services.summary_query import (
    is_summary_dataframe,
)
from app.modules.forecasting.services import (
    identify_forecast_columns,
    prepare_forecast_dataframe,
)


ANOMALY_SENSITIVITIES = {
    "high": {
        "robust_threshold": 2.5,
        "standard_threshold": 2.0,
    },
    "medium": {
        "robust_threshold": 3.5,
        "standard_threshold": 2.5,
    },
    "low": {
        "robust_threshold": 4.5,
        "standard_threshold": 3.0,
    },
}
MINIMUM_OBSERVATIONS = 5
FLOAT_EPSILON = 1e-12
SUMMARY_STATISTIC_SUFFIXES = (
    "__mean",
    "__min",
    "__max",
    "__count",
    "__sum",
)


def _finite_float(value):
    try:
        numeric_value = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return numeric_value if math.isfinite(numeric_value) else None


def _rounded_number(value):
    numeric_value = _finite_float(value)
    if numeric_value is None:
        return None
    return round(numeric_value, 6)


def _is_analysis_metric(column, date_column):
    column_name = str(column)
    return (
        column_name != str(date_column)
        and column_name not in {
            "__decisionate_summary__",
            "__decisionate_summary_month__",
        }
    )


def _format_period(value):
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return str(value)


def _metric_columns(dataframe, date_column):
    metrics = set()
    available_columns = {
        str(column)
        for column in dataframe.columns
    }
    summary_metric_names = set()
    if is_summary_dataframe(dataframe):
        summary_suffixes_by_metric = {}
        for column_name in available_columns:
            for suffix in SUMMARY_STATISTIC_SUFFIXES:
                if column_name.endswith(suffix):
                    candidate_metric = column_name[
                        : -len(suffix)
                    ]
                    summary_suffixes_by_metric.setdefault(
                        candidate_metric,
                        set(),
                    ).add(suffix)
                    break

        summary_metric_names = {
            metric_name
            for metric_name, suffixes in (
                summary_suffixes_by_metric.items()
            )
            if metric_name in available_columns
            or len(suffixes) >= 2
        }

    for column, _ in get_numeric_columns(dataframe):
        column_name = str(column)
        metric_name = column_name
        for suffix in SUMMARY_STATISTIC_SUFFIXES:
            if not column_name.endswith(suffix):
                continue

            candidate_metric = column_name[
                : -len(suffix)
            ]
            # Connector fields can legitimately end in names such as
            # ``Line__count``. Treat a suffix as a stored summary statistic
            # only when it belongs to a coherent summary metric group.
            if candidate_metric in summary_metric_names:
                metric_name = candidate_metric
                break

        if _is_analysis_metric(
            metric_name,
            date_column,
        ):
            metrics.add(metric_name)

    return sorted(metrics)


def _metric_result(
    dataframe: pd.DataFrame,
    date_column,
    metric: str,
    sensitivity: str,
    max_anomalies: int,
):
    dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
    )
    values = coerce_numeric_series(
        dataframe[metric]
    )
    points = pd.DataFrame({
        "period": dates,
        "value": values,
    }).dropna(subset=["period", "value"])
    points = points.sort_values(
        "period",
    ).reset_index(drop=True)

    observation_count = int(len(points.index))
    if observation_count < MINIMUM_OBSERVATIONS:
        return {
            "metric": metric,
            "status": "insufficient_data",
            "observation_count": observation_count,
            "anomaly_count": 0,
            "method": None,
            "threshold": None,
            "baseline": None,
            "spread": None,
            "anomalies": [],
            "message": (
                "At least five valid time periods are required "
                "before anomaly detection is evaluated."
            ),
        }

    numeric_values = points["value"].astype(float)
    median = float(numeric_values.median())
    absolute_deviations = (
        numeric_values - median
    ).abs()
    mad = float(absolute_deviations.median())
    sensitivity_config = ANOMALY_SENSITIVITIES[
        sensitivity
    ]

    if mad > FLOAT_EPSILON:
        method = "median_absolute_deviation"
        baseline = median
        spread = mad
        threshold = sensitivity_config[
            "robust_threshold"
        ]
        scores = (
            0.6745 * (numeric_values - baseline) / spread
        )
    else:
        first_quartile = float(
            numeric_values.quantile(0.25)
        )
        third_quartile = float(
            numeric_values.quantile(0.75)
        )
        interquartile_range = (
            third_quartile - first_quartile
        )

        if interquartile_range > FLOAT_EPSILON:
            method = "interquartile_range"
            baseline = median
            spread = interquartile_range
            threshold = sensitivity_config[
                "robust_threshold"
            ]
            robust_scale = interquartile_range / 1.349
            scores = (
                (numeric_values - baseline) / robust_scale
            )
        else:
            standard_deviation = float(
                numeric_values.std(ddof=0)
            )
            if standard_deviation > FLOAT_EPSILON:
                method = "standard_deviation"
                baseline = float(numeric_values.mean())
                spread = standard_deviation
                threshold = sensitivity_config[
                    "standard_threshold"
                ]
                scores = (
                    (numeric_values - baseline)
                    / spread
                )
            else:
                method = "constant_series"
                baseline = median
                spread = 0.0
                threshold = None
                scores = pd.Series(
                    0.0,
                    index=numeric_values.index,
                )

    points["score"] = scores.replace(
        [float("inf"), float("-inf")],
        float("nan"),
    )
    if threshold is None:
        anomaly_points = points.iloc[0:0]
    else:
        anomaly_points = points.loc[
            points["score"].abs() >= threshold
        ]

    anomaly_points = anomaly_points.assign(
        absolute_score=anomaly_points["score"].abs()
    ).sort_values(
        ["absolute_score", "period"],
        ascending=[False, False],
    ).head(max_anomalies)

    anomalies = []
    for _, point in anomaly_points.iterrows():
        value = float(point["value"])
        score = float(point["score"])
        anomalies.append({
            "period": _format_period(point["period"]),
            "value": _rounded_number(value),
            "baseline": _rounded_number(baseline),
            "deviation": _rounded_number(value - baseline),
            "score": _rounded_number(score),
            "direction": "high" if score > 0 else "low",
        })

    return {
        "metric": metric,
        "status": "ready",
        "observation_count": observation_count,
        "anomaly_count": int(
            len(anomaly_points.index)
        ),
        "method": method,
        "threshold": _rounded_number(threshold),
        "baseline": _rounded_number(baseline),
        "spread": _rounded_number(spread),
        "anomalies": anomalies,
        "message": (
            "No observations crossed the selected threshold."
            if not anomalies
            else None
        ),
    }


def detect_dataset_anomalies(
    dataframe: pd.DataFrame,
    *,
    metric: str | None = None,
    date_column: str | None = None,
    start_date: str | None = None,
    period_filter: str = "all",
    aggregation: str = "monthly",
    aggregation_type: str = "sum",
    sensitivity: str = "medium",
    max_anomalies: int = 100,
):
    """Detect statistical outliers in real, time-bucketed dataset values.

    This function intentionally does not infer causes. It only compares each
    selected period with a robust baseline calculated from the selected data.
    """
    if not isinstance(dataframe, pd.DataFrame):
        raise ValueError("Dataset data is not available for anomaly detection")

    clean_sensitivity = str(
        sensitivity or "medium"
    ).strip().lower()
    if clean_sensitivity not in ANOMALY_SENSITIVITIES:
        raise ValueError(
            "Sensitivity must be high, medium, or low"
        )

    clean_aggregation = str(
        aggregation or "monthly"
    ).strip().lower()
    if clean_aggregation not in {
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    }:
        raise ValueError("Unsupported anomaly aggregation")

    clean_aggregation_type = str(
        aggregation_type or "sum"
    ).strip().lower()
    if clean_aggregation_type not in {
        "sum",
        "count",
        "avg",
        "min",
        "max",
    }:
        raise ValueError("Unsupported anomaly aggregation type")

    selected_date_column = date_column
    if selected_date_column is None:
        selected_date_column, _ = identify_forecast_columns(
            dataframe
        )
    if selected_date_column not in dataframe.columns:
        raise ValueError(
            "Anomaly detection requires a valid date or time column"
        )

    if start_date:
        parsed_start_date = pd.to_datetime(
            str(start_date).strip(),
            errors="coerce",
        )
        if pd.isna(parsed_start_date):
            raise ValueError("Start date is invalid")

    available_metrics = _metric_columns(
        dataframe,
        selected_date_column,
    )
    clean_metric = (
        str(metric).strip()
        if metric is not None
        else ""
    )
    if clean_metric and clean_metric not in available_metrics:
        raise ValueError(
            f"Metric '{clean_metric}' is not numeric or was not found"
        )

    prepared_dataframe = prepare_forecast_dataframe(
        dataframe,
        selected_date_column,
        start_date,
        period_filter,
        clean_aggregation,
        clean_aggregation_type,
    )
    metrics_to_scan = (
        [clean_metric]
        if clean_metric
        else available_metrics
    )
    results = [
        _metric_result(
            prepared_dataframe,
            selected_date_column,
            metric_name,
            clean_sensitivity,
            max_anomalies,
        )
        for metric_name in metrics_to_scan
    ]

    if not results:
        status = "unavailable"
        message = (
            "No numeric metrics are available for anomaly detection."
        )
    elif any(
        result["status"] == "ready"
        for result in results
    ):
        status = "ready"
        message = None
    else:
        status = "insufficient_data"
        message = (
            "No selected metric has enough valid time periods "
            "for anomaly detection."
        )

    data_notes = []
    if is_summary_dataframe(dataframe):
        data_notes.append(
            "Historical summarized rows are evaluated at the "
            "stored granularity; daily row-level detail is not "
            "reconstructed from summaries."
        )

    total_anomaly_count = sum(
        result["anomaly_count"]
        for result in results
    )

    return {
        "status": status,
        "message": message,
        "date_column": str(selected_date_column),
        "metric": clean_metric or None,
        "available_metrics": available_metrics,
        "period_filter": str(period_filter or "all"),
        "start_date": str(start_date) if start_date else None,
        "aggregation": clean_aggregation,
        "aggregation_type": clean_aggregation_type,
        "sensitivity": clean_sensitivity,
        "minimum_observations": MINIMUM_OBSERVATIONS,
        "method_description": (
            "Robust outliers use the median and median absolute "
            "deviation. Interquartile-range or standard-deviation "
            "fallbacks are used when the robust spread is zero. "
            "The result identifies unusual values but does not infer "
            "their cause."
        ),
        "data_notes": data_notes,
        "total_anomaly_count": int(total_anomaly_count),
        "metrics": results,
    }
