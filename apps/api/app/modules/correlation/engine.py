"""Pair orchestration; the existing relationship primitive is authoritative."""

from itertools import combinations
from importlib.metadata import PackageNotFoundError, version
import math
import warnings

import pandas as pd

from app.modules.datasets.services.relationships import _calculate_lag_result


try:
    STATISTICAL_BACKEND = "scipy-" + version("scipy")
except PackageNotFoundError:
    STATISTICAL_BACKEND = "coefficients-only"
ENGINE_VERSION = "correlation-v2.1/" + STATISTICAL_BACKEND


def metric_id(reference):
    return f"{reference['dataset_id']}:{reference['metric_key']}"


def metric_pairs(references):
    return combinations(sorted(references, key=lambda item: (item["dataset_id"], item["metric_key"])), 2)


def adjust_bh(p_values):
    valid = sorted((value, index) for index, value in enumerate(p_values) if value is not None and math.isfinite(value) and 0 <= value <= 1)
    adjusted = [None] * len(p_values)
    running = 1.0
    for rank in range(len(valid), 0, -1):
        value, index = valid[rank - 1]
        running = min(running, value * len(valid) / rank)
        adjusted[index] = min(1.0, running)
    return adjusted


def p_value(left, right, method):
    try:
        from scipy import stats
    except ImportError:
        return None
    if len(left) < 3:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = (stats.spearmanr if method == "spearman" else stats.pearsonr)(left, right)
    value = float(result.pvalue)
    return value if math.isfinite(value) else None


def normalized_evidence(aligned):
    if aligned.empty:
        return []
    frame = aligned.tail(200).copy()
    for column in ("left_value", "right_value"):
        std = aligned[column].std(ddof=0)
        frame[column] = (frame[column] - aligned[column].mean()) / std if std else 0.0
    return [{"period": str(row.period.date()), "a": float(row.left_value), "b": float(row.right_value)} for row in frame.itertuples(index=False)]


def select_best_pair(rows):
    for row in rows:
        row["selected"] = False
    if rows:
        candidates = [row for row in rows if row["eligible"]]
        chosen = max(candidates, key=lambda row: (row["score"], row["observations"], -row["lag"]), default=rows[0])
        chosen["selected"] = True
    return rows


def compute_pair(left, right, series, definition, *, include_zero=True):
    a, b = metric_id(left), metric_id(right)
    aligned = series[a].rename(columns={"value": "left_value"}).merge(
        series[b].rename(columns={"value": "right_value"}), on="period", how="inner",
    ).sort_values("period").reset_index(drop=True)
    lag = definition["lag"]
    if lag["direction"] == "b_leads_a":
        aligned[["left_value", "right_value"]] = aligned[["right_value", "left_value"]]
    lags = sorted({0, *range(lag["minimum"], lag["maximum"] + 1)}) if lag["enabled"] else [0]
    if not include_zero:
        lags = [value for value in lags if value > 0]
    rows = []
    minimum = definition["filters"]["minimum_observations"]
    for shift in lags:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            result = _calculate_lag_result(aligned, definition["method"], shift)
        sample = result["aligned"]
        coefficient = result["correlation"]
        flags = []
        if len(sample) < minimum:
            flags.append("insufficient_overlap")
        if len(sample) >= 2 and (sample.left_value.nunique() < 2 or sample.right_value.nunique() < 2):
            flags.append("constant")
        if coefficient is None and not flags:
            flags.append("unavailable_coefficient")
        if coefficient is not None and abs(coefficient) > 1 + 1e-12:
            raise ValueError("Invalid correlation coefficient")
        coefficient = max(-1.0, min(1.0, coefficient)) if coefficient is not None else None
        p = p_value(sample.left_value, sample.right_value, definition["method"]) if coefficient is not None else None
        if p is None:
            flags.append("significance_unavailable")
        if shift:
            flags.append("lag_uses_shared_periods")
        if definition["method"] == "spearman" and len(sample) < 500 and p is not None:
            flags.append("small_sample_rank_significance")
        if set(left.get("components", [])) & {right["metric_key"]} and left["dataset_id"] == right["dataset_id"] or set(right.get("components", [])) & {left["metric_key"]} and left["dataset_id"] == right["dataset_id"]:
            flags.append("mathematical_components")
        if left.get("currency") != right.get("currency") and left.get("currency") and right.get("currency"):
            flags.append("different_currencies_no_conversion")
        eligible = coefficient is not None and len(sample) >= minimum and "constant" not in flags
        if coefficient is not None and abs(coefficient) < definition["filters"]["minimum_abs_coefficient"]:
            flags.append("below_coefficient_threshold")
        evidence = normalized_evidence(sample)
        if lag["direction"] == "b_leads_a":
            evidence = [{"period": point["period"], "a": point["b"], "b": point["a"]} for point in evidence]
        rows.append({
            "metric_a": a, "metric_b": b, "lead_metric": b if lag["direction"] == "b_leads_a" else a,
            "lag": shift, "coefficient": coefficient, "observations": len(sample),
            "p_value": p, "flags": flags, "eligible": eligible,
            "score": abs(coefficient) if eligible else 0.0,
            "evidence": evidence, "selected": False,
        })
    return select_best_pair(rows)
