"""Individually revocable links, including bounded management of legacy links."""

from datetime import UTC
from hashlib import sha256
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import Column, DateTime, Integer, String, cast, func, inspect, literal, select, union_all

from app.db.database import Base, SessionLocal
from app.db.models import DashboardShare, Dataset, utc_now
from app.infrastructure.ingestion_jobs import lock_workspace_queue
from app.modules.auth_context import get_auth_context
from app.modules.applications import workspace_scoped
from app.modules.datasets.services.auth import require_workspace_data_manager
from app.modules.reports.models import BusinessReport, ReportShare


class SharedLink(Base):
    __tablename__ = "shared_links"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    delivery_id = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False)
    dataset_id = Column(Integer, nullable=True, index=True)
    report_id = Column(String, nullable=True, index=True)
    dashboard_key = Column(String, nullable=True)
    recipient = Column(String, nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    revoked_at = Column(DateTime, nullable=True)


router = APIRouter()


def database():
    with SessionLocal() as db:
        yield db


def link_table_exists(db):
    return inspect(db.connection()).has_table(SharedLink.__tablename__)


def find_shared_link(db, token):
    if not isinstance(token, str) or not 32 <= len(token) <= 100 or not link_table_exists(db):
        return None
    return db.query(SharedLink).filter_by(token_hash=sha256(token.encode()).hexdigest()).first()


def active_link_count(db, *, dataset_id=None, report_id=None, dashboard=None, dataset_ids=None, delivery_id=None):
    if not link_table_exists(db):
        return 0
    query = db.query(SharedLink).filter(SharedLink.revoked_at.is_(None))
    for field, value in (("dataset_id", dataset_id), ("report_id", report_id),
                         ("dashboard_key", dashboard), ("delivery_id", delivery_id)):
        if value is not None:
            query = query.filter(getattr(SharedLink, field) == value)
    if dataset_ids is not None:
        query = query.filter(SharedLink.dataset_id.in_(dataset_ids))
    return query.count()


def revoke_links(db, *, dataset_id=None, report_id=None, dashboard=None, dataset_ids=None):
    if not link_table_exists(db):
        return 0
    query = db.query(SharedLink).filter(SharedLink.revoked_at.is_(None))
    if dataset_id is not None:
        query = query.filter_by(dataset_id=dataset_id)
    if report_id is not None:
        query = query.filter_by(report_id=report_id)
    if dashboard is not None:
        query = query.filter_by(dashboard_key=dashboard)
    if dataset_ids is not None:
        query = query.filter(SharedLink.dataset_id.in_(dataset_ids))
    return query.update({"revoked_at": utc_now()}, synchronize_session=False)


def authorize_target(db, auth, *, kind, dataset_id=None, report_id=None, dashboard=None):
    from app.modules.datasets.router import clean_dashboard_share_key, load_dataset, verify_dataset_owner
    from app.modules.reports.router import allowed_report
    if kind not in {"dashboard", "report"}:
        raise HTTPException(422, "Choose dashboards or reports.")
    if kind == "dashboard":
        if report_id or dashboard and not dataset_id:
            raise HTTPException(422, "Choose a dashboard dataset.")
        if dataset_id is not None:
            dataset = load_dataset(db, dataset_id)
            verify_dataset_owner(dataset, auth.user_id, auth.workspace_id)
        if dashboard is not None:
            clean_dashboard_share_key(dashboard)
    else:
        if dataset_id or dashboard:
            raise HTTPException(422, "Choose a saved report.")
        if report_id is not None:
            allowed_report(db, report_id, auth.user_id, auth.workspace_id)


@router.get("/links")
def get_shared_links(request: Request, response: Response, kind: str,
                     dataset_id: int | None = Query(default=None, gt=0), report_id: str | None = None,
                     dashboard: str | None = None, offset: int = Query(default=0, ge=0), db=Depends(database)):
    response.headers["Cache-Control"] = "no-store"
    auth = get_auth_context(request)
    require_workspace_data_manager(request)
    return list_shared_links(db, auth, kind=kind, dataset_id=dataset_id, report_id=report_id,
                             dashboard=dashboard, offset=offset)


@workspace_scoped("auth", "workspace_id")
def list_shared_links(db, auth, *, kind, dataset_id=None, report_id=None, dashboard=None, offset=0):
    authorize_target(db, auth, kind=kind, dataset_id=dataset_id, report_id=report_id, dashboard=dashboard)
    from app.modules.datasets.router import filter_datasets_for_workspace
    queries = []
    if link_table_exists(db):
        query = select(SharedLink.id, SharedLink.kind, SharedLink.dataset_id, SharedLink.report_id,
                       SharedLink.dashboard_key.label("dashboard"), func.coalesce(Dataset.file_name, BusinessReport.name).label("title"),
                       SharedLink.recipient, SharedLink.created_at).select_from(SharedLink).outerjoin(Dataset, SharedLink.dataset_id == Dataset.id).outerjoin(
                           BusinessReport, SharedLink.report_id == BusinessReport.id).where(
                               SharedLink.workspace_id == auth.workspace_id, SharedLink.kind == kind, SharedLink.revoked_at.is_(None))
        query = query.where(Dataset.id.isnot(None) if kind == "dashboard" else BusinessReport.id.isnot(None))
        if dataset_id is not None:
            query = query.where(SharedLink.dataset_id == dataset_id)
        if report_id is not None:
            query = query.where(SharedLink.report_id == report_id)
        if dashboard is not None:
            query = query.where(SharedLink.dashboard_key == dashboard)
        queries.append(query)
    if kind == "dashboard":
        scope = filter_datasets_for_workspace(auth.user_id, auth.workspace_id)
        legacy = select((literal("legacy-dashboard:") + cast(DashboardShare.id, String)).label("id"),
                        literal("dashboard").label("kind"), Dataset.id.label("dataset_id"), literal(None, String).label("report_id"),
                        DashboardShare.dashboard_key.label("dashboard"), Dataset.file_name.label("title"),
                        literal(None, String).label("recipient"), DashboardShare.created_at).join(
                            Dataset, DashboardShare.dataset_id == Dataset.id).where(scope)
        original = select((literal("legacy-dataset:") + cast(Dataset.id, String)).label("id"), literal("dashboard").label("kind"),
                          Dataset.id.label("dataset_id"), literal(None, String).label("report_id"),
                          literal("general-business").label("dashboard"), Dataset.file_name.label("title"),
                          literal(None, String).label("recipient"), Dataset.created_at).where(scope, Dataset.share_token.isnot(None), Dataset.share_token != "")
        if dataset_id is not None:
            legacy = legacy.where(Dataset.id == dataset_id)
            original = original.where(Dataset.id == dataset_id)
        if dashboard is not None:
            legacy = legacy.where(DashboardShare.dashboard_key == dashboard)
        queries.append(legacy)
        if dashboard in {None, "general-business"}:
            queries.append(original)
    else:
        legacy = select((literal("legacy-report:") + ReportShare.report_id).label("id"), literal("report").label("kind"),
                        literal(None, Integer).label("dataset_id"), BusinessReport.id.label("report_id"),
                        literal(None, String).label("dashboard"), BusinessReport.name.label("title"),
                        literal(None, String).label("recipient"), BusinessReport.created_at).join(
                            BusinessReport, ReportShare.report_id == BusinessReport.id).where(BusinessReport.workspace_id == auth.workspace_id)
        if report_id is not None:
            legacy = legacy.where(BusinessReport.id == report_id)
        queries.append(legacy)
    combined = union_all(*queries).subquery()
    rows = db.execute(select(combined).order_by(combined.c.created_at.desc().nullslast(), combined.c.id).offset(offset).limit(51)).mappings().all()
    return {"items": [{**dict(row), "legacy": row["id"].startswith("legacy-"),
                       "created_at": row["created_at"].replace(tzinfo=UTC).isoformat() if row["created_at"] else None}
                      for row in rows[:50]], "next_offset": offset + 50 if len(rows) > 50 else None}


@router.delete("/links/{link_id}")
def stop_shared_link(link_id: str, request: Request, response: Response, db=Depends(database)):
    response.headers["Cache-Control"] = "no-store"
    auth = get_auth_context(request)
    require_workspace_data_manager(request)
    return stop_one_link(db, auth, link_id)


@workspace_scoped("auth", "workspace_id")
def stop_one_link(db, auth, link_id):
    lock_workspace_queue(db, "share-email:" + auth.workspace_id)
    if link_id.startswith("legacy-dashboard:"):
        identity = link_id.partition(":")[2]
        if not identity.isdigit():
            raise HTTPException(404, "Shared link not found.")
        record = db.get(DashboardShare, int(identity))
        if record is None:
            raise HTTPException(404, "Shared link not found.")
        authorize_target(db, auth, kind="dashboard", dataset_id=record.dataset_id, dashboard=record.dashboard_key)
        db.delete(record)
    elif link_id.startswith("legacy-dataset:"):
        identity = link_id.partition(":")[2]
        if not identity.isdigit():
            raise HTTPException(404, "Shared link not found.")
        authorize_target(db, auth, kind="dashboard", dataset_id=int(identity))
        record = db.get(Dataset, int(identity))
        record.share_token = None
    elif link_id.startswith("legacy-report:"):
        identity = link_id.partition(":")[2]
        authorize_target(db, auth, kind="report", report_id=identity)
        record = db.get(ReportShare, identity)
        if record is None:
            raise HTTPException(404, "Shared link not found.")
        db.delete(record)
    else:
        record = db.query(SharedLink).filter_by(id=link_id, workspace_id=auth.workspace_id).with_for_update().first()
        if record is None:
            raise HTTPException(404, "Shared link not found.")
        authorize_target(db, auth, kind=record.kind, dataset_id=record.dataset_id, report_id=record.report_id, dashboard=record.dashboard_key)
        record.revoked_at = record.revoked_at or utc_now()
    db.commit()
    return {"link_id": link_id, "revoked": True}
