from datetime import date
from datetime import datetime
import math

import pandas as pd


def to_json_number(value):
    if pd.isna(value):
        return 0.0

    try:
        numeric_value = float(value)
    except (
        TypeError,
        ValueError,
        OverflowError,
    ):
        return 0.0

    if not math.isfinite(numeric_value):
        return 0.0

    return numeric_value


def dataframe_to_json_records(
    dataframe: pd.DataFrame,
):
    json_safe_frame = (
        dataframe
        .astype(object)
    )

    records = (
        json_safe_frame
        .where(
            pd.notna(json_safe_frame),
            None,
        )
        .to_dict(
            orient="records"
        )
    )

    return [
        {
            str(key): to_json_value(value)
            for key, value in record.items()
        }
        for record in records
    ]


def to_json_value(value):
    if isinstance(
        value,
        pd.Timestamp,
    ):
        return value.isoformat()

    if isinstance(
        value,
        datetime,
    ):
        return value.isoformat()

    if isinstance(
        value,
        date,
    ):
        return value.isoformat()

    return value
