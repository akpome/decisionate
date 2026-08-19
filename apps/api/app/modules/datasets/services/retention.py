"""Retention rules for connector-ingested analytical data."""

from __future__ import annotations

from datetime import date

import pandas as pd


CONNECTOR_DATA_RETENTION_YEARS = 5
CONNECTOR_DATA_RETENTION_MONTHS = CONNECTOR_DATA_RETENTION_YEARS * 12


def month_index(value: str) -> int:
    year, month = (int(part) for part in str(value)[:7].split("-"))
    return year * 12 + month - 1


def month_key_from_index(index: int) -> str:
    year, month_zero_based = divmod(index, 12)
    return f"{year:04d}-{month_zero_based + 1:02d}"


def connector_retention_cutoff_month(
    as_of: date | None = None,
) -> str:
    """Return the first month still retained by the five-year rule.

    The current month and the preceding 59 calendar months remain available;
    older months are eligible for deletion.
    """
    reference = as_of or date.today()
    current_index = reference.year * 12 + reference.month - 1
    return month_key_from_index(
        current_index - CONNECTOR_DATA_RETENTION_MONTHS + 1
    )


def filter_connector_dataframe_by_retention(
    dataframe: pd.DataFrame,
    date_column: str | None,
    as_of: date | None = None,
) -> pd.DataFrame:
    """Remove connector rows whose source month is outside the retention window."""
    if dataframe.empty or not date_column or date_column not in dataframe.columns:
        return dataframe

    parsed_dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
        utc=True,
    )
    months = parsed_dates.dt.strftime("%Y-%m")
    cutoff = connector_retention_cutoff_month(as_of)
    # Rows with an unusable source date are retained because their age cannot
    # be established from the connector payload without dropping live data.
    keep = months.isna() | (months >= cutoff)
    return dataframe.loc[keep].reset_index(drop=True)


def filter_connector_summary_by_retention(
    dataframe: pd.DataFrame,
    summary_month_column: str,
    as_of: date | None = None,
) -> pd.DataFrame:
    """Remove summarized connector rows whose source month is too old."""
    if dataframe.empty or summary_month_column not in dataframe.columns:
        return dataframe

    months = dataframe[summary_month_column].astype(str).str.slice(0, 7)
    cutoff = connector_retention_cutoff_month(as_of)
    keep = dataframe[summary_month_column].isna() | (months >= cutoff)
    return dataframe.loc[keep].reset_index(drop=True)


def has_expired_connector_month(
    value: str,
    as_of: date | None = None,
) -> bool:
    """Return whether a YYYY-MM partition is outside the retention window."""
    try:
        return month_index(value) < month_index(
            connector_retention_cutoff_month(as_of)
        )
    except (TypeError, ValueError):
        return False
