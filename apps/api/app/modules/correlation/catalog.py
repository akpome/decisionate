"""Server-approved metric semantics, independent of client-supplied labels."""

from collections import Counter
import os
from zoneinfo import ZoneInfo

import pandas as pd

from app.modules.datasets.services.curated_metric_analytics import aggregate_curated_dataframe, frame_policy
from app.modules.datasets.services.joins import _infer_explicit_year, _parse_dates
from app.modules.datasets.services.metric_recommendations import config_for
from app.modules.datasets.services.metric_selection import build_metric_selection_profile, get_dataset_selected_metric_columns
from app.modules.datasets.services.numeric import is_identifier_column
from app.modules.datasets.services.relationships import _build_metric_series
from app.modules.datasets.services.sources import IMPLEMENTED_CONNECTOR_TYPES
from app.modules.datasets.services.summary_query import is_summary_dataframe


def reporting_timezone():
    value = os.getenv("CORRELATION_REPORTING_TIMEZONE", "UTC")
    ZoneInfo(value)
    return value


def metric_catalog(dataset, frame):
    if dataset.source_type == "entity_matching" and not config_for(dataset).get("entity_history"):
        from app.modules.datasets.services.entity_history import LEGACY_SUMMARY_MESSAGE
        return {"dataset_id": dataset.id, "dataset_label": dataset.file_name, "connector": dataset.source_type,
                "date_columns": [], "availability": {}, "metrics": [],
                "metric_issues": [{"code": "entity_history_required", "message": LEGACY_SUMMARY_MESSAGE}],
                "freshness": None, "timezone": reporting_timezone()}
    profile = build_metric_selection_profile(dataset, frame)
    dates = [field["column"] for field in profile["fields"] if field["role"] == "time" and field["column"] in frame]
    saved_selection = get_dataset_selected_metric_columns(dataset)
    selected = set(saved_selection or [])
    issues = []
    if saved_selection is None:
        issues.append({"code": "selection_not_saved"})
    elif not selected:
        issues.append({"code": "no_metrics_selected"})
    policy = frame_policy(frame)
    if dataset.source_type in IMPLEMENTED_CONNECTOR_TYPES and not policy:
        # Legacy line-expanded connector selections are not proof of safe grain.
        issues.append({"code": "transaction_policy_required"})
        selected = set()
    for key in sorted(selected - set(frame.columns)):
        issues.append({"metric_key": key, "code": "column_unavailable"})
    metrics = []
    for field in profile["fields"]:
        key = field["column"]
        if key not in frame or key not in selected:
            continue
        if is_identifier_column(key):
            issues.append({"metric_key": key, "code": "identifier_field"})
            continue
        descriptor = policy["descriptors"].get(key) if policy else None
        registry = field.get("registry")
        if descriptor:
            aggregation = "policy"
            unit, currency = descriptor["unit"], descriptor.get("currency")
            components = descriptor.get("components", [])
        elif registry and not registry.get("derived") and registry.get("aggregation") in {"sum", "avg", "min", "max", "count", "last"}:
            # A user must have explicitly selected this legacy metric. A small
            # dataset's numeric blanket alone does not grant v2 eligibility.
            aggregation = registry["aggregation"]
            unit, currency, components = registry.get("unit", "number"), None, []
            if unit in {"ratio", "percentage", "percent", "rate"} or is_summary_dataframe(frame):
                issues.append({"metric_key": key, "code": "formula_required" if unit in {"ratio", "percentage", "percent", "rate"} else "summary_policy_required"})
                continue
        else:
            issues.append({"metric_key": key, "code": "formula_required" if registry and registry.get("derived") else "aggregation_unconfirmed"})
            continue
        if unit == "currency" and not policy and "currency" in frame:
            currencies = frame.loc[frame[key].notna(), "currency"].astype("string").str.strip().str.upper()
            if currencies.isna().any() or currencies.nunique() != 1 or not currencies.str.fullmatch(r"[A-Z]{3}").all():
                issues.append({"metric_key": key, "code": "currency_unresolved"})
                continue
            currency = currencies.iloc[0]
        values = pd.to_numeric(frame[key], errors="coerce").replace([float("inf"), -float("inf")], float("nan"))
        if values.notna().sum() < 2:
            issues.append({"metric_key": key, "code": "insufficient_values"})
            continue
        metrics.append({
            "dataset_id": dataset.id, "metric_key": key, "label": descriptor.get("label", key.replace("_", " ")) if descriptor else key.replace("_", " "),
            "aggregation": aggregation, "unit": unit, "currency": currency,
            "components": components, "definition": field["reason"], "native_grain": "monthly" if is_summary_dataframe(frame) else "daily",
            "missing_fraction": float(values.isna().mean()), "constant": values.nunique() < 2,
            "currency_unresolved": unit == "currency" and not currency,
        })
    availability = {}
    for column in dates:
        parsed = _parse_dates(frame[column], reference_year=_infer_explicit_year(frame[column])).dropna()
        if not parsed.empty:
            availability[column] = {"start": str(parsed.min().date()), "end": str(parsed.max().date())}
    if not dates:
        issues.append({"code": "date_field_missing"})
    elif not availability:
        issues.append({"code": "date_values_unavailable"})
    return {"dataset_id": dataset.id, "dataset_label": dataset.file_name, "connector": dataset.source_type,
            "date_columns": dates, "availability": availability, "metrics": metrics,
            "metric_issues": issues,
            "freshness": config_for(dataset).get("end_date"), "timezone": reporting_timezone()}


def normalize_dates(series, timezone=None):
    zone = ZoneInfo(timezone or reporting_timezone())
    def normalize(value):
        try:
            parsed = pd.Timestamp(value)
            return parsed.tz_convert(zone).tz_localize(None) if parsed.tzinfo else value
        except (ValueError, TypeError):
            return value
    return series.map(normalize)


def prepare_series(dataset_frames, references, definition):
    explicit_years = []
    for item in references:
        dataset, frame = dataset_frames[item["dataset_id"]]
        if item["date_column"] not in frame:
            raise ValueError("Date column is unavailable")
        year = _infer_explicit_year(frame[item["date_column"]])
        if year:
            explicit_years.append(year)
    reference_year = Counter(explicit_years).most_common(1)[0][0] if explicit_years else None
    prepared, quality, scoped_frames, policy_groups = {}, {}, {}, {}
    for item in references:
        dataset, original = dataset_frames[item["dataset_id"]]
        date_column = item["date_column"]
        cache_key = (item["dataset_id"], date_column)
        if cache_key not in scoped_frames:
            frame = original.copy()
            frame[date_column] = normalize_dates(frame[date_column], definition.get("reporting_timezone"))
            parsed = _parse_dates(frame[date_column], reference_year=reference_year)
            start, end = pd.Timestamp(definition["date_range"]["start"]), pd.Timestamp(definition["date_range"]["end"]) + pd.Timedelta(days=1)
            frame = frame.loc[(parsed >= start) & (parsed < end)].copy()
            scoped_frames[cache_key] = (frame, parsed)
        frame, parsed = scoped_frames[cache_key]
        if item["aggregation"] == "last" and not frame_policy(frame):
            from app.modules.datasets.services.joins import _bucket_dates
            values = pd.to_numeric(frame[item["metric_key"]], errors="coerce")
            working = pd.DataFrame({"date": parsed.loc[frame.index], "value": values}).dropna().sort_values("date")
            working["period"] = _bucket_dates(working["date"], definition["grain"])
            grouped = working.groupby("period", sort=True).value.last().reset_index()
        elif frame.empty:
            grouped = pd.DataFrame({"period": pd.Series(dtype="datetime64[ns]"), "value": pd.Series(dtype=float)})
        elif frame_policy(frame):
            if cache_key not in policy_groups:
                normalized = frame.copy()
                normalized[date_column] = parsed.loc[frame.index]
                policy_groups[cache_key] = aggregate_curated_dataframe(normalized, date_column, definition["grain"])
            grouped = policy_groups[cache_key][[date_column, item["metric_key"]]].rename(columns={date_column: "period", item["metric_key"]: "value"})
        else:
            selection = {"date_column": date_column, "metric_column": item["metric_key"]}
            grouped = _build_metric_series(dataset, frame, selection, definition["grain"], "sum" if item["aggregation"] == "policy" else item["aggregation"], reference_year)
        identity = f"{item['dataset_id']}:{item['metric_key']}"
        prepared[identity] = grouped
        values = grouped["value"].dropna()
        quality[identity] = {"observations": len(values), "constant": values.nunique() < 2, "missing_periods": int(grouped.value.isna().sum()), "duplicate_dates": int(parsed.duplicated().sum())}
    return prepared, quality
