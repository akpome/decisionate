"""Dedicated bounded queue. Never claims or modifies ingestion jobs."""

from datetime import timedelta
import json
import logging
import os
from uuid import uuid4

from fastapi import HTTPException

from app.db.database import SessionLocal
from app.db.models import utc_now
from app.modules.auth_context import get_verified_workspace_access
from app.modules.datasets.services.dataset_loader import load_dataframe_from_dataset
from .catalog import metric_catalog, prepare_series
from .engine import adjust_bh, compute_pair, metric_id, metric_pairs
from .models import CorrelationAnalysis, CorrelationResult, CorrelationRun
from .service import authorize_datasets, encode, event, snapshot, validate_persisted_metrics


logger = logging.getLogger(__name__)


class Canceled(Exception):
    pass


def claim_next(session_factory=SessionLocal):
    with session_factory() as db:
        stale = db.query(CorrelationRun).filter(
            CorrelationRun.status == "running",
            CorrelationRun.heartbeat_at < utc_now() - timedelta(minutes=5),
        ).all()
        for run in stale:
            run.status = "failed" if run.attempts >= 3 else "canceled" if run.cancel_requested else "queued"
            run.phase = run.status
            run.worker_token = None
            run.error_code = "worker_interrupted"
        db.commit()
        candidate = db.query(CorrelationRun).filter_by(status="queued").order_by(CorrelationRun.created_at, CorrelationRun.id).first()
        if candidate is None:
            return None
        identity, token = candidate.id, uuid4().hex
        claimed = db.query(CorrelationRun).filter_by(id=identity, status="queued").update({
            "status": "running", "phase": "preparing", "worker_token": token,
            "started_at": utc_now(), "heartbeat_at": utc_now(),
            "attempts": CorrelationRun.attempts + 1, "completed_pairs": 0, "prepared_metrics": 0,
        }, synchronize_session=False)
        db.commit()
        return (identity, token) if claimed else None


def checkpoint(db, run, token, phase=None, **progress):
    db.refresh(run)
    if run.worker_token != token or run.status != "running":
        raise Canceled()
    if run.cancel_requested:
        raise Canceled()
    if phase:
        run.phase = phase
    for key, value in progress.items():
        setattr(run, key, value)
    run.heartbeat_at = utc_now()
    db.commit()


def check_worker_access(run):
    from types import SimpleNamespace
    get_verified_workspace_access(SimpleNamespace(headers={"X-Workspace-Id": run.workspace_id}), run.user_id)


def process_run(identity, token, session_factory=SessionLocal):
    with session_factory() as db:
        run = db.get(CorrelationRun, identity)
        if run is None or run.worker_token != token or run.status != "running":
            return
        analysis = db.get(CorrelationAnalysis, run.analysis_id)
        try:
            checkpoint(db, run, token, "preparing")
            check_worker_access(run)
            definition = json.loads(run.definition)
            datasets = authorize_datasets(db, run.user_id, run.workspace_id, [item["dataset_id"] for item in definition["metrics"]])
            validate_persisted_metrics(datasets, definition["metrics"])
            if snapshot(datasets) != json.loads(run.watermark):
                raise ValueError("source_changed")
            db.query(CorrelationResult).filter_by(run_id=run.id).delete(synchronize_session=False)
            db.commit()
            frames, metadata = {}, {}
            for dataset_id, dataset in datasets.items():
                checkpoint(db, run, token)
                frame = load_dataframe_from_dataset(dataset)
                catalogue = metric_catalog(dataset, frame)
                approved = {item["metric_key"]: item for item in catalogue["metrics"]}
                for reference in definition["metrics"]:
                    if reference["dataset_id"] != dataset_id:
                        continue
                    metric = approved.get(reference["metric_key"])
                    if not metric or reference["date_column"] not in catalogue["date_columns"] or metric["aggregation"] != reference["aggregation"]:
                        raise ValueError("metric_no_longer_eligible")
                    if metric["native_grain"] == "monthly" and definition["grain"] in {"daily", "weekly"}:
                        raise ValueError("grain_finer_than_source")
                    reference.update(components=metric["components"], currency=metric["currency"])
                    metadata[metric_id(reference)] = {**metric, "dataset_label": dataset.file_name, "connector": dataset.source_type,
                                                       "availability": catalogue["availability"].get(reference["date_column"])}
                frames[dataset_id] = (dataset, frame)
            series, quality = prepare_series(frames, definition["metrics"], definition)
            checkpoint(db, run, token, prepared_metrics=len(definition["metrics"]))
            run.summary = encode({"metrics": metadata, "quality": quality, "warnings": ["association_not_causation", "time_series_significance_is_exploratory"]})
            db.commit()
            checkpoint(db, run, token, "computing")
            for completed, (left, right) in enumerate(metric_pairs(definition["metrics"]), start=1):
                checkpoint(db, run, token)
                rows = compute_pair(left, right, series, definition)
                for row in rows:
                    row["flags"], row["evidence"] = encode(row["flags"]), encode(row["evidence"])
                    db.add(CorrelationResult(run_id=run.id, workspace_id=run.workspace_id, **row))
                run.completed_pairs = completed
                db.commit()
            checkpoint(db, run, token, "correcting")
            results = db.query(CorrelationResult).filter_by(run_id=run.id).order_by(CorrelationResult.id).all()
            adjusted = adjust_bh([item.p_value for item in results])
            for result, corrected in zip(results, adjusted):
                result.adjusted_p_value = corrected
                warnings = json.loads(result.flags)
                result.reliability = "insufficient" if not result.eligible else "reliable" if corrected is not None and corrected <= .05 and "small_sample_rank_significance" not in warnings and "mathematical_components" not in warnings else "exploratory"
            db.commit()
            checkpoint(db, run, token, "persisting")
            check_worker_access(run)
            db.expire_all()
            datasets = authorize_datasets(db, run.user_id, run.workspace_id, [item["dataset_id"] for item in definition["metrics"]])
            if snapshot(datasets) != json.loads(run.watermark):
                raise ValueError("source_changed")
            checkpoint(db, run, token)
            run.status, run.phase, run.completed_at, run.error_code = "completed", "completed", utc_now(), None
            analysis.latest_successful_run_id = run.id
            event(db, analysis, run.user_id, "run_completed", run.id)
            db.commit()
            logger.info("Correlation run completed", extra={"run_id": run.id, "metric_count": len(definition["metrics"]), "pair_count": run.total_pairs, "attempts": run.attempts})
        except Canceled:
            db.rollback()
            db.refresh(run)
            if run.worker_token == token:
                run.status, run.phase, run.completed_at = "canceled", "canceled", utc_now()
                event(db, analysis, run.user_id, "run_canceled", run.id)
                db.commit()
        except Exception as error:
            db.rollback()
            db.refresh(run)
            if run.worker_token != token:
                return
            transient = isinstance(error, (OSError, ConnectionError)) or isinstance(error, HTTPException) and error.status_code == 503
            retry = transient and run.attempts < 3 and not run.cancel_requested
            run.status = "queued" if retry else "failed"
            run.phase = run.status
            run.error_code = str(error) if isinstance(error, ValueError) and str(error) in {"source_changed", "metric_no_longer_eligible", "grain_finer_than_source"} else "access_revoked" if isinstance(error, HTTPException) and error.status_code in {403, 404} else "infrastructure_unavailable" if transient else "calculation_failed"
            run.completed_at = None if retry else utc_now()
            run.worker_token = None
            event(db, analysis, run.user_id, "run_retry" if retry else "run_failed", run.id)
            db.commit()
            logger.warning("Correlation run did not complete", extra={"run_id": identity, "reason_code": run.error_code, "attempts": run.attempts})
