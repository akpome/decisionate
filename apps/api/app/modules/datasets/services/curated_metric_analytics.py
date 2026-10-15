"""Analytical views for opted-in selections; source data is never rewritten."""

from __future__ import annotations

import math

import pandas as pd

from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
from app.modules.datasets.services.summary_query import SUMMARY_MARKER_COLUMN, _summary_state


def frame_policy(dataframe):
    return dataframe.attrs.get(FRAME_POLICY_KEY)


def _finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError, OverflowError):
        return None


def _states(dataframe, column):
    columns = [key for key in (column, SUMMARY_MARKER_COLUMN, *(f"{column}__{stat}" for stat in ("sum", "count", "mean", "min", "max"))) if key in dataframe]
    return [state for row in dataframe.loc[:, columns].to_dict("records") if (state := _summary_state(row, column)) is not None]


def _sum(dataframe, column):
    states = _states(dataframe, column)
    return sum(state["sum"] for state in states) if states else None


def _members(dataframe, entry):
    saved_column = f"__curated_members__{entry['columnKey']}"
    if saved_column in dataframe:
        return {str(value) for values in dataframe[saved_column] for value in values}
    return set(dataframe[entry["components"][0]].dropna().astype(str))


def _weighted_state(dataframe, entry):
    key = entry["columnKey"]
    numerator_key, denominator_key = f"__curated_weighted_sum__{key}", f"__curated_weight__{key}"
    if numerator_key in dataframe and denominator_key in dataframe:
        return _sum(dataframe, numerator_key), _sum(dataframe, denominator_key)
    value_column, weight_column = entry["components"]
    values = pd.to_numeric(dataframe[value_column], errors="coerce")
    weights = pd.to_numeric(dataframe[weight_column], errors="coerce")
    valid = values.notna() & weights.notna()
    return _finite((values[valid] * weights[valid]).sum()), _finite(weights[valid].sum())


def aggregate_metric(dataframe, entry):
    operation = entry.get("operation")
    if operation == "count_distinct":
        return float(len(_members(dataframe, entry)))
    if operation in {"ratio", "weighted_mean"}:
        if operation == "weighted_mean":
            numerator, denominator = _weighted_state(dataframe, entry)
        else:
            numerator, denominator = (_sum(dataframe, column) for column in entry["components"])
        return _finite(numerator / denominator) if numerator is not None and denominator not in {None, 0} else None
    states = _states(dataframe, entry["columnKey"])
    if not states:
        return None
    if entry["aggregation"] == "LAST":
        return _finite(pd.to_numeric(dataframe[entry["columnKey"]], errors="coerce").dropna().iloc[-1])
    if entry["aggregation"] == "AVG":
        count = sum(state["count"] for state in states)
        return sum(state["sum"] for state in states) / count if count else None
    return sum(state["sum"] for state in states)


def prepare_curated_dataframe(dataframe, recommendations, selected_columns):
    if frame_policy(dataframe):
        return dataframe.copy()
    frame = dataframe.copy()
    descriptors = {entry["columnKey"]: dict(entry) for group in ("recommended", "optional", "derived") for entry in recommendations[group]}
    # Convert each physical monetary column once, before evaluating formulas.
    for group in ("recommended", "optional"):
        for entry in recommendations[group]:
            key = entry["columnKey"]
            if key not in frame:
                continue
            values = pd.to_numeric(frame[key], errors="coerce") * entry.get("multiplier", 1)
            frame[key] = -values.abs() if entry.get("sign") == -1 else values
    for entry in recommendations["derived"]:
        key = entry["columnKey"]
        if key not in selected_columns:
            continue
        if entry["operation"] == "count_distinct":
            frame[key] = (~frame[entry["components"][0]].duplicated()).astype(float)
        else:
            left, right = entry["components"]
            numerator = pd.to_numeric(frame[left], errors="coerce")
            denominator = pd.to_numeric(frame[right], errors="coerce")
            frame[key] = numerator / denominator.replace(0, float("nan")) if entry["operation"] == "ratio" else numerator
    frame.attrs[FRAME_POLICY_KEY] = {"descriptors": descriptors, "selected": list(selected_columns), "policy_version": recommendations["policyVersion"]}
    return frame


def curated_metrics(dataframe, selected_columns=None):
    policy = frame_policy(dataframe)
    if not policy:
        return None
    selected = policy["selected"] if selected_columns is None else selected_columns
    metrics = []
    for key in selected:
        entry = policy["descriptors"].get(key)
        if not entry or key not in dataframe:
            continue
        value = aggregate_metric(dataframe, entry)
        values = pd.to_numeric(dataframe[key], errors="coerce")
        metrics.append({
            "column": key, "total": _finite(value),
            "average": _finite(value if entry.get("operation") or entry["aggregation"] != "SUM" else values.mean()),
            "min": _finite(values.min()), "max": _finite(values.max()),
            "minimum": _finite(values.min()), "maximum": _finite(values.max()),
            "aggregation": entry["aggregation"], "unit": entry["unit"],
            "currency": entry.get("currency"), "definition": entry["reason"],
        })
    return metrics


def aggregate_curated_dataframe(dataframe, date_column, grouping):
    policy = frame_policy(dataframe)
    if not policy:
        return None
    dates = pd.to_datetime(dataframe[date_column], errors="coerce", utc=True).dt.tz_localize(None)
    if grouping == "daily":
        buckets = dates.dt.normalize()
    else:
        buckets = dates.dt.to_period({"weekly": "W-SUN", "quarterly": "Q"}.get(grouping, "M")).dt.start_time
    descriptors = policy["descriptors"]
    required = set(policy["selected"])
    for key in policy["selected"]:
        entry = descriptors.get(key, {})
        required.update(entry.get("components", ()) if entry.get("operation") != "count_distinct" else ())
    # Aggregate components first; ratios and weighted means are computed last.
    entries = [entry for key, entry in descriptors.items() if key in required and not entry.get("operation")]
    entries += [entry for key, entry in descriptors.items() if key in required and entry.get("operation")]
    rows = []
    for bucket in sorted(buckets.dropna().unique()):
        group = dataframe.loc[buckets.eq(bucket)]
        row = {date_column: bucket, SUMMARY_MARKER_COLUMN: True}
        for entry in entries:
            key = entry["columnKey"]
            if key not in group:
                continue
            row[key] = aggregate_metric(group, entry)
            if entry.get("operation") == "count_distinct":
                row[f"__curated_members__{key}"] = sorted(_members(group, entry))
            elif entry.get("operation") == "weighted_mean":
                numerator, denominator = _weighted_state(group, entry)
                for name, value in ((f"__curated_weighted_sum__{key}", numerator), (f"__curated_weight__{key}", denominator)):
                    row[name] = value
                    row[f"{name}__sum"] = value
                    row[f"{name}__count"] = 1
            elif not entry.get("operation"):
                states = _states(group, key)
                row[f"{key}__sum"] = sum(state["sum"] for state in states)
                row[f"{key}__count"] = sum(state["count"] for state in states)
                row[f"{key}__min"] = min((state["min"] for state in states if state["min"] is not None), default=None)
                row[f"{key}__max"] = max((state["max"] for state in states if state["max"] is not None), default=None)
        rows.append(row)
    result = pd.DataFrame(rows)
    result.attrs[FRAME_POLICY_KEY] = policy
    return result
