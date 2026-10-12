"""Write marketing work in the same transaction as authoritative application changes."""

from sqlalchemy import event
from app.db.database import SessionLocal

import json
from app.db.models import DataIngestionJob, Dataset, Organization, OrganizationMember, WorkspaceSubscription
from app.modules.marketing.models import MarketingDatasetState
from app.modules.marketing.service import enqueue, mark_completed_data


def before_flush(db, flush_context, instances):
    workspace_ids = set()
    for record in list(db.new) + list(db.dirty) + list(db.deleted):
        if isinstance(record, Organization):
            workspace_ids.add(record.owner_user_id)
        elif isinstance(record, OrganizationMember):
            org = db.get(Organization, record.organization_id)
            if org:
                workspace_ids.add(org.owner_user_id)
        elif isinstance(record, WorkspaceSubscription):
            workspace_ids.add(record.workspace_id)
        elif isinstance(record, DataIngestionJob):
            workspace_ids.add(record.workspace_id or record.user_id)
            if record.status == "succeeded":
                try:
                    result = json.loads(record.result_payload or "{}")
                except ValueError:
                    result = {}
                if not isinstance(result, dict):
                    result = {}
                records = result.get("datasets") or [result]
                for item in records:
                    dataset = db.get(Dataset, item.get("dataset_id")) if isinstance(item, dict) and item.get("dataset_id") else None
                    if dataset:
                        mark_completed_data(db, dataset)
        elif isinstance(record, Dataset):
            workspace_id = record.workspace_id or record.user_id
            workspace_ids.add(workspace_id)
            if record in db.new:
                db.info.setdefault("marketing_new_datasets", []).append(record)
    for workspace_id in workspace_ids:
        if workspace_id:
            enqueue(db, "workspace", workspace_id)


def after_flush(db, flush_context):
    for dataset in db.info.pop("marketing_new_datasets", []):
        active = db.query(DataIngestionJob.id).filter_by(workspace_id=dataset.workspace_id or dataset.user_id).filter(
            DataIngestionJob.status == "running").first()
        if active:
            db.add(MarketingDatasetState(dataset_id=dataset.id))
        else:
            mark_completed_data(db, dataset)


def install_marketing_hooks(session_class=None):
    session_class = session_class or SessionLocal.class_
    if not event.contains(session_class, "before_flush", before_flush):
        event.listen(session_class, "before_flush", before_flush)
        event.listen(session_class, "after_flush_postexec", after_flush)
