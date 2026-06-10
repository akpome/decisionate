import pandas as pd
import numpy as np


def identify_forecast_columns(
    dataframe: pd.DataFrame,
):
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
        column_name = column.lower()

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

    date_column, value_column = identify_forecast_columns(dataframe)

    if metric and metric in dataframe.columns:
        value_column = metric

    if value_column not in dataframe.columns:
        return {"error": f"Metric '{value_column}' not found"}

    numeric_columns = dataframe.select_dtypes(include="number").columns.tolist()

    if not date_column:
        return {"error": "No date column found"}

    if not value_column:
        return {"error": "No numeric column found"}

    working_dataframe = dataframe[[date_column, value_column]].copy()

    working_dataframe = working_dataframe.dropna()

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

        forecasts.append(
            round(
                float(forecast_value),
                2,
            )
        )

    recommendation = generate_recommendation(forecasts)

    return {
        "date_column": date_column,
        "value_column": value_column,
        "available_metrics": numeric_columns,
        "forecast": forecasts,
        "recommendation": recommendation,
    }


def generate_recommendation(
    forecasts: list[float],
):
    if len(forecasts) < 2:
        return {
            "title": "Insufficient Data",
            "message": "Not enough data to generate a recommendation.",
            "confidence": "low",
        }

    first_value = forecasts[0]

    last_value = forecasts[-1]

    if first_value == 0:
        growth = 0
    else:
        growth = (
            last_value
            - first_value
        ) / first_value

    forecast_changes = []

    for i in range(
        1,
        len(forecasts)
    ):
        previous = forecasts[i - 1]

        current = forecasts[i]

        if previous == 0:
            continue

        forecast_changes.append(
            (
                current
                - previous
            )
            / previous
        )

    average_change = (
        sum(forecast_changes)
        / len(forecast_changes)
        if forecast_changes
        else 0
    )

    if growth > 0.15:
        return {
            "title": "Increase Investment",
            "message": "Forecasted growth remains positive.",
            "reason": "The metric has shown strong upward growth over time.",
            "confidence": "medium",
        }
    elif growth > 0:
        return {
            "title": "Maintain Strategy",
            "message": "Growth remains positive.",
            "reason": "The metric is growing steadily without significant acceleration.",
            "confidence": "medium",
        }

    elif growth < -0.10:
        return {
            "title": "Investigate Decline",
            "message": "Performance is weakening.",
            "reason": "The metric has experienced a significant downward trend.",
            "confidence": "high",
        }

    else:
        return {
            "title": "Monitor Closely",
            "message": "Performance is stable.",
            "reason": "No significant growth or decline is currently detected.",
            "confidence": "low",
        }
