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

    return {
        "date_column": date_column,
        "value_column": value_column,
        "available_metrics": numeric_columns,
        "forecast": forecasts,
    }
