"""Expire live customer records without closing or disabling a workspace."""

import logging
from collections import Counter
from datetime import datetime, time, timedelta
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from app.db.database import SessionLocal
from app.db.models import (
    AgencyClientInvitation, DashboardShare, DataIngestionJob, DataSourceConnection, Dataset, DatasetAnalysis,
    DatasetJoinCache, DatasetRelationship, ExpiredDatasetObject, HostedSubdomainOAuthReturn,
    OAuthConnectionState, OrganizationInvite,
    UsageActivityEvent, WeeklyReportDeliveryLog, utc_now,
)
from app.infrastructure.ingestion_jobs import cleanup_ingestion_staging, lock_workspace_queue
from app.infrastructure.object_storage import get_dataset_storage_reference, get_object_storage
from app.modules.budget_planner.models import BudgetPlan
from app.modules.correlation.cleanup import delete_analyses
from app.modules.correlation.models import CorrelationAnalysis, CorrelationEvent, CorrelationRun, CorrelationRunRequest, CorrelationResult, CorrelationInsight
from app.modules.datasets.services.retention import connector_retention_cutoff_date
from app.modules.datasets.services.sources import IMPLEMENTED_CONNECTOR_TYPES
from app.modules.decisions.activity_models import DecisionActivity
from app.modules.decisions.models import Decision, DecisionCreationRequest, DecisionDuplicate
from app.modules.performance.models import PerformanceAnalysis
from app.modules.reports import cleanup as report_cleanup
from app.modules.reports.models import BusinessReport, CurrentWeeklyReport, DecisionImpactReview, ReportAnalysisJob
from app.modules.share_emails import ShareEmailDelivery
from app.modules.sharing_links import SharedLink


logger = logging.getLogger(__name__)
FILE_DATASET_TYPES = frozenset({"csv", "excel", "json", "parquet", "joined", "entity_matching"})
DATASET_BATCH = 20
RECORD_BATCH = 250
ACTIVE = frozenset({"queued", "running"})


def record_cutoff(now):
    return datetime.combine(connector_retention_cutoff_date(now.date()), time.min)


def live_dataset_uses_reference(db, storage, reference):
    candidates = {reference, storage.reference_key(reference)} if storage.is_reference(reference) else {reference}
    return any(get_dataset_storage_reference(row) == reference for row in db.query(Dataset).filter(Dataset.file_path.in_(candidates)))


def queue_object_deletion(db, references, now):
    storage = get_object_storage()
    for reference in sorted(set(references) - {None, "", "manual_upload"}):
        # A legacy upload may refer to a path also used by a retained row.
        if live_dataset_uses_reference(db, storage, reference):
            continue
        if db.get(ExpiredDatasetObject, reference) is None:
            db.add(ExpiredDatasetObject(reference=reference, next_attempt_at=now))


def drain_expired_objects(now, heartbeat):
    with SessionLocal() as db:
        references = [row.reference for row in db.query(ExpiredDatasetObject.reference)
                      .filter(ExpiredDatasetObject.next_attempt_at <= now)
                      .order_by(ExpiredDatasetObject.next_attempt_at, ExpiredDatasetObject.reference)
                      .limit(DATASET_BATCH)]
    storage = get_object_storage()
    for reference in references:
        heartbeat()
        with SessionLocal() as db:
            record = db.get(ExpiredDatasetObject, reference)
            if not record:
                continue
            try:
                if not live_dataset_uses_reference(db, storage, reference):
                    storage.delete(reference)
            except Exception as error:
                record.next_attempt_at = now + timedelta(hours=1)
                logger.warning("Expired dataset object could not be deleted; will retry (%s)", type(error).__name__)
            else:
                db.delete(record)
            db.commit()


def retire_expired_datasets(cutoff, now, heartbeat):
    from app.modules.datasets import router as datasets
    from app.modules.organizations.router import ensure_client_workspace_idle

    with SessionLocal() as db:
        # Connector datasets age by row, not file age.
        identity = func.coalesce(Dataset.workspace_id, Dataset.user_id)
        expired = (Dataset.created_at < cutoff, Dataset.source_type.in_(FILE_DATASET_TYPES))
        workspaces = [row[0] for row in db.query(identity).filter(*expired).group_by(identity)
                      .order_by(func.min(Dataset.created_at), identity)]
    removed = 0
    for workspace in workspaces:
        if removed >= DATASET_BATCH:
            break
        heartbeat()
        with SessionLocal() as db:
            try:
                lock_workspace_queue(db, workspace, wait=False)
                ensure_client_workspace_idle(db, workspace, include_queued=False)
                if db.query(CorrelationRun.id).filter_by(workspace_id=workspace).filter(CorrelationRun.status.in_(ACTIVE)).first():
                    continue
                stale = db.query(Dataset).filter(func.coalesce(Dataset.workspace_id, Dataset.user_id) == workspace,
                                                 *expired).order_by(Dataset.created_at, Dataset.id).limit(DATASET_BATCH).all()
                references = []
                for dataset in stale:
                    if db.get(Dataset, dataset.id) is None:
                        continue
                    references.append(get_dataset_storage_reference(dataset))
                    datasets.cleanup_deleted_dataset_preferences(db, dataset)
                    datasets.cleanup_deleted_entity_matching_records(db, dataset)
                    references.extend(datasets.cleanup_deleted_dataset_join_caches(db, dataset))
                    datasets.cleanup_deleted_dataset_relationships(db, dataset)
                    db.delete(dataset)
                db.flush()
                # Join cleanup can remove newer materializations that used an
                # expired source. Their analysis and share records are orphaned.
                for model in (DatasetAnalysis, DashboardShare):
                    db.query(model).filter(~model.dataset_id.in_(select(Dataset.id))).delete(synchronize_session=False)
                queue_object_deletion(db, references, now)
                db.commit()
                removed += len(references)
            except HTTPException as error:
                if error.status_code != 409:
                    raise
            except Exception:
                logger.exception("Could not expire a workspace's datasets; will retry")
    return removed


def retire_detached_connector_rows(now, heartbeat):
    """A deleted connection must not make its imported history permanent."""
    from app.modules.datasets import router as datasets
    from app.modules.organizations.router import ensure_client_workspace_idle

    with SessionLocal() as db:
        connections = {(workspace or user, source, str(identity)) for workspace, user, source, identity in db.query(
            DataSourceConnection.workspace_id, DataSourceConnection.user_id, DataSourceConnection.source_type, DataSourceConnection.id)}
        connection_counts = Counter(item[:2] for item in connections)
        candidates = []
        for row in db.query(Dataset.id, Dataset.workspace_id, Dataset.user_id, Dataset.source_type, Dataset.source_config).filter(
            Dataset.source_type.in_(IMPLEMENTED_CONNECTOR_TYPES)
        ).order_by(Dataset.id).yield_per(250):
            config = datasets.parse_source_connection_config(row.source_config)
            scope = (row.workspace_id or row.user_id, row.source_type)
            connection_id = config.get("connection_id")
            if connection_id:
                attached = (*scope, str(connection_id)) in connections
            else:
                attached = connection_counts[scope] == 1
            if not attached:
                candidates.append((row.id, scope[0]))
    count = 0
    for dataset_id, workspace in candidates:
        if count >= DATASET_BATCH:
            break
        heartbeat()
        with SessionLocal() as db:
            try:
                lock_workspace_queue(db, workspace, wait=False)
                dataset = db.get(Dataset, dataset_id)
                if dataset is None or (dataset.workspace_id or dataset.user_id) != workspace:
                    continue
                ensure_client_workspace_idle(db, workspace, include_queued=False)
                # Reuse the partition writer for this exact dataset. No credentials
                # are read and this identity is never stored as a connection.
                config = datasets.parse_source_connection_config(dataset.source_config)
                source = SimpleNamespace(id=config.get("connection_id") or f"detached-{dataset.id}",
                                         workspace_id=dataset.workspace_id, user_id=dataset.user_id, source_type=dataset.source_type)
                result = datasets.purge_expired_connector_dataset(db, source, dataset, heartbeat=heartbeat)
                if result:
                    queue_object_deletion(db, [result["replaced_file_path"], *result["derived_file_references"]], now)
                    db.commit()
                    count += 1
            except HTTPException as error:
                if error.status_code != 409:
                    logger.warning("Detached connector retention could not complete (status %s)", error.status_code)
            except Exception:
                logger.exception("Detached connector retention could not complete")
    return count


def oldest_ids(db, id_column, dated_column, cutoff, *filters):
    return [row[0] for row in db.query(id_column).filter(dated_column < cutoff, *filters)
            .order_by(dated_column, id_column).limit(RECORD_BATCH)]


def remove_expired_rows(db, model, id_column, dated_column, cutoff, *filters):
    ids = oldest_ids(db, id_column, dated_column, cutoff, *filters)
    if not ids:
        return 0
    return db.query(model).filter(id_column.in_(ids), dated_column < cutoff, *filters).delete(synchronize_session=False)


def retire_expired_database_records(db, cutoff):
    expired_reports = oldest_ids(db, BusinessReport.id, BusinessReport.created_at, cutoff)
    if expired_reports:
        db.query(ReportAnalysisJob).filter(ReportAnalysisJob.saved_report_id.in_(expired_reports),
                                           ~ReportAnalysisJob.status.in_(ACTIVE)).delete(synchronize_session=False)
        report_cleanup.delete_reports(db, expired_reports)
    decisions = oldest_ids(db, Decision.id, Decision.created_at, cutoff)
    if decisions:
        for model in (DecisionActivity, DecisionCreationRequest, DecisionImpactReview):
            db.query(model).filter(model.decision_id.in_(decisions)).delete(synchronize_session=False)
        db.query(DecisionDuplicate).filter(or_(DecisionDuplicate.duplicate_id.in_(decisions),
                                               DecisionDuplicate.canonical_id.in_(decisions))).delete(synchronize_session=False)
        db.query(Decision).filter(Decision.id.in_(decisions)).delete(synchronize_session=False)
    analysis_ids = oldest_ids(db, CorrelationAnalysis.id, CorrelationAnalysis.created_at, cutoff,
                              ~CorrelationAnalysis.id.in_(select(CorrelationRun.analysis_id).where(CorrelationRun.status.in_(ACTIVE))))
    delete_analyses(db, analysis_ids)
    runs = oldest_ids(db, CorrelationRun.id, CorrelationRun.created_at, cutoff, ~CorrelationRun.status.in_(ACTIVE))
    if runs:
        db.query(CorrelationAnalysis).filter(CorrelationAnalysis.latest_successful_run_id.in_(runs)).update(
            {CorrelationAnalysis.latest_successful_run_id: None}, synchronize_session=False)
        db.query(CorrelationInsight).filter(CorrelationInsight.result_id.in_(
            select(CorrelationResult.id).where(CorrelationResult.run_id.in_(runs)))).delete(synchronize_session=False)
        for model in (CorrelationResult, CorrelationRunRequest, CorrelationEvent):
            db.query(model).filter(model.run_id.in_(runs)).delete(synchronize_session=False)
        db.query(CorrelationRun).filter(CorrelationRun.id.in_(runs)).delete(synchronize_session=False)
    tables = (
        (BudgetPlan, BudgetPlan.id, BudgetPlan.created_at),
        (PerformanceAnalysis, PerformanceAnalysis.id, PerformanceAnalysis.created_at),
        (DecisionImpactReview, DecisionImpactReview.id, DecisionImpactReview.created_at),
        (DecisionActivity, DecisionActivity.id, DecisionActivity.created_at),
        (CorrelationEvent, CorrelationEvent.id, CorrelationEvent.created_at),
        (DatasetRelationship, DatasetRelationship.id, DatasetRelationship.created_at),
        (DatasetJoinCache, DatasetJoinCache.id, DatasetJoinCache.updated_at),
        (CurrentWeeklyReport, CurrentWeeklyReport.workspace_id, CurrentWeeklyReport.updated_at),
        (WeeklyReportDeliveryLog, WeeklyReportDeliveryLog.id, WeeklyReportDeliveryLog.attempted_at),
        (DashboardShare, DashboardShare.id, DashboardShare.created_at),
        (SharedLink, SharedLink.id, SharedLink.created_at),
        (ShareEmailDelivery, ShareEmailDelivery.id, ShareEmailDelivery.created_at),
        (OrganizationInvite, OrganizationInvite.id, OrganizationInvite.created_at),
        (AgencyClientInvitation, AgencyClientInvitation.id, AgencyClientInvitation.created_at),
        (UsageActivityEvent, UsageActivityEvent.id, UsageActivityEvent.created_at),
    )
    count = len(expired_reports) + len(decisions) + len(analysis_ids) + len(runs)
    for model, identity, recorded_at in tables:
        count += remove_expired_rows(db, model, identity, recorded_at, cutoff)
    count += remove_expired_rows(db, ReportAnalysisJob, ReportAnalysisJob.id, ReportAnalysisJob.created_at,
                                 cutoff, ~ReportAnalysisJob.status.in_(ACTIVE))
    count += remove_expired_rows(db, DatasetAnalysis, DatasetAnalysis.id, DatasetAnalysis.updated_at,
                                 cutoff, ~DatasetAnalysis.status.in_({"pending", *ACTIVE}))
    state_ids = oldest_ids(db, OAuthConnectionState.id, OAuthConnectionState.created_at, cutoff)
    if state_ids:
        db.query(HostedSubdomainOAuthReturn).filter(HostedSubdomainOAuthReturn.state_id.in_(state_ids)).delete(synchronize_session=False)
        count += db.query(OAuthConnectionState).filter(OAuthConnectionState.id.in_(state_ids)).delete(synchronize_session=False)
    # A child still in progress must not lose the parent job it depends on.
    live_parent_ids = select(DataIngestionJob.parent_job_id).where(
        DataIngestionJob.parent_job_id.isnot(None), DataIngestionJob.status.in_(ACTIVE))
    job_ids = oldest_ids(db, DataIngestionJob.id, DataIngestionJob.created_at, cutoff,
                         ~DataIngestionJob.status.in_(ACTIVE), ~DataIngestionJob.id.in_(live_parent_ids))
    for job in db.query(DataIngestionJob).filter(DataIngestionJob.id.in_(job_ids)):
        try:
            cleanup_ingestion_staging(job)
        except Exception as error:
            logger.warning("Expired import staging could not be deleted; will retry (%s)", type(error).__name__)
            continue
        db.delete(job)
        count += 1
    return count


def sweep_workspace_record_retention(heartbeat=lambda: None, now=None):
    now = now or utc_now()
    cutoff = record_cutoff(now)
    datasets = retire_expired_datasets(cutoff, now, heartbeat)
    detached_connectors = retire_detached_connector_rows(now, heartbeat)
    heartbeat()
    try:
        with SessionLocal() as db:
            records = retire_expired_database_records(db, cutoff)
            db.commit()
    finally:
        drain_expired_objects(now, heartbeat)
    return {"datasets": datasets, "records": records, "detached_connectors": detached_connectors}
