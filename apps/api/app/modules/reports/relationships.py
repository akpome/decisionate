"""Report-specific timing policies over the shared correlation engine."""

from itertools import combinations

from app.modules.correlation.engine import compute_pair
from app.modules.correlation.direction import resolve_direction


def metric_key(reference):
    return reference["dataset_id"], reference["metric_key"]


def pair_key(left, right):
    return frozenset((metric_key(left), metric_key(right)))


def report_pairs(definition, metrics=None):
    if definition.get("impact") or definition.get("scope") == "single" or not definition.get("include_relationships", True):
        return []
    excluded = {pair_key(item["metric_a"], item["metric_b"]) for item in definition.get("excluded_pairs", [])}
    return [(left, right) for left, right in combinations(definition["metrics"] if metrics is None else metrics, 2)
            if left["dataset_id"] != right["dataset_id"] and pair_key(left, right) not in excluded]


def normalize_pair_directions(configured):
    if configured is None:
        return None
    # Existing snapshots stay intact; only settings used for a new run are normalized.
    return [{**item, "direction": "same_period" if item["direction"] == "both" else item["direction"]} for item in configured]


def direction_lookup(definition):
    return {pair_key(item["metric_a"], item["metric_b"]): item for item in normalize_pair_directions(definition.get("pair_directions")) or []}


def pair_direction(left, right, definition, lookup):
    policy = lookup.get(pair_key(left, right))
    if policy is None:
        # Older reports keep their original, selection-ordered direction.
        return definition["lag"]["direction"] if definition.get("pair_directions") is None else "auto"
    mode = policy["direction"]
    if metric_key(policy["metric_a"]) != metric_key(left):
        mode = {"a_leads_b": "b_leads_a", "b_leads_a": "a_leads_b"}.get(mode, mode)
    return mode


def report_test_count(definition):
    lookup, lag = direction_lookup(definition), definition["lag"]
    positive = len({value for value in range(lag["minimum"], lag["maximum"] + 1) if value > 0}) if lag["enabled"] else 0
    count = 0
    for left, right in report_pairs(definition):
        mode = pair_direction(left, right, definition, lookup)
        count += 1 + (0 if mode == "same_period" else positive * (2 if mode == "auto" else 1))
    return count


def compute_report_pair(left, right, series, definition, lookup):
    mode = pair_direction(left, right, definition, lookup)
    lag = definition["lag"]
    suggestion = {"direction": mode if mode != "same_period" else None, "source": "user_selected", "message": "Direction selected by you."}
    if mode == "auto":
        from app.modules.correlation.engine import metric_id
        aligned = series[metric_id(left)].rename(columns={"value": "left_value"}).merge(
            series[metric_id(right)].rename(columns={"value": "right_value"}), on="period", how="inner").sort_values("period").reset_index(drop=True)
        suggestion = resolve_direction(left, right, aligned, maximum_lag=lag["maximum"] if lag["enabled"] else 0,
                                       minimum_observations=definition["filters"]["minimum_observations"], grain=definition["grain"])
        mode = suggestion["direction"] or "same_period"
    policy = {**definition, "lag": {**lag, "enabled": lag["enabled"] and mode != "same_period",
                                   "direction": mode if mode in {"a_leads_b", "b_leads_a"} else "a_leads_b"}}
    return [{**row, "direction_suggestion": suggestion} for row in compute_pair(left, right, series, policy)]
