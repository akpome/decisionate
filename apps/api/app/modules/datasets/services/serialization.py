from datetime import date
from datetime import datetime
from decimal import Decimal
import math
from numbers import Integral
from numbers import Real

import numpy as np
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
    if value is None:
        return None

    if type(value) in (str, bool, int):
        return value
    if type(value) is float:
        return value if math.isfinite(value) else None

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

    if isinstance(value, (pd.Period, pd.Timedelta)):
        return str(value)

    if isinstance(value, dict):
        return {
            str(key): to_json_value(child)
            for key, child in value.items()
        }

    if isinstance(value, (list, tuple, set)):
        return [
            to_json_value(child)
            for child in value
        ]

    if isinstance(value, np.ndarray):
        return to_json_value(value.tolist())

    if isinstance(value, np.generic):
        return to_json_value(value.item())

    if isinstance(value, Decimal):
        try:
            numeric_value = float(value)
        except (TypeError, ValueError, OverflowError):
            return str(value)
        return (
            numeric_value
            if math.isfinite(numeric_value)
            else None
        )

    if isinstance(value, Integral):
        return int(value)

    if isinstance(value, Real):
        numeric_value = float(value)
        return (
            numeric_value
            if math.isfinite(numeric_value)
            else None
        )

    try:
        missing = pd.isna(value)
    except (TypeError, ValueError):
        missing = False
    if isinstance(missing, (bool, np.bool_)) and bool(missing):
        return None

    if isinstance(value, (str, bool)):
        return value

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    return str(value)
