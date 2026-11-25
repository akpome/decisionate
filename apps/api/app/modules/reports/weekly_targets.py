"""Evaluate saved benchmarks against the completed week's approved metrics."""

from math import isclose, isfinite

from app.modules.correlation.engine import metric_id


def assess_weekly_targets(targets, metrics, dataset_labels):
    by_metric = {item["id"]: item for item in metrics}
    results = []
    for target in targets:
        identity = metric_id(target)
        metric = by_metric.get(identity, {})
        actual = metric.get("value")
        observed = metric.get("observations", 0)
        value, direction = target["value"], target["direction"]
        status = "not_assessed"
        reason = None
        gap = None
        if not metric:
            reason = "metric_unavailable"
        elif observed != 7 or metric.get("expected_periods") != 7 or actual is None or not isfinite(actual):
            reason = "incomplete_week"
        elif metric.get("currency_unresolved"):
            reason = "currency_unavailable"
        else:
            equal = isclose(actual, value, rel_tol=0.0, abs_tol=1e-9)
            met = equal or (actual >= value if direction == "at_least" else actual <= value)
            status = "met" if met else "missed"
            difference = actual - value
            gap = 0 if equal else difference if isfinite(difference) else None
        results.append({
            **target, "metric_id": identity, "label": metric.get("label") or target["metric_key"],
            "dataset_label": metric.get("dataset_label") or dataset_labels.get(target["dataset_id"]) or f"Dataset {target['dataset_id']}",
            "currency": metric.get("currency"), "status": status, "reason": reason,
            "observed_days": observed, "actual": actual if status != "not_assessed" else None, "gap": gap,
        })
    return results
