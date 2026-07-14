import pandas as pd

from app.modules.datasets.services.serialization import (
    dataframe_to_json_records,
)


def generate_chart_data(
    dataframe: pd.DataFrame
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return None

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
    chart_columns = [
        x_key,
        *[
            column
            for column in numeric_columns
            if column != x_key
        ],
    ]
    chart_frame = (
        dataframe[
            chart_columns
        ]
        .tail(50)
    )

    return {
        "x_key": str(x_key),
        "y_key": str(y_key),
        "data": dataframe_to_json_records(
            chart_frame
        ),
    }
