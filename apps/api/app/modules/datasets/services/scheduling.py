from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


SYNC_ENABLED_KEY = "_sync_enabled"
SYNC_INTERVAL_HOURS_KEY = "_sync_interval_hours"
SYNC_TIME_OF_DAY_KEY = "_sync_time_of_day"
SYNC_TIMEZONE_KEY = "_sync_timezone"
SYNC_ANCHOR_DATE_KEY = "_sync_anchor_date"
SYNC_DAY_OF_WEEK_KEY = "_sync_day_of_week"
DEFAULT_SYNC_ENABLED = True
DEFAULT_SYNC_INTERVAL_HOURS = 24
DEFAULT_SYNC_TIME_OF_DAY = "09:00"
DEFAULT_SYNC_TIMEZONE = "UTC"
DEFAULT_SYNC_DAY_OF_WEEK = 0
SUPPORTED_SYNC_INTERVAL_HOURS = (24, 168)


def parse_connection_config(value) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


def read_connection_schedule(value) -> tuple[bool, int]:
    enabled, interval_hours, _, _, _, _ = read_connection_schedule_details(value)
    return enabled, interval_hours


def _normalize_time_of_day(value, fallback: str = DEFAULT_SYNC_TIME_OF_DAY) -> str:
    clean_value = str(value or "").strip()
    try:
        return datetime.strptime(clean_value, "%H:%M").strftime("%H:%M")
    except ValueError:
        return fallback


def _normalize_timezone(value, fallback: str = DEFAULT_SYNC_TIMEZONE) -> str:
    clean_value = str(value or "").strip() or fallback
    try:
        ZoneInfo(clean_value)
    except ZoneInfoNotFoundError:
        return fallback
    return clean_value


def _normalize_day_of_week(
    value,
    fallback: int = DEFAULT_SYNC_DAY_OF_WEEK,
) -> int:
    try:
        clean_value = int(value)
    except (TypeError, ValueError):
        return fallback

    return clean_value if 0 <= clean_value <= 6 else fallback


def read_connection_schedule_details(value) -> tuple[
    bool,
    int,
    str,
    str,
    str | None,
    int,
]:
    config = parse_connection_config(value)
    enabled = str(
        config.get(
            SYNC_ENABLED_KEY,
            str(DEFAULT_SYNC_ENABLED).lower(),
        )
    ).lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    try:
        interval_hours = int(
            config.get(
                SYNC_INTERVAL_HOURS_KEY,
                DEFAULT_SYNC_INTERVAL_HOURS,
            )
        )
    except (TypeError, ValueError):
        interval_hours = DEFAULT_SYNC_INTERVAL_HOURS
    if interval_hours not in SUPPORTED_SYNC_INTERVAL_HOURS:
        interval_hours = DEFAULT_SYNC_INTERVAL_HOURS
    anchor_date = config.get(SYNC_ANCHOR_DATE_KEY)
    try:
        if anchor_date:
            date.fromisoformat(str(anchor_date))
            anchor_date = str(anchor_date)
        else:
            anchor_date = None
    except ValueError:
        anchor_date = None
    day_of_week = _normalize_day_of_week(
        config.get(SYNC_DAY_OF_WEEK_KEY)
    )
    return (
        enabled,
        interval_hours,
        _normalize_time_of_day(config.get(SYNC_TIME_OF_DAY_KEY)),
        _normalize_timezone(config.get(SYNC_TIMEZONE_KEY)),
        anchor_date,
        day_of_week,
    )


def write_connection_schedule(
    value,
    enabled: bool,
    interval_hours: int,
    time_of_day: str | None = None,
    timezone_name: str | None = None,
    day_of_week: int | None = None,
    now: datetime | None = None,
) -> str:
    try:
        clean_interval = int(interval_hours)
    except (TypeError, ValueError) as error:
        raise ValueError("Sync interval must be a whole number of hours") from error
    if clean_interval not in SUPPORTED_SYNC_INTERVAL_HOURS:
        raise ValueError(
            "Sync interval must be one of: "
            + ", ".join(
                f"{hours} hours"
                for hours in SUPPORTED_SYNC_INTERVAL_HOURS
            )
        )

    config = parse_connection_config(value)
    # Retention is an application policy, not a customer setting. Remove the
    # legacy key when an existing connection is scheduled again.
    config.pop("_connector_retention_months", None)
    next_time = _normalize_time_of_day(
        time_of_day
        if time_of_day is not None
        else config.get(SYNC_TIME_OF_DAY_KEY)
    )
    next_timezone = _normalize_timezone(
        timezone_name
        if timezone_name is not None
        else config.get(SYNC_TIMEZONE_KEY)
    )
    next_day_of_week = _normalize_day_of_week(
        day_of_week
        if day_of_week is not None
        else config.get(SYNC_DAY_OF_WEEK_KEY)
    )
    (
        previous_enabled,
        previous_interval,
        previous_time,
        previous_timezone,
        _,
        previous_day_of_week,
    ) = read_connection_schedule_details(config)
    # Reset the anchor whenever a schedule is enabled or its local clock changes.
    schedule_changed = (
        not previous_enabled
        or previous_interval != clean_interval
        or previous_time != next_time
        or previous_timezone != next_timezone
        or previous_day_of_week != next_day_of_week
    )
    config[SYNC_ENABLED_KEY] = bool(enabled)
    config[SYNC_INTERVAL_HOURS_KEY] = clean_interval
    config[SYNC_TIME_OF_DAY_KEY] = next_time
    config[SYNC_TIMEZONE_KEY] = next_timezone
    config[SYNC_DAY_OF_WEEK_KEY] = next_day_of_week
    if enabled and schedule_changed:
        current_time = now or datetime.now(timezone.utc)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)
        config[SYNC_ANCHOR_DATE_KEY] = current_time.astimezone(
            ZoneInfo(next_timezone)
        ).date().isoformat()
    elif not enabled:
        config.pop(SYNC_ANCHOR_DATE_KEY, None)
    return json.dumps(config, sort_keys=True)


def connection_sync_is_due(
    last_synced_at: datetime | None,
    now: datetime,
    interval_hours: int,
    time_of_day: str | None = None,
    timezone_name: str | None = None,
    anchor_date: str | None = None,
    day_of_week: int = DEFAULT_SYNC_DAY_OF_WEEK,
) -> bool:
    if last_synced_at is None:
        if not anchor_date:
            return True

    if not anchor_date or time_of_day is None or timezone_name is None:
        if last_synced_at is None:
            return True
        return last_synced_at + timedelta(hours=interval_hours) <= now

    schedule_timezone = ZoneInfo(_normalize_timezone(timezone_name))
    schedule_time = datetime.strptime(
        _normalize_time_of_day(time_of_day),
        "%H:%M",
    ).time()
    current_time = now
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    current_local = current_time.astimezone(schedule_timezone)
    anchor_local = datetime.combine(
        date.fromisoformat(anchor_date),
        schedule_time,
        tzinfo=schedule_timezone,
    )
    if interval_hours == 168:
        target_weekday = (_normalize_day_of_week(day_of_week) - 1) % 7
        days_since_target = (
            current_local.weekday() - target_weekday
        ) % 7
        scheduled_date = current_local.date() - timedelta(
            days=days_since_target
        )
        latest_slot = datetime.combine(
            scheduled_date,
            schedule_time,
            tzinfo=schedule_timezone,
        )
        if current_local < latest_slot:
            latest_slot -= timedelta(days=7)
    else:
        latest_slot = datetime.combine(
            current_local.date(),
            schedule_time,
            tzinfo=schedule_timezone,
        )
        if current_local < latest_slot:
            latest_slot -= timedelta(days=1)

    if latest_slot < anchor_local:
        return False

    if last_synced_at is None:
        return True
    last_sync = last_synced_at
    if last_sync.tzinfo is None:
        last_sync = last_sync.replace(tzinfo=timezone.utc)
    return last_sync < latest_slot.astimezone(timezone.utc)
