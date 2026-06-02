import pandas as pd


def generate_metrics(
    dataframe: pd.DataFrame
):
    metrics = []

    numeric_columns = (
        dataframe
        .select_dtypes(
            include=["number"]
        )
        .columns
    )

    for column in numeric_columns:
        metrics.append({
            "column": column,
            "total": float(
                dataframe[column].sum()
            ),
            "average": float(
                dataframe[column].mean()
            ),
            "minimum": float(
                dataframe[column].min()
            ),
            "maximum": float(
                dataframe[column].max()
            ),
        })

    return metrics