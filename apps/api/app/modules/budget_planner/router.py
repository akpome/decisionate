import json
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.infrastructure.ingestion_jobs import lock_workspace_queue
from app.modules.correlation.catalog import reporting_timezone
from app.modules.correlation.service import authorize_datasets, encode, snapshot
from app.modules.reports.jobs import allowed_job, cancel_job, enqueue, job_response
from app.modules.reports.router import database, identity, require_report_writer
from .models import BudgetPlan
from .schemas import BudgetDecision, BudgetDefinition, selections
from .service import validate_dates

router = APIRouter(prefix="/api/v2/budget-plans", tags=["budget-plans"])


def sources(db, definition, user, workspace):
    return authorize_datasets(db, user, workspace, [item.dataset_id for item in selections(definition)])


def budget_job(db, job_id, user, workspace):
    job = allowed_job(db, job_id, user, workspace, for_update=True)
    if job.kind != "budget_plan":
        raise HTTPException(404, "Budget preview not found")
    return job


def allowed_plan(db, plan_id, user, workspace):
    plan = db.query(BudgetPlan).filter_by(id=plan_id, workspace_id=workspace).first()
    if not plan:
        raise HTTPException(404, "Budget plan not found")
    definition = BudgetDefinition.model_validate_json(plan.definition)
    sources(db, definition, user, workspace)
    return plan


def plan_response(plan):
    return {**json.loads(plan.snapshot), "plan_id": plan.id, "decision_id": plan.decision_id}


@router.post("/jobs", status_code=202)
def preview(request: Request, payload: BudgetDefinition, db=Depends(database)):
    user, workspace = identity(request)
    validate_dates(payload)
    definition = {**payload.model_dump(mode="json"), "reporting_timezone": reporting_timezone()}
    return job_response(enqueue(db, user, workspace, "budget_plan", definition, sources(db, payload, user, workspace),
                                request.headers.get("Idempotency-Key")))


@router.get("/jobs/{job_id}")
def status(job_id: str, request: Request, db=Depends(database)):
    return job_response(budget_job(db, job_id, *identity(request)), include_result=True)


@router.delete("/jobs/{job_id}")
def cancel(job_id: str, request: Request, db=Depends(database)):
    return cancel_job(db, budget_job(db, job_id, *identity(request)))


@router.post("/jobs/{job_id}/save", status_code=201)
def save(job_id: str, request: Request, db=Depends(database)):
    require_report_writer(request)
    user, workspace = identity(request)
    lock_workspace_queue(db, "budget-plan:" + workspace)
    job = budget_job(db, job_id, user, workspace)
    if job.saved_report_id:
        plan = db.get(BudgetPlan, job.saved_report_id)
        if not plan:
            raise HTTPException(410, "This plan was deleted. Generate a new preview before saving again.")
        return plan_response(plan)
    result = json.loads(job.result) if job.result else {}
    if job.status != "succeeded" or result.get("status") != "ready":
        raise HTTPException(409, "Preview a supported allocation before saving a plan.")
    definition = BudgetDefinition.model_validate(result["definition"])
    validate_dates(definition)
    if snapshot(sources(db, definition, user, workspace)) != json.loads(job.sources):
        raise HTTPException(409, "The data changed. Generate a new preview before saving.")
    plan = BudgetPlan(workspace_id=workspace, user_id=user, job_id=job.id, name=definition.name,
                      definition=encode(definition.model_dump(mode="json")), snapshot=encode(result))
    db.add(plan)
    db.flush()
    job.saved_report_id = plan.id
    db.commit()
    return plan_response(plan)


@router.get("")
def plans(request: Request, offset: int = Query(0, ge=0), db=Depends(database)):
    user, workspace = identity(request)
    rows = db.query(BudgetPlan).filter_by(workspace_id=workspace).order_by(BudgetPlan.created_at.desc()).offset(offset).limit(26).all()
    result = []
    for row in rows[:25]:
        try:
            allowed_plan(db, row.id, user, workspace)
        except HTTPException:
            continue
        result.append({"plan_id": row.id, "name": row.name, "created_at": row.created_at.isoformat() + "Z"})
    return {"plans": result, "next_offset": offset + 25 if len(rows) > 25 else None}


@router.get("/{plan_id}")
def detail(plan_id: str, request: Request, db=Depends(database)):
    return plan_response(allowed_plan(db, plan_id, *identity(request)))


@router.delete("/{plan_id}")
def delete(plan_id: str, request: Request, db=Depends(database)):
    require_report_writer(request)
    db.delete(allowed_plan(db, plan_id, *identity(request)))
    db.commit()
    return {"deleted": True}


@router.post("/{plan_id}/decision", status_code=201)
async def create_plan_decision(plan_id: str, payload: BudgetDecision, request: Request, db=Depends(database)):
    from app.modules.decisions.router import create_decision, require_decision_manager
    from app.modules.decisions.schemas import DecisionCreate
    from app.modules.decisions.models import Decision

    require_decision_manager(request)
    require_report_writer(request)
    user, workspace = identity(request)
    lock_workspace_queue(db, "budget-plan-decision:" + workspace)
    plan = allowed_plan(db, plan_id, user, workspace)
    if plan.decision_id:
        if not db.get(Decision, plan.decision_id):
            raise HTTPException(410, "The linked decision was deleted.")
        return {"decision_id": plan.decision_id}
    definition = BudgetDefinition.model_validate_json(plan.definition)
    validate_dates(definition)
    if payload.review_date < definition.start_date + timedelta(weeks=definition.weeks):
        raise HTTPException(422, "Choose a review date after the planning period.")
    datasets = sources(db, definition, user, workspace)
    evidence = {(item.dataset_id, item.metric_key): {"dataset_id": item.dataset_id,
                "file_name": datasets[item.dataset_id].file_name, "metric_column": item.metric_key, "label": item.metric_key}
                for item in selections(definition)}
    result = json.loads(plan.snapshot)
    recommendation = "Suggested allocation: " + "; ".join(f"{item['name']}: {definition.currency} {item['suggested']:,.2f}" for item in result["allocations"])
    recommendation += ". Model-based estimate, not proof of causation. Validate with a measured test."
    decision = await create_decision(DecisionCreate(
        dataset_id=definition.outcome.dataset_id, outcome_dataset_id=definition.outcome.dataset_id,
        metric_column=definition.outcome.metric_key, evidence_dataset_ids=list(datasets), evidence_metrics=list(evidence.values()),
        title=payload.title, action=payload.action, expected_outcome=payload.expected_outcome,
        review_date=datetime.combine(payload.review_date, time.min), recommendation_source="rules",
        recommendation_text=recommendation, recommendation_context=encode({"evidence_kind": "budget_plan", "plan_id": plan.id, **result}),
    ), x_user_id=user, x_workspace_id=workspace, idempotency_key="budget-plan:" + plan.id)
    plan.decision_id = decision.id
    db.commit()
    return {"decision_id": decision.id}
