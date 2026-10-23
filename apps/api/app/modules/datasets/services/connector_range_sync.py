"""Checkpoints for large manual and scheduled connector date ranges."""

from datetime import date, timedelta

from .connector_history import backfill_chunk_days
from .retention import connector_retention_cutoff_date


RANGE_SYNC_KEY = "_connector_range_sync"
RANGE_SYNC_JOB_TYPE = "connector_range_sync"
MAX_UNCHUNKED_SYNC_DAYS = 90


def range_sync_pending(config):
    plan = config.get(RANGE_SYNC_KEY)
    return isinstance(plan, dict) and plan.get("status") != "complete"


def new_range_sync(start, end, resource_type, recent_synced_at, submitted_at):
    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "next_end_date": end.isoformat(),
        "resource_type": resource_type,
        "recent_synced_at": recent_synced_at,
        # Only a range reaching today may advance the incremental watermark.
        "completed_watermark": submitted_at if end >= date.today() else recent_synced_at,
        "status": "pending",
    }


def next_range_sync_chunk(plan, *, as_of=None):
    today = as_of or date.today()
    start = date.fromisoformat(plan["start_date"])
    end = date.fromisoformat(plan["end_date"])
    cursor = date.fromisoformat(plan["next_end_date"])
    if start > end or cursor > end:
        raise ValueError("Connector date-range checkpoint is invalid")
    start = max(start, connector_retention_cutoff_date(today))
    end = min(cursor, today)
    if end < start:
        return None
    return max(start, end - timedelta(days=backfill_chunk_days() - 1)), end


def advance_range_sync(plan, start, end):
    if date.fromisoformat(plan["next_end_date"]) != end:
        raise ValueError("Connector date-range checkpoint changed; retry the current chunk")
    updated = {**plan, "next_end_date": (start - timedelta(days=1)).isoformat()}
    updated["status"] = "pending" if next_range_sync_chunk(updated) else "complete"
    return updated
