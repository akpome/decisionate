import pandas as pd

from app.modules.datasets.services.numeric import (
    get_numeric_columns,
)
from app.modules.datasets.services.serialization import (
    dataframe_to_json_records,
)


def generate_chart_data(
    dataframe: pd.DataFrame,
    limit: int | None = 50,
    date_column=None,
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

    resolved_date_column = (
        date_column
        if date_column in dataframe.columns
        else find_date_column(
            dataframe,
            text_columns,
        )
    )
    if resolved_date_column is not None:
        x_column = resolved_date_column
    elif text_columns:
        x_column = text_columns[0]
    else:
        x_column = dataframe.columns[0]

    y_column = numeric_columns[0]
    # Keep every source column in the bounded chart sample. Industry
    # dashboards need text dimensions (for example, HubSpot channel/source)
    # alongside numeric metrics when a chart is manually mapped.
    chart_frame = dataframe.copy()

    if limit is not None:
        chart_frame = chart_frame.tail(limit)

    chart_frame = chart_frame.copy()

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


def find_date_column(
    dataframe: pd.DataFrame,
    columns: list,
):
    preferred_date_columns = (
        "date",
        "date_start",
        "created_at",
        "created_at_utc",
        "created",
        "created_date",
        "transaction_date",
        "invoice_date",
        "updated_at",
        "updated_date",
        "timestamp",
    )
    date_keywords = (
        "date",
        "day",
        "month",
        "year",
        "time",
        "period",
        "quarter",
        "created",
        "updated",
        "timestamp",
        "transaction",
    )

    ordered_columns = [
        *(
            column
            for preferred_column in preferred_date_columns
            for column in columns
            if str(column).lower() == preferred_column
        ),
        *columns,
    ]
    seen_columns = set()

    for column in ordered_columns:
        if column in seen_columns:
            continue
        seen_columns.add(column)
        column_name = str(column).lower()
        if not any(
            keyword in column_name
            for keyword in date_keywords
        ):
            continue

        values = dataframe[column].dropna().head(100)
        if values.empty:
            continue

        parsed_values = pd.to_datetime(
            values,
            errors="coerce",
        )
        if (
            parsed_values.notna().mean() >= 0.8
        ):
            return column

    return None
