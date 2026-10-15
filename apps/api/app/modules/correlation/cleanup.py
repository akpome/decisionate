"""Delete result graphs with their source/workspace, including on older SQLite."""

from sqlalchemy import inspect

from .models import CorrelationAnalysis, CorrelationEvent, CorrelationInsight, CorrelationMetric, CorrelationResult, CorrelationRun, CorrelationRunRequest, CorrelationWidget


def delete_analyses(db, analysis_ids):
    if not analysis_ids:
        return
    run_ids = [row.id for row in db.query(CorrelationRun.id).filter(CorrelationRun.analysis_id.in_(analysis_ids))]
    result_ids = [row.id for row in db.query(CorrelationResult.id).filter(CorrelationResult.run_id.in_(run_ids))]
    db.query(CorrelationInsight).filter(CorrelationInsight.result_id.in_(result_ids)).delete(synchronize_session=False)
    db.query(CorrelationResult).filter(CorrelationResult.run_id.in_(run_ids)).delete(synchronize_session=False)
    db.query(CorrelationRunRequest).filter(CorrelationRunRequest.analysis_id.in_(analysis_ids)).delete(synchronize_session=False)
    db.query(CorrelationRun).filter(CorrelationRun.analysis_id.in_(analysis_ids)).delete(synchronize_session=False)
    for model in (CorrelationWidget, CorrelationMetric, CorrelationEvent):
        db.query(model).filter(model.analysis_id.in_(analysis_ids)).delete(synchronize_session=False)
    db.query(CorrelationAnalysis).filter(CorrelationAnalysis.id.in_(analysis_ids)).delete(synchronize_session=False)


def cleanup_source(db, dataset_id):
    if inspect(db.connection()).has_table(CorrelationMetric.__tablename__):
        identities = [row.analysis_id for row in db.query(CorrelationMetric.analysis_id).filter_by(dataset_id=dataset_id)]
        delete_analyses(db, identities)


def cleanup_workspace(db, workspace_id):
    if inspect(db.connection()).has_table(CorrelationAnalysis.__tablename__):
        delete_analyses(db, [row.id for row in db.query(CorrelationAnalysis.id).filter_by(workspace_id=workspace_id)])
