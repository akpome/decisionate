import pandas as pd


NUMERIC_MISSING_VALUES = {
    "",
    "-",
    "\u2014",
    "na",
    "n/a",
    "nan",
    "null",
    "none",
    "inf",
    "+inf",
    "-inf",
    "infinity",
    "+infinity",
    "-infinity",
}


def coerce_numeric_series(
    series: pd.Series,
) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        numeric_values = pd.to_numeric(
            series,
            errors="coerce",
        )
        return numeric_values.replace(
            [float("inf"), float("-inf")],
            float("nan"),
        )

    text_values = (
        series
        .astype("string")
        .str.strip()
    )
    normalized_values = text_values.str.lower()
    accounting_negative = (
        text_values.str.startswith("(")
        & text_values.str.endswith(")")
    )
    cleaned_values = (
        text_values
        .mask(
            normalized_values.isin(
                NUMERIC_MISSING_VALUES
            )
        )
        .str.replace(
            r"^\((.*)\)$",
            r"\1",
            regex=True,
        )
        .str.replace(
            r"[$,%\s,]",
            "",
            regex=True,
        )
    )
    numeric_values = pd.to_numeric(
        cleaned_values,
        errors="coerce",
    )

    numeric_values = numeric_values.replace(
        [float("inf"), float("-inf")],
        float("nan"),
    )

    return numeric_values.where(
        ~accounting_negative.fillna(
            False
        ),
        -numeric_values,
    )


def get_numeric_columns(
    dataframe: pd.DataFrame,
):
    numeric_columns = []

    for column in dataframe.columns:
        series = dataframe[column]
        numeric_series = coerce_numeric_series(
            series
        )
        text_values = (
            series
            .astype("string")
            .str.strip()
            .str.lower()
        )
        meaningful_values = (
            series.notna()
            & ~text_values.isin(
                NUMERIC_MISSING_VALUES
            )
        )

        if (
            meaningful_values.any()
            and numeric_series[meaningful_values]
            .notna()
            .all()
        ):
            numeric_columns.append(
                (column, numeric_series)
            )

    return numeric_columns
