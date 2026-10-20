"""Report-specific timing policies over the shared correlation engine."""

from itertools import combinations

from app.modules.correlation.engine import compute_pair, select_best_pair


def metric_key(reference):
    return reference["dataset_id"], reference["metric_key"]


def pair_key(left, right):
    return frozenset((metric_key(left), metric_key(right)))


def direction_lookup(definition):
    return {pair_key(item["metric_a"], item["metric_b"]): item for item in definition.get("pair_directions") or []}


def pair_direction(left, right, definition, lookup):
    policy = lookup.get(pair_key(left, right))
    if policy is None:
        # Older reports keep their original, selection-ordered direction.
        return definition["lag"]["direction"] if definition.get("pair_directions") is None else "both"
    mode = policy["direction"]
    if metric_key(policy["metric_a"]) != metric_key(left):
        mode = {"a_leads_b": "b_leads_a", "b_leads_a": "a_leads_b"}.get(mode, mode)
    return mode


def report_test_count(definition):
    lookup, lag = direction_lookup(definition), definition["lag"]
    positive = len({value for value in range(lag["minimum"], lag["maximum"] + 1) if value > 0}) if lag["enabled"] else 0
    count = 0
    for left, right in combinations(definition["metrics"], 2):
        if left["dataset_id"] == right["dataset_id"]:
            continue
        mode = pair_direction(left, right, definition, lookup)
        count += 1 + (0 if mode == "same_period" else positive * (2 if mode == "both" else 1))
    return count


def compute_report_pair(left, right, series, definition, lookup):
    mode = pair_direction(left, right, definition, lookup)
    if mode == "both" and metric_key(right) < metric_key(left):
        left, right = right, left
    lag = definition["lag"]
    policy = {**definition, "lag": {**lag, "enabled": lag["enabled"] and mode != "same_period",
                                   "direction": mode if mode in {"a_leads_b", "b_leads_a"} else "a_leads_b"}}
    rows = compute_pair(left, right, series, policy)
    if mode == "both" and lag["enabled"]:
        reverse = {**policy, "lag": {**policy["lag"], "direction": "b_leads_a"}}
        rows.extend(compute_pair(left, right, series, reverse, include_zero=False))
    return select_best_pair(rows)
