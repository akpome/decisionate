from hashlib import sha256
import json
import os
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_, and_, text
from sqlalchemy.exc import IntegrityError

from app.db.models import Dataset
from app.modules.datasets.services.metric_recommendations import config_for, uses_curated_selection
from app.modules.datasets.services.metric_registry import get_metric_definition
from app.modules.datasets.services.metric_selection import get_dataset_selected_metric_columns
from app.modules.datasets.services.numeric import is_identifier_column
from app.modules.datasets.services.ownership import verify_dataset_owner
from .catalog import reporting_timezone
from .engine import ENGINE_VERSION, metric_id
from .models import CorrelationAnalysis, CorrelationEvent, CorrelationMetric, CorrelationResult, CorrelationRun, CorrelationRunRequest


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return sha256(encode(value).encode()).hexdigest()


def flags(user_id):
    internal = {value.strip() for value in os.getenv("MULTI_METRIC_CORRELATION_INTERNAL_USERS", "").split(",")}
    eligible = user_id in internal or os.getenv("MULTI_METRIC_CORRELATION_ROLLOUT", "internal") == "all"
    def enabled(name):
        return eligible and os.getenv(name, "false").lower() in {"true", "1", "on"}
    api = enabled("MULTI_METRIC_CORRELATION_API")
    return {"api": api, "ui": api and enabled("MULTI_METRIC_CORRELATION_UI"),
            "widgets": api and enabled("CORRELATION_DASHBOARD_WIDGETS"),
            "lag": api and enabled("CORRELATION_LAG_MATRIX"), "ai": False}


def authorize_datasets(db, user_id, workspace_id, dataset_ids):
    result = {}
    for identity in sorted(set(dataset_ids)):
        dataset = db.get(Dataset, identity)
        if dataset is None:
            raise HTTPException(404, "A selected dataset is unavailable")
        verify_dataset_owner(dataset, user_id, workspace_id)
        result[identity] = dataset
    return result


def snapshot(datasets):
    result = {}
    for identity, item in datasets.items():
        local_stat = None
        if item.file_path and os.path.isfile(item.file_path):
            stat = os.stat(item.file_path)
            local_stat = [stat.st_mtime_ns, stat.st_size]
        result[str(identity)] = digest({
            "file": item.file_path, "config": item.source_config,
            "rows": item.row_count, "columns": item.column_count, "local_stat": local_stat,
        })
    return result


def validate_persisted_metrics(datasets, metrics):
    for item in metrics:
        dataset = datasets[item["dataset_id"]]
        if item["metric_key"] not in (get_dataset_selected_metric_columns(dataset) or []) or is_identifier_column(item["metric_key"]):
            raise HTTPException(400, "Choose an explicitly selected, analyzable dataset metric")
        if uses_curated_selection(dataset):
            provenance = config_for(dataset).get("metric_selection_provenance", {})
            available = {metric["selected_column_key"] for metric in provenance.get("metrics", [])}
            if item["metric_key"] not in available or item["aggregation"] != "policy":
                raise HTTPException(400, "Use the dataset's saved metric policy")
        else:
            definition = get_metric_definition(item["metric_key"], dataset.source_type)
            if not definition or definition.derived or item["aggregation"] != definition.aggregation:
                raise HTTPException(400, "Metric aggregation must match its approved catalogue definition")


def event(db, analysis, user_id, action, run_id=None):
    db.add(CorrelationEvent(workspace_id=analysis.workspace_id, user_id=user_id,
                            analysis_id=analysis.id, run_id=run_id, event=action))


def allowed_analysis(db, identity, user_id, workspace_id):
    item = db.get(CorrelationAnalysis, identity)
    if item is None or item.workspace_id != workspace_id:
        raise HTTPException(404, "Analysis not found")
    definition = json.loads(item.definition)
    authorize_datasets(db, user_id, workspace_id, [metric["dataset_id"] for metric in definition["metrics"]])
    return item


def allowed_run(db, identity, user_id, workspace_id):
    item = db.get(CorrelationRun, identity)
    if item is None or item.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    analysis = allowed_analysis(db, item.analysis_id, user_id, workspace_id)
    return item, analysis


def run_response(run):
    definition = json.loads(run.definition)
    lag = definition["lag"]
    lag_count = len({0, *range(lag["minimum"], lag["maximum"] + 1)}) if lag["enabled"] else 1
    return {"analysis_id": run.analysis_id, "run_id": run.id, "status": run.status,
            "progress": {"phase": run.phase, "completed_pairs": run.completed_pairs,
                         "total_pairs": run.total_pairs, "prepared_metrics": run.prepared_metrics,
                         "completed_pair_lag_tasks": run.completed_pairs * lag_count,
                         "total_pair_lag_tasks": run.total_pairs * lag_count},
            "created_at": run.created_at.isoformat() + "Z", "computed_at": run.completed_at.isoformat() + "Z" if run.completed_at else None,
            "error_code": run.error_code, "summary": json.loads(run.summary or "{}"),
            "engine_version": run.engine_version, "watermark": digest(json.loads(run.watermark)),
            "definition": json.loads(run.definition)}


def enqueue(db, analysis, user_id, *, idempotency_key=None):
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(59832, hashtext(:workspace))"), {"workspace": analysis.workspace_id})
    analysis = db.query(CorrelationAnalysis).filter_by(id=analysis.id).with_for_update().one()
    definition = json.loads(analysis.definition)
    datasets = authorize_datasets(db, user_id, analysis.workspace_id, [item["dataset_id"] for item in definition["metrics"]])
    validate_persisted_metrics(datasets, definition["metrics"])
    request_key = digest([user_id, idempotency_key]) if idempotency_key else None
    if request_key:
        previous = db.query(CorrelationRunRequest).filter_by(analysis_id=analysis.id, request_key=request_key).first()
        if previous:
            return db.get(CorrelationRun, previous.run_id)
    def remember(run):
        if request_key:
            try:
                with db.begin_nested():
                    db.add(CorrelationRunRequest(analysis_id=analysis.id, request_key=request_key, run_id=run.id))
                    db.flush()
            except IntegrityError:
                previous = db.query(CorrelationRunRequest).filter_by(analysis_id=analysis.id, request_key=request_key).one()
                return db.get(CorrelationRun, previous.run_id)
        return run
    watermark = snapshot(datasets)
    identity = digest([analysis.id, definition, watermark, ENGINE_VERSION])
    reusable = db.query(CorrelationRun).filter_by(analysis_id=analysis.id, watermark=encode(watermark), engine_version=ENGINE_VERSION).filter(
        CorrelationRun.status.in_(["queued", "running", "completed"]),
    ).order_by(CorrelationRun.created_at.desc()).first()
    if reusable:
        return remember(reusable)
    existing = db.query(CorrelationRun).filter_by(identity_hash=identity).first()
    if existing and existing.status not in {"failed", "canceled"}:
        return remember(existing)
    if existing:
        identity = digest([identity, uuid4().hex])
    pending = db.query(CorrelationRun).filter(CorrelationRun.workspace_id == analysis.workspace_id, CorrelationRun.status.in_(["queued", "running"])).count()
    if pending >= 3:
        raise HTTPException(429, "Three relationship analyses are already queued for this workspace")
    count = len(definition["metrics"])
    run = CorrelationRun(analysis_id=analysis.id, workspace_id=analysis.workspace_id, user_id=user_id,
                         identity_hash=identity, definition=encode(definition), watermark=encode(watermark),
                         engine_version=ENGINE_VERSION, code_version=os.getenv("RAILWAY_GIT_COMMIT_SHA", os.getenv("GIT_COMMIT_SHA", "development")),
                         total_pairs=count * (count - 1) // 2)
    db.add(run)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.query(CorrelationRun).filter_by(identity_hash=identity).one()
        return remember(existing)
    event(db, analysis, user_id, "run_queued", run.id)
    return remember(run)


def create_analysis(db, payload, user_id, workspace_id, idempotency_key=None):
    definition = payload.model_dump(mode="json")
    definition["name"] = definition["name"].strip()
    definition["metrics"].sort(key=lambda item: (item["dataset_id"], item["metric_key"]))
    if not definition["lag"]["enabled"]:
        definition["lag"].update(minimum=0, maximum=0, direction="a_leads_b")
    if definition["lag"]["enabled"]:
        if not flags(user_id)["lag"]:
            raise HTTPException(400, "Multi-metric lag analysis is not enabled")
        maximum = min(60, max(0, int(os.getenv("CORRELATION_MAX_LAG", "14"))))
        if definition["lag"]["maximum"] > maximum:
            raise HTTPException(400, f"Maximum lag is {maximum} shared periods")
    count = len(definition["metrics"])
    lag = definition["lag"]
    lag_count = len({0, *range(lag["minimum"], lag["maximum"] + 1)}) if lag["enabled"] else 1
    if count * (count - 1) // 2 * lag_count > 20000:
        raise HTTPException(400, "Reduce metrics or lags to at most 20,000 pair-lag tasks")
    definition["reporting_timezone"] = reporting_timezone()
    request_hash = digest(definition)
    creation_key = digest([user_id, idempotency_key or request_hash])
    existing = db.query(CorrelationAnalysis).filter_by(workspace_id=workspace_id, creation_key=creation_key).first()
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(409, "Idempotency key belongs to a different request")
        allowed_analysis(db, existing.id, user_id, workspace_id)
        original = db.query(CorrelationRun).filter_by(analysis_id=existing.id).order_by(CorrelationRun.created_at, CorrelationRun.id).first()
        if idempotency_key and original:
            return original
        return enqueue(db, existing, user_id)
    datasets = authorize_datasets(db, user_id, workspace_id, [item["dataset_id"] for item in definition["metrics"]])
    validate_persisted_metrics(datasets, definition["metrics"])
    analysis = CorrelationAnalysis(workspace_id=workspace_id, user_id=user_id, name=payload.name.strip(),
                                   definition=encode(definition), request_hash=request_hash, creation_key=creation_key)
    db.add(analysis)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.query(CorrelationAnalysis).filter_by(workspace_id=workspace_id, creation_key=creation_key).one()
        if existing.request_hash != request_hash:
            raise HTTPException(409, "Idempotency key belongs to a different request")
        return enqueue(db, existing, user_id)
    for position, item in enumerate(definition["metrics"]):
        db.add(CorrelationMetric(analysis_id=analysis.id, dataset_id=item["dataset_id"], metric_key=item["metric_key"], position=position))
    event(db, analysis, user_id, "analysis_created")
    return enqueue(db, analysis, user_id)


def card(result, run):
    definition = json.loads(run.definition)
    refs = {metric_id(item): item for item in definition["metrics"]}
    metadata = json.loads(run.summary or "{}").get("metrics", {})
    def label(identity):
        item = refs[identity]
        return {**item, **metadata.get(identity, {}), "id": identity}
    return {"result_id": result.id, "run_id": run.id, "analysis_id": run.analysis_id,
            "evidence_kind": "correlation_v2", "engine_version": run.engine_version,
            "metric_a": label(result.metric_a), "metric_b": label(result.metric_b),
            "coefficient": result.coefficient, "direction": "undetermined" if result.coefficient is None else "positive" if result.coefficient >= 0 else "negative",
            "lag": {"periods": result.lag, "unit": "shared " + definition["grain"] + " periods", "lead_metric": result.lead_metric},
            "observations": result.observations, "method": definition["method"], "grain": definition["grain"],
            "p_value": result.p_value, "adjusted_p_value": result.adjusted_p_value,
            "reliability": result.reliability, "warnings": json.loads(result.flags), "eligible": result.eligible,
            "window": definition["date_range"], "computed_at": run.completed_at.isoformat() + "Z" if run.completed_at else None}


def dataset_scope(user_id, workspace_id):
    return or_(Dataset.workspace_id == workspace_id, and_(Dataset.workspace_id.is_(None), Dataset.user_id == user_id))
