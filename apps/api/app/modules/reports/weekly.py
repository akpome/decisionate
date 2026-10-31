"""Independent weekly settings; instant-analysis time units never become weeks."""

from datetime import datetime
import json
from zoneinfo import ZoneInfo

from app.modules.correlation.catalog import reporting_timezone
from app.modules.correlation.defaults import MAXIMUM_LAG
from .anomalies import historical_start
from .service import complete_week, previous_window


def weekly_context(anchor=None):
    anchor = anchor or datetime.now(ZoneInfo(reporting_timezone())).date()
    window = complete_week(anchor)
    return {"window": window, "history_window": {"start": historical_start(anchor), "end": previous_window(window)["end"]},
            "reporting_timezone": reporting_timezone()}


def weekly_settings_copy(definition):
    value = {**definition, "scope": "multi", "grain": "weekly", "included_findings": None, "source_run_id": None}
    if definition.get("grain") != "weekly":
        # A daily/monthly lag cannot be reinterpreted as the same number of weeks.
        value["lag"] = {"enabled": True, "minimum": 0, "maximum": MAXIMUM_LAG, "direction": "a_leads_b"}
        value["pair_directions"] = [{**pair, "direction": "same_period"} for pair in definition.get("pair_directions") or []]
    return value


def apply_weekly_settings(db, definition, workspace):
    from app.db.models import WeeklyReportPreference
    from app.modules.correlation.engine import metric_id
    from app.modules.correlation.service import encode
    from app.infrastructure.ingestion_jobs import lock_workspace_queue

    lock_workspace_queue(db, "weekly-settings:" + workspace)
    preference = db.query(WeeklyReportPreference).filter_by(workspace_id=workspace).with_for_update().first()
    if preference is None:
        preference = WeeklyReportPreference(workspace_id=workspace, enabled=0)
        db.add(preference)
    preference.weekly_report_definition = encode(definition)
    preference.business_report_id = None
    preference.metric_focus = encode([metric_id(item) for item in definition["metrics"]])
    return preference


def current_weekly_report(db, user, workspace, definition):
    from app.modules.correlation.service import authorize_datasets
    from .decision_reviews import attach_review_target
    from .models import BusinessReport, CurrentWeeklyReport
    from .service import attach_report_decisions

    current = db.get(CurrentWeeklyReport, workspace)
    if current is None or json.loads(current.definition) != definition:
        return None
    report = json.loads(current.snapshot)
    dataset_ids = {item["dataset_id"] for item in report["definition"]["metrics"]}
    authorize_datasets(db, user, workspace, dataset_ids)
    if report.get("report_id") and db.get(BusinessReport, report["report_id"]) is None:
        report.pop("report_id")
    attach_report_decisions(report, db, workspace, dataset_ids, report.get("report_id"))
    attach_review_target(report, db, user, workspace)
    return {**report, "weekly_current": True, "analysis_job_id": current.job_id}


def archive_weekly_delivery(db, job, report):
    """Freeze the exact report before sending, without changing the active setup."""
    from app.modules.correlation.service import encode
    from .models import BusinessReport

    if job.saved_report_id:
        return
    snapshot = {**report, "weekly_report": True, "weekly_history_kind": "delivery", "delivery_status": "pending"}
    archived = BusinessReport(workspace_id=job.workspace_id, user_id=job.user_id, name=report["name"],
                              definition=encode(report["definition"]), snapshot=encode(snapshot))
    db.add(archived)
    db.flush()
    job.saved_report_id = archived.id
    db.flush()


def confirm_weekly_delivery(db, job, sent_at):
    from app.modules.correlation.service import encode
    from .models import BusinessReport

    archive = db.get(BusinessReport, job.saved_report_id)
    archive.snapshot = encode({**json.loads(archive.snapshot), "delivery_status": "sent", "sent_at": sent_at.isoformat()})
