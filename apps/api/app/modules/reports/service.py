"""Shared, deterministic evidence for interactive and scheduled reports."""

from datetime import date, datetime, timedelta, timezone
from itertools import combinations
import math
from zoneinfo import ZoneInfo

import pandas as pd

from app.modules.correlation.catalog import metric_catalog, normalize_dates, prepare_series, reporting_timezone
from app.modules.correlation.engine import adjust_bh, compute_pair, metric_id
from app.modules.datasets.services.curated_metric_analytics import aggregate_metric, frame_policy
from app.modules.datasets.services.joins import _bucket_dates, _infer_explicit_year, _parse_dates
from app.modules.datasets.services.numeric import coerce_numeric_series
from .catalog import prepare_report_source
from app.modules.decisions.titles import is_legacy_evidence_placeholder


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


def build_report(frames, definition, *, unavailable=None):
    """Frames must already be authorized; source data and selections are never changed."""
    frames = {identity: prepare_report_source(dataset, frame) for identity, (dataset, frame) in frames.items()}
    window, grain, references = definition["date_range"], definition["grain"], definition["metrics"]
    zone = definition.get("reporting_timezone") or reporting_timezone()
    previous = previous_window(window)
    metadata, series, metrics, warnings = {}, {}, [], list(unavailable or [])
    catalogs = {identity: metric_catalog(dataset, frame) for identity, (dataset, frame) in frames.items()}
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
    prior_series = {}
    if usable:
        series = prepare_report_series(frames, usable, actual_definition)
        prior_series = prepare_report_series(frames, usable, {**actual_definition, "date_range": previous})
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

    # Weekly movement is described over one week, but relationships use at least
    # a 90-day historical window. Seven observations are not a reliable lag study.
    history = {"start": str(min(date.fromisoformat(window["start"]), date.fromisoformat(window["end"]) - timedelta(days=89))), "end": window["end"]}
    relationship_definition = {**actual_definition, "date_range": history,
                               "filters": {**definition["filters"], "minimum_observations": max(30, definition["filters"]["minimum_observations"])}}
    historical = prepare_report_series(frames, usable, relationship_definition) if usable else {}
    history_periods = period_index(history, grain)
    for identity, points in list(historical.items()):
        points["value"] = pd.to_numeric(points["value"], errors="coerce").replace([float("inf"), -float("inf")], float("nan"))
        # Retain missing calendar buckets so the existing shift primitive moves
        # exactly k calendar periods, then discards unavailable pairs, not dates.
        historical[identity] = points.set_index("period").reindex(history_periods).rename_axis("period").reset_index()
    rows = []
    for left, right in combinations(usable, 2):
        if left["dataset_id"] == right["dataset_id"]:
            continue
        rows.extend(compute_pair(metadata[metric_id(left)], metadata[metric_id(right)], historical, relationship_definition))
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
            timing = "in the same period" if not row["lag"] else f"when {lead['dataset_label']} / {lead['label']} precedes {follow['dataset_label']} / {follow['label']} by {row['lag']} calendar {grain} periods"
            interpretation = f"Observed {strength} {direction} association {timing} (r={coefficient:.2f}, {row['observations']} matched periods). "
            interpretation += "This is historical association, not attribution, a purchase-conversion delay, or proof of causation."
            if not reliable:
                interpretation += " Treat this finding as exploratory; adjusted significance is unavailable or not established."
        findings.append({"id": f"{row['metric_a']}|{row['metric_b']}|{row['lag']}", "metric_a": left, "metric_b": right,
                         "coefficient": coefficient, "lag": row["lag"], "lag_unit": f"calendar {grain} periods",
                         "lead_metric": row["lead_metric"], "observations": row["observations"], "eligible": row["eligible"],
                         "adjusted_p_value": adjusted_p, "reliability": "passes_adjusted_test" if reliable else "exploratory" if row["eligible"] else "insufficient",
                         "warnings": flags, "interpretation": interpretation, "history_window": history,
                         "evidence": row["evidence"]})
    findings.sort(key=lambda item: (item["eligible"], abs(item["coefficient"] or 0)), reverse=True)
    requested = definition.get("included_findings")
    if requested is not None:
        unknown = set(requested) - {finding["id"] for finding in findings}
        if unknown:
            raise ValueError("A selected finding is not part of this analysis")
    selected = [finding for finding in findings if requested is None or finding["id"] in requested]
    dataset_count = len({metric["dataset_id"] for metric in metrics if metric["value"] is not None})
    if dataset_count < 2:
        warnings.append("Cross-dataset coverage is insufficient: at least two datasets need usable observations in the report window.")
    if any(metric["warnings"] for metric in metrics):
        warnings.append("Some metrics have incomplete coverage or no previous-period baseline. Review the metric-level warnings before acting.")
    movements = sorted((metric for metric in metrics if metric["change_percent"] is not None), key=lambda item: abs(item["change_percent"]), reverse=True)
    observations = [f"{metric['dataset_label']} / {metric['label']}: {metric['change_percent']:+.1f}% versus the previous comparable period."
                    for metric in movements[:6]]
    contrasts = []
    for left, right in combinations(movements, 2):
        if left["dataset_id"] != right["dataset_id"] and left["change_percent"] * right["change_percent"] < 0:
            contrasts.append(f"{left['dataset_label']} / {left['label']} and {right['dataset_label']} / {right['label']} moved in opposite directions. Check channel mix, timing and source coverage before attributing the difference to an intervention.")
    actions = []
    if warnings:
        actions.append("Resolve missing coverage and baseline warnings before making a consequential change.")
    if contrasts:
        actions.append("Investigate the contrasting cross-dataset movements and record competing explanations.")
    if any(finding["eligible"] for finding in selected):
        actions.append("Validate promising relationships with segmentation or a controlled experiment; define the expected outcome and review date before acting.")
    if not actions:
        actions.append("Collect comparable history across the selected datasets before drawing a relationship conclusion.")
    selected_ids = [finding["id"] for finding in selected]
    return {"name": definition["name"], "business_question": definition["business_question"],
            "definition": {**definition, "included_findings": selected_ids},
            "report_version": "cross_dataset_report.v1",
            "window": window, "previous_window": previous, "history_window": history, "grain": grain,
            "dataset_count": dataset_count, "status": "ready" if dataset_count >= 2 else "limited_coverage",
            "analysis_source": "deterministic", "generated_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics, "findings": findings, "included_findings": selected_ids,
            "observations": observations, "contrasts": contrasts[:5], "recommendations": actions, "warnings": warnings,
            "limitations": ["Association does not establish causation. Shared seasonality and other channels may explain co-movement.",
                            "Report lag tests use calendar-aligned periods. Missing observations remain unavailable and are not zero-filled.",
                            "No attribution, currency conversion, profit or ROAS is inferred from unrelated totals.",
                            "Time-series autocorrelation and shared seasonal patterns can overstate statistical significance.",
                            "Different datasets can contain duplicated or mathematically related measures; a cross-dataset correlation is not automatically independent evidence.",
                            "Significance is adjusted across tested pairs and lags, but is not a causal or out-of-sample validation."],
            "decisions": []}


def decisions_for_report(db, workspace, dataset_ids, report_id=None):
    import json
    from app.modules.decisions.models import Decision
    # Sharing datasets is not an explicit link to a report or a decision version.
    if not report_id:
        return []
    result = []
    for item in db.query(Decision).filter(Decision.workspace_id == workspace).order_by(Decision.created_at.desc(), Decision.id.desc()).yield_per(100):
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
        if is_legacy_evidence_placeholder(item.title, item.action):
            continue
        result.append({"id": item.id, "report_id": report_id, "title": item.title, "action": item.action, "status": item.status,
                       "owner_user_id": item.owner_user_id, "expected_outcome": item.expected_outcome,
                       "actual_outcome": item.actual_outcome, "outcome_status": item.outcome_status,
                       "review_date": item.review_date.isoformat() if item.review_date else None,
                       "baseline": item.outcome_baseline_value, "measured_value": item.outcome_measured_value,
                       "change_percent": item.outcome_delta_percent})
        if len(result) == 20:
            break
    return result
