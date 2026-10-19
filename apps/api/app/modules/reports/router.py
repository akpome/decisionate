import json
import logging
from itertools import combinations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.db.database import SessionLocal
from app.db.models import Dataset, WeeklyReportPreference
from app.modules.correlation.catalog import reporting_timezone
from app.modules.correlation.engine import metric_id
from app.modules.correlation.service import allowed_run, authorize_datasets, dataset_scope, encode
from app.modules.auth_context import is_client_workspace_role
from app.modules.datasets.services.auth import get_user_id, get_workspace_id, get_workspace_role, require_workspace_data_manager
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from app.modules.decisions.metric_scope import selected_report_metrics
from .models import BusinessReport
from .catalog import report_metric_catalog
from .schemas import ReportDecision, ReportDefinition
from .service import attach_report_decisions, build_report


router = APIRouter(prefix="/api/v2/business-reports", tags=["business-reports"])
logger = logging.getLogger(__name__)


def database():
    with SessionLocal() as db:
        yield db


def identity(request):
    user = get_user_id(request)
    return user, get_workspace_id(request, user)


def allowed_report(db, report_id, user, workspace):
    report = db.get(BusinessReport, report_id)
    if report is None or report.workspace_id != workspace:
        raise HTTPException(404, "Report not found")
    definition = json.loads(report.definition)
    authorize_datasets(db, user, workspace, [item["dataset_id"] for item in definition["metrics"]])
    return report


def generate(db, payload, user, workspace):
    source_run = allowed_run(db, payload.source_run_id, user, workspace)[0] if payload.source_run_id else None
    if len(payload.metrics) > 25 or payload.lag.maximum > 12:
        raise HTTPException(400, "Reports support at most 25 metrics and 12 lag periods")
    pairs = sum(left.dataset_id != right.dataset_id for left, right in combinations(payload.metrics, 2))
    lag_count = len({0, *range(payload.lag.minimum, payload.lag.maximum + 1)}) if payload.lag.enabled else 1
    if pairs * lag_count > 1000:
        raise HTTPException(400, "Reduce the report's metrics or lag window to at most 1,000 pair-lag tests. Larger analyses remain available in the advanced matrix.")
    definition = payload.model_dump(mode="json")
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
    try:
        result = build_report(frames, definition, unavailable=unavailable)
    except (ValueError, KeyError) as error:
        raise HTTPException(400, "The selected metrics, date columns or saved policies are no longer available. Review the selections.") from error
    if source_run:
        result["source_analysis"] = {"run_id": source_run.id, "engine_version": source_run.engine_version,
                                     "definition": json.loads(source_run.definition),
                                     "computed_at": source_run.completed_at.isoformat() if source_run.completed_at else None,
                                     "note": "This report recalculates the selected sources. The original analysis run remains available for comparison."}
    attach_report_decisions(result, db, workspace, {item["dataset_id"] for item in result["definition"]["metrics"]})
    return result["definition"], result


@router.get("/catalog")
def catalog(request: Request, db=Depends(database), offset: int = Query(0, ge=0), dataset_id: int | None = Query(None, ge=1)):
    user, workspace = identity(request)
    query = db.query(Dataset).filter(dataset_scope(user, workspace))
    if dataset_id is not None:
        query = query.filter(Dataset.id == dataset_id)
    datasets = query.order_by(Dataset.id).offset(offset).limit(25).all()
    result = []
    for dataset in datasets:
        try:
            result.append(report_metric_catalog(dataset, load_dataframe_from_dataset(dataset)))
        except Exception:
            logger.warning("Report catalogue dataset %s unavailable", dataset.id, exc_info=True)
            result.append({"dataset_id": dataset.id, "dataset_label": dataset.file_name, "connector": dataset.source_type,
                           "date_columns": [], "metrics": [], "availability": {}, "error_code": "dataset_unavailable"})
    return {"datasets": result, "next_offset": offset + 25 if len(datasets) == 25 else None}


@router.get("/from-run/{run_id}")
def from_run(run_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    run, _ = allowed_run(db, run_id, user, workspace)
    definition = json.loads(run.definition)
    definition["business_question"] = "What do the combined datasets show, and which changes deserve investigation?"
    definition["source_run_id"] = run.id
    definition["lag"]["maximum"] = min(12, definition["lag"]["maximum"])
    return definition


@router.post("/preview")
def preview(request: Request, payload: ReportDefinition, db=Depends(database)):
    user, workspace = identity(request)
    return generate(db, payload, user, workspace)[1]


@router.post("", status_code=201)
def save(request: Request, payload: ReportDefinition, db=Depends(database)):
    user, workspace = identity(request)
    role = get_workspace_role(request)
    if role not in {"owner", "member", "managed_client"} and not is_client_workspace_role(role):
        raise HTTPException(403, "Read-only users cannot save shared reports")
    definition, result = generate(db, payload, user, workspace)
    report = BusinessReport(workspace_id=workspace, user_id=user, name=payload.name,
                            definition=encode(definition), snapshot=encode(result))
    db.add(report)
    db.commit()
    return {**result, "report_id": report.id}


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
    from app.modules.alerts.router import build_weekly_report_digest_for_workspace_async
    user, workspace = identity(request)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).first()
    digest = await build_weekly_report_digest_for_workspace_async(db, user, workspace, preference, include_ai_analysis=False)
    return digest.cross_dataset_report


@router.get("/{report_id}")
def detail(report_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    report = allowed_report(db, report_id, user, workspace)
    snapshot = json.loads(report.snapshot)
    attach_report_decisions(snapshot, db, workspace, {item["dataset_id"] for item in snapshot["definition"]["metrics"]}, report.id)
    return {**snapshot, "report_id": report.id}


@router.post("/{report_id}/decision-evidence")
def decision_evidence(report_id: str, request: Request, payload: ReportDecision, db=Depends(database)):
    user, workspace = identity(request)
    report = allowed_report(db, report_id, user, workspace)
    snapshot = json.loads(report.snapshot)
    try:
        metrics = selected_report_metrics(snapshot)
    except ValueError as error:
        raise HTTPException(400, "The saved report's selected metrics are unavailable. Generate a new report.") from error
    outcome = next((item for item in metrics if item["id"] == payload.outcome_metric), None)
    if outcome is None:
        raise HTTPException(400, "Select an outcome metric from the report")
    if snapshot["status"] != "ready":
        raise HTTPException(400, "Resolve cross-dataset coverage before using this report as decision evidence")
    metric_ids = {item["id"] for item in metrics}
    findings = [{key: value for key, value in item.items() if key != "evidence"}
                for item in snapshot["findings"] if item["id"] in snapshot["included_findings"]
                and item["metric_a"]["id"] in metric_ids and item["metric_b"]["id"] in metric_ids]
    evidence = {"evidence_kind": "business_report", "report_id": report.id, "business_question": snapshot["business_question"],
                "window": snapshot["window"], "previous_window": snapshot["previous_window"],
                "metrics": [{key: value for key, value in item.items() if key != "trend"} for item in metrics],
                "findings": findings, "definition": snapshot["definition"], "warnings": snapshot["warnings"],
                "limitations": snapshot["limitations"], "generated_at": snapshot["generated_at"]}
    return {"decision_payload": {"dataset_id": outcome["dataset_id"], "outcome_dataset_id": outcome["dataset_id"],
            "metric_column": outcome["metric_key"], "title": payload.title, "action": payload.action,
            "description": f"Business question: {snapshot['business_question']}\nReasoning and assumptions: {payload.reasoning}\nEvidence: /dashboard/reports?report={report.id}",
            "expected_outcome": payload.expected_outcome, "review_date": payload.review_date,
            "evidence_dataset_ids": list(dict.fromkeys(item["dataset_id"] for item in metrics)),
            "evidence_metrics": [{"dataset_id": item["dataset_id"], "file_name": item["dataset_label"],
                                  "metric_column": item["metric_key"], "label": item["label"], "column_type": "numeric"} for item in metrics],
            "recommendation_source": "rules", "recommendation_context": encode(evidence)}}


@router.post("/{report_id}/weekly")
def weekly_template(report_id: str, request: Request, db=Depends(database)):
    user, workspace = identity(request)
    require_workspace_data_manager(request)
    report = allowed_report(db, report_id, user, workspace)
    definition = json.loads(report.definition)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).first()
    if preference is None:
        preference = WeeklyReportPreference(workspace_id=workspace, enabled=0)
        db.add(preference)
    preference.business_report_id = report.id
    preference.metric_focus = encode([metric_id(item) for item in definition["metrics"]])
    # Selecting a template must not enable sending or change existing recipients.
    db.commit()
    return {"report_id": report.id, "enabled": bool(preference.enabled)}
