"""Recognize unfinished report work independently of its editable title."""

import json

from app.modules.decisions.titles import is_legacy_evidence_placeholder, is_legacy_evidence_title


def is_report_decision_draft(decision):
    if any(str(getattr(decision, field, None) or "").strip() for field in (
        "actual_outcome", "outcome_status", "lessons_learned",
    )) or any(getattr(decision, field, None) is not None for field in (
        "outcome_baseline_value", "outcome_measured_value", "outcome_delta_percent", "outcome_measured_at",
    )):
        return False
    if is_legacy_evidence_placeholder(decision.title, decision.action):
        return True
    action = (decision.action or "").strip()
    if action and action != "Review the joined metrics and agree on the next action." and not is_legacy_evidence_title(action):
        return False
    raw = decision.recommendation_context or ""
    try:
        context = json.loads(raw)
    except (TypeError, ValueError):
        return raw.startswith("Joined evidence from ")
    return isinstance(context, dict) and context.get("evidence_kind") == "business_report"
