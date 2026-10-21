from hashlib import sha256
import json
import os

from fastapi import HTTPException
from sqlalchemy import or_, and_

from app.db.models import Dataset
from app.modules.datasets.services.ownership import verify_dataset_owner
from .engine import metric_id
from .models import CorrelationAnalysis, CorrelationEvent, CorrelationRun


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return sha256(encode(value).encode()).hexdigest()


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
