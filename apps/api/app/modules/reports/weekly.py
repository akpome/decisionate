"""Independent weekly settings; instant-analysis time units never become weeks."""

from datetime import datetime
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
