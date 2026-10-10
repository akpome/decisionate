"""Database queue boundaries shared by the API and supervised worker."""

import json
import hashlib
import os

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy import text

from app.configuration import get_runtime_configuration
from app.db.models import DataIngestionJob, utc_now
from app.infrastructure.object_storage import get_object_storage


class WorkspaceIngestionQueueFull(HTTPException):
    def __init__(self):
        super().__init__(
            status_code=429,
            detail="Five imports are already queued for this workspace. Please wait.",
        )


def durable_ingestion_enabled() -> bool:
    mode = os.getenv("INGESTION_EXECUTION_MODE", "").strip().lower()
    return mode == "worker" or get_runtime_configuration().app_env == "production"


def claim_ingestion_job(db, job) -> bool:
    claimed = db.query(DataIngestionJob).filter(
        DataIngestionJob.id == job.id,
        DataIngestionJob.status == "queued",
    ).update({"status": "running", "started_at": utc_now()}, synchronize_session=False)
    db.commit()
    if claimed:
        db.refresh(job)
    return bool(claimed)


def lock_connection_for_enqueue(db, connection):
    from app.db.models import DataSourceConnection

    locked = db.query(DataSourceConnection).filter(
        DataSourceConnection.id == connection.id,
    ).with_for_update().first()
    if locked is None:
        raise HTTPException(404, "Data source connection no longer exists.")


def lock_workspace_queue(db, workspace_id):
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(str(workspace_id).encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def ensure_workspace_queue_capacity(db, workspace_id: str):
    lock_workspace_queue(db, workspace_id)
    if get_runtime_configuration().app_env == "production":
        from app.db.models import Organization
        if db.query(Organization.id).filter(Organization.owner_user_id == workspace_id).first() is None:
            raise HTTPException(404, "Workspace no longer exists. Complete workspace setup before importing.")
    count = db.query(DataIngestionJob).filter(
        DataIngestionJob.workspace_id == workspace_id,
        DataIngestionJob.parent_job_id.is_(None),
        DataIngestionJob.status.in_({"queued", "running"}),
    ).count()
    if count >= 5:
        raise WorkspaceIngestionQueueFull()


def workspace_job_scope(workspace_ids):
    return or_(
        DataIngestionJob.workspace_id.in_(workspace_ids),
        and_(DataIngestionJob.workspace_id.is_(None), DataIngestionJob.user_id.in_(workspace_ids)),
    )


def ensure_workspace_jobs_idle(db, workspace_ids, *, include_queued=False):
    # Lock queued records against a concurrent worker claim until deletion
    # commits. Running jobs must finish before their workspace can be removed.
    for workspace_id in sorted(workspace_ids):
        lock_workspace_queue(db, workspace_id)
    jobs = db.query(DataIngestionJob).filter(
        workspace_job_scope(workspace_ids),
        DataIngestionJob.status.in_({"queued", "running"}),
    ).with_for_update().all()
    if any(job.status == "running" or include_queued for job in jobs):
        raise HTTPException(409, "An import is active. Wait for it to finish before deleting data.")


def delete_workspace_ingestion_jobs(db, workspace_ids):
    jobs = db.query(DataIngestionJob).filter(workspace_job_scope(workspace_ids)).all()
    for job in jobs:
        cleanup_ingestion_staging(job)
        db.delete(job)


def cleanup_ingestion_staging(job):
    try:
        payload = json.loads(job.request_payload or "{}")
    except (TypeError, ValueError):
        return
    reference = payload.get("staged_file_reference") or payload.get("file_path")
    if reference and job.job_type == "file_upload":
        get_object_storage().delete(reference)
