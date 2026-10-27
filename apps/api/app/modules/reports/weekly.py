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
