import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.db.database import SessionLocal
from app.db.models import utc_now
from app.modules.datasets.services.auth import get_user_id, get_workspace_id, require_workspace_data_manager
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.datasets.services.ownership import verify_dataset_owner
from app.db.models import Dataset
from .catalog import metric_catalog
from .engine import metric_id
from .models import CorrelationAnalysis, CorrelationInsight, CorrelationResult, CorrelationRun, CorrelationWidget
from .schemas import AnalysisCreate, EvidenceCreate, WidgetCreate
from .service import allowed_analysis, allowed_run, card, create_analysis, dataset_scope, encode, enqueue, event, flags, run_response, snapshot, authorize_datasets


router = APIRouter(prefix="/api/v2", tags=["correlation-v2"])


def database():
    with SessionLocal() as db:
        yield db


def identity(request):
    user = get_user_id(request)
    return user, get_workspace_id(request, user)


def enabled(request):
    user, workspace = identity(request)
    if not flags(user)["api"]:
        raise HTTPException(404, "Multi-metric correlation is not enabled")
    return user, workspace


def completed(run):
    if run.status != "completed":
        raise HTTPException(409, "Results are available after the run completes")


@router.get("/correlation-capabilities")
def capabilities(request: Request):
    user, _ = identity(request)
    return {**flags(user), "guided_limit": 25, "advanced_limit": 50}


@router.get("/correlation-analyses/catalog")
def catalogue(request: Request, db=Depends(database), offset: int = Query(0, ge=0), dataset_id: int | None = Query(None, ge=1)):
    user, workspace = enabled(request)
    query = db.query(Dataset).filter(dataset_scope(user, workspace))
    if dataset_id:
        dataset = db.get(Dataset, dataset_id)
        if dataset is None:
            raise HTTPException(404, "Dataset not found")
        verify_dataset_owner(dataset, user, workspace)
        query = query.filter(Dataset.id == dataset_id)
    datasets = query.order_by(Dataset.id).offset(offset).limit(25).all()
    results = []
    for dataset in datasets:
        try:
            results.append(metric_catalog(dataset, load_dataframe_from_dataset(dataset)))
        except HTTPException as error:
            if error.status_code in {403, 401}:
                raise
            results.append({"dataset_id": dataset.id, "dataset_label": dataset.file_name, "connector": dataset.source_type,
                            "date_columns": [], "metrics": [], "availability": {}, "error_code": "dataset_unavailable"})
    return {"datasets": results, "next_offset": offset + 25 if len(datasets) == 25 else None}


@router.post("/correlation-analyses", status_code=202)
def create(request: Request, payload: AnalysisCreate, db=Depends(database), idempotency_key: str | None = Header(None, max_length=120, alias="Idempotency-Key")):
    user, workspace = enabled(request)
    run = create_analysis(db, payload, user, workspace, idempotency_key)
    db.commit()
    return run_response(run)


@router.get("/correlation-analyses")
def analyses(request: Request, db=Depends(database)):
    user, workspace = enabled(request)
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
    user, workspace = enabled(request)
    item = allowed_analysis(db, analysis_id, user, workspace)
    runs = db.query(CorrelationRun).filter_by(analysis_id=item.id).order_by(CorrelationRun.created_at.desc()).limit(20).all()
    return {"analysis_id": item.id, "name": item.name, "definition": json.loads(item.definition),
            "latest_successful_run_id": item.latest_successful_run_id, "runs": [run_response(run) for run in runs]}


@router.post("/correlation-analyses/{analysis_id}/runs", status_code=202)
def rerun(analysis_id: str, request: Request, db=Depends(database), idempotency_key: str | None = Header(None, max_length=120, alias="Idempotency-Key")):
    user, workspace = enabled(request)
    item = allowed_analysis(db, analysis_id, user, workspace)
    run = enqueue(db, item, user, idempotency_key=idempotency_key)
    db.commit()
    return run_response(run)


@router.get("/correlation-runs/{run_id}")
def run_detail(run_id: str, request: Request, db=Depends(database)):
    user, workspace = enabled(request)
    run, _ = allowed_run(db, run_id, user, workspace)
    return run_response(run)


@router.post("/correlation-runs/{run_id}/cancel")
def cancel(run_id: str, request: Request, db=Depends(database)):
    user, workspace = enabled(request)
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
    user, workspace = enabled(request)
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
    user, workspace = enabled(request)
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
    user, workspace = enabled(request)
    result, run, _ = accessible_result(db, result_id, user, workspace)
    profile = db.query(CorrelationResult).filter_by(run_id=run.id, metric_a=result.metric_a, metric_b=result.metric_b).order_by(CorrelationResult.lag).all()
    return {**card(result, run), "evidence": json.loads(result.evidence),
            "lag_profile": [{"lag": item.lag, "coefficient": item.coefficient, "n": item.observations, "eligible": item.eligible} for item in profile]}


@router.post("/correlation-results/{result_id}/evidence")
def save_evidence(result_id: str, request: Request, payload: EvidenceCreate, db=Depends(database)):
    user, workspace = enabled(request)
    result, run, analysis = accessible_result(db, result_id, user, workspace)
    if not result.eligible:
        raise HTTPException(400, "This relationship has insufficient evidence")
    evidence = card(result, run)
    link = f"/dashboard/relationships/explorer?run={run.id}&result={result.id}"
    if payload.kind == "insight":
        insight = db.query(CorrelationInsight).filter_by(workspace_id=workspace, result_id=result.id).first()
        if not insight:
            insight = CorrelationInsight(workspace_id=workspace, user_id=user, result_id=result.id, evidence=encode(evidence))
            db.add(insight)
            event(db, analysis, user, "insight_created", run.id)
            db.commit()
        return {"insight_id": insight.id, "evidence_url": link, "evidence": evidence}
    event(db, analysis, user, "decision_evidence_requested", run.id)
    db.commit()
    a, b = evidence["metric_a"], evidence["metric_b"]
    return {"evidence_url": link, "decision_payload": {
        "dataset_id": b["dataset_id"], "metric_column": b["metric_key"], "outcome_dataset_id": b["dataset_id"],
        "evidence_dataset_ids": list(dict.fromkeys([a["dataset_id"], b["dataset_id"]])),
        "evidence_metrics": [{"dataset_id": item["dataset_id"], "file_name": item["dataset_label"], "metric_column": item["metric_key"], "label": item["label"], "column_type": "numeric"} for item in (a, b)],
        "title": "Investigate observed metric relationship", "description": "Association does not establish causation. Evidence: " + link,
        "recommendation_source": "rules", "recommendation_context": encode(evidence),
        "expected_outcome": "Validate the observed association before choosing an action.",
    }}


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


@router.post("/correlation-widgets", status_code=201)
def save_widget(request: Request, payload: WidgetCreate, db=Depends(database)):
    user, workspace = enabled(request)
    require_workspace_data_manager(request)
    if not flags(user)["widgets"]:
        raise HTTPException(404, "Correlation widget creation is not enabled")
    analysis = allowed_analysis(db, payload.analysis_id, user, workspace)
    run = db.get(CorrelationRun, analysis.latest_successful_run_id) if analysis.latest_successful_run_id else None
    if run is None:
        raise HTTPException(400, "A successful run is required")
    if not db.query(CorrelationResult).filter_by(run_id=run.id, selected=True, eligible=True).first():
        raise HTTPException(400, "A run with eligible relationships is required")
    if db.query(CorrelationWidget).filter_by(workspace_id=workspace, dashboard_key=payload.dashboard_key).count() >= 50:
        raise HTTPException(429, "This dashboard already has 50 relationship widgets")
    config = {"pinned_run_id": run.id}
    identities = {metric_id(item) for item in json.loads(run.definition)["metrics"]}
    if payload.widget_type == "saved_relationship":
        row, selected_run, selected_analysis = accessible_result(db, payload.result_id, user, workspace)
        if selected_analysis.id != analysis.id or not row.eligible:
            raise HTTPException(400, "Choose an eligible relationship from this analysis")
        config.update(metric_a=row.metric_a, metric_b=row.metric_b, pinned_run_id=selected_run.id)
    elif payload.widget_type == "outcome_drivers":
        if payload.outcome_metric not in identities:
            raise HTTPException(400, "Choose an outcome in this analysis")
        config["outcome_metric"] = payload.outcome_metric
    widget = CorrelationWidget(workspace_id=workspace, user_id=user, analysis_id=analysis.id,
                               dashboard_key=payload.dashboard_key, widget_type=payload.widget_type, configuration=encode(config))
    db.add(widget)
    event(db, analysis, user, "widget_saved", run.id)
    db.commit()
    return {"widget_id": widget.id}


@router.get("/correlation-widgets")
def widgets(request: Request, db=Depends(database), dashboard_key: str = Query("general-business", max_length=120)):
    # Existing saved widgets remain readable during flag rollback.
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
                       "updating": bool(latest and latest.status in {"queued", "running"}),
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
