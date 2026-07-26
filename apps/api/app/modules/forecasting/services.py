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
from app.modules.ai.service import (
    generate_structured_analysis,
)
from app.modules.datasets.services.numeric import (
    get_numeric_columns,
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

    numeric_columns = [
        column
        for column, _ in get_numeric_columns(
            dataframe
        )
    ]

    if numeric_columns:
        value_column = numeric_columns[0]

    return (
        date_column,
        value_column,
    )


def build_model_forecast(
    values: list[float],
    method: str,
    forecast_count: int,
):
    if not values or forecast_count <= 0:
        return []

    numeric_values = np.array(
        values,
        dtype=float,
    )

    if method == "last_value":
        forecast_values = np.repeat(
            numeric_values[-1],
            forecast_count,
        )
    elif method == "moving_average":
        window = min(3, len(numeric_values))
        forecast_values = np.repeat(
            np.mean(numeric_values[-window:]),
            forecast_count,
        )
    else:
        train_x = np.arange(len(numeric_values))
        slope, intercept = np.polyfit(
            train_x,
            numeric_values,
            1,
        )
        future_x = np.arange(
            len(numeric_values),
            len(numeric_values) + forecast_count,
        )
        forecast_values = slope * future_x + intercept

    return [
        round(
            to_finite_forecast_number(value) or 0.0,
            2,
        )
        for value in forecast_values
    ]


def score_forecast_predictions(
    predictions: list[float],
    actual_values: list[float],
):
    prediction_values = np.array(
        predictions,
        dtype=float,
    )
    actual_numeric_values = np.array(
        actual_values,
        dtype=float,
    )
    absolute_errors = np.abs(
        prediction_values - actual_numeric_values
    )
    nonzero_values = np.abs(
        actual_numeric_values
    ) > np.finfo(float).eps

    mape = None

    if np.any(nonzero_values):
        mape = float(
            np.mean(
                absolute_errors[nonzero_values]
                / np.abs(
                    actual_numeric_values[nonzero_values]
                )
                * 100
            )
        )

    rounded_mape = (
        round(mape, 2)
        if mape is not None
        else None
    )

    return {
        "mae": round(
            float(np.mean(absolute_errors)),
            2,
        ),
        "mape": rounded_mape,
    }


def evaluate_forecast_model(
    values: list[float],
):
    holdout_periods = min(
        3,
        max(
            1,
            len(values) // 4,
        ),
    )
    train_count = len(values) - holdout_periods

    if train_count < 2:
        return {
            "method": "linear_regression",
            "candidate_count": 1,
            "validation_periods": 0,
            "mae": None,
            "mape": None,
            "reliability": "limited",
        }

    train_values = values[:train_count]
    holdout_values = values[train_count:]
    candidate_methods = [
        "linear_regression",
        "last_value",
        "moving_average",
    ]
    scored_methods = []

    for method_index, method in enumerate(candidate_methods):
        predictions = build_model_forecast(
            train_values,
            method,
            holdout_periods,
        )
        score = score_forecast_predictions(
            predictions,
            holdout_values,
        )
        scored_methods.append({
            "method": method,
            "method_index": method_index,
            **score,
        })

    selected_method = min(
        scored_methods,
        key=lambda item: (
            item["mae"],
            item["method_index"],
        ),
    )

    return {
        "method": selected_method["method"],
        "candidate_count": len(scored_methods),
        "validation_periods": holdout_periods,
        "mae": selected_method["mae"],
        "mape": selected_method["mape"],
        "reliability": get_forecast_model_reliability(
            holdout_periods,
            selected_method["mape"],
        ),
    }


def get_forecast_model_reliability(
    validation_periods: int,
    mape: float | None,
):
    if validation_periods < 2:
        return "limited"

    if mape is not None and mape >= 50:
        return "low"

    if mape is not None and mape >= 25:
        return "moderate"

    return "good"


def generate_forecast(
    dataframe: pd.DataFrame,
    metric: str | None = None,
    learning_context: dict | None = None,
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return {
            "error": "Forecast data must be tabular"
        }

    date_column, value_column = identify_forecast_columns(dataframe)

    numeric_column_pairs = get_numeric_columns(
        dataframe
    )
    numeric_columns = [
        column
        for column, _ in numeric_column_pairs
    ]
    numeric_series_by_column = dict(
        numeric_column_pairs
    )
    dataframe_columns_by_label = {
        str(column): column
        for column in dataframe.columns
    }
    numeric_columns_by_label = {
        str(column): column
        for column in numeric_columns
    }
    clean_metric = (
        str(metric).strip()
        if metric is not None
        else None
    )

    if not date_column:
        return {"error": "No date column found"}

    if clean_metric:
        if clean_metric not in dataframe_columns_by_label:
            return {"error": f"Metric '{clean_metric}' not found"}

        if clean_metric not in numeric_columns_by_label:
            return {"error": f"Metric '{clean_metric}' is not numeric"}

        value_column = numeric_columns_by_label[
            clean_metric
        ]

    if not value_column:
        return {"error": "No numeric column found"}

    working_dataframe = dataframe[[date_column, value_column]].copy()

    working_dataframe[value_column] = numeric_series_by_column[
        value_column
    ].loc[working_dataframe.index]

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

    # Forecasts must follow calendar order even when an uploaded file does not.
    with warnings.catch_warnings():
        warnings.simplefilter(
            "ignore",
            UserWarning,
        )
        parsed_dates = pd.to_datetime(
            working_dataframe[date_column],
            errors="coerce",
        )

    if parsed_dates.notna().sum() >= 2:
        sorted_indexes = (
            parsed_dates.dropna()
            .sort_values(kind="stable")
            .index
        )
        working_dataframe = working_dataframe.loc[
            sorted_indexes
        ]

    values = working_dataframe[value_column].tolist()

    if len(values) < 2:
        return {"error": "Not enough data"}

    model_quality = evaluate_forecast_model(
        values,
    )
    forecasts = build_model_forecast(
        values,
        model_quality["method"],
        3,
    )

    forecast_periods = build_forecast_period_labels(
        working_dataframe[date_column].tolist(),
        len(forecasts),
    )
    summary = build_forecast_summary(
        values,
        forecasts,
        forecast_periods,
    )
    recommendation = apply_model_quality_to_recommendation(
        generate_recommendation(forecasts),
        model_quality,
    )
    ai_facts = {
        "date_column": str(date_column),
        "value_column": str(value_column),
        "recent_values": [
            round(float(value), 4)
            for value in values[-12:]
        ],
        "forecast_values": forecasts,
        "forecast_periods": forecast_periods,
        "summary": summary,
        "model_quality": model_quality,
    }

    if learning_context:
        ai_facts["historical_decision_learning"] = learning_context

    ai_analysis = generate_structured_analysis(
        context="dataset metric forecast and decision recommendation",
        facts=ai_facts,
        fallback_summary=recommendation["message"],
        fallback_recommendations=[
            recommendation["reason"],
        ],
        fallback_risks=(
            ["The forecast indicates a declining trend."]
            if summary["direction"] == "decrease"
            else []
        ),
    )
    ai_analysis = apply_model_quality_to_analysis(
        ai_analysis,
        model_quality,
    )

    return {
        "date_column": date_column,
        "value_column": value_column,
        "available_metrics": numeric_columns,
        "forecast": forecasts,
        "forecast_periods": forecast_periods,
        "summary": summary,
        "model_quality": model_quality,
        "recommendation": recommendation,
        "ai_analysis": ai_analysis,
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

    return build_recommendation(
        title="Monitor Closely",
        message="Performance is stable.",
        reason="No significant growth or decline is currently detected.",
        confidence=LOW_DECISION_CONFIDENCE,
    )


def apply_model_quality_to_recommendation(
    recommendation: dict,
    model_quality: dict,
):
    adjusted_recommendation = dict(
        recommendation
    )
    adjusted_recommendation[
        "confidence"
    ] = cap_confidence_for_model_quality(
        recommendation.get(
            "confidence",
            LOW_DECISION_CONFIDENCE,
        ),
        model_quality,
    )

    return adjusted_recommendation


def apply_model_quality_to_analysis(
    analysis: dict,
    model_quality: dict,
):
    adjusted_analysis = dict(analysis)
    adjusted_analysis[
        "confidence"
    ] = cap_confidence_for_model_quality(
        analysis.get(
            "confidence",
            LOW_DECISION_CONFIDENCE,
        ),
        model_quality,
    )

    return adjusted_analysis


def cap_confidence_for_model_quality(
    confidence: str,
    model_quality: dict,
):
    validation_periods = model_quality.get(
        "validation_periods",
        0,
    )
    mape = model_quality.get("mape")

    reliability = model_quality.get("reliability")

    if reliability is None:
        reliability = get_forecast_model_reliability(
            validation_periods,
            mape if isinstance(mape, (int, float)) else None,
        )

    if reliability in {"limited", "low"}:
        return LOW_DECISION_CONFIDENCE

    if reliability == "moderate":
        return (
            MEDIUM_DECISION_CONFIDENCE
            if confidence == HIGH_DECISION_CONFIDENCE
            else LOW_DECISION_CONFIDENCE
        )

    return confidence


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
