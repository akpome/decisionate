import pandas as pd

from app.modules.datasets.services.numeric import (
    get_numeric_columns,
)
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

    for column, numeric_series in get_numeric_columns(
        dataframe
    ):
        column_label = str(column)
        total = to_json_number(
            numeric_series.sum()
        )
        average = to_json_number(
            numeric_series.mean()
        )
        minimum = to_json_number(
            numeric_series.min()
        )
        maximum = to_json_number(
            numeric_series.max()
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
