import json
import logging
from datetime import date
from typing import Literal

import pandas as pd

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.db.database import SessionLocal
from app.db.models import Dataset, WeeklyReportPreference
from app.modules.ai.service import generate_structured_analysis
from app.modules.correlation.catalog import metric_catalog, reporting_timezone
from app.modules.correlation.engine import metric_id
from app.modules.correlation.service import allowed_run, authorize_datasets, dataset_scope, encode
from app.modules.auth_context import is_client_workspace_role
from app.modules.datasets.services.auth import get_user_id, get_workspace_id, get_workspace_role, require_workspace_data_manager
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.forecasting.services import prepare_forecast_dataframe
from app.modules.decisions.metric_scope import selected_report_metrics
from .decision_drafts import is_report_decision_draft
from .models import BusinessReport
from .catalog import prepare_report_source, report_metric_catalog
from .schemas import ReportDecision, ReportDefinition
from .service import attach_report_decisions, build_report, report_analysis_facts, report_anomalies, report_dates
from .relationships import report_test_count
from .jobs import (allowed_job, cancel_job, enqueue, enqueue_report, enqueue_weekly, job_response,
                   save_completed_job, wait_for_job, worker_ready)
from .models import ReportAnalysisJob


router = APIRouter(prefix="/api/v2/business-reports", tags=["business-reports"])
logger = logging.getLogger(__name__)


def database():
    with SessionLocal() as db:
        yield db


def identity(request):
    user = get_user_id(request)
    return user, get_workspace_id(request, user)


def allowed_report(db, report_id, user, workspace, *, for_update=False):
    report = (db.query(BusinessReport).filter_by(id=report_id, workspace_id=workspace).with_for_update().first()
              if for_update else db.get(BusinessReport, report_id))
    if report is None or report.workspace_id != workspace:
        raise HTTPException(404, "Report not found")
    definition = json.loads(report.definition)
    authorize_datasets(db, user, workspace, [item["dataset_id"] for item in definition["metrics"]])
    return report


def generate(db, payload, user, workspace, progress=None):
    source_run = allowed_run(db, payload.source_run_id, user, workspace)[0] if payload.source_run_id else None
    if len(payload.metrics) > 25 or payload.lag.maximum > 12:
        raise HTTPException(400, "Reports support at most 25 metrics and 12 lag periods")
    definition = payload.model_dump(mode="json")
    if report_test_count(definition) > 1000:
        raise HTTPException(400, "Reduce the report's metrics or lag window to at most 1,000 pair-lag tests.")
    definition["reporting_timezone"] = reporting_timezone()
    datasets = authorize_datasets(db, user, workspace, [item.dataset_id for item in payload.metrics])
    frames, unavailable = {}, []
    for key, dataset in datasets.items():
        try:
            frames[key] = dataset, load_dataframe_from_dataset(dataset)
        except HTTPException as error:
            if error.status_code in {401, 403}:
                raise
            unavailable.append(f"Dataset unavailable: {dataset.file_name}.")
        except Exception:
            logger.warning("Report dataset %s unavailable", key, exc_info=True)
            unavailable.append(f"Dataset unavailable: {dataset.file_name}.")
    if progress:
        progress("computing")
    try:
        result = build_report(frames, definition, unavailable=unavailable)
    except (ValueError, KeyError) as error:
        raise HTTPException(400, "The selected metrics, date columns or saved policies are no longer available. Review the selections.") from error
    if source_run:
        result["source_analysis"] = {"run_id": source_run.id, "engine_version": source_run.engine_version,
                                     "definition": json.loads(source_run.definition),
                                     "computed_at": source_run.completed_at.isoformat() if source_run.completed_at else None,
                                     "note": "This report recalculates the selected sources. The original analysis run remains available for comparison."}
    if payload.include_ai_analysis:
        if progress:
            progress("interpreting")
        result["ai_analysis"] = generate_structured_analysis(
            context="business report selected-metric interpretation",
            facts=report_analysis_facts(result),
            fallback_summary=" ".join(result["observations"] + result["contrasts"]) or "No comparable metric movements are available. Review coverage and baseline warnings.",
            fallback_recommendations=result["recommendations"],
            fallback_risks=result["warnings"] + result["limitations"],
            workspace_id=workspace, actor_user_id=user,
        )
    attach_report_decisions(result, db, workspace, {item["dataset_id"] for item in result["definition"]["metrics"]})
    return result["definition"], result


@router.get("/catalog")
def catalog(request: Request, db=Depends(database), offset: int = Query(0, ge=0), dataset_id: int | None = Query(None, ge=1),
            metadata_only: bool = Query(False)):
    user, workspace = identity(request)
    query = db.query(Dataset).filter(dataset_scope(user, workspace))
    if dataset_id is not None:
        query = query.filter(Dataset.id == dataset_id)
    if metadata_only:
        query = query.with_entities(Dataset.id, Dataset.file_name, Dataset.source_type)
    page_size = 1 if dataset_id is not None else 25
    rows = query.order_by(Dataset.id).offset(offset).limit(page_size + 1).all()
    datasets = rows[:page_size]
    result = []
    for dataset in datasets:
        if metadata_only:
            result.append({"dataset_id": dataset.id, "dataset_label": dataset.file_name, "connector": dataset.source_type,
                           "date_columns": [], "metrics": [], "availability": {}, "catalog_status": "pending"})
            continue
        try:
            result.append(report_metric_catalog(dataset, load_dataframe_from_dataset(dataset)))
        except Exception:
            logger.warning("Report catalogue dataset %s unavailable", dataset.id, exc_info=True)
            result.append({"dataset_id": dataset.id, "dataset_label": dataset.file_name, "connector": dataset.source_type,
                           "date_columns": [], "metrics": [], "availability": {}, "error_code": "dataset_unavailable"})
    return {"datasets": result, "next_offset": offset + page_size if len(rows) > page_size else None}


@router.get("/from-run/{run_id}")
def from_run(run_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    run, _ = allowed_run(db, run_id, user, workspace)
    definition = json.loads(run.definition)
    definition["business_question"] = "What do the combined datasets show, and which changes deserve investigation?"
    definition["source_run_id"] = run.id
    definition["lag"]["maximum"] = min(12, definition["lag"]["maximum"])
    return definition


@router.get("/dataset-anomalies/{dataset_id}")
async def single_dataset_anomalies(
    dataset_id: int, request: Request, db=Depends(database), metric: str | None = Query(None, max_length=200),
    start_date: date | None = None, period_filter: Literal["all", "1m", "1q", "6m", "1y", "2y", "3y", "5y"] = "all",
    aggregation: Literal["daily", "weekly", "monthly", "quarterly"] = "monthly",
    aggregation_type: Literal["sum", "avg", "min", "max", "count"] = "sum", seasonal_business: bool = False,
):
    user, workspace = identity(request)
    datasets = authorize_datasets(db, user, workspace, [dataset_id])
    definition = {"dataset_id": dataset_id, "metric": metric, "start_date": str(start_date) if start_date else None,
                  "period_filter": period_filter, "aggregation": aggregation, "aggregation_type": aggregation_type,
                  "seasonal_business": seasonal_business}
    job = enqueue(db, user, workspace, "dataset_anomalies", definition, datasets)
    return await wait_for_job(job.id, user, workspace)


def calculate_dataset_anomalies(db, dataset_id, user, workspace, metric=None, start_date=None, period_filter="all",
                               aggregation="monthly", aggregation_type="sum", seasonal_business=False):
    dataset = authorize_datasets(db, user, workspace, [dataset_id])[dataset_id]
    try:
        dataset, frame = prepare_report_source(dataset, load_dataframe_from_dataset(dataset))
        catalog = metric_catalog(dataset, frame)
        selected = [item for item in catalog["metrics"] if not metric or item["metric_key"] == metric]
        if not selected or not catalog["date_columns"]:
            raise HTTPException(400, "No approved selected metric with a usable date field is available for anomaly detection.")
        if len(selected) > 25:
            raise HTTPException(400, "Choose a metric to assess; reports support at most 25 selected metrics.")
        column, zone = catalog["date_columns"][0], reporting_timezone()
        normalized = frame.copy()
        normalized[column] = report_dates(frame, column, zone)
        scoped = prepare_forecast_dataframe(normalized, column, str(start_date) if start_date else None, period_filter)
        dates = pd.to_datetime(scoped[column], errors="coerce").dropna()
        if dates.empty:
            raise HTTPException(400, "No dated observations are available in this reporting window.")
        definition = {"date_range": {"start": str(dates.min().date()), "end": str(dates.max().date())},
                      "grain": aggregation, "reporting_timezone": zone, "seasonal_business": seasonal_business}
        references, metadata = [], {}
        for item in selected:
            reference = {"dataset_id": dataset_id, "metric_key": item["metric_key"], "date_column": column,
                         "aggregation": "policy" if item["aggregation"] == "policy" else aggregation_type}
            key = metric_id(reference)
            references.append(reference)
            metadata[key] = {**item, **reference, "id": key, "dataset_label": dataset.file_name}
            if reference["aggregation"] == "count":
                metadata[key].update(unit="count", currency=None)
        return report_anomalies({dataset_id: (dataset, frame)}, references, definition, metadata)
    except HTTPException:
        raise
    except (ValueError, KeyError) as error:
        raise HTTPException(400, "Anomaly detection is unavailable for the selected metric and date policy.") from error
    except Exception as error:
        logger.warning("Report anomaly dataset %s unavailable", dataset_id, exc_info=True)
        raise HTTPException(503, "Anomaly detection is temporarily unavailable. Try again shortly.") from error


@router.post("/jobs", status_code=202)
def create_job(request: Request, payload: ReportDefinition, db=Depends(database)):
    user, workspace = identity(request)
    return job_response(enqueue_report(db, payload, user, workspace, request.headers.get("Idempotency-Key")))


@router.get("/jobs")
def active_jobs(request: Request, db=Depends(database)):
    user, workspace = identity(request)
    result = []
    for job in db.query(ReportAnalysisJob).filter_by(workspace_id=workspace, user_id=user).order_by(ReportAnalysisJob.created_at.desc()).limit(10):
        try:
            allowed_job(db, job.id, user, workspace)
            result.append(job_response(job))
        except HTTPException:
            continue
    return {"jobs": result, "worker_ready": worker_ready(db)}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    job = allowed_job(db, job_id, user, workspace)
    response = job_response(job, include_result=True)
    if response["result"] is not None and job.saved_report_id:
        saved = detail(job.saved_report_id, request, db)
        if job.kind == "weekly_preview" and "cross_dataset_report" in response["result"]:
            response["result"]["cross_dataset_report"] = saved
        else:
            response["result"] = saved
    return response


@router.post("/jobs/{job_id}/cancel")
def cancel_analysis(job_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    return cancel_job(db, allowed_job(db, job_id, user, workspace, for_update=True))


def require_report_writer(request):
    role = get_workspace_role(request)
    if role not in {"owner", "member", "managed_client"} and not is_client_workspace_role(role):
        raise HTTPException(403, "Read-only users cannot save shared reports")


@router.post("/jobs/{job_id}/save", status_code=201)
def save_job(job_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    require_report_writer(request)
    return save_completed_job(db, job_id, user, workspace)


@router.post("/weekly-jobs", status_code=202)
def weekly_job(request: Request, send: bool = False, include_ai_analysis: bool = False, report_only: bool = True, db=Depends(database)):
    from app.modules.alerts.router import require_weekly_report_manager

    user, workspace = identity(request)
    if send or not report_only:
        require_weekly_report_manager(get_workspace_role(request))
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).first()
    return job_response(enqueue_weekly(db, user, workspace, preference, send=send, include_ai=include_ai_analysis,
                                     request_key=request.headers.get("Idempotency-Key"), report_only=report_only))


@router.post("/preview", deprecated=True)
async def preview(request: Request, payload: ReportDefinition, db=Depends(database)):
    user, workspace = identity(request)
    job = enqueue_report(db, payload, user, workspace, request.headers.get("Idempotency-Key"))
    return await wait_for_job(job.id, user, workspace)


@router.post("", status_code=201, deprecated=True)
async def save(request: Request, payload: ReportDefinition, db=Depends(database)):
    user, workspace = identity(request)
    require_report_writer(request)
    job = enqueue_report(db, payload, user, workspace, request.headers.get("Idempotency-Key"))
    await wait_for_job(job.id, user, workspace)
    return save_completed_job(db, job.id, user, workspace)


@router.get("")
def reports(request: Request, db=Depends(database)):
    user, workspace = identity(request)
    result = []
    for report in db.query(BusinessReport).filter_by(workspace_id=workspace).order_by(BusinessReport.created_at.desc()).limit(100):
        try:
            allowed_report(db, report.id, user, workspace)
        except HTTPException:
            continue
        result.append({"report_id": report.id, "name": report.name, "created_at": report.created_at.isoformat() + "Z"})
    return result


@router.get("/weekly-preview")
async def weekly_preview(request: Request, db=Depends(database)):
    user, workspace = identity(request)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).first()
    job = enqueue_weekly(db, user, workspace, preference, include_ai=False, report_only=True)
    return await wait_for_job(job.id, user, workspace)


@router.get("/weekly-template")
def weekly_template_status(request: Request, db=Depends(database)):
    _, workspace = identity(request)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).first()
    report_id = preference.business_report_id if preference else None
    name = db.query(BusinessReport.name).filter_by(id=report_id, workspace_id=workspace).scalar() if report_id else None
    return {"report_id": report_id, "name": name,
            "enabled": bool(preference.enabled) if preference else False}


def clear_weekly_template(preference):
    preference.business_report_id = None
    preference.metric_focus = None
    # Removing the selected template must not silently send a different report.
    preference.enabled = 0


@router.delete("/weekly-template")
def remove_weekly_template(request: Request, report_id: str = Query(..., min_length=1, max_length=120), db=Depends(database)):
    _, workspace = identity(request)
    require_workspace_data_manager(request)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).with_for_update().first()
    if preference and preference.enabled and not preference.business_report_id:
        raise HTTPException(409, "The weekly template has changed. Refresh before removing it.")
    if preference and preference.business_report_id:
        if preference.business_report_id != report_id:
            raise HTTPException(409, "The weekly template has changed. Refresh before removing it.")
        clear_weekly_template(preference)
        db.commit()
    return {"report_id": None, "name": None, "enabled": bool(preference.enabled) if preference else False}


@router.get("/{report_id}")
def detail(report_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    report = allowed_report(db, report_id, user, workspace)
    snapshot = json.loads(report.snapshot)
    attach_report_decisions(snapshot, db, workspace, {item["dataset_id"] for item in snapshot["definition"]["metrics"]}, report.id)
    return {**snapshot, "report_id": report.id}


@router.delete("/{report_id}")
def delete_report(report_id: str, request: Request, db=Depends(database)):
    _, workspace = identity(request)
    require_workspace_data_manager(request)
    report = db.query(BusinessReport).filter_by(id=report_id, workspace_id=workspace).with_for_update().first()
    if report is None:
        raise HTTPException(404, "Report not found")
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).with_for_update().first()
    removed_template = bool(preference and preference.business_report_id == report.id)
    if removed_template:
        clear_weekly_template(preference)
    db.query(ReportAnalysisJob).filter_by(saved_report_id=report.id).delete(synchronize_session=False)
    db.delete(report)
    db.commit()
    return {"report_id": report_id, "deleted": True, "weekly_template_removed": removed_template}


def report_decision_evidence(report):
    snapshot = json.loads(report.snapshot)
    try:
        metrics = selected_report_metrics(snapshot)
    except ValueError as error:
        raise HTTPException(400, "The saved report's selected metrics are unavailable. Generate a new report.") from error
    if not metrics or snapshot["status"] != "ready":
        raise HTTPException(400, "Resolve report coverage before using this report as decision evidence")
    metric_ids = {item["id"] for item in metrics}
    findings = [{key: value for key, value in item.items() if key != "evidence"}
                for item in snapshot["findings"] if item["id"] in snapshot["included_findings"]
                and item["metric_a"]["id"] in metric_ids and item["metric_b"]["id"] in metric_ids]
    evidence = {"evidence_kind": "business_report", "report_id": report.id, "business_question": snapshot["business_question"],
                "window": snapshot["window"], "previous_window": snapshot["previous_window"],
                "metrics": [{key: value for key, value in item.items() if key != "trend"} for item in metrics],
                "findings": findings, "definition": snapshot["definition"], "warnings": snapshot["warnings"],
                "limitations": snapshot["limitations"], "generated_at": snapshot["generated_at"]}
    descriptors = [{"dataset_id": item["dataset_id"], "file_name": item["dataset_label"],
                    "metric_column": item["metric_key"], "label": item["label"], "column_type": "numeric"} for item in metrics]
    return snapshot, metrics, evidence, descriptors


@router.post("/{report_id}/decision-evidence")
def decision_evidence(report_id: str, request: Request, payload: ReportDecision, db=Depends(database)):
    user, workspace = identity(request)
    report = allowed_report(db, report_id, user, workspace)
    snapshot, metrics, evidence, descriptors = report_decision_evidence(report)
    outcome = next((item for item in metrics if item["id"] == payload.outcome_metric), None)
    if outcome is None:
        raise HTTPException(400, "Select an outcome metric from the report")
    return {"decision_payload": {"dataset_id": outcome["dataset_id"], "outcome_dataset_id": outcome["dataset_id"],
            "metric_column": outcome["metric_key"], "title": payload.title, "action": payload.action,
            "description": f"Business question: {snapshot['business_question']}\nReasoning and assumptions: {payload.reasoning}\nEvidence: /dashboard/reports?report={report.id}",
            "expected_outcome": payload.expected_outcome, "review_date": payload.review_date,
            "evidence_dataset_ids": list(dict.fromkeys(item["dataset_id"] for item in metrics)),
            "evidence_metrics": descriptors,
            "recommendation_source": "rules", "recommendation_context": encode(evidence)}}


@router.post("/{report_id}/decision-drafts/{decision_id}/evidence")
def bind_draft_evidence(report_id: str, decision_id: int, request: Request, db=Depends(database)):
    from app.modules.decisions.router import (
        DETAILS_DECISION_ACTIVITY, ensure_decision_is_editable,
        get_accessible_decision_or_404, record_decision_activity, require_decision_manager,
    )

    user, workspace = identity(request)
    require_decision_manager(request)
    report = allowed_report(db, report_id, user, workspace)
    decision = get_accessible_decision_or_404(db, decision_id, user, workspace)
    db.refresh(decision, with_for_update=True)
    ensure_decision_is_editable(decision)
    if decision.status != "planned" or not is_report_decision_draft(decision):
        raise HTTPException(409, "Only an unrecorded decision draft can adopt report evidence")
    _, metrics, evidence, descriptors = report_decision_evidence(report)
    sources = list(dict.fromkeys(item["dataset_id"] for item in metrics))
    if set(sources) != {decision.dataset_id, *decision.evidence_dataset_ids}:
        raise HTTPException(409, "The report and decision draft must use the same datasets")
    try:
        previous = json.loads(decision.recommendation_context or "{}")
    except (TypeError, ValueError):
        previous = None
    if isinstance(previous, dict) and previous.get("report_id") and previous["report_id"] != report.id:
        raise HTTPException(409, "This draft is already linked to another saved report. Open it from that report.")
    # Keep the original legacy evidence, but never use its wider cache as the selection.
    evidence["original_evidence"] = previous["original_evidence"] if isinstance(previous, dict) and "original_evidence" in previous else {
        "recommendation_context": decision.recommendation_context,
        "recommendation_text": decision.recommendation_text,
        "recommendation_source": decision.recommendation_source,
        "evidence_metrics": decision.evidence_metrics,
        "evidence_dataset_ids": decision.evidence_dataset_ids,
        "description": decision.description,
        "outcome_dataset_id": decision.outcome_dataset_id,
        "metric_column": decision.metric_column,
    }
    context = encode(evidence)
    if decision.recommendation_context != context or decision.evidence_metrics != descriptors:
        decision.recommendation_context = context
        decision.evidence_metrics = descriptors
        decision.evidence_dataset_ids = sources
        selected = {(item["dataset_id"], item["metric_key"]) for item in metrics}
        if (decision.outcome_dataset_id or decision.dataset_id, decision.metric_column) not in selected:
            decision.metric_column = None
            decision.outcome_dataset_id = None
        record_decision_activity(db, decision, DETAILS_DECISION_ACTIVITY,
                                 f"Selected evidence saved from report {report.id}", actor_user_id=user)
        db.commit()
    return {"decision_id": decision.id}


@router.post("/{report_id}/weekly")
def weekly_template(report_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    require_workspace_data_manager(request)
    report = allowed_report(db, report_id, user, workspace, for_update=True)
    definition = json.loads(report.definition)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).with_for_update().first()
    if definition.get("scope", "multi") != "multi" or len({item["dataset_id"] for item in definition["metrics"]}) < 2:
        raise HTTPException(400, "Weekly reports require a multi dataset report template")
    if preference is None:
        preference = WeeklyReportPreference(workspace_id=workspace, enabled=0)
        db.add(preference)
    preference.business_report_id = report.id
    preference.metric_focus = encode([metric_id(item) for item in definition["metrics"]])
    # Selecting a template must not enable sending or change existing recipients.
    db.commit()
    return {"report_id": report.id, "enabled": bool(preference.enabled)}
