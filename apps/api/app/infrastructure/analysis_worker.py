"""Separate, supervised Reports queue; never consumes ingestion jobs."""

from datetime import timedelta
import json
import logging
import os
import signal
import subprocess
import sys
import time

from fastapi import HTTPException
from sqlalchemy import func, text

from app.db.database import SessionLocal, engine
from app.db.models import IngestionWorkerHeartbeat, WeeklyReportPreference, utc_now
from app.modules.reports.job_constants import ACTIVE, WORKER_NAME
from app.modules.reports.models import ReportAnalysisJob
from app.infrastructure.analysis_resources import child_environment, memory_budget_bytes, process_memory


logger = logging.getLogger(__name__)
WORKER_LOCK = "SELECT pg_try_advisory_lock(59831, 4)"


def record_heartbeat():
    with SessionLocal() as db:
        row = db.get(IngestionWorkerHeartbeat, WORKER_NAME)
        if row is None:
            row = IngestionWorkerHeartbeat(name=WORKER_NAME)
            db.add(row)
        row.last_seen_at = utc_now()
        # Ingestion heartbeat job_id is an integer; the analysis job UUID stays in this queue.
        db.commit()


def check_inputs(db, job):
    from app.modules.correlation.catalog import reporting_timezone
    from app.modules.correlation.service import authorize_datasets, snapshot
    from app.modules.reports.jobs import verify_job_actor, weekly_configuration, weekly_owner_recipient

    db.expire_all()
    db.refresh(job)
    if job.status != "running":
        raise HTTPException(409, "Analysis was cancelled.")
    verify_job_actor(job)
    if json.loads(job.definition).get("reporting_timezone", reporting_timezone()) != reporting_timezone():
        raise HTTPException(409, "The reporting timezone changed. Generate a new preview with the current reporting settings.")
    expected = json.loads(job.sources)
    datasets = authorize_datasets(db, job.user_id, job.workspace_id, [int(key) for key in expected])
    if snapshot(datasets) != expected:
        raise HTTPException(409, "A selected dataset changed during analysis. Generate a new preview with its latest data.")
    from app.modules.reports.decision_reviews import bind_decision_review, review_study
    frozen_definition = json.loads(job.definition)
    study = review_study(frozen_definition)
    frozen_timing = json.dumps(study.get("timing_evidence"), sort_keys=True) if study else None
    bind_decision_review(db, frozen_definition, job.user_id, job.workspace_id, editable=job.kind == "report")
    if study and frozen_timing != json.dumps(study.get("timing_evidence"), sort_keys=True):
        raise HTTPException(409, "The decision's timing evidence changed. Generate a new assessment.")
    if job.kind.startswith("weekly_"):
        delivery = json.loads(job.definition).get("delivery", {})
        if job.kind == "weekly_owner_send" and delivery.get("mode") != "workspace_owner":
            raise HTTPException(400, "The owner delivery settings are unavailable. Request a new report send.")
        if delivery.get("mode") == "workspace_owner" and weekly_owner_recipient(db, job.workspace_id) != delivery["recipient"]:
            raise HTTPException(409, "The workspace owner's email changed. Send a new report after reviewing the current owner.")
        preference = db.query(WeeklyReportPreference).filter_by(workspace_id=job.workspace_id).first()
        if weekly_configuration(db, preference, job.workspace_id, job.user_id) != json.loads(job.definition)["configuration"]:
            raise HTTPException(409, "Weekly report settings changed. Generate a new preview before sending.")
        if job.kind in {"weekly_send", "weekly_owner_send"}:
            from datetime import date, datetime
            from zoneinfo import ZoneInfo
            from app.modules.reports.service import complete_week
            anchor = date.fromisoformat(json.loads(job.definition)["anchor"])
            if complete_week(anchor) != complete_week(datetime.now(ZoneInfo(reporting_timezone())).date()):
                raise HTTPException(409, "The reporting week changed while this delivery waited. Generate the latest weekly report.")


def set_phase(db, job, phase, *, intermediate_result=None):
    from app.modules.correlation.service import encode

    check_inputs(db, job)
    values = {"phase": phase}
    if intermediate_result is not None:
        values["result"] = encode(intermediate_result)
    changed = db.query(ReportAnalysisJob).filter_by(id=job.id, status="running").update(values, synchronize_session=False)
    db.commit()
    if not changed:
        raise HTTPException(409, "Analysis was cancelled.")


def fail_job(db, identity, message, status=503):
    job = db.get(ReportAnalysisJob, identity, populate_existing=True)
    if job is None or job.status not in ACTIVE:
        return
    is_delivery = job.kind in {"weekly_send", "weekly_owner_send"}
    sending = is_delivery and job.phase == "sending"
    changed = db.query(ReportAnalysisJob).filter(ReportAnalysisJob.id == identity, ReportAnalysisJob.status.in_(ACTIVE)).update(
        {"status": "failed", "phase": "failed", "error": message, "error_status": status, "completed_at": utc_now(),
         "result": json.dumps({"delivery_started": sending}) if is_delivery else None}, synchronize_session=False)
    if changed and job.kind in {"weekly_send", "weekly_owner_send"} and job.phase != "sending":
        from app.modules.alerts.router import record_weekly_report_delivery_log, update_weekly_report_delivery_status
        definition = json.loads(job.definition)
        configuration = definition.get("configuration", {}).get("preference", {})
        delivery = definition.get("delivery", {})
        preference = db.query(WeeklyReportPreference).filter_by(workspace_id=job.workspace_id).first()
        if delivery.get("mode") != "workspace_owner":
            update_weekly_report_delivery_status(preference, "failed", message)
        recipients = [delivery["recipient"]] if delivery.get("mode") == "workspace_owner" else configuration.get("recipient_emails", [])
        record_weekly_report_delivery_log(db, job.workspace_id, "failed", recipients, error=message)
    db.commit()


def run_weekly(db, job, definition):
    from datetime import date
    from app.modules.alerts import router as alerts

    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=job.workspace_id).first()
    set_phase(db, job, "computing")
    digest = alerts.build_weekly_report_digest_for_workspace(
        db, job.user_id, job.workspace_id, preference,
        include_ai_analysis=definition["include_ai_analysis"], analysis_date=date.fromisoformat(definition["anchor"]),
    )
    digest.cross_dataset_report["analysis_job_id"] = job.id
    if job.kind == "weekly_preview":
        check_inputs(db, job)
        return digest.cross_dataset_report if definition.get("report_only") else digest.model_dump(mode="json")
    owner_delivery = definition.get("delivery", {}).get("mode") == "workspace_owner"
    if owner_delivery:
        digest = digest.model_copy(update={"enabled": True, "recipient_emails": [definition["delivery"]["recipient"]]})
    alerts.validate_weekly_report_digest_for_delivery(digest)
    # Commit before external side effects. A restart in this phase needs operator
    # reconciliation, never an automatic resend (SMTP cannot guarantee exactly once).
    set_phase(db, job, "sending", intermediate_result={"digest": digest.model_dump(mode="json")})
    try:
        delivery = alerts.send_weekly_report_email(digest)
    except Exception as error:
        recipients, count = alerts.get_weekly_report_delivery_failure_details(error, digest)
        if not owner_delivery:
            alerts.update_weekly_report_delivery_status(preference, "failed", "Weekly report delivery failed; inspect delivery history before retrying.")
        db.commit()
        alerts.record_weekly_report_delivery_log(db, job.workspace_id, "failed", recipients, digest.subject,
                                                delivered_count=count, metrics_count=len(digest.metrics),
                                                error="Delivery failed or was partially accepted. No automatic resend.")
        raise HTTPException(502, "Weekly report delivery failed. Inspect delivery history before retrying.") from error
    sent_at = alerts.get_utc_now()
    if not owner_delivery:
        alerts.update_weekly_report_delivery_status(preference, "sent", sent_at=sent_at)
    db.commit()
    alerts.record_weekly_report_delivery_log(db, job.workspace_id, "sent", delivery["recipients"], digest.subject,
                                            delivery["delivered_count"], len(digest.metrics))
    return alerts.build_weekly_report_delivery_response(job.workspace_id, digest, delivery["delivered_count"], delivery["recipients"], sent_at).model_dump(mode="json")


def execute_job(identity):
    from app.modules.correlation.service import encode

    with SessionLocal() as db:
        claimed = db.query(ReportAnalysisJob).filter_by(id=identity, status="queued").update(
            {"status": "running", "phase": "loading", "started_at": utc_now(),
             "attempts": ReportAnalysisJob.attempts + 1}, synchronize_session=False)
        db.commit()
        if not claimed:
            return
        job = db.get(ReportAnalysisJob, identity)
        logger.info("Report analysis %s started (%s)", identity, job.kind)
        try:
            check_inputs(db, job)
            definition = json.loads(job.definition)
            if job.kind == "report":
                from app.modules.reports.router import generate
                from app.modules.reports.schemas import ReportDefinition

                payload = {key: value for key, value in definition.items() if key != "reporting_timezone"}
                result = generate(db, ReportDefinition.model_validate(payload), job.user_id, job.workspace_id,
                                  progress=lambda phase: set_phase(db, job, phase))[1]
                result["analysis_job_id"] = job.id
                check_inputs(db, job)
            elif job.kind in {"weekly_preview", "weekly_send", "weekly_owner_send"}:
                result = run_weekly(db, job, definition)
            elif job.kind == "dataset_anomalies":
                from app.modules.reports.router import calculate_dataset_anomalies
                set_phase(db, job, "computing")
                result = calculate_dataset_anomalies(db, user=job.user_id, workspace=job.workspace_id, **definition)
                check_inputs(db, job)
            else:
                raise HTTPException(400, "Unsupported report analysis job.")
            db.query(ReportAnalysisJob).filter_by(id=identity, status="running").update(
                {"status": "succeeded", "phase": "completed", "result": encode(result), "completed_at": utc_now()}, synchronize_session=False)
            db.commit()
            logger.info("Report analysis %s completed", identity)
        except HTTPException as error:
            logger.warning("Report analysis %s stopped (HTTP %s)", identity, error.status_code)
            db.rollback()
            fail_job(db, identity, str(error.detail), error.status_code)
        except MemoryError:
            logger.exception("Report analysis exhausted available memory", extra={"job_id": identity})
            db.rollback()
            fail_job(db, identity, "Analysis ran out of available memory. Your selections have been preserved. Try fewer metrics or a shorter reporting window.")
        except Exception:
            logger.exception("Report analysis failed", extra={"job_id": identity})
            db.rollback()
            fail_job(db, identity, "Report analysis could not be completed. Your selections have been preserved.")


def recover_interrupted_jobs(identity=None, *, retry=True, reason="Analysis worker restarted before completion."):
    with SessionLocal() as db:
        query = db.query(ReportAnalysisJob)
        if identity:
            query = query.filter(ReportAnalysisJob.id == identity, ReportAnalysisJob.status.in_(ACTIVE))
        else:
            query = query.filter_by(status="running")
        for job in query.all():
            definition = json.loads(job.definition)
            # AI charges and external sends are not blindly replayed.
            safe = job.status == "running" and job.phase not in {"sending", "interpreting"} and not definition.get("include_ai_analysis", False)
            if retry and safe and job.attempts < 2:
                job.status, job.phase = "queued", "queued"
            else:
                sending = job.phase == "sending"
                job.status, job.phase = "failed", "failed"
                job.error = ("Email delivery was interrupted; check provider logs before retrying. No automatic resend."
                             if sending else reason)
                job.error_status, job.completed_at = 503, utc_now()
                if job.kind in {"weekly_send", "weekly_owner_send"}:
                    job.result = json.dumps({"delivery_started": sending})
                if job.kind in {"weekly_send", "weekly_owner_send"}:
                    from app.modules.alerts.router import record_weekly_report_delivery_log, update_weekly_report_delivery_status
                    configuration = definition.get("configuration", {}).get("preference", {})
                    delivery = definition.get("delivery", {})
                    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=job.workspace_id).first()
                    if delivery.get("mode") != "workspace_owner":
                        update_weekly_report_delivery_status(preference, "failed", job.error)
                    recipients = [delivery["recipient"]] if delivery.get("mode") == "workspace_owner" else configuration.get("recipient_emails", [])
                    record_weekly_report_delivery_log(db, job.workspace_id, "unknown" if sending else "failed", recipients, error=job.error)
        db.commit()


def next_job():
    with SessionLocal() as db:
        if db.query(ReportAnalysisJob.id).filter_by(status="queued").first() is None:
            return None
        served = db.query(ReportAnalysisJob.workspace_id.label("workspace"), func.max(ReportAnalysisJob.started_at).label("last_started")).group_by(ReportAnalysisJob.workspace_id).subquery()
        job = db.query(ReportAnalysisJob).outerjoin(served, served.c.workspace == ReportAnalysisJob.workspace_id).filter(
            ReportAnalysisJob.status == "queued").order_by(served.c.last_started.asc().nullsfirst(), ReportAnalysisJob.created_at, ReportAnalysisJob.id).first()
        return job.id if job else None


def supervise_job(identity, connection, script):
    timeout = max(30, min(int(os.getenv("ANALYSIS_JOB_TIMEOUT_SECONDS", "900")), 7200))
    memory_budget = memory_budget_bytes()
    try:
        child = subprocess.Popen([sys.executable, "-B", script, "--job-id", identity, "--parent-pid", str(os.getpid())],
                                 start_new_session=True, env=child_environment())
    except OSError:
        logger.exception("Report analysis child could not start: job_id=%s", identity)
        recover_interrupted_jobs(identity, retry=False,
                                 reason="Analysis could not start. Your selections have been preserved. Please try again.")
        return
    deadline = time.monotonic() + timeout
    timed_out = False
    memory_exceeded = False
    peak_rss = peak_virtual = max_threads = 0
    logger.info("Report analysis resource budget: job_id=%s resident_limit_bytes=%s timeout_seconds=%s",
                identity, memory_budget, timeout)
    try:
        while child.poll() is None:
            memory = process_memory(child.pid)
            if memory:
                peak_rss = max(peak_rss, memory["rss_bytes"])
                peak_virtual = max(peak_virtual, memory["virtual_bytes"])
                max_threads = max(max_threads, memory["threads"])
                if memory["rss_bytes"] > memory_budget:
                    memory_exceeded = True
                    break
            connection.execute(text("SELECT 1"))
            connection.commit()
            record_heartbeat()
            with SessionLocal() as db:
                row = db.get(ReportAnalysisJob, identity)
                if row is None or row.status == "cancelled":
                    break
            if time.monotonic() >= deadline:
                timed_out = True
                break
            time.sleep(1)
    finally:
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        returncode = child.wait()
        with SessionLocal() as db:
            row = db.get(ReportAnalysisJob, identity)
            if row is not None and row.status in ACTIVE:
                logger.error("Report analysis child stopped: job_id=%s returncode=%s timed_out=%s phase=%s attempts=%s memory_exceeded=%s peak_rss_bytes=%s peak_virtual_bytes=%s max_threads=%s resident_limit_bytes=%s",
                             identity, returncode, timed_out, row.phase, row.attempts, memory_exceeded,
                             peak_rss, peak_virtual, max_threads, memory_budget)
        reason = ("Analysis exceeded its memory budget. Your selections have been preserved. Try fewer selected metrics."
                  if memory_exceeded else "Analysis exceeded its execution limit. Reduce the selected metrics or reporting window."
                  if timed_out else "Analysis was interrupted before it finished. Your selections have been preserved. Please try again.")
        recover_interrupted_jobs(identity, retry=not (timed_out or memory_exceeded), reason=reason)


def run_worker(script, once=False):
    if engine.dialect.name != "postgresql":
        raise RuntimeError("The durable analysis worker requires PostgreSQL.")
    with engine.connect() as connection:
        warned = False
        while True:
            acquired = connection.execute(text(WORKER_LOCK)).scalar()
            connection.commit()
            if acquired:
                break
            if once:
                raise RuntimeError("Another analysis worker owns the queue.")
            if not warned:
                logger.warning("Another analysis worker owns the queue; waiting for it to stop.")
                warned = True
            time.sleep(5)
        try:
            logger.info("Reports analysis worker acquired queue lock")
            recover_interrupted_jobs()
            last_cleanup = 0
            while True:
                connection.execute(text("SELECT 1"))
                connection.commit()
                record_heartbeat()
                if time.monotonic() - last_cleanup > 3600:
                    with SessionLocal() as db:
                        db.query(ReportAnalysisJob).filter(ReportAnalysisJob.status.notin_(ACTIVE),
                            (ReportAnalysisJob.kind.notin_({"weekly_send", "weekly_owner_send"}) & (ReportAnalysisJob.completed_at < utc_now() - timedelta(days=7))) |
                            (ReportAnalysisJob.completed_at < utc_now() - timedelta(days=90))).delete(synchronize_session=False)
                        db.commit()
                    last_cleanup = time.monotonic()
                identity = next_job()
                if identity:
                    supervise_job(identity, connection, script)
                if once:
                    return
                time.sleep(1)
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(59831, 4)"))
            connection.commit()
