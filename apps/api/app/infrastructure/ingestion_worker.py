"""Supervised, single-consumer PostgreSQL ingestion queue.

Each job runs in an isolated process with a deadline. The supervisor owns a
database advisory lock and checks that connection while the child is alive.
An interrupted job is failed, not silently retried after partial writes.
"""

import logging
import os
import signal
import subprocess
import sys
import time
from datetime import timedelta

from sqlalchemy import text

from app.db.database import SessionLocal, engine
from app.db.models import DataIngestionJob, DatasetAnalysis, IngestionWorkerHeartbeat, utc_now
from app.infrastructure.ingestion_jobs import cleanup_ingestion_staging


logger = logging.getLogger(__name__)
WORKER_NAME = "ingestion"
WORKER_LOCK = "SELECT pg_try_advisory_lock(59831, 1)"


def record_heartbeat(job_id=None):
    with SessionLocal() as db:
        record = db.get(IngestionWorkerHeartbeat, WORKER_NAME)
        if record is None:
            record = IngestionWorkerHeartbeat(name=WORKER_NAME)
            db.add(record)
        record.last_seen_at = utc_now()
        record.job_id = job_id
        db.commit()


def ingestion_worker_ready(db) -> bool:
    record = db.get(IngestionWorkerHeartbeat, WORKER_NAME)
    return bool(record and record.last_seen_at >= utc_now() - timedelta(seconds=30))


def fail_interrupted_jobs(job_id=None, reason="Import interrupted by a worker restart. Please retry."):
    from app.modules.datasets import router as routes

    with SessionLocal() as db:
        query = db.query(DataIngestionJob).filter(
            DataIngestionJob.status.in_({"queued", "running"}) if job_id is not None
            else DataIngestionJob.status == "running"
        )
        if job_id is not None:
            query = query.filter(
                (DataIngestionJob.id == job_id) | (DataIngestionJob.parent_job_id == job_id)
            )
        ids = [job.id for job in query.all()]
        for interrupted_id in ids:
            job = db.get(DataIngestionJob, interrupted_id)
            if not job:
                continue
            routes._fail_pending_connector_children(db, interrupted_id, RuntimeError(reason))
            if job.job_type == routes.CONNECTOR_ANALYSIS_JOB_TYPE:
                db.query(DatasetAnalysis).filter(
                    DatasetAnalysis.connection_id == job.connection_id,
                    DatasetAnalysis.status.in_({"queued", "running"}),
                ).update({"status": "failed", "error_message": reason}, synchronize_session=False)
            routes._persist_ingestion_job_failure(db, interrupted_id, RuntimeError(reason))
            try:
                cleanup_ingestion_staging(job)
                if job.job_type in {"file_upload", "signed_url_import"}:
                    job.request_payload = None
            except Exception:
                logger.exception("Failed to clean interrupted import staging", extra={"job_id": job.id})
            db.commit()


def next_queued_job():
    with SessionLocal() as db:
        job = db.query(DataIngestionJob).filter(
            DataIngestionJob.status == "queued",
            DataIngestionJob.parent_job_id.is_(None),
        ).order_by(DataIngestionJob.id).first()
        return job.id if job else None


def cleanup_terminal_file_jobs():
    with SessionLocal() as db:
        jobs = db.query(DataIngestionJob).filter(
            DataIngestionJob.job_type.in_({"file_upload", "signed_url_import"}),
            DataIngestionJob.status.in_({"succeeded", "no_data", "failed"}),
            DataIngestionJob.request_payload.isnot(None),
        ).limit(100).all()
        for job in jobs:
            try:
                cleanup_ingestion_staging(job)
                job.request_payload = None
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Failed to remove terminal job staging", extra={"job_id": job.id})


def execute_job(job_id):
    from app.modules.datasets import router as routes

    with SessionLocal() as db:
        job = db.get(DataIngestionJob, job_id)
        job_type = job.job_type if job else None
    if job_type in {"file_upload", "signed_url_import"}:
        routes.run_file_ingestion_job(job_id)
    elif job_type == routes.CONNECTOR_ANALYSIS_JOB_TYPE:
        routes.run_connector_analysis_job(job_id)
    elif job_type:
        routes.run_connector_ingestion_job(job_id)


def supervise_job(job_id, lock_connection, script):
    timeout = max(30, min(int(os.getenv("INGESTION_JOB_TIMEOUT_SECONDS", "900")), 7200))
    child = subprocess.Popen([
        sys.executable, "-B", script, "--job-id", str(job_id), "--parent-pid", str(os.getpid()),
    ], start_new_session=True)
    deadline = time.monotonic() + timeout
    failure_reason = "Import worker stopped before completion. Please retry."
    try:
        while child.poll() is None:
            lock_connection.execute(text("SELECT 1"))
            lock_connection.commit()
            record_heartbeat(job_id)
            if time.monotonic() >= deadline:
                raise TimeoutError("Import exceeded its execution deadline. Please retry a smaller date range.")
            time.sleep(1)
    except TimeoutError as error:
        failure_reason = str(error)
        raise
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        fail_interrupted_jobs(job_id, failure_reason)
        cleanup_terminal_file_jobs()


def run_worker(script, once=False):
    if engine.dialect.name != "postgresql":
        raise RuntimeError("The durable ingestion worker requires PostgreSQL.")
    with engine.connect() as connection:
        if not connection.execute(text(WORKER_LOCK)).scalar():
            raise RuntimeError("Another ingestion worker already owns the queue.")
        connection.commit()
        try:
            fail_interrupted_jobs()
            cleanup_terminal_file_jobs()
            last_retention = 0
            while True:
                connection.execute(text("SELECT 1"))
                connection.commit()
                record_heartbeat()
                job_id = next_queued_job()
                if time.monotonic() - last_retention >= 3600:
                    from app.modules.datasets import router as routes
                    def maintenance_heartbeat():
                        connection.execute(text("SELECT 1"))
                        connection.commit()
                        record_heartbeat()
                    routes.sweep_connector_retention(heartbeat=maintenance_heartbeat)
                    last_retention = time.monotonic()
                if job_id is not None:
                    supervise_job(job_id, connection, script)
                if once:
                    return
                time.sleep(1)
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(59831, 1)"))
            connection.commit()
