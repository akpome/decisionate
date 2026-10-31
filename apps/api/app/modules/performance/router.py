import json
from datetime import datetime, time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.infrastructure.ingestion_jobs import lock_workspace_queue
from app.modules.correlation.catalog import reporting_timezone
from app.modules.correlation.service import authorize_datasets, encode, snapshot
from app.modules.reports.jobs import allowed_job, cancel_job, enqueue, job_response
from app.modules.reports.router import database, identity, require_report_writer
from .models import PerformanceAnalysis
from .schemas import PerformanceDecision, PerformanceDefinition
from .growth_schemas import ToolDefinition, definition_adapter, references

router = APIRouter(prefix="/api/v2/performance-analyses", tags=["performance-analyses"])


def sources(db, definition, user, workspace):
    return authorize_datasets(db, user, workspace, [source.dataset_id for source in references(definition)])


def performance_job(db, job_id, user, workspace):
    job = allowed_job(db, job_id, user, workspace, for_update=True)
    if job.kind != "performance":
        raise HTTPException(404, "Comparison preview not found.")
    return job


def allowed_analysis(db, analysis_id, user, workspace):
    analysis = db.query(PerformanceAnalysis).filter_by(id=analysis_id, workspace_id=workspace).first()
    if not analysis:
        raise HTTPException(404, "Saved comparison not found.")
    sources(db, definition_adapter.validate_json(analysis.definition), user, workspace)
    return analysis


def response(analysis):
    return {**json.loads(analysis.snapshot), "analysis_id": analysis.id, "decision_id": analysis.decision_id}


@router.post("/jobs", status_code=202)
def preview(request: Request, payload: ToolDefinition, db=Depends(database)):
    user, workspace = identity(request)
    if not payload.amounts_confirmed:
        raise HTTPException(422, "Confirm the selected records and coverage before comparing.")
    return job_response(enqueue(db, user, workspace, "performance",
        {**payload.model_dump(mode="json"), "reporting_timezone": reporting_timezone()},
        sources(db, payload, user, workspace), request.headers.get("Idempotency-Key")))


@router.get("/jobs/{job_id}")
def status(job_id: str, request: Request, db=Depends(database)):
    return job_response(performance_job(db, job_id, *identity(request)), include_result=True)


@router.delete("/jobs/{job_id}")
def cancel(job_id: str, request: Request, db=Depends(database)):
    return cancel_job(db, performance_job(db, job_id, *identity(request)))


@router.post("/jobs/{job_id}/save", status_code=201)
def save(job_id: str, request: Request, db=Depends(database)):
    require_report_writer(request)
    user, workspace = identity(request)
    lock_workspace_queue(db, "performance:" + workspace)
    job = performance_job(db, job_id, user, workspace)
    if job.saved_report_id:
        analysis = db.get(PerformanceAnalysis, job.saved_report_id)
        if not analysis:
            raise HTTPException(410, "This comparison was deleted. Preview again before saving.")
        return response(analysis)
    result = json.loads(job.result) if job.result else {}
    if job.status != "succeeded" or not any(row.get("ready") for row in result.get("rows", [])):
        raise HTTPException(409, "Preview at least one complete result before saving.")
    definition = definition_adapter.validate_python(result["definition"])
    if snapshot(sources(db, definition, user, workspace)) != json.loads(job.sources):
        raise HTTPException(409, "The data changed. Preview again before saving.")
    analysis = PerformanceAnalysis(workspace_id=workspace, user_id=user, job_id=job.id,
        kind=definition.kind, name=result["name"], definition=encode(definition.model_dump(mode="json")), snapshot=encode(result))
    db.add(analysis)
    db.flush()
    job.saved_report_id = analysis.id
    db.commit()
    return response(analysis)


@router.get("")
def history(request: Request, kind: Literal["return", "profit", "retention", "conversion", "cashflow"], offset: int = Query(0, ge=0), db=Depends(database)):
    user, workspace = identity(request)
    records = db.query(PerformanceAnalysis).filter_by(workspace_id=workspace, kind=kind).order_by(
        PerformanceAnalysis.created_at.desc()).offset(offset).limit(26).all()
    result = []
    for record in records[:25]:
        try:
            allowed_analysis(db, record.id, user, workspace)
        except HTTPException:
            continue
        result.append({"analysis_id": record.id, "name": record.name, "created_at": record.created_at.isoformat() + "Z"})
    return {"analyses": result, "next_offset": offset + 25 if len(records) > 25 else None}


@router.get("/{analysis_id}")
def detail(analysis_id: str, request: Request, db=Depends(database)):
    return response(allowed_analysis(db, analysis_id, *identity(request)))


@router.delete("/{analysis_id}")
def delete(analysis_id: str, request: Request, db=Depends(database)):
    require_report_writer(request)
    db.delete(allowed_analysis(db, analysis_id, *identity(request)))
    db.commit()
    return {"deleted": True}


@router.post("/{analysis_id}/decision", status_code=201)
async def create_performance_decision(analysis_id: str, payload: PerformanceDecision, request: Request, db=Depends(database)):
    from app.modules.decisions.router import create_decision, require_decision_manager
    from app.modules.decisions.schemas import DecisionCreate
    from app.modules.decisions.models import Decision

    require_decision_manager(request)
    require_report_writer(request)
    user, workspace = identity(request)
    lock_workspace_queue(db, "performance-decision:" + workspace)
    analysis = allowed_analysis(db, analysis_id, user, workspace)
    if analysis.decision_id:
        if not db.get(Decision, analysis.decision_id):
            raise HTTPException(410, "The linked decision was deleted.")
        return {"decision_id": analysis.decision_id}
    definition = definition_adapter.validate_json(analysis.definition)
    datasets = sources(db, definition, user, workspace)
    evidence = {(item.dataset_id, item.metric_key): {"dataset_id": item.dataset_id,
        "file_name": datasets[item.dataset_id].file_name, "metric_column": item.metric_key, "label": item.metric_key}
        for item in references(definition) if getattr(item, "metric_key", None)}
    result = json.loads(analysis.snapshot)
    outcome = definition.items[0].revenue if isinstance(definition, PerformanceDefinition) else None
    decision = await create_decision(DecisionCreate(dataset_id=next(iter(datasets)),
        outcome_dataset_id=outcome.dataset_id if outcome else None, metric_column=outcome.metric_key if outcome else None,
        evidence_dataset_ids=list(datasets), evidence_metrics=list(evidence.values()),
        title=payload.title, action=payload.action, expected_outcome=payload.expected_outcome,
        review_date=datetime.combine(payload.review_date, time.min), recommendation_source="rules",
        recommendation_text=result["headline"] + " " + result["next_action"],
        recommendation_context=encode({"evidence_kind": "performance", **result, "analysis_id": analysis.id})),
        x_user_id=user, x_workspace_id=workspace, idempotency_key="performance:" + analysis.id)
    analysis.decision_id = decision.id
    db.commit()
    return {"decision_id": decision.id}
