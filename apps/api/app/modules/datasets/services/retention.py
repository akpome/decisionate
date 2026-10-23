"""Retention rules for connector-ingested analytical data."""

from __future__ import annotations

from datetime import date

import pandas as pd


CONNECTOR_DATA_RETENTION_YEARS = 3
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
    """Return the boundary partition; individual rows use the exact cutoff."""
    return connector_retention_cutoff_date(as_of).strftime("%Y-%m")


def connector_retention_cutoff_date(as_of: date | None = None) -> date:
    reference = as_of or date.today()
    try:
        return reference.replace(year=reference.year - CONNECTOR_DATA_RETENTION_YEARS)
    except ValueError:
        return reference.replace(year=reference.year - CONNECTOR_DATA_RETENTION_YEARS, day=28)


def filter_connector_dataframe_by_retention(
    dataframe: pd.DataFrame,
    date_column: str | None,
    as_of: date | None = None,
) -> pd.DataFrame:
    """Remove connector rows older than the exact calendar-date cutoff."""
    if dataframe.empty or not date_column or date_column not in dataframe.columns:
        return dataframe

    parsed_dates = pd.to_datetime(
        dataframe[date_column],
        errors="coerce",
        utc=True,
        format="mixed",
    )
    cutoff = pd.Timestamp(connector_retention_cutoff_date(as_of), tz="UTC")
    # Rows with an unusable source date are retained because their age cannot
    # be established from the connector payload without dropping live data.
    keep = parsed_dates.isna() | (parsed_dates >= cutoff)
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
    boundary = connector_retention_cutoff_date(as_of)
    # A legacy monthly total cannot be split at the cutoff day without
    # inventing daily values. Drop that partial month conservatively.
    cutoff = boundary.strftime("%Y-%m")
    if boundary.day > 1:
        cutoff = month_key_from_index(month_index(cutoff) + 1)
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
