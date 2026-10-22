"""Durable report work. API paths only validate, enqueue, poll and save snapshots."""

import asyncio
from datetime import datetime, timedelta
import json
import time
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.db.database import SessionLocal
from app.db.models import Dataset, IngestionWorkerHeartbeat, WeeklyReportPreference, utc_now
from app.infrastructure.ingestion_jobs import lock_workspace_queue
from app.modules.correlation.catalog import reporting_timezone
from app.modules.correlation.service import allowed_run, authorize_datasets, digest, encode, snapshot
from .models import BusinessReport, ReportAnalysisJob
from .relationships import report_test_count


ACTIVE = {"queued", "running"}
WORKER_NAME = "reports-analysis"


def worker_ready(db):
    heartbeat = db.get(IngestionWorkerHeartbeat, WORKER_NAME)
    return bool(heartbeat and heartbeat.last_seen_at >= utc_now() - timedelta(seconds=30))


def require_worker(db):
    if not worker_ready(db):
        raise HTTPException(503, "Report analysis is temporarily unavailable. Your selections have been preserved.")


def validate_definition(db, payload, user, workspace):
    if len(payload.metrics) > 25 or payload.lag.maximum > 12 or report_test_count(payload.model_dump(mode="json")) > 1000:
        raise HTTPException(400, "Reports support at most 25 metrics, 12 lag periods and 1,000 pair-lag tests.")
    if payload.source_run_id:
        allowed_run(db, payload.source_run_id, user, workspace)
    definition = payload.model_dump(mode="json")
    definition["reporting_timezone"] = reporting_timezone()
    datasets = authorize_datasets(db, user, workspace, [item.dataset_id for item in payload.metrics])
    return definition, datasets


def weekly_configuration(db, preference, workspace):
    from app.modules.alerts.router import build_weekly_report_preference_response, weekly_business_template

    configuration = build_weekly_report_preference_response(preference).model_dump(mode="json")
    for key in ("last_sent_at", "last_send_status", "last_send_error"):
        configuration.pop(key, None)
    return {"preference": configuration, "template": weekly_business_template(db, preference, workspace)}


def enqueue(db, user, workspace, kind, definition, datasets, request_key=None):
    lock_workspace_queue(db, "reports-analysis:" + workspace)
    key = digest([workspace, user, kind, request_key or str(uuid4())])
    existing = db.query(ReportAnalysisJob).filter_by(request_key=key).first()
    if existing:
        if json.loads(existing.definition) != definition:
            raise HTTPException(409, "This analysis request has already been used with different settings.")
        db.commit()
        return existing
    require_worker(db)
    if db.query(ReportAnalysisJob).filter(ReportAnalysisJob.workspace_id == workspace, ReportAnalysisJob.status.in_(ACTIVE)).count() >= 3:
        raise HTTPException(429, "Three analyses are already queued for this workspace. Wait for one to finish.")
    job = ReportAnalysisJob(user_id=user, workspace_id=workspace, kind=kind, request_key=key,
                            definition=encode(definition), sources=encode(snapshot(datasets)))
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def enqueue_report(db, payload, user, workspace, request_key=None):
    definition, datasets = validate_definition(db, payload, user, workspace)
    return enqueue(db, user, workspace, "report", definition, datasets, request_key)


def enqueue_weekly(db, user, workspace, preference, *, send=False, scheduled=False, include_ai=True, request_key=None, report_only=False):
    from app.modules.alerts.router import get_alert_datasets
    from .service import complete_week

    anchor = datetime.now(ZoneInfo(reporting_timezone())).date()
    definition = {"configuration": weekly_configuration(db, preference, workspace), "anchor": str(anchor),
                  "include_ai_analysis": include_ai, "scheduled": scheduled, "reporting_timezone": reporting_timezone(), "report_only": report_only}
    if send and not definition["configuration"]["preference"]["enabled"]:
        raise HTTPException(400, "Weekly KPI email notifications are not enabled")
    if scheduled:
        # One claim per workspace and completed week, even when the template changes.
        request_key = "weekly:" + complete_week(anchor)["end"]
        existing = db.query(ReportAnalysisJob).filter_by(request_key=digest([workspace, user, "weekly_send", request_key])).first()
        if existing:
            return existing
    datasets = {item.id: item for item in get_alert_datasets(db, workspace)}
    authorize_datasets(db, user, workspace, datasets)
    return enqueue(db, user, workspace, "weekly_send" if send else "weekly_preview", definition, datasets, request_key)


def verify_job_actor(job):
    from app.modules.auth_context import is_agency_managed_client_workspace, is_agency_owner_access_enabled, verify_workspace_membership

    if job.user_id == job.workspace_id:
        role = "owner"
    elif is_agency_managed_client_workspace(job.user_id, job.workspace_id):
        if not is_agency_owner_access_enabled(job.workspace_id):
            raise HTTPException(403, "Workspace access was revoked. Generate a new analysis after access is restored.")
        role = "managed_client"
    else:
        role = verify_workspace_membership(job.user_id, job.workspace_id)
        if ":client:" in job.workspace_id and role == "owner":
            role = "client_owner"
    if job.kind == "weekly_send" or job.kind == "weekly_preview" and not json.loads(job.definition).get("report_only"):
        from app.modules.alerts.router import require_weekly_report_manager
        require_weekly_report_manager(role)


def allowed_job(db, identity, user, workspace, *, for_update=False):
    query = db.query(ReportAnalysisJob).populate_existing().filter_by(id=identity, workspace_id=workspace, user_id=user)
    job = (query.with_for_update() if for_update else query).first()
    if job is None:
        raise HTTPException(404, "Analysis job not found")
    if job.kind == "weekly_send" or job.kind == "weekly_preview" and not json.loads(job.definition).get("report_only"):
        verify_job_actor(job)
    authorize_datasets(db, user, workspace, [int(key) for key in json.loads(job.sources)])
    return job


def job_response(job, *, include_result=False):
    return {"job_id": job.id, "kind": job.kind, "status": job.status, "phase": job.phase,
            "created_at": job.created_at.isoformat() + "Z", "error": job.error,
            "definition": json.loads(job.definition) if job.kind == "report" else None,
            "error_status": job.error_status, "saved_report_id": job.saved_report_id,
            "result": json.loads(job.result) if include_result and job.status == "succeeded" and job.result else None}


def cancel_job(db, job):
    if job.kind == "weekly_send" and job.phase == "sending":
        raise HTTPException(409, "Email delivery has already started and cannot be cancelled.")
    db.query(ReportAnalysisJob).filter(ReportAnalysisJob.id == job.id, ReportAnalysisJob.status.in_(ACTIVE)).update(
        {"status": "cancelled", "phase": "cancelled", "result": None, "completed_at": utc_now()}, synchronize_session=False)
    db.commit()
    db.refresh(job)
    return job_response(job)


def save_completed_job(db, identity, user, workspace):
    job = allowed_job(db, identity, user, workspace, for_update=True)
    if job.status != "succeeded" or job.kind not in {"report", "weekly_preview"}:
        raise HTTPException(409, "Wait for report analysis to finish before saving.")
    if job.saved_report_id:
        existing = db.get(BusinessReport, job.saved_report_id)
        if existing:
            return {**json.loads(existing.snapshot), "report_id": existing.id, "analysis_job_id": job.id}
        raise HTTPException(410, "This saved report was deleted. Generate a new preview to save it again.")
    result = json.loads(job.result)
    if job.kind == "weekly_preview":
        result = result.get("cross_dataset_report", result)
        if len({item["dataset_id"] for item in result["definition"]["metrics"]}) < 2:
            raise HTTPException(400, "Weekly report snapshots require usable metrics from at least two datasets.")
    report = BusinessReport(workspace_id=workspace, user_id=user, name=result["name"],
                            definition=encode(result["definition"]), snapshot=encode(result))
    db.add(report)
    db.flush()
    job.saved_report_id = report.id
    db.commit()
    return {**result, "report_id": report.id, "analysis_job_id": job.id}


async def wait_for_job(identity, user, workspace, *, timeout=45):
    """Compatibility for older clients. No calculation takes place in the API."""
    deadline = time.monotonic() + timeout
    while True:
        with SessionLocal() as db:
            job = allowed_job(db, identity, user, workspace)
            if job.status == "succeeded":
                return json.loads(job.result)
            if job.status not in ACTIVE:
                raise HTTPException(job.error_status or 409, job.error or "Analysis was cancelled. Generate another preview.")
        if time.monotonic() >= deadline:
            raise HTTPException(504, "Analysis is still queued or running. Open Reports to retrieve the completed result.", headers={"X-Analysis-Job-Id": identity})
        await asyncio.sleep(.5)
