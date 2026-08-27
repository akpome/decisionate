"""Dataset-level metric selection shared by analytical read paths."""

from __future__ import annotations

import json

import pandas as pd


DATASET_SELECTED_METRICS_KEY = "selected_metric_columns"

_SUMMARY_STATISTICS = (
    "mean",
    "min",
    "max",
    "count",
    "sum",
)
_GENERATED_METRIC_COLUMNS = {
    "__decisionate_summary__",
    "__decisionate_summary_month__",
}


def parse_dataset_source_config(dataset) -> dict:
    raw_config = getattr(dataset, "source_config", None)

    if isinstance(raw_config, dict):
        return raw_config

    if not isinstance(raw_config, str) or not raw_config.strip():
        return {}

    try:
        parsed_config = json.loads(raw_config)
    except json.JSONDecodeError:
        return {}

    return parsed_config if isinstance(parsed_config, dict) else {}


def _is_generated_metric_column(column) -> bool:
    column_name = str(column)

    return (
        column_name in _GENERATED_METRIC_COLUMNS
        or any(
            column_name.endswith(f"__{statistic}")
            for statistic in _SUMMARY_STATISTICS
        )
    )


def get_selectable_numeric_columns(
    dataframe: pd.DataFrame,
) -> list[str]:
    if not isinstance(dataframe, pd.DataFrame):
        return []

    return [
        str(column)
        for column in dataframe.columns
        if (
            pd.api.types.is_numeric_dtype(dataframe[column])
            and not pd.api.types.is_bool_dtype(dataframe[column])
            and not _is_generated_metric_column(column)
        )
    ]


def get_dataset_selected_metric_columns(dataset) -> list[str] | None:
    config = parse_dataset_source_config(dataset)

    if DATASET_SELECTED_METRICS_KEY not in config:
        # Existing datasets retain the previous behavior until configured.
        return None

    raw_selection = config.get(DATASET_SELECTED_METRICS_KEY)
    if not isinstance(raw_selection, list):
        return None

    selected_columns: list[str] = []
    seen: set[str] = set()
    for value in raw_selection:
        column = str(value).strip()
        if column and column not in seen:
            selected_columns.append(column)
            seen.add(column)

    return selected_columns


def normalize_selected_metric_columns(
    dataframe: pd.DataFrame,
    requested_columns: list[str],
) -> tuple[list[str], list[str]]:
    available_columns = get_selectable_numeric_columns(dataframe)
    available_set = set(available_columns)
    selected_columns: list[str] = []
    seen: set[str] = set()

    for value in requested_columns:
        column = str(value).strip()
        if not column or column in seen:
            continue
        if column not in available_set:
            raise ValueError(
                f"Metric column '{column}' is not numeric or was not found"
            )
        selected_columns.append(column)
        seen.add(column)

    # Preserve the source column order in the stored response and UI.
    selected_set = set(selected_columns)
    return available_columns, [
        column
        for column in available_columns
        if column in selected_set
    ]


def get_effective_dataset_metric_columns(
    dataset,
    dataframe: pd.DataFrame,
) -> list[str]:
    available_columns = get_selectable_numeric_columns(dataframe)
    selected_columns = get_dataset_selected_metric_columns(dataset)

    if selected_columns is None:
        return available_columns

    selected_set = set(selected_columns)
    return [
        column
        for column in available_columns
        if column in selected_set
    ]


def filter_dataframe_to_selected_metrics(
    dataset,
    dataframe: pd.DataFrame,
) -> pd.DataFrame:
    if not isinstance(dataframe, pd.DataFrame):
        return dataframe

    selected_columns = get_dataset_selected_metric_columns(dataset)
    if selected_columns is None:
        return dataframe

    selectable_columns = set(
        get_selectable_numeric_columns(dataframe)
    )
    selected_set = set(
        get_effective_dataset_metric_columns(
            dataset,
            dataframe,
        )
    )
    keep_columns = [
        column
        for column in dataframe.columns
        if (
            str(column) not in selectable_columns
            or str(column) in selected_set
        )
    ]

    return dataframe.loc[:, keep_columns].copy()
