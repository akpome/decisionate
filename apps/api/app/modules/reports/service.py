"""Shared, deterministic evidence for interactive and scheduled reports."""

from datetime import date, datetime, timedelta, timezone
import json
import math
from zoneinfo import ZoneInfo

import pandas as pd

from app.modules.correlation.catalog import metric_catalog, normalize_dates, prepare_series, reporting_timezone
from app.modules.correlation.engine import adjust_bh, metric_id
from app.modules.datasets.services.curated_metric_analytics import aggregate_metric, frame_policy
from app.modules.datasets.services.joins import _bucket_dates, _infer_explicit_year, _parse_dates
from app.modules.datasets.services.numeric import coerce_numeric_series
from app.modules.datasets.services.dimension_filters import apply_dimension_filter
from .catalog import prepare_report_source
from .anomalies import anomaly_summary, detect_report_metric, historical_start
from .decision_drafts import is_report_decision_draft
from .relationships import compute_report_pair, direction_lookup, normalize_pair_directions, report_pairs, report_test_count
from .schemas import MINIMUM_REPORT_OBSERVATIONS
from .impact import evaluate_impact, impact_facts
from app.modules.decisions.duplicates import canonical_decisions


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def complete_week(today=None):
    today = today or datetime.now(ZoneInfo(reporting_timezone())).date()
    end = today - timedelta(days=today.weekday() + 1)
    return {"start": str(end - timedelta(days=6)), "end": str(end)}


def previous_window(window):
    start, end = date.fromisoformat(window["start"]), date.fromisoformat(window["end"])
    days = (end - start).days + 1
    return {"start": str(start - timedelta(days=days)), "end": str(start - timedelta(days=1))}


def report_dates(frame, column, zone):
    normalized = normalize_dates(frame[column], zone)
    buckets = _parse_dates(normalized, reference_year=_infer_explicit_year(frame[column]))
    # Shared legacy parsing normalizes to midnight; retain intraday ordering for LAST.
    instants = pd.to_datetime(normalized, errors="coerce", format="mixed")
    return buckets + (instants - instants.dt.normalize()).fillna(pd.Timedelta(0))


def scoped_frame(frame, column, window, zone):
    dates = report_dates(frame, column, zone)
    valid = (dates >= pd.Timestamp(window["start"])) & (dates < pd.Timestamp(window["end"]) + pd.Timedelta(days=1))
    return frame.loc[valid].copy(), dates.loc[valid]


def period_index(window, grain):
    endpoints = _bucket_dates(pd.Series(pd.to_datetime([window["start"], window["end"]])), grain)
    return pd.date_range(endpoints.iloc[0], endpoints.iloc[-1], freq={"daily": "D", "weekly": "W-MON", "monthly": "MS", "quarterly": "QS"}[grain])


def metric_value(frame, dates, reference):
    key, aggregation = reference["metric_key"], reference["aggregation"]
    policy = frame_policy(frame)
    if frame.empty:
        return None
    if policy and aggregation == "policy":
        descriptor = policy["descriptors"][key]
        if descriptor["aggregation"] == "LAST":
            frame = frame.loc[dates.sort_values(kind="stable").index]
        return finite(aggregate_metric(frame, descriptor))
    values = coerce_numeric_series(frame[key]).replace([float("inf"), -float("inf")], float("nan"))
    if not values.notna().any():
        return None
    if aggregation == "last":
        ordered = pd.DataFrame({"date": dates, "value": values}).dropna().sort_values("date")
        return finite(ordered.value.iloc[-1]) if not ordered.empty else None
    operation = {"sum": lambda: values.sum(min_count=1), "avg": values.mean, "min": values.min,
                 "max": values.max, "count": values.count}[aggregation]
    return finite(operation())


def prepare_report_series(frames, references, definition):
    result, policy_groups = {}, {}
    for reference in references:
        identity, column = reference["dataset_id"], reference["date_column"]
        if frame_policy(frames[identity][1]):
            policy_groups.setdefault((identity, column), []).append(reference)
    for (identity, column), group in policy_groups.items():
        dataset, original = frames[identity]
        dates = report_dates(original, column, definition["reporting_timezone"])
        ordered = original.loc[dates.sort_values(kind="stable").index].copy()
        result.update(prepare_series({identity: (dataset, ordered)}, group, definition)[0])
    for reference in references:
        key = metric_id(reference)
        if key in result:
            continue
        _, original = frames[reference["dataset_id"]]
        frame, dates = scoped_frame(original, reference["date_column"], definition["date_range"], definition["reporting_timezone"])
        values = coerce_numeric_series(frame[reference["metric_key"]]).replace([float("inf"), -float("inf")], float("nan"))
        working = pd.DataFrame({"period": _bucket_dates(dates, definition["grain"]), "date": dates, "value": values}).sort_values("date")
        groups = working.groupby("period", sort=True).value
        aggregation = reference["aggregation"]
        grouped = groups.sum(min_count=1) if aggregation == "sum" else groups.agg({"avg": "mean"}.get(aggregation, aggregation))
        # Empty values are not zero, including when the selected operation is count.
        grouped = grouped.where(groups.count() > 0)
        result[key] = grouped.rename("value").reset_index()
    return result


def report_anomalies(frames, references, definition, metadata, *, anchor=None):
    window = definition["date_range"]
    start = historical_start(anchor or window["start"])
    history_definition = {**definition, "date_range": {"start": start, "end": window["end"]}}
    available = [reference for reference in references if metric_id(reference) in metadata]
    points = prepare_report_series(frames, available, history_definition) if available else {}
    periods = period_index(history_definition["date_range"], definition["grain"])
    results = []
    for reference in references:
        key = metric_id(reference)
        if key not in points:
            descriptor = {**reference, "id": key, "dataset_label": f"Dataset {reference['dataset_id']}", "label": reference["metric_key"]}
            empty = pd.DataFrame({"period": pd.DatetimeIndex([]), "value": pd.Series(dtype=float)})
            missing = detect_report_metric(empty, descriptor, window, definition["grain"], definition.get("seasonal_business", False), anchor)
            missing["warnings"] = ["The selected dataset is unavailable; this metric could not be assessed."]
            results.append(missing)
            continue
        values = points[key].set_index("period").reindex(periods).rename_axis("period").reset_index()
        results.append(detect_report_metric(values, metadata[key], window, definition["grain"],
                                            definition.get("seasonal_business", False), anchor))
    return anomaly_summary(results, definition.get("seasonal_business", False), window, anchor)


def build_report(frames, definition, *, unavailable=None, history_anchor=None, impact_definition=None, reporting_grain=None):
    """Frames must already be authorized; source data and selections are never changed."""
    definition = {**definition, "pair_directions": normalize_pair_directions(definition.get("pair_directions"))}
    single = definition.get("scope", "multi") == "single"
    if report_test_count(definition) > 1000:
        raise ValueError("Reports support at most 1,000 pair-lag tests")
    frames = {identity: prepare_report_source(dataset, frame) for identity, (dataset, frame) in frames.items()}
    window, analysis_grain, references = definition["date_range"], definition["grain"], definition["metrics"]
    grain = reporting_grain or analysis_grain
    zone = definition.get("reporting_timezone") or reporting_timezone()
    previous = previous_window(window)
    metadata, series, metrics, warnings = {}, {}, [], list(unavailable or [])
    catalogs = {identity: metric_catalog(dataset, frame) for identity, (dataset, frame) in frames.items()}
    for selection in definition.get("dimension_filters", []):
        identity = selection["dataset_id"]
        if identity in frames:
            dataset, frame = frames[identity]
            frames[identity] = dataset, apply_dimension_filter(
                dataset, frame, selection,
                metrics=[item["metric_key"] for item in references if item["dataset_id"] == identity],
            )
    usable = []
    for reference in references:
        identity = reference["dataset_id"]
        if identity not in frames:
            continue
        dataset, original = frames[identity]
        catalog = catalogs[identity]
        descriptor = next((item for item in catalog["metrics"] if item["metric_key"] == reference["metric_key"]), None)
        if descriptor is None or reference["date_column"] not in catalog["date_columns"] or descriptor["aggregation"] != reference["aggregation"]:
            raise ValueError("Choose an available, explicitly selected metric with its approved date and aggregation policy")
        usable.append(reference)
        identity_key = metric_id(reference)
        metadata[identity_key] = {**reference, **descriptor, "id": identity_key, "dataset_label": dataset.file_name}

    actual_definition = {**definition, "metrics": usable, "reporting_timezone": zone}
    # Weekly summaries use daily coverage/anomalies without changing analysis units.
    reporting_definition = {**actual_definition, "grain": grain}
    prior_series = {}
    if usable:
        series = prepare_report_series(frames, usable, reporting_definition)
        prior_series = prepare_report_series(frames, usable, {**reporting_definition, "date_range": previous})
        for points in series.values():
            points["value"] = pd.to_numeric(points["value"], errors="coerce").replace([float("inf"), -float("inf")], float("nan"))
    expected = period_index(window, grain)
    previous_expected = period_index(previous, grain)
    for reference in usable:
        key = metric_id(reference)
        dataset, frame = frames[reference["dataset_id"]]
        current_frame, dates = scoped_frame(frame, reference["date_column"], window, zone)
        prior_frame, prior_dates = scoped_frame(frame, reference["date_column"], previous, zone)
        value, prior = metric_value(current_frame, dates, reference), metric_value(prior_frame, prior_dates, reference)
        delta = finite(value - prior) if value is not None and prior is not None else None
        percent = finite(delta / abs(prior) * 100) if delta is not None and prior != 0 else None
        points = series[key]
        observed = set(points.loc[points.value.notna(), "period"])
        missing = len(set(expected) - observed)
        prior_points = prior_series[key]
        prior_observed = set(prior_points.loc[prior_points.value.notna(), "period"])
        prior_missing = len(set(previous_expected) - prior_observed)
        quality = []
        if missing:
            quality.append(f"{missing} of {len(expected)} reporting periods have no usable observation; missing data is not treated as zero.")
        if prior is None:
            quality.append("No usable previous-period baseline.")
        if prior_missing:
            quality.append(f"Previous-period coverage: {len(prior_observed)}/{len(previous_expected)} periods. Percentage comparison is withheld.")
        if missing or prior_missing:
            delta = percent = None
        if dates.empty:
            quality.append("No observations in this reporting window.")
        elif dates.max().date() < date.fromisoformat(window["end"]):
            quality.append(f"Latest observation in the window: {dates.max().date()}.")
        if metadata[key].get("currency_unresolved"):
            quality.append("Currency could not be established; no currency conversion is assumed.")
        metrics.append({**metadata[key], "value": value, "previous_value": prior, "change": delta, "change_percent": percent,
                        "observations": len(observed), "expected_periods": len(expected), "warnings": quality,
                        "previous_observations": len(prior_observed), "previous_expected_periods": len(previous_expected),
                        "trend": [{"period": str(period.date()), "value": finite(value)}
                                  for period, value in points.set_index("period").value.reindex(expected).items()]})

    # Relationship history is separate from the reporting window: interactive
    # reports use at least 90 days; scheduled reviews use a rolling three years.
    history = {"start": historical_start(history_anchor) if history_anchor else str(min(date.fromisoformat(window["start"]), date.fromisoformat(window["end"]) - timedelta(days=89))), "end": window["end"]}
    relationship_definition = {**actual_definition, "date_range": history,
                               "filters": {**definition["filters"], "minimum_observations": max(MINIMUM_REPORT_OBSERVATIONS, definition["filters"]["minimum_observations"])}}
    pairs = report_pairs(definition, usable)
    relationship_metrics = {metric_id(item) for pair in pairs for item in pair}
    historical = prepare_report_series(frames, [item for item in usable if metric_id(item) in relationship_metrics], relationship_definition) if pairs and not single else {}
    history_periods = period_index(history, analysis_grain)
    for identity, points in list(historical.items()):
        points["value"] = pd.to_numeric(points["value"], errors="coerce").replace([float("inf"), -float("inf")], float("nan"))
        # Retain missing calendar buckets so the existing shift primitive moves
        # exactly k calendar periods, then discards unavailable pairs, not dates.
        historical[identity] = points.set_index("period").reindex(history_periods).rename_axis("period").reset_index()
    rows, directions = [], direction_lookup(definition)
    for left, right in pairs:
        rows.extend(compute_report_pair(metadata[metric_id(left)], metadata[metric_id(right)], historical, relationship_definition, directions))
    adjusted = adjust_bh([row["p_value"] for row in rows])
    findings = []
    for row, adjusted_p in zip(rows, adjusted):
        if not row["selected"]:
            continue
        left, right = metadata[row["metric_a"]], metadata[row["metric_b"]]
        coefficient = row["coefficient"]
        flags = [flag for flag in row["flags"] if flag != "lag_uses_shared_periods"]
        if row["lag"]:
            flags.append("calendar_aligned_lag")
        if historical[row["metric_a"]].value.isna().any() or historical[row["metric_b"]].value.isna().any():
            flags.append("incomplete_shared_history")
        strength = "unavailable" if coefficient is None else "strong" if abs(coefficient) >= .7 else "moderate" if abs(coefficient) >= .4 else "weak"
        reliable = (row["eligible"] and abs(coefficient or 0) >= definition["filters"]["minimum_abs_coefficient"]
                    and adjusted_p is not None and adjusted_p <= .05)
        if coefficient is None or not row["eligible"]:
            interpretation = f"Insufficient matched history or variation to establish a usable relationship between {left['label']} and {right['label']}."
        else:
            direction = "positive" if coefficient >= 0 else "negative"
            lead = left if row["lead_metric"] == left["id"] else right
            follow = right if lead is left else left
            timing = "in the same period" if not row["lag"] else f"when {lead['dataset_label']} / {lead['label']} precedes {follow['dataset_label']} / {follow['label']} by {row['lag']} calendar {analysis_grain} periods"
            interpretation = f"Observed {strength} {direction} association {timing} (r={coefficient:.2f}, {row['observations']} matched periods). "
            interpretation += "This is historical association, not attribution, a purchase-conversion delay, or proof of causation."
            if not reliable:
                interpretation += " Treat this finding as exploratory; adjusted significance is unavailable or not established."
        findings.append({"id": f"{row['metric_a']}|{row['metric_b']}|{row['lag']}", "metric_a": left, "metric_b": right,
                         "coefficient": coefficient, "lag": row["lag"], "lag_unit": f"calendar {analysis_grain} periods",
                         "lead_metric": row["lead_metric"], "observations": row["observations"], "eligible": row["eligible"],
                         "adjusted_p_value": adjusted_p, "reliability": "passes_adjusted_test" if reliable else "exploratory" if row["eligible"] else "insufficient",
                         "warnings": flags, "interpretation": interpretation, "history_window": history,
                         "evidence": row["evidence"]})
        findings[-1]["business_summary"] = relationship_summary(findings[-1], analysis_grain)
    findings.sort(key=lambda item: (item["eligible"], abs(item["coefficient"] or 0)), reverse=True)
    requested = definition.get("included_findings")
    if requested is not None:
        unknown = set(requested) - {finding["id"] for finding in findings}
        if unknown:
            raise ValueError("A selected finding is not part of this analysis")
    selected = [finding for finding in findings if requested is None or finding["id"] in requested]
    dataset_count = len({metric["dataset_id"] for metric in metrics if metric["value"] is not None})
    required_datasets = 1 if single else 2
    if single and dataset_count < 1:
        warnings.append("The selected dataset has no usable observations in the report window.")
    elif not single and dataset_count < 2:
        warnings.append("Cross-dataset coverage is insufficient: at least two datasets need usable observations in the report window.")
    if any(metric["observations"] < metric["expected_periods"] for metric in metrics):
        warnings.append("Some selected metrics have gaps in this report's dates. Check their coverage notes.")
    if any(metric["change_percent"] is None for metric in metrics):
        warnings.append("A previous-period comparison is unavailable for some metrics. This does not by itself prevent a relationship or business-change analysis.")
    movements = sorted((metric for metric in metrics if metric["change_percent"] is not None), key=lambda item: abs(item["change_percent"]), reverse=True)
    observations = [f"{metric['dataset_label']} / {metric['label']}: {metric['change_percent']:+.1f}% versus the previous comparable period."
                    for metric in movements[:6]]
    contrasts = []
    for left, right in report_pairs(definition, movements):
        if left["change_percent"] * right["change_percent"] < 0:
            contrasts.append(f"{left['dataset_label']} / {left['label']} and {right['dataset_label']} / {right['label']} moved in opposite directions. Check channel mix, timing and source coverage before attributing the difference to an intervention.")
    actions = []
    if warnings:
        actions.append("Check the missing-date and earlier-comparison notes before making a large commitment.")
    if contrasts:
        actions.append("Check why the results moved in different directions, including changes to prices, channels or business activity.")
    if any(finding["eligible"] for finding in selected):
        actions.append("Try a small, fair comparison before expanding a change. Record the result you expect and when you will review it.")
    if not actions:
        actions.append("Compare the selected metrics with their previous-period baselines and business targets before acting." if single else
                       "Collect comparable history across the selected datasets before drawing a relationship conclusion.")
    anomalies = report_anomalies(frames, references, reporting_definition, metadata, anchor=history_anchor)
    if anomalies["anomaly_count"]:
        actions.append("Check unusual changes against your normal busy and quiet times, recent business events, and whether the data import finished.")
    impact = None
    if definition.get("impact"):
        study_definition = {**actual_definition, **(impact_definition or {}), "reporting_timezone": zone}
        study = study_definition["impact"]
        role_ids = {metric_id(study["outcome"]), metric_id(study["comparison"])}
        study_references = [item for item in usable if metric_id(item) in role_ids]
        study_metadata = {key: dict(value) for key, value in metadata.items() if key in role_ids}
        for reference in study_references:
            policy = frame_policy(frames[reference["dataset_id"]][1])
            study_metadata[metric_id(reference)]["additive"] = reference["aggregation"] in {"sum", "count"} or bool(
                policy and reference["aggregation"] == "policy" and policy["descriptors"][reference["metric_key"]]["aggregation"] == "SUM")
        impact = evaluate_impact(prepare_report_series(frames, study_references, study_definition), study_definition, study_metadata)
        actions = impact["next_steps"]
    selected_ids = [finding["id"] for finding in selected]
    return {"name": definition["name"], "business_question": definition["business_question"],
            "definition": {**definition, "included_findings": selected_ids},
            "report_version": "single_dataset_report.v1" if single else "cross_dataset_report.v1",
            "window": window, "previous_window": previous, "history_window": history, "grain": grain, "analysis_grain": analysis_grain,
            "dataset_count": dataset_count, "status": "ready" if dataset_count >= required_datasets else "limited_coverage",
            "analysis_source": "deterministic", "generated_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics, "findings": findings, "included_findings": selected_ids,
            "anomaly_analysis": anomalies,
            "impact_analysis": impact,
            "observations": observations, "contrasts": contrasts[:5], "recommendations": actions, "warnings": warnings,
            "limitations": ["Missing observations remain unavailable and are not zero-filled.",
                            "An unusual change is not proof of its cause. Check source quality and business context.",
                            "No attribution, currency conversion, profit or ROAS is inferred from unrelated totals."] if single else
                           ["Association does not establish causation. Shared seasonality and other channels may explain co-movement.",
                            "Report lag tests use calendar-aligned periods. Missing observations remain unavailable and are not zero-filled.",
                            "No attribution, currency conversion, profit or ROAS is inferred from unrelated totals.",
                            "Time-series autocorrelation and shared seasonal patterns can overstate statistical significance.",
                            "Different datasets can contain duplicated or mathematically related measures; a cross-dataset correlation is not automatically independent evidence.",
                            "Significance is adjusted across tested pairs and lags, but is not a causal or out-of-sample validation."],
            "decisions": []}


def report_analysis_facts(report):
    """Bounded selected evidence, without raw rows, training arrays or trend series."""
    facts = {key: report[key] for key in ("business_question", "window", "previous_window", "history_window", "status",
                                        "observations", "contrasts", "warnings", "limitations")}
    facts["metrics"] = [{key: value for key, value in item.items() if key != "trend"} for item in report["metrics"]]
    facts["dimension_filters"] = report["definition"].get("dimension_filters", [])
    facts["summary_grouping"] = report["grain"]
    facts["analysis_grouping"] = report.get("analysis_grain", report["grain"])
    facts["findings"] = [{key: value for key, value in item.items() if key != "evidence"}
                         for item in report["findings"] if item["id"] in report["included_findings"]][:10]
    analysis = report.get("anomaly_analysis")
    if analysis:
        facts["anomaly_analysis"] = {
            **{key: value for key, value in analysis.items() if key != "metrics"},
            "metrics": [{key: value for key, value in item.items() if key not in {"baselines", "anomalies"}}
                        | {"anomalies": item["anomalies"][:7]} for item in analysis["metrics"]],
        }
    if report.get("impact_analysis"):
        facts["impact_analysis"] = impact_facts(report["impact_analysis"])
    return facts


def report_summary(report):
    if report.get("impact_analysis"):
        return " ".join(report["impact_analysis"][key] for key in ("headline", "summary"))
    movements = report["observations"] + report["contrasts"]
    if movements:
        return " ".join(movements[:3])
    selected = set(report["included_findings"])
    findings = [item for item in report["findings"] if item["id"] in selected and item["eligible"]]
    if findings:
        return " ".join(item.get("business_summary") or relationship_summary(item, report.get("analysis_grain", report["grain"])) for item in findings[:2])
    if report.get("anomaly_analysis", {}).get("anomaly_count"):
        return "Some selected results changed unusually. Check the unusual changes below before deciding what to do."
    return "There is not enough comparable history to explain these results yet. Check the dates and missing-data notes below."


def relationship_summary(finding, grain):
    left, right = finding["metric_a"], finding["metric_b"]
    names = f"{left['dataset_label']} / {left['label']} and {right['dataset_label']} / {right['label']}"
    if not finding["eligible"] or finding["coefficient"] is None:
        return f"We need more matching history or more variation to explain the pattern between {names}."
    coefficient = finding["coefficient"]
    if abs(coefficient) < .3:
        return f"There was no clear pattern of {names} moving together."
    pattern = "tended to rise and fall together" if coefficient >= 0 else "tended to move in opposite directions"
    text = f"{names} {pattern}. "
    if finding["lag"]:
        leader = left if finding["lead_metric"] == left["id"] else right
        unit = {"daily": "days", "weekly": "weeks", "monthly": "months", "quarterly": "quarters"}[grain]
        text += f"The pattern was strongest with {leader['label']} {finding['lag']} {unit} ahead. "
    text += "This is a pattern worth checking, not evidence that one caused the other."
    if finding["reliability"] != "passes_adjusted_test":
        text += " The pattern is not clear enough to rely on by itself."
    return text


def decisions_for_report(db, workspace, dataset_ids, report_id=None):
    from app.modules.decisions.models import Decision
    # Sharing datasets is not an explicit link to a report or a decision version.
    if not report_id:
        return []
    result = []
    for item in db.query(Decision).filter(Decision.workspace_id == workspace, canonical_decisions()).order_by(Decision.created_at.desc(), Decision.id.desc()).yield_per(100):
        evidence_ids = set(item.evidence_dataset_ids or [item.dataset_id])
        if not evidence_ids or not evidence_ids.issubset(dataset_ids):
            continue
        try:
            context = json.loads(item.recommendation_context or "{}")
        except (TypeError, ValueError):
            context = {}
        if not isinstance(context, dict):
            context = {}
        if context.get("report_id") != report_id:
            continue
        if is_report_decision_draft(item):
            continue
        result.append(report_decision_record(item, report_id))
        if len(result) == 20:
            break
    return result


def report_decision_record(item, report_id=None):
    return {"id": item.id, "report_id": report_id, "is_draft": is_report_decision_draft(item), "title": item.title, "action": item.action, "status": item.status,
            "owner_user_id": item.owner_user_id, "expected_outcome": item.expected_outcome,
            "actual_outcome": item.actual_outcome, "outcome_status": item.outcome_status,
            "review_date": item.review_date.isoformat() if item.review_date else None,
            "baseline": item.outcome_baseline_value, "measured_value": item.outcome_measured_value,
            "change_percent": item.outcome_delta_percent}


def legacy_decision_drafts(db, workspace, dataset_ids, report_id=None):
    from app.modules.decisions.models import Decision
    from sqlalchemy import func

    if len(dataset_ids) < 2:
        return []
    query = db.query(Decision).filter(Decision.workspace_id == workspace, Decision.status == "planned", canonical_decisions())
    query = query.order_by(func.coalesce(Decision.updated_at, Decision.created_at).desc(), Decision.id.desc())
    for item in query.yield_per(100):
        # A source-only draft is not a report link or a completed decision.
        evidence_ids = {item.dataset_id, *(item.evidence_dataset_ids or [])}
        if evidence_ids != dataset_ids or not is_report_decision_draft(item):
            continue
        try:
            context = json.loads(item.recommendation_context or "{}")
        except (TypeError, ValueError):
            context = {}
        linked_report = context.get("report_id") if isinstance(context, dict) else None
        if linked_report and linked_report != report_id:
            continue
        return [{**report_decision_record(item, linked_report), "evidence_dataset_ids": sorted(evidence_ids)}]
    return []


def attach_report_decisions(report, db, workspace, dataset_ids, report_id=None):
    report["decisions"] = decisions_for_report(db, workspace, dataset_ids, report_id)
    report["decision_drafts"] = [] if any(item["status"] != "archived" for item in report["decisions"]) else legacy_decision_drafts(db, workspace, dataset_ids, report_id)
