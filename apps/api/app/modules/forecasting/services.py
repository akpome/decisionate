import pandas as pd

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

        if any(
            keyword in column_name
            for keyword in date_keywords
        ):
            date_column = column
            break

    numeric_columns = (
        dataframe.select_dtypes(
            include="number"
        )
        .columns
        .tolist()
    )

    if numeric_columns:
        value_column = numeric_columns[0]

    return (
        date_column,
        value_column,
    )

def generate_forecast(
    dataframe: pd.DataFrame,
):

    date_column, value_column = (
        identify_forecast_columns(
            dataframe
        )
    )

    print(
        "COLUMNS:",
        dataframe.columns.tolist()
    )

    if not date_column:
        return {
            "error": "No date column found"
        }

    if not value_column:
        return {
            "error": "No numeric column found"
        }

    working_dataframe = dataframe[
        [date_column, value_column]
    ].copy()

    working_dataframe = (
        working_dataframe
        .dropna()
    )

    values = (
        working_dataframe[
            value_column
        ]
        .tail(3)
        .tolist()
    )

    if len(values) < 2:
        return {
            "error": "Not enough data"
        }

    growth_rates = []

    for i in range(
        1,
        len(values),
    ):
        previous = values[i - 1]

        current = values[i]

        if previous == 0:
            continue

        growth_rates.append(
            (
                current
                - previous
            )
            / previous
        )

    average_growth = (
        sum(growth_rates)
        / len(growth_rates)
        if growth_rates
        else 0
    )

    last_value = values[-1]

    forecasts = []

    for period in range(1, 4):
        last_value = (
            last_value
            * (
                1
                + average_growth
            )
        )

        forecasts.append(
            round(
                last_value,
                2,
            )
        )

    return {
        "date_column": date_column,
        "value_column": value_column,
        "forecast": forecasts,
    }