"""Remove derived report evidence with its source data or workspace."""

import json

from sqlalchemy import inspect

from app.db.models import WeeklyReportPreference
from .models import BusinessReport, DecisionImpactReview, ReportAnalysisJob


def delete_reports(db, identities):
    if not identities:
        return
    if inspect(db.connection()).has_table(DecisionImpactReview.__tablename__):
        db.query(DecisionImpactReview).filter(DecisionImpactReview.report_id.in_(identities)).update({"report_id": None}, synchronize_session=False)
    if inspect(db.connection()).has_table(WeeklyReportPreference.__tablename__):
        db.query(WeeklyReportPreference).filter(WeeklyReportPreference.business_report_id.in_(identities)).update(
            {WeeklyReportPreference.business_report_id: None, WeeklyReportPreference.weekly_report_definition: None,
             WeeklyReportPreference.metric_focus: None, WeeklyReportPreference.enabled: 0}, synchronize_session=False)
    db.query(BusinessReport).filter(BusinessReport.id.in_(identities)).delete(synchronize_session=False)


def cleanup_source(db, dataset_id):
    if inspect(db.connection()).has_table(DecisionImpactReview.__tablename__):
        identities = [row.id for row in db.query(DecisionImpactReview) if any(
            item["dataset_id"] == dataset_id for item in json.loads(row.definition)["metrics"])]
        if identities:
            db.query(DecisionImpactReview).filter(DecisionImpactReview.id.in_(identities)).delete(synchronize_session=False)
    if inspect(db.connection()).has_table(WeeklyReportPreference.__tablename__):
        for preference in db.query(WeeklyReportPreference).filter(WeeklyReportPreference.weekly_report_definition.isnot(None)):
            if any(item["dataset_id"] == dataset_id for item in json.loads(preference.weekly_report_definition)["metrics"]):
                preference.weekly_report_definition = None
                preference.business_report_id = None
                preference.metric_focus = None
                preference.enabled = 0
    if inspect(db.connection()).has_table(ReportAnalysisJob.__tablename__):
        identities = [identity for identity, sources in db.query(ReportAnalysisJob.id, ReportAnalysisJob.sources)
                      if str(dataset_id) in json.loads(sources)]
        if identities:
            db.query(ReportAnalysisJob).filter(ReportAnalysisJob.id.in_(identities)).delete(synchronize_session=False)
    if not inspect(db.connection()).has_table(BusinessReport.__tablename__):
        return
    identities = []
    for identity, encoded in db.query(BusinessReport.id, BusinessReport.definition):
        definition = json.loads(encoded)
        if any(item["dataset_id"] == dataset_id for item in definition["metrics"]):
            identities.append(identity)
    delete_reports(db, identities)


def cleanup_workspace(db, workspace_id):
    if inspect(db.connection()).has_table(DecisionImpactReview.__tablename__):
        db.query(DecisionImpactReview).filter_by(workspace_id=workspace_id).delete(synchronize_session=False)
    if inspect(db.connection()).has_table(WeeklyReportPreference.__tablename__):
        db.query(WeeklyReportPreference).filter_by(workspace_id=workspace_id).update(
            {WeeklyReportPreference.business_report_id: None, WeeklyReportPreference.weekly_report_definition: None,
             WeeklyReportPreference.metric_focus: None, WeeklyReportPreference.enabled: 0}, synchronize_session=False)
    if inspect(db.connection()).has_table(ReportAnalysisJob.__tablename__):
        db.query(ReportAnalysisJob).filter_by(workspace_id=workspace_id).delete(synchronize_session=False)
    if inspect(db.connection()).has_table(BusinessReport.__tablename__):
        delete_reports(db, [row.id for row in db.query(BusinessReport.id).filter_by(workspace_id=workspace_id)])
