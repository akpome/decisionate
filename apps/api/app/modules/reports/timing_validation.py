"""Qualify correlation timing while its original historical series are available."""

import math

from app.modules.correlation.engine import adjust_bh, compute_pair, metric_id


VERSION = "historical_timing.v1"


def validate_timing(left, right, series, definition, selected, direction):
    result = {"version": VERSION, "status": "unavailable", "lag": selected["lag"],
              "grain": definition["grain"], "reporting_timezone": definition.get("reporting_timezone"),
              "lead_metric": selected["lead_metric"], "checks": []}
    if not definition["lag"]["enabled"] or direction == "same_period" or definition["lag"]["maximum"] < 1:
        return {**result, "message": "Only the same period was compared; a response delay was not tested."}
    if not selected["eligible"] or selected["coefficient"] is None:
        return {**result, "message": "There is not enough matched history to establish response timing."}
    a, b = metric_id(left), metric_id(right)
    paired = series[a].set_index("period").rename(columns={"value": "a"}).join(
        series[b].set_index("period").rename(columns={"value": "b"}), how="outer").sort_index()
    if paired[["a", "b"]].isna().any().any():
        return {**result, "message": "Timing could not be checked because shared history has gaps."}
    minimum = max(12, math.ceil(definition["filters"]["minimum_observations"] / 2))
    split = len(paired) // 2
    checks, rows = [], []
    for name, block in (("earlier_history", paired.iloc[:split]), ("later_history", paired.iloc[split:])):
        if len(block) < minimum + definition["lag"]["maximum"] + 1:
            return {**result, "message": "More history is needed to check timing in two separate periods."}
        # Changes rather than raw levels reduce the chance of selecting a shared slow trend.
        changed = block[["a", "b"]].diff()
        sources = {key: changed[column].rename("value").rename_axis("period").reset_index()
                   for key, column in ((a, "a"), (b, "b"))}
        policy = {**definition, "filters": {**definition["filters"], "minimum_observations": minimum},
                  "lag": {**definition["lag"], "direction": direction}}
        candidates = compute_pair(left, right, sources, policy)
        winner = next((item for item in candidates if item["selected"]), None)
        expected = next((item for item in candidates if item["lag"] == selected["lag"]), None)
        other = max((abs(item["coefficient"] or 0) for item in candidates if item["eligible"] and item is not expected), default=0)
        check = {"period": name, "start": str(block.index[0].date()), "end": str(block.index[-1].date()),
                 "observations": expected["observations"] if expected else 0,
                 "coefficient": expected["coefficient"] if expected else None,
                 "selected_lag": winner["lag"] if winner else None,
                 "separation": abs(expected["coefficient"] or 0) - other if expected else None}
        checks.append(check)
        rows.extend((item, check if item is expected else None) for item in candidates)
    for (_, check), adjusted in zip(rows, adjust_bh([item["p_value"] for item, _ in rows])):
        if check is not None:
            check["adjusted_p_value"] = adjusted
    supported = all(check["selected_lag"] == selected["lag"] and check["coefficient"] is not None
                    and check["coefficient"] * selected["coefficient"] > 0
                    and abs(check["coefficient"]) >= max(.3, definition["filters"]["minimum_abs_coefficient"])
                    and check["separation"] >= .05 and check.get("adjusted_p_value") is not None
                    and check["adjusted_p_value"] <= .05 for check in checks)
    return {**result, "checks": checks, "status": "supported" if supported else "unavailable",
            "message": "The same timing stood out in changes across two separate historical periods." if supported else
                       "The timing was not consistent or distinct enough across separate historical periods."}
