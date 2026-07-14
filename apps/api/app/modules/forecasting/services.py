import warnings

import pandas as pd
import numpy as np

from app.modules.decisions.schemas import (
    DecisionConfidenceScore,
    HIGH_DECISION_CONFIDENCE,
    LOW_DECISION_CONFIDENCE,
    MEDIUM_DECISION_CONFIDENCE,
    VALID_DECISION_CONFIDENCE_SCORES,
)


def to_finite_forecast_number(
    value,
):
    try:
        numeric_value = float(
            value
        )
    except (TypeError, ValueError, OverflowError):
        return None

    if not np.isfinite(
        numeric_value
    ):
        return None

    return numeric_value


def format_forecast_period_label(
    value,
):
    if pd.isna(
        value
    ):
        return None

    if hasattr(
        value,
        "strftime",
    ):
        return value.strftime(
            "%Y-%m-%d"
        )

    clean_value = str(
        value
    ).strip()

    return clean_value or None


def build_forecast_period_labels(
    period_values,
    forecast_count: int,
):
    fallback_labels = [
        f"F{index + 1}"
        for index in range(
            forecast_count
        )
    ]

    if forecast_count <= 0:
        return []

    with warnings.catch_warnings():
        warnings.simplefilter(
            "ignore",
            UserWarning,
        )
        parsed_dates = pd.to_datetime(
            pd.Series(
                period_values
            ),
            errors="coerce",
        ).dropna()

    if len(parsed_dates) < 2:
        return fallback_labels

    frequency = None

    if len(parsed_dates) >= 3:
        frequency = pd.infer_freq(
            parsed_dates
        )

    if frequency:
        projected_dates = pd.date_range(
            start=parsed_dates.iloc[-1],
            periods=forecast_count + 1,
            freq=frequency,
        )[1:]
    else:
        interval = (
            parsed_dates.iloc[-1]
            - parsed_dates.iloc[-2]
        )

        if interval <= pd.Timedelta(0):
            return fallback_labels

        projected_dates = [
            parsed_dates.iloc[-1]
            + (interval * period)
            for period in range(
                1,
                forecast_count + 1,
            )
        ]

    labels = [
        format_forecast_period_label(
            projected_date
        )
        for projected_date in projected_dates
    ]

    return [
        label
        if label is not None
        else fallback_labels[index]
        for index, label in enumerate(
            labels
        )
    ]


def build_forecast_summary(
    values: list[float],
    forecasts: list[float],
    forecast_periods: list[str],
):
    current_value = (
        to_finite_forecast_number(
            values[-1]
        )
        if values
        else None
    )
    forecast_value = (
        to_finite_forecast_number(
            forecasts[-1]
        )
        if forecasts
        else None
    )

    if (
        current_value is None
        or forecast_value is None
    ):
        absolute_change = 0.0
        percent_change = 0.0
    else:
        absolute_change = (
            forecast_value
            - current_value
        )
        percent_change = (
            0.0
            if current_value == 0
            else (
                absolute_change
                / current_value
            ) * 100
        )

    if percent_change > 0:
        direction = "increase"
    elif percent_change < 0:
        direction = "decrease"
    else:
        direction = "stable"

    return {
        "current_value": round(
            current_value or 0.0,
            2,
        ),
        "forecast_value": round(
            forecast_value or 0.0,
            2,
        ),
        "absolute_change": round(
            absolute_change,
            2,
        ),
        "percent_change": round(
            percent_change,
            2,
        ),
        "direction": direction,
        "forecast_period": (
            forecast_periods[-1]
            if forecast_periods
            else None
        ),
    }


def identify_forecast_columns(
    dataframe: pd.DataFrame,
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return (
            None,
            None,
        )

    date_column = None
    value_column = None

    date_keywords = [
        "date",
        "month",
        "year",
        "time",
        "period",
        "quarter",
    ]

    for column in dataframe.columns:
        column_name = str(
            column
        ).lower()

        if any(keyword in column_name for keyword in date_keywords):
            date_column = column
            break

    numeric_columns = dataframe.select_dtypes(include="number").columns.tolist()

    if numeric_columns:
        value_column = numeric_columns[0]

    return (
        date_column,
        value_column,
    )


def generate_forecast(
    dataframe: pd.DataFrame,
    metric: str | None = None,
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return {
            "error": "Forecast data must be tabular"
        }

    date_column, value_column = identify_forecast_columns(dataframe)

    numeric_columns = dataframe.select_dtypes(include="number").columns.tolist()
    clean_metric = (
        str(metric).strip()
        if metric is not None
        else None
    )

    if not date_column:
        return {"error": "No date column found"}

    if clean_metric:
        if clean_metric not in dataframe.columns:
            return {"error": f"Metric '{clean_metric}' not found"}

        if clean_metric not in numeric_columns:
            return {"error": f"Metric '{clean_metric}' is not numeric"}

        value_column = clean_metric

    if not value_column:
        return {"error": "No numeric column found"}

    working_dataframe = dataframe[[date_column, value_column]].copy()

    working_dataframe[value_column] = pd.to_numeric(
        working_dataframe[value_column],
        errors="coerce",
    )

    working_dataframe = working_dataframe.replace(
        [
            np.inf,
            -np.inf,
        ],
        np.nan,
    ).dropna(
        subset=[
            date_column,
            value_column,
        ]
    )

    values = working_dataframe[value_column].tolist()

    if len(values) < 2:
        return {"error": "Not enough data"}

    x = np.arange(len(values))

    y = np.array(values)

    slope, intercept = np.polyfit(
        x,
        y,
        1,
    )

    forecasts = []

    for period in range(
        1,
        4,
    ):
        future_x = len(values) + period - 1

        forecast_value = slope * future_x + intercept

        finite_forecast_value = to_finite_forecast_number(
            forecast_value
        )

        if finite_forecast_value is None:
            finite_forecast_value = 0.0

        forecasts.append(
            round(
                finite_forecast_value,
                2,
            )
        )

    recommendation = generate_recommendation(forecasts)
    forecast_periods = build_forecast_period_labels(
        working_dataframe[date_column].tolist(),
        len(forecasts),
    )
    summary = build_forecast_summary(
        values,
        forecasts,
        forecast_periods,
    )

    return {
        "date_column": date_column,
        "value_column": value_column,
        "available_metrics": numeric_columns,
        "forecast": forecasts,
        "forecast_periods": forecast_periods,
        "summary": summary,
        "recommendation": recommendation,
    }


def generate_recommendation(
    forecasts: list[float],
):
    finite_forecasts = [
        forecast
        for forecast in (
            to_finite_forecast_number(
                forecast
            )
            for forecast in forecasts
        )
        if forecast is not None
    ]

    if len(finite_forecasts) < 2:
        return build_recommendation(
            title="Insufficient Data",
            message="Not enough data to generate a recommendation.",
            reason="More historical data is required before recommending an action.",
            confidence=LOW_DECISION_CONFIDENCE,
        )

    first_value = finite_forecasts[0]

    last_value = finite_forecasts[-1]

    if first_value == 0:
        growth = 0
    else:
        growth = (last_value - first_value) / first_value

    if growth > 0.15:
        return build_recommendation(
            title="Increase Investment",
            message="Forecasted growth remains positive.",
            reason="The metric has shown strong upward growth over time.",
            confidence=MEDIUM_DECISION_CONFIDENCE,
        )
    elif growth > 0:
        return build_recommendation(
            title="Maintain Strategy",
            message="Growth remains positive.",
            reason="The metric is growing steadily without significant acceleration.",
            confidence=MEDIUM_DECISION_CONFIDENCE,
        )

    elif growth < -0.10:
        return build_recommendation(
            title="Investigate Decline",
            message="Performance is weakening.",
            reason="The metric has experienced a significant downward trend.",
            confidence=HIGH_DECISION_CONFIDENCE,
        )

    else:
        return build_recommendation(
            title="Monitor Closely",
            message="Performance is stable.",
            reason="No significant growth or decline is currently detected.",
            confidence=LOW_DECISION_CONFIDENCE,
        )


def build_recommendation(
    title: str,
    message: str,
    reason: str,
    confidence: DecisionConfidenceScore,
):
    if confidence not in VALID_DECISION_CONFIDENCE_SCORES:
        raise ValueError(
            "Invalid recommendation confidence"
        )

    return {
        "title": title,
        "message": message,
        "reason": reason,
        "confidence": confidence,
    }
