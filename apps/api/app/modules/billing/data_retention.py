"""Workspace data deletion after subscription expiry."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, or_

from app.db.models import DashboardShare
from app.db.models import Dataset
from app.db.models import DatasetJoinCache
from app.db.models import DatasetRelationship
from app.db.models import UserPreference
from app.infrastructure.object_storage import (
    get_dataset_storage_reference,
    get_object_storage,
)


SUBSCRIPTION_EXPIRY_DATA_PURGE_DAYS = 89
SUBSCRIPTION_CANCELLATION_DATA_PURGE_DAYS = 90


def subscription_data_purge_due_at(
    period_end: datetime | None,
    canceled_at: datetime | None = None,
) -> datetime | None:
    due_dates = []
    if period_end is not None:
        due_dates.append(
            period_end + timedelta(
                days=SUBSCRIPTION_EXPIRY_DATA_PURGE_DAYS,
            )
        )
    if canceled_at is not None:
        due_dates.append(
            canceled_at + timedelta(
                days=SUBSCRIPTION_CANCELLATION_DATA_PURGE_DAYS,
            )
        )
    if not due_dates:
        return None
    return min(due_dates)


def purge_workspace_data_after_expiry(
    db,
    workspace_ids: list[str] | set[str],
    period_end: datetime | None,
    now: datetime,
    already_purged_at: datetime | None = None,
    canceled_at: datetime | None = None,
) -> dict | None:
    """Delete analytical dataset storage once the post-expiry window ends.

    Connector datasets are stored as a reference to a directory containing
    hot monthly partitions and historical yearly partitions. Uploaded files
    use the same Dataset.file_path field, so deleting every dataset reference
    also removes non-connector analytical files without leaving orphaned
    storage. Connector credentials and connection configuration are retained
    so a renewed workspace can be reconnected without losing setup metadata.
    """
    purge_due_at = subscription_data_purge_due_at(
        period_end,
        canceled_at,
    )
    if (
        purge_due_at is None
        or now < purge_due_at
        or already_purged_at is not None
    ):
        return None

    clean_workspace_ids = {
        str(workspace_id).strip()
        for workspace_id in workspace_ids
        if str(workspace_id or "").strip()
    }
    if not clean_workspace_ids:
        return {
            "purged_at": now,
            "purge_due_at": purge_due_at,
            "workspace_count": 0,
            "dataset_count": 0,
            "file_count": 0,
        }

    dataset_scope = or_(
        Dataset.workspace_id.in_(clean_workspace_ids),
        and_(
            Dataset.workspace_id.is_(None),
            Dataset.user_id.in_(clean_workspace_ids),
        ),
    )
    datasets = db.query(Dataset).filter(dataset_scope).all()
    storage = get_object_storage()
    file_references = {
        get_dataset_storage_reference(dataset)
        for dataset in datasets
        if get_dataset_storage_reference(dataset)
    }
    for file_reference in file_references:
        storage.delete(file_reference)

    dataset_ids = {dataset.id for dataset in datasets}
    if dataset_ids:
        db.query(DashboardShare).filter(
            DashboardShare.dataset_id.in_(dataset_ids),
        ).delete(synchronize_session=False)

    join_cache_scope = or_(
        DatasetJoinCache.workspace_id.in_(clean_workspace_ids),
        and_(
            DatasetJoinCache.workspace_id.is_(None),
            DatasetJoinCache.user_id.in_(clean_workspace_ids),
        ),
    )
    db.query(DatasetJoinCache).filter(join_cache_scope).delete(
        synchronize_session=False,
    )

    relationship_scope = or_(
        DatasetRelationship.workspace_id.in_(clean_workspace_ids),
        and_(
            DatasetRelationship.workspace_id.is_(None),
            DatasetRelationship.user_id.in_(clean_workspace_ids),
        ),
    )
    db.query(DatasetRelationship).filter(relationship_scope).delete(
        synchronize_session=False,
    )

    preference_scope = or_(
        UserPreference.workspace_id.in_(clean_workspace_ids),
        and_(
            UserPreference.workspace_id.is_(None),
            UserPreference.clerk_user_id.in_(clean_workspace_ids),
        ),
    )
    preferences = db.query(UserPreference).filter(preference_scope).all()
    for preference in preferences:
        preference.selected_dataset_id = None
        preference.selected_metric = None
        preference.metric_targets = None
        preference.dashboard_preferences = None
        preference.dashboard_dataset_ids = None
        preference.dashboard_views = None

    for dataset in datasets:
        db.delete(dataset)

    return {
        "purged_at": now,
        "purge_due_at": purge_due_at,
        "workspace_count": len(clean_workspace_ids),
        "dataset_count": len(datasets),
        "file_count": len(file_references),
    }
