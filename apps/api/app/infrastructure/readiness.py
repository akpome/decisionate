"""Operational readiness, distinct from static configuration and liveness."""

import logging
from sqlalchemy import text

from app.db.database import SessionLocal
from app.infrastructure.ingestion_jobs import durable_ingestion_enabled
from app.infrastructure.ingestion_worker import ingestion_worker_ready


logger = logging.getLogger(__name__)


def check_service_readiness():
    database_ready = False
    worker_required = durable_ingestion_enabled()
    worker_ready = not worker_required
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            database_ready = True
            if worker_required:
                worker_ready = ingestion_worker_ready(db)
    except Exception:
        logger.exception("Operational readiness check failed")
    return {
        "ready": database_ready and worker_ready,
        "database_ready": database_ready,
        "ingestion_worker_required": worker_required,
        "ingestion_worker_ready": worker_ready,
    }
