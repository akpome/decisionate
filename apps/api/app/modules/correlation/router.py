import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.db.database import SessionLocal
from app.db.models import utc_now
from app.modules.datasets.services.auth import get_user_id, get_workspace_id, require_workspace_data_manager
from .engine import metric_id
from .models import CorrelationAnalysis, CorrelationInsight, CorrelationResult, CorrelationRun, CorrelationWidget
from .service import allowed_analysis, allowed_run, card, event, run_response, snapshot, authorize_datasets


router = APIRouter(prefix="/api/v2", tags=["correlation-v2"])


def database():
    with SessionLocal() as db:
        yield db


def identity(request):
    user = get_user_id(request)
    return user, get_workspace_id(request, user)


def retired(request):
    identity(request)
    raise HTTPException(410, "The advanced relationship explorer has been retired. Use Reports for multi dataset analysis.")


def completed(run):
    if run.status != "completed":
        raise HTTPException(409, "This historical analysis has no completed results. Use Reports for a new analysis.")


@router.get("/correlation-capabilities")
def capabilities(request: Request):
    identity(request)
    return {"api": False, "ui": False, "widgets": False, "lag": False, "ai": False,
            "retired": True, "replacement_url": "/dashboard/reports", "guided_limit": 25, "advanced_limit": 0}


@router.get("/correlation-analyses/catalog", deprecated=True)
def catalogue(request: Request):
    retired(request)


@router.post("/correlation-analyses", deprecated=True)
def create(request: Request):
    retired(request)


@router.get("/correlation-analyses")
def analyses(request: Request, db=Depends(database)):
    user, workspace = identity(request)
    result = []
    for item in db.query(CorrelationAnalysis).filter_by(workspace_id=workspace).order_by(CorrelationAnalysis.created_at.desc()).limit(100):
        try:
            allowed_analysis(db, item.id, user, workspace)
        except HTTPException:
            continue
        latest = db.query(CorrelationRun).filter_by(analysis_id=item.id).order_by(CorrelationRun.created_at.desc(), CorrelationRun.id.desc()).first()
        result.append({"analysis_id": item.id, "name": item.name, "latest_run": run_response(latest) if latest else None})
    return result


@router.get("/correlation-analyses/{analysis_id}")
def analysis_detail(analysis_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    item = allowed_analysis(db, analysis_id, user, workspace)
    runs = db.query(CorrelationRun).filter_by(analysis_id=item.id).order_by(CorrelationRun.created_at.desc()).limit(20).all()
    return {"analysis_id": item.id, "name": item.name, "definition": json.loads(item.definition),
            "latest_successful_run_id": item.latest_successful_run_id, "runs": [run_response(run) for run in runs]}


@router.post("/correlation-analyses/{analysis_id}/runs", deprecated=True)
def rerun(analysis_id: str, request: Request):
    retired(request)


@router.get("/correlation-runs/{run_id}")
def run_detail(run_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    run, _ = allowed_run(db, run_id, user, workspace)
    return run_response(run)


@router.post("/correlation-runs/{run_id}/cancel")
def cancel(run_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    run, analysis = allowed_run(db, run_id, user, workspace)
    if run.status in {"queued", "running"}:
        run.cancel_requested = True
        if run.status == "queued":
            run.status, run.phase, run.completed_at = "canceled", "canceled", utc_now()
        event(db, analysis, user, "cancel_requested", run.id)
        db.commit()
    return run_response(run)


@router.get("/correlation-runs/{run_id}/relationships")
def relationships(run_id: str, request: Request, db=Depends(database), offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100), minimum_abs_coefficient: float = Query(0, ge=0, le=1), include_insufficient: bool = False, outcome_metric: str | None = None):
    user, workspace = identity(request)
    run, _ = allowed_run(db, run_id, user, workspace)
    completed(run)
    query = db.query(CorrelationResult).filter_by(run_id=run.id, selected=True)
    if not include_insufficient:
        threshold = max(minimum_abs_coefficient, json.loads(run.definition)["filters"]["minimum_abs_coefficient"])
        query = query.filter(CorrelationResult.eligible.is_(True), CorrelationResult.score >= threshold)
    if outcome_metric:
        query = query.filter((CorrelationResult.metric_a == outcome_metric) | (CorrelationResult.metric_b == outcome_metric))
    total = query.count()
    rows = query.order_by(CorrelationResult.score.desc(), CorrelationResult.observations.desc(), CorrelationResult.metric_a, CorrelationResult.metric_b).offset(offset).limit(limit).all()
    return {"items": [card(row, run) for row in rows], "total": total, "offset": offset, "limit": limit}


@router.get("/correlation-runs/{run_id}/matrix")
def matrix(run_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    run, _ = allowed_run(db, run_id, user, workspace)
    completed(run)
    definition = json.loads(run.definition)
    metadata = json.loads(run.summary or "{}").get("metrics", {})
    return {"metrics": [{**item, **metadata.get(metric_id(item), {}), "id": metric_id(item)} for item in definition["metrics"]],
            "cells": [{"a": row.metric_a, "b": row.metric_b, "result_id": row.id,
                       "coefficient": row.coefficient if row.eligible else None, "lag": row.lag, "lead_metric": row.lead_metric,
                       "n": row.observations, "reliability": row.reliability} for row in db.query(CorrelationResult).filter_by(run_id=run.id, selected=True)],
            "method": definition["method"], "grain": definition["grain"], "window": definition["date_range"]}


def accessible_result(db, result_id, user, workspace):
    result = db.get(CorrelationResult, result_id)
    if result is None or result.workspace_id != workspace:
        raise HTTPException(404, "Relationship not found")
    run, analysis = allowed_run(db, result.run_id, user, workspace)
    completed(run)
    return result, run, analysis


@router.get("/correlation-results/{result_id}")
def relationship_detail(result_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    result, run, _ = accessible_result(db, result_id, user, workspace)
    profile = db.query(CorrelationResult).filter_by(run_id=run.id, metric_a=result.metric_a, metric_b=result.metric_b).order_by(CorrelationResult.lag).all()
    return {**card(result, run), "evidence": json.loads(result.evidence),
            "lag_profile": [{"lag": item.lag, "coefficient": item.coefficient, "n": item.observations, "eligible": item.eligible} for item in profile]}


@router.post("/correlation-results/{result_id}/evidence", deprecated=True)
def save_evidence(result_id: str, request: Request):
    retired(request)


@router.get("/correlation-insights")
def insights(request: Request, db=Depends(database)):
    user, workspace = identity(request)
    result = []
    for item in db.query(CorrelationInsight).filter_by(workspace_id=workspace).order_by(CorrelationInsight.created_at.desc()).limit(100):
        try:
            row, run, _ = accessible_result(db, item.result_id, user, workspace)
        except HTTPException:
            continue
        result.append({"insight_id": item.id, "evidence": card(row, run)})
    return result


@router.post("/correlation-widgets", deprecated=True)
def save_widget(request: Request):
    retired(request)


@router.get("/correlation-widgets")
def widgets(request: Request, db=Depends(database), dashboard_key: str = Query("general-business", max_length=120)):
    # Saved evidence remains readable after retirement, without queue polling or refresh.
    user, workspace = identity(request)
    result = []
    for widget in db.query(CorrelationWidget).filter_by(workspace_id=workspace, dashboard_key=dashboard_key).order_by(CorrelationWidget.created_at).limit(50):
        try:
            analysis = allowed_analysis(db, widget.analysis_id, user, workspace)
        except HTTPException:
            continue
        config = json.loads(widget.configuration)
        candidates = db.query(CorrelationRun).filter_by(analysis_id=analysis.id, status="completed").order_by(CorrelationRun.completed_at.desc()).limit(20).all()
        pinned = db.get(CorrelationRun, config["pinned_run_id"])
        if pinned and pinned.analysis_id == analysis.id and pinned.status == "completed" and all(run.id != pinned.id for run in candidates):
            candidates.append(pinned)
        rows, chosen = [], None
        for run in candidates:
            query = db.query(CorrelationResult).filter_by(run_id=run.id, selected=True, eligible=True)
            threshold = json.loads(run.definition)["filters"]["minimum_abs_coefficient"]
            query = query.filter(CorrelationResult.score >= threshold)
            if widget.widget_type == "saved_relationship":
                query = query.filter_by(metric_a=config["metric_a"], metric_b=config["metric_b"])
            if widget.widget_type == "outcome_drivers":
                query = query.filter((CorrelationResult.metric_a == config["outcome_metric"]) | (CorrelationResult.metric_b == config["outcome_metric"]))
            rows = query.order_by(CorrelationResult.score.desc(), CorrelationResult.observations.desc()).limit(1 if widget.widget_type == "saved_relationship" else 3).all()
            if rows:
                chosen = run
                break
        latest = db.query(CorrelationRun).filter_by(analysis_id=analysis.id).order_by(CorrelationRun.created_at.desc()).first()
        current_sources = authorize_datasets(db, user, workspace, [item["dataset_id"] for item in json.loads(analysis.definition)["metrics"]])
        cards = []
        for row in rows if chosen else []:
            item = card(row, chosen)
            previous = db.query(CorrelationResult).join(CorrelationRun, CorrelationRun.id == CorrelationResult.run_id).filter(
                CorrelationRun.analysis_id == analysis.id, CorrelationRun.status == "completed", CorrelationRun.completed_at < chosen.completed_at,
                CorrelationResult.metric_a == row.metric_a, CorrelationResult.metric_b == row.metric_b, CorrelationResult.lag == row.lag,
                CorrelationResult.eligible.is_(True),
            ).order_by(CorrelationRun.completed_at.desc()).first()
            item["coefficient_change"] = row.coefficient - previous.coefficient if previous else None
            cards.append(item)
        result.append({"widget_id": widget.id, "widget_type": widget.widget_type, "analysis_id": analysis.id, "name": analysis.name,
                       "updating": False, "retired": True,
                       "last_refresh_status": latest.status if latest else None,
                       "stale": bool(chosen and snapshot(current_sources) != json.loads(chosen.watermark)),
                       "cards": cards})
    return result


@router.delete("/correlation-widgets/{widget_id}")
def remove_widget(widget_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    require_workspace_data_manager(request)
    widget = db.get(CorrelationWidget, widget_id)
    if widget is None or widget.workspace_id != workspace:
        raise HTTPException(404, "Widget not found")
    analysis = allowed_analysis(db, widget.analysis_id, user, workspace)
    event(db, analysis, user, "widget_removed")
    db.delete(widget)
    db.commit()
    return {"deleted": True}
