import pandas as pd


def generate_chart_data(
    dataframe: pd.DataFrame
):
    numeric_columns = list(
        dataframe
        .select_dtypes(
            include=["number"]
        )
        .columns
    )

    if not numeric_columns:
        return None

    text_columns = [
        column
        for column in dataframe.columns
        if column not in numeric_columns
    ]

    x_key = (
        text_columns[0]
        if text_columns
        else dataframe.columns[0]
    )

    y_key = numeric_columns[0]

    return {
        "x_key": x_key,
        "y_key": y_key,
        "data": dataframe[
            [x_key, y_key]
        ]
        .head(50)
        .to_dict(
            orient="records"
        ),
    }