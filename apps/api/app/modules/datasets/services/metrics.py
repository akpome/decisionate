import pandas as pd

from app.modules.datasets.services.serialization import (
    to_json_number,
)


def generate_metrics(
    dataframe: pd.DataFrame
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return []

    metrics = []

    numeric_columns = (
        dataframe
        .select_dtypes(
            include=["number"]
        )
        .columns
    )

    for column in numeric_columns:
        column_label = str(column)
        total = to_json_number(
            dataframe[column].sum()
        )
        average = to_json_number(
            dataframe[column].mean()
        )
        minimum = to_json_number(
            dataframe[column].min()
        )
        maximum = to_json_number(
            dataframe[column].max()
        )

        metrics.append({
            "column": column_label,
            "total": total,
            "average": average,
            "min": minimum,
            "max": maximum,
            "minimum": minimum,
            "maximum": maximum,
        })

    return metrics
