"""Date-normalized joins for cross-dataset dashboard evidence."""

from __future__ import annotations

import math
import re
import warnings
from collections import Counter

import pandas as pd

from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
)


JOIN_PERIOD_MONTHS = {
    "1m": 1,
    "1q": 3,
    "6m": 6,
    "1y": 12,
    "2y": 24,
    "3y": 36,
    "5y": 60,
}

JOIN_PERIODS = {
    "daily",
    "weekly",
    "monthly",
    "quarterly",
}
JOIN_NORMALIZATION_PERIOD = "monthly"
# Bump when join semantics change so persisted dashboard results are rebuilt.
JOIN_RESULT_VERSION = 6

JOIN_AGGREGATIONS = {
    "sum": "sum",
    "count": "count",
    "avg": "mean",
    "min": "min",
    "max": "max",
}

DATE_COLUMN_KEYWORDS = (
    "date",
    "month",
    "year",
    "time",
    "period",
    "quarter",
)

MONTH_ONLY_REFERENCE_YEAR = 2000
MONTH_ONLY_PATTERN = re.compile(
    r"^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|"
    r"apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|"
    r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?$",
    re.IGNORECASE,
)
DAY_FIRST_DATE_PATTERN = re.compile(
    r"(?<!\d)\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?!\d)"
)
MONTH_NUMBERS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _parse_dates(
    series: pd.Series,
    reference_year: int | None = None,
) -> pd.Series:
    text_values = series.astype("string").str.strip()
    month_names = text_values.str.extract(
        MONTH_ONLY_PATTERN,
        expand=False,
    ).str.lower()
    month_only = month_names.notna()
    parsed = pd.Series(
        pd.NaT,
        index=series.index,
        dtype="datetime64[ns]",
    )

    if month_only.any():
        month_numbers = month_names.loc[month_only].map(
            MONTH_NUMBERS
        )
        month_year = int(
            reference_year or MONTH_ONLY_REFERENCE_YEAR
        )
        month_dates = pd.to_datetime(
            pd.DataFrame(
                {
                    "year": month_year,
                    "month": month_numbers,
                    "day": 1,
                },
                index=month_numbers.index,
            ),
            errors="coerce",
        )
        parsed.loc[month_dates.index] = month_dates

    remaining = ~month_only
    if remaining.any():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            values = series.loc[remaining]
            try:
                parsed_values = pd.to_datetime(
                    values,
                    errors="coerce",
                    format="mixed",
                    utc=True,
                )
            except TypeError:
                parsed_values = pd.to_datetime(
                    values,
                    errors="coerce",
                    utc=True,
                )

            day_first_mask = values.astype("string").str.contains(
                DAY_FIRST_DATE_PATTERN,
                na=False,
            )
            if day_first_mask.any():
                day_first_values = pd.to_datetime(
                    values.loc[day_first_mask],
                    errors="coerce",
                    format="mixed",
                    dayfirst=True,
                    utc=True,
                )
                parsed_values.loc[day_first_values.index] = (
                    day_first_values
                )

        parsed.loc[parsed_values.index] = (
            parsed_values.dt.tz_convert(None).dt.normalize()
        )

    return parsed


def infer_date_columns(dataframe: pd.DataFrame) -> list[str]:
    candidates: list[tuple[str, float, bool]] = []

    for column in dataframe.columns:
        series = dataframe[column]
        if pd.api.types.is_numeric_dtype(series):
            continue

        parsed = _parse_dates(series)
        valid_ratio = float(parsed.notna().mean())
        if valid_ratio < 0.6:
            continue

        column_name = str(column).lower()
        keyword_match = any(
            keyword in column_name
            for keyword in DATE_COLUMN_KEYWORDS
        )
        if keyword_match or valid_ratio >= 0.8:
            candidates.append(
                (str(column), valid_ratio, keyword_match)
            )

    candidates.sort(
        key=lambda item: (
            not item[2],
            -item[1],
            item[0].lower(),
        )
    )
    return [column for column, _ratio, _keyword in candidates]


def _infer_explicit_year(series: pd.Series) -> int | None:
    text_values = series.astype("string").str.strip()
    month_only = text_values.str.extract(
        MONTH_ONLY_PATTERN,
        expand=False,
    ).notna()
    explicit_values = series.loc[~month_only]
    if explicit_values.empty:
        return None

    parsed = _parse_dates(explicit_values).dropna()
    if parsed.empty:
        return None

    years = parsed.dt.year
    return int(years.mode().iloc[0])


def _column_lookup(dataframe: pd.DataFrame) -> dict[str, object]:
    return {
        str(column): column
        for column in dataframe.columns
    }


def resolve_column(
    dataframe: pd.DataFrame,
    requested: str | None,
    label: str,
) -> object:
    lookup = _column_lookup(dataframe)
    clean_requested = str(requested or "").strip()
    if clean_requested and clean_requested in lookup:
        return lookup[clean_requested]

    raise ValueError(
        f"{label} '{clean_requested or 'not selected'}' was not found"
    )


def build_join_dataset_metadata(
    dataset,
    dataframe: pd.DataFrame,
) -> dict:
    date_columns = infer_date_columns(dataframe)
    numeric_columns = [
        str(column)
        for column, _series in get_numeric_columns(dataframe)
    ]

    date_range = {
        "start": None,
        "end": None,
    }
    if date_columns:
        parsed = _parse_dates(
            dataframe[date_columns[0]]
        ).dropna()
        if not parsed.empty:
            date_range = {
                "start": parsed.min().date().isoformat(),
                "end": parsed.max().date().isoformat(),
            }

    return {
        "dataset_id": dataset.id,
        "file_name": dataset.file_name,
        "row_count": dataset.row_count,
        "columns": [str(column) for column in dataframe.columns],
        "date_columns": date_columns,
        "numeric_columns": numeric_columns,
        "default_date_column": date_columns[0]
        if date_columns
        else None,
        "date_range": date_range,
    }


def _bucket_dates(
    dates: pd.Series,
    aggregation: str,
) -> pd.Series:
    if aggregation == "daily":
        return dates.dt.normalize()

    if aggregation == "weekly":
        return dates.dt.to_period("W-SUN").dt.start_time

    if aggregation == "quarterly":
        return dates.dt.to_period("Q").dt.start_time

    return dates.dt.to_period("M").dt.start_time


def _period_label(value: pd.Timestamp) -> str:
    return value.date().isoformat()


def _safe_number(value) -> float | None:
    if pd.isna(value):
        return None

    numeric_value = float(value)
    return numeric_value if math.isfinite(numeric_value) else None


def _safe_join_value(value):
    if pd.isna(value):
        return None
    if isinstance(value, str):
        return value
    return _safe_number(value)


def _aggregate_text_values(values: pd.Series) -> str | None:
    clean_values = (
        values.dropna()
        .astype("string")
        .str.strip()
    )
    clean_values = clean_values[clean_values.ne("")]
    if clean_values.empty:
        return None

    return " | ".join(
        dict.fromkeys(clean_values.tolist())
    )


def _apply_window(
    dataframe: pd.DataFrame,
    start_date: str | None,
    period_filter: str | None,
) -> pd.DataFrame:
    if dataframe.empty:
        return dataframe

    clean_period = str(period_filter or "all").strip().lower()
    parsed_start = None
    if str(start_date or "").strip():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            parsed_start = pd.to_datetime(
                str(start_date).strip(),
                errors="coerce",
            )
        if pd.isna(parsed_start):
            parsed_start = None

    if parsed_start is None and clean_period in JOIN_PERIOD_MONTHS:
        parsed_start = dataframe["join_date"].min()

    if parsed_start is None:
        return dataframe

    scoped = dataframe.loc[
        dataframe["join_date"] >= parsed_start
    ]
    months = JOIN_PERIOD_MONTHS.get(clean_period)
    if months:
        scoped = scoped.loc[
            scoped["join_date"]
            < parsed_start + pd.DateOffset(months=months)
        ]
    return scoped


def build_joined_dataset(
    dataset_frames: list[tuple[object, pd.DataFrame, dict]],
    selections: list[dict],
    start_date: str | None = None,
    period_filter: str | None = "all",
    aggregation: str = "monthly",
    aggregation_type: str = "sum",
) -> dict:
    clean_aggregation = str(aggregation).strip().lower()
    if clean_aggregation not in JOIN_PERIODS:
        raise ValueError("Join period must be daily, weekly, monthly, or quarterly")
    clean_period = str(period_filter or "all").strip().lower()

    clean_aggregation_type = str(
        aggregation_type or "sum"
    ).strip().lower()
    aggregation_function = JOIN_AGGREGATIONS.get(
        clean_aggregation_type
    )
    if not aggregation_function:
        raise ValueError("Unsupported join aggregation")

    frame_by_id = {
        int(dataset.id): (dataset, dataframe, metadata)
        for dataset, dataframe, metadata in dataset_frames
    }
    ordered_selections = sorted(
        selections,
        key=lambda selection: int(selection["dataset_id"]),
    )
    canonical_primary_dataset_id = int(
        ordered_selections[0]["dataset_id"]
    )
    grouped_frames: list[pd.DataFrame] = []
    details: list[dict] = []
    available_periods: set[str] = set()
    reference_year = None
    if str(start_date or "").strip():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            parsed_start = pd.to_datetime(
                str(start_date).strip(),
                errors="coerce",
            )
        if not pd.isna(parsed_start):
            reference_year = int(parsed_start.year)

    if reference_year == MONTH_ONLY_REFERENCE_YEAR:
        reference_year = None

    if reference_year is None:
        explicit_years: list[int] = []
        for selection in ordered_selections:
            dataset_id = int(selection["dataset_id"])
            frame = frame_by_id.get(dataset_id)
            if frame is None:
                continue

            _dataset, dataframe, metadata = frame
            date_column = selection.get("date_column") or metadata.get(
                "default_date_column"
            )
            if not date_column:
                continue

            try:
                date_column = resolve_column(
                    dataframe,
                    date_column,
                    "Join date column",
                )
            except ValueError:
                continue

            explicit_year = _infer_explicit_year(
                dataframe[date_column]
            )
            if explicit_year is not None:
                explicit_years.append(explicit_year)

        if explicit_years:
            reference_year = max(
                Counter(explicit_years).items(),
                key=lambda item: (item[1], item[0]),
            )[0]

    effective_start_date = start_date
    if (
        reference_year is not None
        and str(start_date or "").strip()
    ):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            parsed_start = pd.to_datetime(
                str(start_date).strip(),
                errors="coerce",
            )
        if (
            not pd.isna(parsed_start)
            and parsed_start.year == MONTH_ONLY_REFERENCE_YEAR
        ):
            effective_start_date = parsed_start.replace(
                year=reference_year
            ).date().isoformat()

    if (
        str(start_date or "").strip()
        or clean_period in JOIN_PERIOD_MONTHS
    ):
        dataset_starts: list[pd.Timestamp] = []
        for selection in ordered_selections:
            dataset_id = int(selection["dataset_id"])
            frame = frame_by_id.get(dataset_id)
            if frame is None:
                continue

            _dataset, dataframe, metadata = frame
            date_column = selection.get("date_column") or metadata.get(
                "default_date_column"
            )
            if not date_column:
                continue

            date_column = resolve_column(
                dataframe,
                date_column,
                f"Join date column for {getattr(_dataset, 'file_name', dataset_id)}",
            )
            parsed_dates = _parse_dates(
                dataframe[date_column],
                reference_year=reference_year,
            ).dropna()
            if not parsed_dates.empty:
                dataset_starts.append(parsed_dates.min())

        if dataset_starts:
            common_start = max(dataset_starts)
            requested_start = None
            if str(effective_start_date or "").strip():
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    requested_start = pd.to_datetime(
                        str(effective_start_date).strip(),
                        errors="coerce",
                    )
                if pd.isna(requested_start):
                    requested_start = None

            effective_start_date = max(
                value
                for value in (common_start, requested_start)
                if value is not None
            ).date().isoformat()

    for selection in ordered_selections:
        dataset_id = int(selection["dataset_id"])
        if dataset_id not in frame_by_id:
            raise ValueError("One of the selected datasets is unavailable")

        dataset, dataframe, metadata = frame_by_id[dataset_id]
        date_column = selection.get("date_column") or metadata.get(
            "default_date_column"
        )
        if not date_column:
            raise ValueError(
                f"{dataset.file_name} does not have a usable date column"
            )

        date_column = resolve_column(
            dataframe,
            date_column,
            f"Date column for {dataset.file_name}",
        )
        columns_to_join = [
            column
            for column in dataframe.columns
            if str(column) != str(date_column)
        ]
        if not columns_to_join:
            raise ValueError(
                f"{dataset.file_name} does not have any columns besides its join date"
            )
        numeric_columns = {
            str(column)
            for column, _series in get_numeric_columns(dataframe)
        }

        dates = _parse_dates(
            dataframe[date_column],
            reference_year=reference_year,
        )
        working = pd.DataFrame(
            {"join_date": dates}
        ).dropna(subset=["join_date"])
        working = _apply_window(
            working,
            effective_start_date,
            period_filter,
        )
        working["period"] = _bucket_dates(
            working["join_date"],
            JOIN_NORMALIZATION_PERIOD,
        )

        dataset_grouped = None
        for column in columns_to_join:
            column_name = str(column)
            is_numeric = column_name in numeric_columns
            values = (
                coerce_numeric_series(dataframe[column])
                if is_numeric
                else dataframe[column]
            )
            metric_working = working.copy()
            metric_working["value"] = values.loc[
                metric_working.index
            ]
            label = f"{dataset.file_name} · {column_name}"
            grouped_metric = (
                metric_working.groupby("period", sort=True)[
                    "value"
                ]
                .agg(
                    aggregation_function
                    if is_numeric
                    else _aggregate_text_values
                )
                .rename(label)
                .reset_index()
            )
            dataset_grouped = (
                grouped_metric
                if dataset_grouped is None
                else dataset_grouped.merge(
                    grouped_metric,
                    on="period",
                    how="outer",
                )
            )
            details.append(
                {
                    "dataset_id": dataset.id,
                    "file_name": dataset.file_name,
                    "date_column": str(date_column),
                    "metric_column": column_name,
                    "label": label,
                    "column_type": "numeric"
                    if is_numeric
                    else "categorical",
                    "source_rows": int(len(dataframe)),
                    "usable_rows": int(len(working)),
                    "period_count": int(
                        grouped_metric["period"].nunique()
                    ),
                }
            )

        if dataset_grouped is None:
            continue

        grouped_frames.append(dataset_grouped)
        period_labels = {
            _period_label(value)
            for value in dataset_grouped["period"]
        }
        available_periods.update(period_labels)

    joined = grouped_frames[0]
    for grouped in grouped_frames[1:]:
        joined = joined.merge(
            grouped,
            on="period",
            how="inner",
        )

    joined = joined.sort_values("period").reset_index(drop=True)
    rows = []
    for _, row in joined.iterrows():
        item = {
            "period": _period_label(row["period"]),
        }
        for detail in details:
            item[detail["label"]] = _safe_join_value(
                row[detail["label"]]
            )
        rows.append(item)

    matched_period_count = len(rows)
    available_period_count = len(available_periods)
    coverage = (
        round(
            matched_period_count
            / available_period_count
            * 100,
            1,
        )
        if available_period_count
        else 0.0
    )
    if not rows:
        raise ValueError(
            "The selected datasets have no shared periods after date normalization"
        )

    latest = rows[-1]
    latest_values = "; ".join(
        f"{detail['label']}: {latest.get(detail['label'])}"
        for detail in details
    )
    column_summary = ", ".join(
        detail["label"] for detail in details
    )
    decision_context = (
        f"Joined evidence from {len(dataset_frames)} datasets on normalized "
        f"month-year periods using {clean_aggregation_type} "
        f"aggregation. Shared periods: {matched_period_count} of "
        f"{available_period_count} available ({coverage}%). Columns: "
        f"{column_summary}. Latest shared period ({latest['period']}): "
        f"{latest_values}."
    )

    return {
        "join_version": JOIN_RESULT_VERSION,
        "primary_dataset_id": canonical_primary_dataset_id,
        "dataset_ids": [
            int(selection["dataset_id"])
            for selection in ordered_selections
        ],
        "join_key": "normalized_date",
        "join_type": "inner",
        "period": JOIN_NORMALIZATION_PERIOD,
        "aggregation_type": clean_aggregation_type,
        "start_date": effective_start_date,
        "period_filter": period_filter or "all",
        "matched_period_count": matched_period_count,
        "available_period_count": available_period_count,
        "coverage_percent": coverage,
        "datasets": details,
        "rows": rows,
        "decision_context": decision_context,
    }
