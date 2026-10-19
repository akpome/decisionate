"""Remove derived report evidence with its source data or workspace."""

import json

from sqlalchemy import inspect

from app.db.models import WeeklyReportPreference
from .models import BusinessReport


def delete_reports(db, identities):
    if not identities:
        return
    if inspect(db.connection()).has_table(WeeklyReportPreference.__tablename__):
        db.query(WeeklyReportPreference).filter(WeeklyReportPreference.business_report_id.in_(identities)).update(
            {WeeklyReportPreference.business_report_id: None}, synchronize_session=False)
    db.query(BusinessReport).filter(BusinessReport.id.in_(identities)).delete(synchronize_session=False)


def cleanup_source(db, dataset_id):
    if not inspect(db.connection()).has_table(BusinessReport.__tablename__):
        return
    identities = []
    for identity, encoded in db.query(BusinessReport.id, BusinessReport.definition):
        definition = json.loads(encoded)
        if any(item["dataset_id"] == dataset_id for item in definition["metrics"]):
            identities.append(identity)
    delete_reports(db, identities)


def cleanup_workspace(db, workspace_id):
    if inspect(db.connection()).has_table(BusinessReport.__tablename__):
        delete_reports(db, [row.id for row in db.query(BusinessReport.id).filter_by(workspace_id=workspace_id)])
