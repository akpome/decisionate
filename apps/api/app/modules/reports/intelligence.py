"""Compose weekly business evidence; all numerical analysis stays in existing engines."""

from hashlib import sha256
import json
import math

from .relationships import metric_key

VERSION = "weekly_intelligence.v1"
MAX_INVESTIGATIONS = 12


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def comparable(metric):
    return (number(metric.get("change")) and metric.get("observations") == metric.get("expected_periods")
            and metric.get("previous_observations") == metric.get("previous_expected_periods"))


def scope_key(definition, metric):
    filters = [dict(item, values=sorted(item.get("values", []), key=str))
               for item in definition.get("dimension_filters", []) if item["dataset_id"] == metric["dataset_id"]]
    scope = [metric["dataset_id"], metric["metric_key"], metric.get("date_column"), metric.get("aggregation"),
             metric.get("currency"), definition.get("reporting_timezone", "UTC"), filters]
    return sha256(json.dumps(scope, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:24]


def select_investigation_pairs(metrics, pairs, weekly_assessment=None):
    """Select before testing; never select pairs by their resulting p-value."""
    unusual = {item["metric_id"] for item in (weekly_assessment or {}).get("metrics", []) if item["anomaly_count"]}
    ranked = sorted((item for item in metrics if comparable(item) and item["change"] != 0),
                    key=lambda item: (item["id"] in unusual, abs(item.get("change_percent") or 0), item["id"]), reverse=True)
    changed = {item["id"] for item in ranked[:5]} | unusual
    lookup = {metric_key(item): item for item in metrics}
    selected, skipped = [], []
    for left, right in pairs:
        a, b = lookup[metric_key(left)], lookup[metric_key(right)]
        if not (a["id"] in changed or b["id"] in changed) or not comparable(a) or not comparable(b):
            continue
        if a.get("currency_unresolved") or b.get("currency_unresolved") or (
                a.get("currency") and b.get("currency") and a["currency"] != b["currency"]):
            skipped.append("A possible relationship was not tested because its monetary units are missing or different.")
            continue
        selected.append((left, right))
    selected.sort(key=lambda pair: (sum(lookup[metric_key(item)]["id"] in unusual for item in pair),
                                   sum(lookup[metric_key(item)]["id"] in changed for item in pair),
                                   sorted(str(metric_key(item)) for item in pair)), reverse=True)
    if len(selected) > MAX_INVESTIGATIONS:
        skipped.append(f"Relationship investigation is limited to {MAX_INVESTIGATIONS} relevant pairs per weekly report.")
    return selected[:MAX_INVESTIGATIONS], list(dict.fromkeys(skipped))


def format_value(value, metric):
    if not number(value):
        return "unavailable"
    return f"{value:,.2f}".rstrip("0").rstrip(".") + (f" {metric['currency']}" if metric.get("currency") else "")


def build_intelligence(report):
    definition = report["definition"]
    metrics = {item["id"]: item for item in report["metrics"]}
    weekly = {item["metric_id"]: item for item in report.get("weekly_anomaly_analysis", {}).get("metrics", [])}
    daily = {item["metric_id"]: item for item in report.get("anomaly_analysis", {}).get("metrics", [])}
    findings = []
    for metric in metrics.values():
        week_points = weekly.get(metric["id"], {}).get("anomalies", [])
        day_points = daily.get(metric["id"], {}).get("anomalies", [])
        changed = comparable(metric) and metric["change"] != 0
        if not week_points and not day_points and not changed:
            continue
        label = f"{metric['dataset_label']} / {metric['label']}"
        points = week_points or day_points
        level = 3 if week_points else 2 if day_points else 1
        if week_points:
            observation = f"{label} was outside its expected range for the completed week."
            title = f"Unusual week for {metric['label']}"
        elif day_points:
            observation = f"{label} was outside its expected range on {len(day_points)} day(s)."
            title = f"Unusual daily changes in {metric['label']}"
        else:
            movement = "rose" if metric["change"] > 0 else "fell"
            amount = f"{abs(metric['change_percent']):.1f}%" if number(metric.get("change_percent")) else format_value(abs(metric["change"]), metric)
            observation = f"{label} {movement} by {amount} compared with the previous complete week."
            title = f"{metric['label']} {movement}"
        limitation = "A change alone does not identify its cause or establish whether the business is better off."
        if points:
            limitation = "The expected range uses earlier records, not a guaranteed forecast or proof of a cause."
        findings.append({"id": "finding-" + scope_key(definition, metric), "kind": "metric_movement",
                         "metric_ids": [metric["id"]], "title": title, "observation": observation,
                         "window": report["window"], "previous_window": report["previous_window"],
                         "relevance": "Check whether this affects your costs, customers or planned actions before committing more resources.",
                         "evidence": {"current": metric["value"], "previous": metric["previous_value"],
                                      "change": metric["change"], "change_percent": metric["change_percent"],
                                      "unusual_periods": points[:7], "assessment_grain": "weekly" if week_points else "daily",
                                      "coverage": [metric["observations"], metric["expected_periods"]]},
                         "limitations": list(dict.fromkeys([limitation, *metric["warnings"],
                             *weekly.get(metric["id"], {}).get("warnings", []), *daily.get(metric["id"], {}).get("warnings", [])])),
                         "rank_basis": "Unusual complete week" if level == 3 else "Unusual day" if level == 2 else "Week-to-week movement; not a significance claim",
                         "rank": level, "magnitude": abs(metric.get("change_percent") or 0),
                         "continuity": "First available report for this scope", "related_decision_id": None})
    findings.sort(key=lambda item: (-item["rank"], -item["magnitude"], item["id"]))
    candidates = {identity for item in findings[:5] for identity in item["metric_ids"]}
    investigations = []
    for relationship in report["findings"]:
        ids = [relationship["metric_a"]["id"], relationship["metric_b"]["id"]]
        if not candidates.intersection(ids):
            continue
        supported = relationship["reliability"] == "passes_adjusted_test"
        investigations.append({"relationship_id": relationship["id"], "metric_ids": ids,
                               "finding_ids": [item["id"] for item in findings[:5] if set(item["metric_ids"]).intersection(ids)],
                               "status": "pattern_to_investigate" if supported else "not_established",
                               "summary": relationship["business_summary"], "coefficient": relationship["coefficient"],
                               "lag": relationship["lag"], "lag_unit": relationship["lag_unit"],
                               "observations": relationship["observations"], "history_window": relationship["history_window"],
                               "limitations": ["A historical relationship is not proof of causation or advertising attribution.", *relationship["warnings"]]})
    recommendations = []
    for item in findings[:5]:
        metric = metrics[item["metric_ids"][0]]
        if not comparable(metric) or metric.get("currency_unresolved"):
            continue
        action = f"Review the records behind {metric['dataset_label']} / {metric['label']} for {report['window']['start']} to {report['window']['end']}. Check which products, channels or locations changed before changing spending or operations."
        recommendations.append({"id": "action-" + item["id"], "finding_id": item["id"], "action": action,
                                "success_metric_id": metric["id"], "expected_direction": "Confirm the reason and choose a measurable response; improvement direction is not assumed.",
                                "priority": "Review first" if item["rank"] >= 2 else "Investigate",
                                "limitations": item["limitations"], "related_decision_id": None})
    quality = list(dict.fromkeys([*report["warnings"], *(warning for metric in metrics.values() for warning in metric["warnings"])]))
    if not definition.get("include_anomalies", True):
        quality.insert(0, "Anomaly detection is off for this report.")
    sources = report.get("source_quality", [])
    for source in sources:
        quality.extend(source.get("warnings", []))
    quality.extend(["Figures from different sources are kept separate. Overlapping sales or costs are not consolidated, and cross-source duplicates are not automatically verified.",
                    "Profitability needs verified costs; this report does not infer profit or advertising return from unrelated totals."])
    return {"version": VERSION, "as_of": report["generated_at"], "window": report["window"],
            "reporting_timezone": definition.get("reporting_timezone", "UTC"),
            "summary": "", "narrative_source": "rules", "findings": findings, "default_finding_count": 5,
            "investigations": investigations[:MAX_INVESTIGATIONS], "recommendations": recommendations,
            "decisions": [], "quality": list(dict.fromkeys(quality)), "sources": sources,
            "forecast_status": "No saved pre-period forecast was supplied; forecast deviation was not calculated.",
            "prioritization": "Complete-week anomalies, then daily anomalies, then complete week-to-week movements ranked by percentage size. This is an attention order, not a profit estimate. Related metrics do not increase statistical confidence."}


def narrative_statements(report):
    intelligence = report["intelligence"]
    statements = {"period": f"This review covers {report['window']['start']} to {report['window']['end']} and compares it with {report['previous_window']['start']} to {report['previous_window']['end']}.",
                  "scope": f"It covers {len(report['metrics'])} selected metrics, with usable values in {report['dataset_count']} datasets this week. Figures are shown separately rather than added across sources.",
                  "caution": "These observations help choose what to investigate; they do not identify causes, assign sales to an advertising channel or prove that a decision worked."}
    for index, item in enumerate(intelligence["findings"][:5]):
        statements[f"finding{index}"] = item["observation"]
    for index, item in enumerate(intelligence["investigations"][:2]):
        statements[f"relationship{index}"] = item["summary"]
    if intelligence["quality"]:
        statements["coverage"] = "Check the source coverage and limitations below before acting. Missing records are not treated as zero, and unsupported comparisons are withheld."
    if not intelligence["findings"]:
        statements["empty"] = "No supported priority change was identified. This may reflect stable results or limited comparable history; it is not a claim that there are no business risks."
    actions = {f"action{index}": item["action"] for index, item in enumerate(intelligence["recommendations"][:5])}
    return {"summary": statements, "recommendations": actions,
            "risks": {f"risk{index}": text for index, text in enumerate(intelligence["quality"][:5])}}


def deterministic_summary(report):
    statements = narrative_statements(report)["summary"]
    selected = [statements["period"], statements["scope"]]
    closing = [statements.get("empty") or "Review the records behind the priority changes before altering spending or operations. Check any existing decision before adopting another action for the same issue.",
               statements["caution"], statements.get("coverage", "")]
    candidates = [text for key, text in statements.items() if key.startswith("finding")][:3]
    candidates += [text for key, text in statements.items() if key.startswith("relationship")][:1]
    for statement in candidates:
        if len(" ".join([*selected, statement, *closing]).split()) <= 250:
            selected.append(statement)
    selected += closing
    return " ".join(text for text in selected if text)
