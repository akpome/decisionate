import pandas as pd


def generate_preview(
    dataframe: pd.DataFrame,
    rows: int = 10
):
    return (
        dataframe
        .head(rows)
        .to_dict(
            orient="records"
        )
    )