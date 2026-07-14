import pandas as pd

from app.modules.datasets.services.serialization import (
    dataframe_to_json_records,
)


def generate_preview(
    dataframe: pd.DataFrame,
    rows: int = 10
):
    if not isinstance(
        dataframe,
        pd.DataFrame,
    ):
        return []

    return dataframe_to_json_records(
        dataframe.head(rows)
    )
