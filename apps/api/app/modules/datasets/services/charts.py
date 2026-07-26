import pandas as pd

from app.modules.datasets.services.numeric import (
    get_numeric_columns,
)
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

    numeric_column_pairs = get_numeric_columns(
        dataframe
    )
    numeric_columns = [
        column
        for column, _ in numeric_column_pairs
    ]

    if not numeric_columns:
        return None

    text_columns = [
        column
        for column in dataframe.columns
        if column not in numeric_columns
    ]

    x_column = (
        text_columns[0]
        if text_columns
        else dataframe.columns[0]
    )

    y_column = numeric_columns[0]
    chart_columns = [
        x_column,
        *[
            column
            for column in numeric_columns
            if column != x_column
        ],
    ]
    chart_frame = (
        dataframe[
            chart_columns
        ]
        .tail(50)
        .copy()
    )

    numeric_series_by_column = dict(
        numeric_column_pairs
    )
    for column in numeric_columns:
        chart_frame[column] = numeric_series_by_column[
            column
        ].loc[chart_frame.index]

    return {
        "x_key": str(x_column),
        "y_key": str(y_column),
        "data": dataframe_to_json_records(
            chart_frame
        ),
    }
