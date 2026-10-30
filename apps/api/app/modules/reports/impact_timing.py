"""Resolve response timing from authorized, immutable correlation snapshots."""

import json

import pandas as pd
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.correlation.service import authorize_datasets, digest
from app.modules.decisions.metric_scope import reference_key
from .models import BusinessReport
from .schemas import ImpactTimingChoice, ImpactTimingEvidence
from .timing_validation import VERSION


def unavailable(message, **values):
    return ImpactTimingEvidence(status="unavailable", message=message, **values).model_dump(mode="json")


def response_date(change_date, lag, grain):
    return (pd.Timestamp(change_date) + {"daily": pd.DateOffset(days=lag), "weekly": pd.DateOffset(weeks=lag),
            "monthly": pd.DateOffset(months=lag), "quarterly": pd.DateOffset(months=3 * lag)}[grain]).date().isoformat()


def decision_timing(db, decision, outcome, user, workspace, finding_id=None):
    try:
        context = json.loads(decision.recommendation_context or "{}")
    except (TypeError, ValueError):
        context = None
    if not isinstance(context, dict) or context.get("evidence_kind") != "business_report" or not isinstance(context.get("report_id"), str):
        return unavailable("No saved correlation timing is linked to this decision. Build a correlation analysis using history before the change.")
    report = db.get(BusinessReport, context["report_id"])
    if report is None or report.workspace_id != workspace:
        return unavailable("The original correlation report is unavailable. Timing has not been assumed.")
    try:
        snapshot = json.loads(report.snapshot)
        definition = snapshot["definition"]
        references = definition["metrics"]
        if definition.get("impact") or not isinstance(snapshot.get("findings"), list):
            raise ValueError("Not a correlation report")
        authorize_datasets(db, user, workspace, list({item["dataset_id"] for item in references}))
    except (TypeError, ValueError, KeyError, HTTPException):
        return unavailable("The original correlation evidence is unavailable in this workspace. Timing has not been assumed.")
    reference = next((item for item in references if reference_key(item) == reference_key(outcome)), None)
    if reference is None:
        return unavailable("The decision's current outcome was not part of its original correlation analysis.")
    candidates, choices = {}, []
    for finding in snapshot["findings"]:
        if not isinstance(finding, dict) or finding.get("id") not in snapshot.get("included_findings", []):
            continue
        try:
            left, right = finding["metric_a"], finding["metric_b"]
            target = left if reference_key(left) == reference_key(outcome) else right if reference_key(right) == reference_key(outcome) else None
            if target is None:
                continue
            driver = right if target is left else left
            validation = finding.get("timing_validation") or {}
            if (not any(reference_key(item) == reference_key(driver) for item in references)
                    or finding.get("lead_metric") != driver["id"] or finding.get("reliability") != "passes_adjusted_test"
                    or validation.get("version") != VERSION or validation.get("status") != "supported"
                    or validation.get("grain") != definition.get("grain")
                    or validation.get("lag") != finding["lag"] or validation.get("lead_metric") != driver["id"]):
                continue
            candidate = ImpactTimingEvidence(status="supported", message=validation["message"], report_id=report.id,
                finding_id=finding["id"], driver={"dataset_id": driver["dataset_id"], "metric_key": driver["metric_key"]}, outcome=outcome,
                driver_label=f"{driver['dataset_label']} / {driver['label']}", lag=finding["lag"], grain=validation["grain"],
                history_window=finding["history_window"], reporting_timezone=validation.get("reporting_timezone", definition.get("reporting_timezone")),
                outcome_date_column=reference["date_column"], outcome_aggregation=reference["aggregation"],
                outcome_filter=next((item for item in definition.get("dimension_filters", []) if item["dataset_id"] == outcome["dataset_id"]), None),
                evidence_digest=digest({"report": report.id, "definition": definition, "finding": finding}))
            candidates[finding["id"]] = candidate
            choices.append({key: getattr(candidate, key) for key in ("finding_id", "driver", "driver_label", "lag", "grain")})
        except (KeyError, TypeError, ValueError, ValidationError):
            continue
    if not candidates:
        return unavailable("No reliable driver-to-outcome timing was established in the saved correlation. Run a directed timing analysis on history before the change.", report_id=report.id)
    chosen = candidates.get(finding_id) if finding_id else next(iter(candidates.values())) if len(candidates) == 1 else None
    if chosen is None:
        return ImpactTimingEvidence(status="choose_relationship", message="Choose the relationship that this decision was intended to change.",
                                    report_id=report.id, choices=choices[:25]).model_dump(mode="json")
    chosen.choices = [ImpactTimingChoice.model_validate(item) for item in choices[:25]]
    return chosen.model_dump(mode="json")


def check_timing_scope(evidence, definition):
    study = definition["impact"]
    if not evidence or evidence.get("status") != "supported":
        return evidence or unavailable("Response timing has not been established for this decision.")
    try:
        evidence = ImpactTimingEvidence.model_validate(evidence).model_dump(mode="json")
        if any(evidence.get(key) is None for key in ("report_id", "finding_id", "driver", "outcome", "lag", "grain", "history_window", "evidence_digest")):
            raise ValueError("Incomplete timing")
        if pd.Timestamp(evidence["history_window"]["end"]) >= pd.Timestamp(study["change_date"]):
            return unavailable("The timing analysis includes dates on or after implementation. Use a correlation analysis based only on earlier history.", report_id=evidence["report_id"])
        if evidence["outcome"] != study["outcome"]:
            return unavailable("The timing evidence belongs to a different outcome metric.")
        reference = next(item for item in definition["metrics"] if reference_key(item) == reference_key(study["outcome"]))
        selection = next((item for item in definition.get("dimension_filters", []) if item["dataset_id"] == study["outcome"]["dataset_id"]), None)
        source_filter = evidence["outcome_filter"]
        same_filter = (selection is None and source_filter is None) or (selection is not None and source_filter is not None
            and selection["column"] == source_filter["column"] and set(selection["values"]) == set(source_filter["values"]))
        if not same_filter or reference["date_column"] != evidence["outcome_date_column"] or reference["aggregation"] != evidence["outcome_aggregation"]:
            return unavailable("The outcome's date column, aggregation or dimension filter differs from the timing analysis. Use matching evidence.", report_id=evidence["report_id"])
        if definition.get("reporting_timezone") != evidence["reporting_timezone"]:
            return unavailable("The reporting timezone differs from the timing analysis. Generate matching correlation evidence.", report_id=evidence["report_id"])
        if evidence["driver"]["dataset_id"] == study["comparison"]["dataset_id"] and evidence["driver"]["metric_key"] == study["comparison"]["metric_key"]:
            return unavailable("The metric changed by this decision cannot also be its unaffected comparison.", report_id=evidence["report_id"])
        return evidence
    except (TypeError, ValueError, KeyError, StopIteration, ValidationError):
        return unavailable("The saved timing evidence is incomplete. Generate a new directed correlation analysis.")
