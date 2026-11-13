"""Weekly continuity and deliberate adoption using the existing Decisions lifecycle."""

from datetime import datetime, timezone
import json

from fastapi import HTTPException

from app.modules.decisions.duplicates import canonical_decisions
from app.modules.decisions.models import Decision
from .intelligence import scope_key
from .models import BusinessReport, CurrentWeeklyReport


def context_of(decision):
    try:
        value = json.loads(decision.recommendation_context or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def active_finding_decision(db, workspace, finding_id):
    for decision in db.query(Decision).filter(Decision.workspace_id == workspace,
            Decision.status.in_(("planned", "in_progress")), canonical_decisions()).order_by(Decision.id).yield_per(100):
        finding = context_of(decision).get("intelligence_finding")
        if isinstance(finding, dict) and finding.get("id") == finding_id:
            return decision
    return None


def finding_evidence(snapshot, finding_id):
    intelligence = snapshot.get("intelligence") or {}
    finding = next((item for item in intelligence.get("findings", []) if item["id"] == finding_id), None)
    action = next((item for item in intelligence.get("recommendations", []) if item["finding_id"] == finding_id), None)
    if not finding or not action:
        raise HTTPException(404, "This finding has no supported recommendation in the saved report.")
    return finding, action


def validate_adoption(db, decision, user):
    context = context_of(decision)
    supplied = context.get("intelligence_finding")
    if supplied is None:
        return None
    from .router import allowed_report
    if not isinstance(supplied, dict) or not isinstance(supplied.get("id"), str) or not context.get("report_id"):
        raise HTTPException(400, "Choose a saved weekly finding in Decisions.")
    report = allowed_report(db, context["report_id"], user, decision.workspace_id)
    snapshot = json.loads(report.snapshot)
    finding, action = finding_evidence(snapshot, supplied["id"])
    if snapshot["status"] != "ready" or f"{decision.outcome_dataset_id or decision.dataset_id}:{decision.metric_column}" != action["success_metric_id"]:
        raise HTTPException(400, "Use the finding's recorded success metric and resolve coverage before adopting it.")
    # Rebuild provenance from the server snapshot, never the editable request text.
    from .router import report_decision_evidence
    _, metrics, evidence, descriptors = report_decision_evidence(report)
    decision.evidence_dataset_ids = list(dict.fromkeys(item["dataset_id"] for item in metrics))
    decision.evidence_metrics = descriptors
    decision.recommendation_context = json.dumps({**evidence, "intelligence_finding": finding, "intelligence_recommendation": action})
    return active_finding_decision(db, decision.workspace_id, finding["id"])


def attach_continuity(report, db, workspace):
    intelligence = report["intelligence"]
    # Bounded lookup of immutable snapshots; only the immediately preceding week
    # establishes continuity, never a report from the future or another workspace.
    previous = None
    current = db.get(CurrentWeeklyReport, workspace)
    if current:
        value = json.loads(current.snapshot)
        if value.get("window") == report["previous_window"] and value.get("intelligence"):
            previous = value
    for stored in db.query(BusinessReport).filter_by(workspace_id=workspace).order_by(BusinessReport.created_at.desc()).limit(100):
        value = json.loads(stored.snapshot)
        if value.get("window") == report["previous_window"] and value.get("intelligence"):
            previous = value
            break
    prior = {item["id"]: item for item in (previous or {}).get("intelligence", {}).get("findings", [])}
    current_metrics = {item["id"]: item for item in report["metrics"]}
    dataset_ids = {item["dataset_id"] for item in report["metrics"]}
    as_of = datetime.fromisoformat(report["generated_at"]).astimezone(timezone.utc).replace(tzinfo=None)
    records, active = [], {}
    for decision in db.query(Decision).filter(Decision.workspace_id == workspace,
            Decision.created_at <= as_of, Decision.status.notin_(("archived", "cancelled")), canonical_decisions()).order_by(Decision.review_date, Decision.id).yield_per(100):
        if not set(decision.evidence_dataset_ids or [decision.dataset_id]).issubset(dataset_ids):
            continue
        key = f"{decision.outcome_dataset_id or decision.dataset_id}:{decision.metric_column}"
        metric = current_metrics.get(key)
        if not metric:
            continue
        context = context_of(decision)
        finding = context.get("intelligence_finding")
        finding_id = finding.get("id") if isinstance(finding, dict) else None
        if finding_id and decision.status in {"planned", "in_progress"}:
            active.setdefault(finding_id, decision.id)
        original_metrics = context.get("metrics")
        original = next((item for item in original_metrics if isinstance(item, dict) and item.get("id") == key), None) if isinstance(original_metrics, list) else None
        try:
            matching_scope = bool(original and scope_key(context.get("definition", {}), original) == scope_key(report["definition"], metric))
        except (KeyError, TypeError, AttributeError, ValueError):
            # Legacy free-form evidence cannot establish a matching metric scope.
            matching_scope = False
        measured_at = decision.outcome_measured_at
        if measured_at and measured_at > as_of:
            measured_at = None
        overdue = bool(decision.review_date and decision.review_date < as_of and decision.status != "completed")
        records.append({"id": decision.id, "title": decision.title, "status": decision.status,
                        "owner_user_id": decision.owner_user_id, "success_metric": f"{metric['dataset_label']} / {metric['label']}",
                        "baseline": decision.outcome_baseline_value if measured_at else None,
                        "target": decision.expected_outcome, "recorded_value": decision.outcome_measured_value if measured_at else None,
                        "recorded_at": measured_at.isoformat() if measured_at else None,
                        "observed_value": metric["value"] if matching_scope else None, "currency": metric.get("currency"),
                        "monitoring_period": report["window"] if matching_scope else None,
                        "review_date": decision.review_date.isoformat() if decision.review_date else None,
                        "assessment": "Review overdue" if overdue else "Outcome recorded" if decision.actual_outcome or measured_at else "Awaiting outcome review" if decision.status == "completed" else "In progress" if decision.status == "in_progress" else "Planned",
                        "recorded_outcome": decision.actual_outcome, "outcome_status": decision.outcome_status,
                        "limitation": "Observed movement is not attributable impact. Recorded outcomes are user assessments, not automatic proof of success."})
    for item in intelligence["findings"]:
        old = prior.get(item["id"])
        if old:
            old_change, change = old["evidence"].get("change"), item["evidence"].get("change")
            same_direction = old_change is not None and change is not None and old_change * change > 0
            comparison = "changed direction" if not same_direction else "larger movement" if item["magnitude"] > old["magnitude"] else "smaller movement" if item["magnitude"] < old["magnitude"] else "similar movement"
            item["continuity"] = "Reported last week; " + comparison
            item["previous_finding_window"] = previous["window"]
        item["related_decision_id"] = active.get(item["id"])
    for action in intelligence["recommendations"]:
        action["related_decision_id"] = active.get(action["finding_id"])
        action["follow_up"] = bool(action["related_decision_id"])
    intelligence["decisions"] = records[:20]
    from app.db.models import AppUser
    owners = {item.id: item.display_name or " ".join(filter(None, [item.first_name, item.last_name])) or item.email
              for item in db.query(AppUser).filter(AppUser.id.in_({item["owner_user_id"] for item in records[:20]}))}
    for record in intelligence["decisions"]:
        record["owner_name"] = owners.get(record["owner_user_id"]) or "Assigned owner"
    if len(records) > 20:
        intelligence["quality"].append("Decision progress is limited to 20 relevant decisions; open Decisions for the full list.")


def attach_ingestion_quality(report, db, workspace):
    from app.db.models import DatasetAnalysis, DataSourceConnection, DataIngestionJob
    from sqlalchemy import func
    for source in report.get("source_quality", []):
        metadata = db.query(DatasetAnalysis).filter_by(dataset_id=source["dataset_id"]).first()
        connection = db.get(DataSourceConnection, metadata.connection_id) if metadata and metadata.connection_id else None
        if connection and (connection.workspace_id or connection.user_id) == workspace:
            source["last_synced_at"] = connection.last_synced_at.isoformat() if connection.last_synced_at else None
            source["connection_status"] = connection.status
            if connection.authorization_error:
                source["warnings"].append(f"{source['dataset_label']}: the connection has an authorization issue; check Connections.")
            if not connection.last_synced_at:
                source["warnings"].append(f"{source['dataset_label']}: no successful connector sync is recorded.")
            job = db.query(DataIngestionJob).filter(DataIngestionJob.connection_id == connection.id,
                func.coalesce(DataIngestionJob.workspace_id, DataIngestionJob.user_id) == workspace).order_by(DataIngestionJob.id.desc()).first()
            if job and job.status in {"failed", "queued", "running"}:
                source["warnings"].append(f"{source['dataset_label']}: the latest connector import is {job.status}; some records may be missing. Check Connections.")
        else:
            source["connection_status"] = "not_verified"
