"""Immutable impact assessments belong to existing decisions, not new actions."""

import json

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_

from app.modules.correlation.schemas import DateRange
from app.modules.correlation.service import authorize_datasets, digest, encode
from app.modules.decisions.duplicates import canonical_decisions
from app.modules.decisions.metric_scope import reference_key
from app.modules.decisions.models import Decision
from .decision_drafts import is_report_decision_draft
from .models import DecisionImpactReview


REVIEW_ROLES = {"owner", "member", "managed_client"}


def decision_scope(user, workspace):
    return or_(Decision.workspace_id == workspace,
               and_(Decision.workspace_id.is_(None), Decision.clerk_user_id == user))


def allowed_decision(db, identity, user, workspace, *, lock=False):
    from app.modules.decisions.router import resolve_canonical_decision

    query = db.query(Decision).filter(Decision.id == identity, decision_scope(user, workspace)).populate_existing()
    decision = (query.with_for_update() if lock else query).first()
    if decision is None:
        raise HTTPException(404, "Decision not found")
    decision = resolve_canonical_decision(db, decision)
    if lock:
        decision = db.query(Decision).filter_by(id=decision.id).populate_existing().with_for_update().one()
    return decision


def decision_revision(decision):
    return digest({"id": decision.id, "action": decision.action, "expected_outcome": decision.expected_outcome,
                   "dataset_id": decision.dataset_id, "outcome_dataset_id": decision.outcome_dataset_id,
                   "metric_column": decision.metric_column, "evidence_metrics": decision.evidence_metrics})


def review_study(definition):
    return (definition.get("configuration", {}).get("template") or definition).get("impact")


def bind_decision_review(db, definition, user, workspace, *, required=False, editable=False, lock=False):
    study = review_study(definition)
    if not study:
        return None
    if not study.get("decision_id"):
        if required:
            raise HTTPException(400, "Choose an existing decision to assess its business impact.")
        return None  # Previously saved standalone studies remain readable and schedulable.
    decision = allowed_decision(db, study["decision_id"], user, workspace, lock=lock)
    if editable and decision.status in {"archived", "cancelled"}:
        raise HTTPException(409, "Restore this decision to active work before saving another impact assessment.")
    if is_report_decision_draft(decision) or not (decision.action or "").strip():
        raise HTTPException(400, "Record the decision's actual action before assessing its impact.")
    if len(decision.action.strip()) > 10000:
        raise HTTPException(400, "Use a decision action of at most 10,000 characters for impact assessment.")
    if not decision.metric_column:
        raise HTTPException(400, "Choose an outcome metric in Decision Details before assessing impact.")
    outcome = {"dataset_id": decision.outcome_dataset_id or decision.dataset_id, "metric_key": decision.metric_column}
    if study["outcome"] != outcome:
        raise HTTPException(409, "The outcome metric must match this decision. Reload its impact review.")
    revision = decision_revision(decision)
    if study.get("decision_revision") and study["decision_revision"] != revision:
        raise HTTPException(409, "The decision changed. Reload its impact review before calculating or saving another assessment.")
    study.update(decision_id=decision.id, decision_revision=revision, change=decision.action.strip())
    from .impact_timing import decision_timing
    # Never accept a client-supplied lag or copied timing verdict as authority.
    study["timing_evidence"] = decision_timing(db, decision, outcome, user, workspace, study.get("timing_finding_id"))
    return decision


def review_record(review, decision):
    return {"review_id": review.id, "decision_id": review.decision_id, "report_id": review.report_id,
            "created_at": review.created_at.isoformat() + "Z", "definition": json.loads(review.definition),
            "analysis": json.loads(review.analysis), "matches_current_decision": review.decision_revision == decision_revision(decision)}


def decision_reviews(db, decision, user, workspace, offset=0):
    rows = db.query(DecisionImpactReview).filter_by(decision_id=decision.id, workspace_id=workspace).order_by(
        DecisionImpactReview.created_at.desc(), DecisionImpactReview.id.desc()).offset(offset).limit(21).all()
    result, restricted = [], False
    for row in rows[:20]:
        definition = json.loads(row.definition)
        try:
            authorize_datasets(db, user, workspace, [item["dataset_id"] for item in definition["metrics"]])
        except HTTPException as error:
            if error.status_code in {403, 404}:
                restricted = True
                continue
            raise
        result.append(review_record(row, decision))
    return {"decision_id": decision.id, "reviews": result, "restricted": restricted,
            "next_offset": offset + 20 if len(rows) > 20 else None}


def decision_data_period(decision, outcome):
    try:
        context = json.loads(decision.recommendation_context or "{}")
    except (TypeError, ValueError):
        return None, None
    if not isinstance(context, dict) or context.get("evidence_kind") != "business_report" or not outcome:
        return None, None
    definition = context.get("definition")
    if not isinstance(definition, dict) or not isinstance(definition.get("metrics"), list):
        return None, None
    reference = next((item for item in definition["metrics"] if reference_key(item) == reference_key(outcome)), None)
    if reference is None:
        return None, None
    column = reference.get("date_column")
    column = column if isinstance(column, str) and column.strip() else None
    try:
        period = DateRange.model_validate(definition.get("date_range") or context.get("window"))
    except ValidationError:
        return None, column
    return period.model_dump(mode="json"), column


def review_context(db, decision, user, workspace):
    from .service import report_decision_record

    outcome = {"dataset_id": decision.outcome_dataset_id or decision.dataset_id, "metric_key": decision.metric_column} if decision.metric_column else None
    if outcome:
        authorize_datasets(db, user, workspace, [outcome["dataset_id"]])
    history = decision_reviews(db, decision, user, workspace)
    period, column = decision_data_period(decision, outcome)
    from .impact_timing import decision_timing
    return {"decision": report_decision_record(decision), "outcome": outcome,
            "decision_revision": decision_revision(decision), "latest_review": next(iter(history["reviews"]), None),
            "decision_period": period, "outcome_date_column": column,
            "timing_evidence": decision_timing(db, decision, outcome, user, workspace) if outcome else None}


def has_multi_dataset_analysis(decision):
    try:
        context = json.loads(decision.recommendation_context or "{}")
    except (TypeError, ValueError):
        return False
    if not isinstance(context, dict) or context.get("evidence_kind") != "business_report":
        return False
    if not isinstance(context.get("report_id"), str) or not context["report_id"].strip():
        return False
    definition = context.get("definition")
    if (not isinstance(definition, dict) or definition.get("scope") not in (None, "multi")
            or definition.get("impact") is not None or context.get("impact_analysis") is not None):
        return False
    references = definition.get("metrics")
    if not isinstance(references, list) or not references:
        return False
    keys = [reference_key(item) for item in references]
    return all(keys) and len({key[0] for key in keys}) >= 2


def review_choices(db, user, workspace, *, search="", offset=0):
    query = db.query(Decision).filter(decision_scope(user, workspace), canonical_decisions(),
        Decision.status.notin_({"archived", "cancelled"}), Decision.action.isnot(None),
        Decision.recommendation_context.isnot(None))
    if search:
        query = query.filter(Decision.title.ilike(f"%{search}%"))
    query = query.order_by(Decision.created_at.desc(), Decision.id.desc())
    choices = []
    # Scan bounded batches until the page is full; excluded records must not hide later choices.
    while True:
        rows = query.offset(offset).limit(100).all()
        for index, row in enumerate(rows):
            if not row.action.strip() or is_report_decision_draft(row) or not has_multi_dataset_analysis(row):
                continue
            if len(choices) == 25:
                return {"decisions": choices, "next_offset": offset + index}
            choices.append({"id": row.id, "title": row.title})
        if len(rows) < 100:
            return {"decisions": choices, "next_offset": None}
        offset += len(rows)


def attach_review_target(report, db, user, workspace):
    from .service import report_decision_record

    study = report["definition"].get("impact")
    if not study or not study.get("decision_id"):
        return
    try:
        decision = allowed_decision(db, study["decision_id"], user, workspace)
    except HTTPException as error:
        if error.status_code not in {404, 410}:
            raise
        report["review_decision_missing"] = True
        return
    report["review_decision"] = report_decision_record(decision)
    review = db.query(DecisionImpactReview).filter_by(report_id=report.get("report_id"), workspace_id=workspace).first() if report.get("report_id") else None
    if review:
        report["decision_review_id"] = review.id


def save_decision_review(db, job, result, report):
    from app.modules.decisions.router import record_decision_activity
    from app.modules.decisions.schemas import OUTCOME_DECISION_ACTIVITY

    definition = json.loads(report.definition)
    study = review_study(definition)
    frozen_timing = digest(study.get("timing_evidence")) if study else None
    decision = bind_decision_review(db, definition, job.user_id, job.workspace_id, editable=True, lock=True)
    if decision is None:
        return
    if frozen_timing != digest(study.get("timing_evidence")):
        raise HTTPException(409, "The decision's timing evidence changed. Generate a new assessment.")
    review = DecisionImpactReview(decision_id=decision.id, workspace_id=job.workspace_id, user_id=job.user_id,
        job_id=job.id, report_id=report.id, definition=encode(definition), analysis=encode(result["impact_analysis"]),
        decision_revision=decision_revision(decision))
    db.add(review)
    db.flush()
    result["decision_review_id"] = review.id
    record_decision_activity(db, decision, OUTCOME_DECISION_ACTIVITY,
        f"Business impact assessment saved ({review.id}): {result['impact_analysis']['headline']}", actor_user_id=job.user_id)
