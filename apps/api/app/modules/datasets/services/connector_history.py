"""Durable date checkpoints for bounded, newest-first connector backfills."""

import os
from datetime import date, timedelta

from .retention import connector_retention_cutoff_date


HISTORY_POLICY_VERSION = 2
HISTORY_VERSION_KEY = "_connector_history_policy_version"
HISTORY_NEXT_END_KEY = "_initial_connector_backfill_next_end_date"
HISTORY_START_KEY = "_initial_connector_backfill_start_date"
HISTORY_END_KEY = "_initial_connector_backfill_end_date"


def backfill_chunk_days():
    try:
        return max(1, min(30, int(os.getenv("CONNECTOR_BACKFILL_CHUNK_DAYS", "30"))))
    except ValueError:
        return 30


def prepare_history(config, start, end, *, completed=False):
    config = dict(config)
    if config.get(HISTORY_VERSION_KEY) == HISTORY_POLICY_VERSION:
        return config
    previous_start = config.get(HISTORY_START_KEY)
    if completed and previous_start:
        try:
            end = min(end, date.fromisoformat(previous_start) - timedelta(days=1))
        except ValueError:
            pass
    config.update({HISTORY_VERSION_KEY: HISTORY_POLICY_VERSION,
                   HISTORY_START_KEY: start.isoformat(), HISTORY_END_KEY: end.isoformat(),
                   HISTORY_NEXT_END_KEY: end.isoformat()})
    return config


def next_history_chunk(config, *, as_of=None):
    start = max(date.fromisoformat(config[HISTORY_START_KEY]), connector_retention_cutoff_date(as_of))
    end = min(date.fromisoformat(config[HISTORY_NEXT_END_KEY]), as_of or date.today())
    if end < start:
        return None
    return max(start, end - timedelta(days=backfill_chunk_days() - 1)), end


def advance_history(config, start, end):
    if date.fromisoformat(config[HISTORY_NEXT_END_KEY]) != end:
        raise ValueError("Historical import checkpoint changed; retry the current chunk.")
    return {**config, HISTORY_NEXT_END_KEY: (start - timedelta(days=1)).isoformat()}
