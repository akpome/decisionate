"""Dataset-level metric selection shared by analytical read paths."""

from __future__ import annotations

import json
import re

import pandas as pd

from app.modules.datasets.services.metric_registry import (
    get_metric_definition,
    normalize_metric_column_name,
)
from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
    is_identifier_column,
)
from app.modules.datasets.services.summary_query import (
    is_summary_dataframe,
)


DATASET_SELECTED_METRICS_KEY = "selected_metric_columns"
DATASET_METRIC_DECISIONS_KEY = "metric_decisions"
DATASET_METRIC_OBJECTIVE_KEY = "business_objective"
DATASET_METRIC_PROFILE_VERSION = 1
SMALL_DATASET_MAX_ROWS = 15

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

_TECHNICAL_COLUMN_PATTERN = re.compile(
    r"(^|_)(api|internal|metadata|row|index|sequence|version|sync|partition|hash)(_|$)"
)
_DIMENSION_COLUMN_PATTERN = re.compile(
    r"(^|_)(category|channel|campaign|location|region|store|branch|status|type|class|segment)(_|$)"
)
_VALUE_COLUMN_WORDS = {
    "amount",
    "average",
    "balance",
    "count",
    "cost",
    "earnings",
    "expense",
    "margin",
    "number",
    "price",
    "profit",
    "quantity",
    "rate",
    "revenue",
    "sales",
    "spend",
    "tax",
    "total",
    "value",
}
_OBJECTIVE_ALIASES = {
    "increase_revenue": ("revenue", "sales", "profit", "orders"),
    "profitability": ("profit", "margin", "revenue", "cost", "expense"),
    "reduce_expenses": ("cost", "expense", "spend"),
    "cash_flow": ("balance", "payment", "cash", "receivable", "revenue"),
    "qualified_leads": ("lead", "conversion", "click", "call"),
    "retention": ("customer", "retained", "churn", "repeat"),
    "marketing_return": ("spend", "cost", "lead", "conversion", "revenue", "roas"),
}


def _dataset_source_type(dataset) -> str:
    return str(getattr(dataset, "source_type", "") or "").strip().lower()


def _column_words(column) -> set[str]:
    normalized = normalize_metric_column_name(column)
    return set(normalized.split("_")) if normalized else set()


def _looks_like_time_column(column, series: pd.Series) -> bool:
    words = _column_words(column)
    if words.intersection({"date", "day", "month", "quarter", "year", "time", "timestamp", "period"}):
        return True

    if not pd.api.types.is_numeric_dtype(series):
        try:
            parsed = pd.to_datetime(
                series,
                errors="coerce",
                format="mixed",
            )
        except (TypeError, ValueError):
            return False
        return parsed.notna().sum() >= max(2, int(series.notna().sum() * 0.8))

    if not words.intersection({"epoch", "unix", "timestamp", "time"}):
        return False
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        return False
    return bool(
        numeric.between(10**8, 10**13).all()
    )


def _numeric_series(dataframe: pd.DataFrame, column) -> pd.Series:
    return coerce_numeric_series(dataframe[column])


def _completeness(series: pd.Series, numeric_series: pd.Series | None) -> float:
    if len(series) == 0:
        return 0.0
    valid = (
        numeric_series.notna()
        if numeric_series is not None
        else series.notna()
    )
    return float(valid.sum() / len(series))


def _distinct_value_count(series: pd.Series) -> int:
    """Count dimension values even when legacy rows contain lists or dicts."""
    values = series.dropna()
    try:
        return int(values.nunique())
    except (TypeError, ValueError):
        normalized_values = values.map(
            lambda value: json.dumps(
                value,
                sort_keys=True,
                default=str,
            )
            if isinstance(value, (dict, list, tuple, set))
            else str(value)
        )
        return int(normalized_values.nunique())


def _variation(numeric_series: pd.Series, valid_count: int) -> float:
    if valid_count <= 1:
        return 0.0
    distinct_count = int(numeric_series.dropna().nunique())
    return min(1.0, distinct_count / max(5, min(valid_count, 20)))


def _is_low_cardinality_dimension(
    column,
    numeric_series: pd.Series,
    valid_count: int,
) -> bool:
    if valid_count <= 1:
        return True
    distinct_count = int(numeric_series.dropna().nunique())
    unique_ratio = distinct_count / valid_count
    return (
        bool(_DIMENSION_COLUMN_PATTERN.search(normalize_metric_column_name(column)))
        or (
            distinct_count <= 20
            and unique_ratio <= 0.2
        )
    )


def _duplicate_column(
    dataframe: pd.DataFrame,
    column,
    numeric_series: pd.Series,
    numeric_lookup: dict[str, pd.Series] | None = None,
):
    """Find an earlier numeric column with identical values.

    Numeric coercion is cached by the profiler. Re-coercing every earlier
    column for every candidate made metric selection quadratic in both column
    count and dataframe size.
    """
    for other_column in dataframe.columns:
        if str(other_column) == str(column):
            break
        other_numeric = (
            numeric_lookup.get(str(other_column))
            if numeric_lookup is not None
            else _numeric_series(dataframe, other_column)
        )
        if other_numeric is None:
            continue
        if numeric_series.equals(other_numeric):
            return str(other_column)
    return None


def _numeric_series_signature(series: pd.Series):
    """Build a cheap pre-check key before comparing full numeric columns."""
    hashed_values = pd.util.hash_pandas_object(
        series,
        index=True,
    )
    return (
        str(series.dtype),
        len(series),
        int(hashed_values.sum()),
    )


def _objective_from_dataset(dataset) -> str:
    config = parse_dataset_source_config(dataset)
    objective = str(
        config.get(DATASET_METRIC_OBJECTIVE_KEY)
        or "general_business"
    ).strip().lower()
    return objective or "general_business"


def _objective_relevance(
    normalized_column: str,
    definition,
    objective: str,
) -> float:
    if definition:
        if objective in definition.business_functions:
            return 1.0
        return 0.65

    aliases = _OBJECTIVE_ALIASES.get(objective, ())
    if aliases and any(alias in normalized_column for alias in aliases):
        return 0.8
    return 0.35


def _semantic_relevance(normalized_column: str, definition) -> float:
    if definition:
        return 1.0
    if any(word in _VALUE_COLUMN_WORDS for word in normalized_column.split("_")):
        return 0.55
    return 0.25


def _has_value_semantics(normalized_column: str, definition) -> bool:
    """Return whether a field name is plausibly a business measure."""
    return bool(
        definition
        or any(
            word in _VALUE_COLUMN_WORDS
            for word in normalized_column.split("_")
        )
    )


def _metric_reason(
    definition,
    completeness: float,
    score: float,
    status: str,
) -> str:
    if definition:
        reason = f"Recognized as {definition.canonical_name.replace('_', ' ')}"
    else:
        reason = "No connector definition matched this field"
    reason += f"; {round(completeness * 100)}% complete"
    if status == "recommended":
        return reason + f"; score {score:.2f}"
    return reason + "; needs confirmation"


def _saved_metric_decisions(dataset) -> dict[str, str]:
    config = parse_dataset_source_config(dataset)
    raw_decisions = config.get(DATASET_METRIC_DECISIONS_KEY)
    if not isinstance(raw_decisions, dict):
        return {}
    return {
        str(column): str(decision)
        for column, decision in raw_decisions.items()
        if str(column).strip() and str(decision).strip()
    }


def build_metric_selection_profile(
    dataset,
    dataframe: pd.DataFrame,
    objective: str | None = None,
) -> dict:
    """Profile every field and produce deterministic metric recommendations."""
    if not isinstance(dataframe, pd.DataFrame):
        return {
            "version": DATASET_METRIC_PROFILE_VERSION,
            "source_type": _dataset_source_type(dataset),
            "objective": objective or _objective_from_dataset(dataset),
            "recommended_metric_columns": [],
            "ambiguous_metric_columns": [],
            "advanced_metric_columns": [],
            "available_metric_columns": [],
            "fields": [],
        }

    resolved_objective = (
        str(objective or _objective_from_dataset(dataset)).strip().lower()
        or "general_business"
    )
    source_type = _dataset_source_type(dataset)
    saved_decisions = _saved_metric_decisions(dataset)
    row_count = len(dataframe)
    is_small_dataset = (
        row_count > 0
        and row_count <= SMALL_DATASET_MAX_ROWS
    )
    time_columns = [
        str(column)
        for column in dataframe.columns
        if _looks_like_time_column(column, dataframe[column])
    ]
    has_time_coverage = len(time_columns) > 0 and row_count > 1
    numeric_lookup = {
        str(column): series
        for column, series in get_numeric_columns(dataframe)
    }
    fields = []
    recommended_candidates = []
    ambiguous_candidates = []
    advanced_candidates = []
    available_metric_columns = []
    duplicate_candidates = {}
    for column in dataframe.columns:
        column_name = str(column)
        series = dataframe[column]
        numeric_series = numeric_lookup.get(column_name)
        is_numeric = (
            not pd.api.types.is_bool_dtype(series)
            and (
                numeric_series is not None
                or pd.api.types.is_numeric_dtype(series)
            )
        )
        if numeric_series is None and is_numeric:
            numeric_series = _numeric_series(dataframe, column)
        definition = get_metric_definition(column, source_type)
        normalized_column = normalize_metric_column_name(column)
        completeness = _completeness(series, numeric_series if is_numeric else None)
        valid_count = int(
            numeric_series.notna().sum()
            if is_numeric and numeric_series is not None
            else series.notna().sum()
        )
        distinct_count = _distinct_value_count(series)
        unique_ratio = (
            distinct_count / valid_count
            if valid_count
            else 0.0
        )
        duplicate_of = None
        if is_numeric and numeric_series is not None:
            signature = _numeric_series_signature(
                numeric_series
            )
            for candidate_column in duplicate_candidates.get(
                signature,
                [],
            ):
                if numeric_series.equals(
                    numeric_lookup[candidate_column]
                ):
                    duplicate_of = candidate_column
                    break
            duplicate_candidates.setdefault(
                signature,
                [],
            ).append(column_name)
        if duplicate_of and definition:
            duplicate_definition = get_metric_definition(
                duplicate_of,
                source_type,
            )
            if (
                duplicate_definition
                and duplicate_definition.canonical_name == definition.canonical_name
                and normalized_column == definition.canonical_name
            ):
                # Prefer the canonical field name when a connector exposes
                # both an alias such as ``unitquantity`` and ``quantity``.
                duplicate_field = next(
                    (
                        field
                        for field in fields
                        if field["column"] == duplicate_of
                    ),
                    None,
                )
                if duplicate_field:
                    duplicate_field.update(
                        role="technical",
                        status="excluded",
                        exclusion_reason=f"Duplicates '{column_name}'.",
                        reason=f"Duplicates '{column_name}'.",
                    )
                    available_metric_columns = [
                        name
                        for name in available_metric_columns
                        if name != duplicate_of
                    ]
                    recommended_candidates = [
                        field
                        for field in recommended_candidates
                        if field["column"] != duplicate_of
                    ]
                    ambiguous_candidates = [
                        field
                        for field in ambiguous_candidates
                        if field["column"] != duplicate_of
                    ]
                duplicate_of = None
        field = {
            "column": column_name,
            "role": "dimension",
            "status": "available",
            "score": 0.0,
            "confidence": 0.0,
            "reason": "Categorical field available for grouping.",
            "exclusion_reason": None,
            "completeness": round(completeness, 4),
            "distinct_count": distinct_count,
            "unique_ratio": round(unique_ratio, 4),
            "registry": definition.as_dict() if definition else None,
        }

        if _is_generated_metric_column(column, dataframe):
            field.update(
                role="technical",
                status="excluded",
                exclusion_reason="Generated summary or transport field.",
                reason="Generated summary or transport field.",
            )
        elif _looks_like_time_column(column, series):
            field.update(
                role="time",
                status="available",
                reason="Date or time field reserved for time dimensions.",
            )
        elif not is_numeric:
            field["role"] = (
                "technical"
                if _TECHNICAL_COLUMN_PATTERN.search(normalized_column)
                else "dimension"
            )
            if field["role"] == "technical":
                field.update(
                    status="excluded",
                    exclusion_reason="Internal or transport field.",
                    reason="Internal or transport field, not an analytical dimension.",
                )
        else:
            variation = _variation(numeric_series, valid_count)
            semantic = _semantic_relevance(normalized_column, definition)
            goal_relevance = _objective_relevance(
                normalized_column,
                definition,
                resolved_objective,
            )
            score = (
                0.30 * semantic
                + 0.20 * completeness
                + 0.15 * variation
                + 0.15 * (1.0 if has_time_coverage else 0.35)
                + 0.20 * goal_relevance
            )
            field["score"] = round(score, 4)
            field["confidence"] = round(min(1.0, score), 4)

            if is_identifier_column(column):
                field.update(
                    role="identifier",
                    status="excluded",
                    exclusion_reason="Identifier-like field, not a business quantity.",
                    reason="Identifier-like field, not a business quantity.",
                )
            elif (
                row_count >= 5
                and unique_ratio >= 0.98
                and not is_small_dataset
                and not _has_value_semantics(
                    normalized_column,
                    definition,
                )
            ):
                field.update(
                    role="identifier",
                    status="excluded",
                    exclusion_reason="Unique or nearly unique across the dataset.",
                    reason="Unique or nearly unique across the dataset, so it is likely an identifier.",
                )
            elif duplicate_of:
                field.update(
                    role="technical",
                    status="excluded",
                    exclusion_reason=f"Duplicates '{duplicate_of}'.",
                    reason=f"Duplicates '{duplicate_of}'.",
                )
            elif valid_count < 1:
                field.update(
                    role="technical",
                    status="excluded",
                    exclusion_reason="No usable observations.",
                    reason="No usable observations.",
                )
            elif completeness < 0.2:
                field.update(
                    role="technical",
                    status="excluded",
                    exclusion_reason="Almost entirely empty.",
                    reason="Almost entirely empty.",
                )
            elif is_small_dataset:
                field.update(
                    role=(
                        "derived_metric"
                        if definition and definition.derived
                        else "metric"
                    ),
                    status="recommended",
                    reason=(
                        "Selected because this small dataset has 15 or "
                        "fewer rows."
                    ),
                )
            elif distinct_count <= 1 and (
                not _has_value_semantics(
                    normalized_column,
                    definition,
                )
            ):
                field.update(
                    role="dimension",
                    status="excluded",
                    exclusion_reason="Contains no meaningful variation.",
                    reason="Contains no meaningful variation.",
                )
            elif _has_value_semantics(
                normalized_column,
                definition,
            ):
                field.update(
                    role="derived_metric" if definition and definition.derived else "metric",
                    status="recommended",
                    reason=_metric_reason(
                        definition,
                        completeness,
                        score,
                        "recommended",
                    ),
                )
            elif (
                _is_low_cardinality_dimension(
                    column,
                    numeric_series,
                    valid_count,
                )
                and not definition
            ):
                field.update(
                    role="dimension",
                    status="available",
                    reason="Low-cardinality code or category for grouping.",
                )
            elif score >= 0.68:
                field.update(
                    role="metric",
                    status="recommended",
                    reason=_metric_reason(None, completeness, score, "recommended"),
                )
            else:
                field.update(
                    role="metric",
                    status="ambiguous",
                    reason=_metric_reason(None, completeness, score, "ambiguous"),
                )

        saved_decision = saved_decisions.get(column_name)
        if (
            saved_decision == "metric"
            and field["status"] in {"recommended", "ambiguous"}
        ):
            field.update(
                status="recommended",
                reason="Previously confirmed as a metric by the user.",
            )
        elif (
            saved_decision == "rejected"
            and field["status"] == "ambiguous"
        ):
            field.update(
                role="metric",
                status="advanced",
                reason="Previously reviewed and kept out of metric calculations.",
            )

        if field["status"] in {"recommended", "ambiguous"}:
            available_metric_columns.append(column_name)
            if field["status"] == "recommended":
                recommended_candidates.append(field)
            else:
                ambiguous_candidates.append(field)
        elif field["status"] == "advanced":
            advanced_candidates.append(field)
        fields.append(field)

    metric_candidates = recommended_candidates + ambiguous_candidates
    outcomes = [
        field
        for field in metric_candidates
        if field["registry"] and field["registry"]["target_or_driver"] in {"outcome", "both"}
    ]
    drivers = [
        field
        for field in metric_candidates
        if field not in outcomes
    ]
    outcomes = sorted(
        outcomes,
        key=lambda field: (-field["score"], field["column"]),
    )
    drivers = sorted(
        drivers,
        key=lambda field: (-field["score"], field["column"]),
    )
    ranked_candidates = (
        outcomes
        + [field for field in drivers if field not in outcomes]
    )
    recommended = [
        field
        for field in ranked_candidates
        if field["status"] == "recommended"
    ]
    recommended_names = [field["column"] for field in recommended]
    recommended_name_set = set(recommended_names)

    return {
        "version": DATASET_METRIC_PROFILE_VERSION,
        "source_type": source_type,
        "objective": resolved_objective,
        "time_columns": time_columns,
        "recommended_metric_columns": recommended_names,
        "ambiguous_metric_columns": [
            field["column"]
            for field in ambiguous_candidates
            if field["column"] not in recommended_name_set
        ],
        "advanced_metric_columns": [
            field["column"] for field in advanced_candidates
        ],
        "available_metric_columns": available_metric_columns,
        "dimension_columns": [
            field["column"]
            for field in fields
            if field["role"] == "dimension"
        ],
        "excluded_columns": [
            field["column"]
            for field in fields
            if field["status"] == "excluded"
        ],
        "fields": fields,
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


def _is_generated_metric_column(
    column,
    dataframe: pd.DataFrame | None = None,
) -> bool:
    column_name = str(column)

    if column_name in _GENERATED_METRIC_COLUMNS:
        return True

    available_columns = (
        {str(value) for value in dataframe.columns}
        if isinstance(dataframe, pd.DataFrame)
        else set()
    )
    is_summary = (
        is_summary_dataframe(dataframe)
        if isinstance(dataframe, pd.DataFrame)
        else False
    )

    for statistic in _SUMMARY_STATISTICS:
        suffix = f"__{statistic}"
        if not column_name.endswith(suffix):
            continue

        base_metric = column_name[: -len(suffix)]
        if base_metric in available_columns:
            return True

        if is_summary:
            sibling_statistics = sum(
                f"{base_metric}__{sibling}" in available_columns
                for sibling in _SUMMARY_STATISTICS
            )
            if sibling_statistics >= 2:
                return True

    return False


def get_selectable_numeric_columns(
    dataframe: pd.DataFrame,
    dataset=None,
    profile: dict | None = None,
) -> list[str]:
    if not isinstance(dataframe, pd.DataFrame):
        return []

    resolved_profile = (
        profile
        if profile is not None
        else build_metric_selection_profile(
            dataset,
            dataframe,
        )
    )
    return list(resolved_profile.get("available_metric_columns", []))


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
    dataset=None,
    available_metric_columns: list[str] | None = None,
) -> tuple[list[str], list[str]]:
    if available_metric_columns is None:
        available_metric_columns = get_selectable_numeric_columns(
            dataframe,
            dataset,
        )
    available_columns = [
        str(column)
        for column in dataframe.columns
        if not _is_generated_metric_column(column, dataframe)
    ]
    available_set = set(available_columns)
    selected_columns: list[str] = []
    seen: set[str] = set()

    for value in requested_columns:
        column = str(value).strip()
        if not column or column in seen:
            continue
        if column not in available_set:
            raise ValueError(
                f"Column '{column}' was not found"
            )
        selected_columns.append(column)
        seen.add(column)

    # Preserve the source column order in the stored response and UI.
    selected_set = set(selected_columns)
    return available_metric_columns, [
        column
        for column in available_columns
        if column in selected_set
    ]


def get_effective_dataset_metric_columns(
    dataset,
    dataframe: pd.DataFrame,
    profile: dict | None = None,
) -> list[str]:
    resolved_profile = (
        profile
        if profile is not None
        else build_metric_selection_profile(
            dataset,
            dataframe,
        )
    )
    selected_columns = get_dataset_selected_metric_columns(dataset)

    if selected_columns is None:
        return list(
            resolved_profile.get(
                "recommended_metric_columns",
                [],
            )
        )

    # The profiler controls automatic defaults. Once a user explicitly saves
    # a selection, every real source column is eligible, including dimensions
    # and identifier-like numeric fields.
    available_columns = [
        str(column)
        for column in dataframe.columns
        if not _is_generated_metric_column(column, dataframe)
    ]
    selected_set = set(selected_columns)
    return [
        column
        for column in available_columns
        if column in selected_set
    ]


def filter_dataframe_to_selected_metrics(
    dataset,
    dataframe: pd.DataFrame,
    profile: dict | None = None,
) -> pd.DataFrame:
    if not isinstance(dataframe, pd.DataFrame):
        return dataframe

    selected_columns = get_dataset_selected_metric_columns(dataset)
    resolved_profile = (
        profile
        if profile is not None
        else build_metric_selection_profile(
            dataset,
            dataframe,
        )
    )
    automatic_metric_columns = set(
        resolved_profile.get("available_metric_columns", [])
    )

    metric_like_columns = {
        str(column)
        for column, _ in get_numeric_columns(dataframe)
        if (
            not pd.api.types.is_bool_dtype(dataframe[column])
            and (
                selected_columns is not None
                or str(column) in automatic_metric_columns
            )
            and not _is_generated_metric_column(
                column,
                dataframe,
            )
        )
    }
    selected_set = set(
        get_effective_dataset_metric_columns(
            dataset,
            dataframe,
            profile=resolved_profile,
        )
    )
    keep_columns = [
        column
        for column in dataframe.columns
        if (
            str(column) not in metric_like_columns
            or str(column) in selected_set
        )
    ]

    return dataframe.loc[:, keep_columns].copy()
