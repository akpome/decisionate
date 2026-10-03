import pandas as pd

from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
    is_identifier_column,
)
from app.modules.datasets.services.serialization import (
    to_json_number,
)


def generate_metrics(
    dataframe: pd.DataFrame,
    selected_columns=None,
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return []

    metrics = []
    selected_column_set = (
        {
            str(column)
            for column in selected_columns
        }
        if selected_columns is not None
        else None
    )

    numeric_columns = dict(
        get_numeric_columns(dataframe)
    )

    # Preserve numeric columns that contain only missing values so their
    # metrics remain stable and serialize as zeroes instead of disappearing.
    for column in dataframe.columns:
        if column in numeric_columns:
            continue
        if not pd.api.types.is_numeric_dtype(dataframe[column]):
            continue
        numeric_columns[column] = coerce_numeric_series(
            dataframe[column]
        )

    for column, numeric_series in numeric_columns.items():
        column_label = str(column)
        if (
            selected_column_set is not None
            and column_label not in selected_column_set
        ):
            continue
        if (
            (
                is_identifier_column(column)
                and (
                    selected_column_set is None
                    or column_label not in selected_column_set
                )
            )
            or column_label in {
                "__decisionate_summary__",
                "__decisionate_summary_month__",
            }
            or any(
                column_label.endswith(
                    f"__{statistic}"
                )
                for statistic in (
                    "mean",
                    "min",
                    "max",
                    "count",
                    "sum",
                )
            )
        ):
            continue
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
