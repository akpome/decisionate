"""Shared limits for untrusted input, before data is saved as a dataset."""

from contextlib import contextmanager
from contextvars import ContextVar


MIB = 1024 * 1024
UPLOAD_MAX_BYTES = 100 * MIB
MAX_DATASET_ROWS = 1_000_000
MAX_DATASET_COLUMNS = 500
MAX_DATASET_CELLS = 10_000_000
MAX_DATAFRAME_BYTES = 512 * MIB
MAX_JSON_DOCUMENT_BYTES = 20 * MIB
MAX_WORKBOOK_EXPANDED_BYTES = 128 * MIB
MAX_WORKBOOK_ENTRIES = 2_000
MAX_CONNECTOR_PAGE_BYTES = 16 * MIB
MAX_CONNECTOR_FETCH_BYTES = 128 * MIB
MAX_CONNECTOR_REQUESTS = 2_000


class IngestionLimitExceeded(ValueError):
    pass


def check_table_shape(rows, columns, *, limit_cells=True):
    if rows > MAX_DATASET_ROWS or columns > MAX_DATASET_COLUMNS:
        raise IngestionLimitExceeded("Dataset exceeds the 1,000,000 row or 500 column limit. Reduce the data and try again.")
    if limit_cells and rows * columns > MAX_DATASET_CELLS:
        raise IngestionLimitExceeded("Dataset exceeds the 10 million cell limit. Use fewer rows or columns and try again.")


def check_dataframe_size(dataframe, *, limit_cells=True):
    check_table_shape(*dataframe.shape, limit_cells=limit_cells)
    if dataframe.memory_usage(index=True, deep=True).sum() > MAX_DATAFRAME_BYTES:
        raise IngestionLimitExceeded("Dataset exceeds the 512 MB in-memory limit. Reduce the data and try again.")


class ConnectorFetchBudget:
    def __init__(self):
        self.requests = 0
        self.bytes = 0


_fetch_budget = ContextVar("connector_ingestion_fetch_budget", default=None)


@contextmanager
def connector_fetch_budget():
    token = _fetch_budget.set(ConnectorFetchBudget())
    try:
        yield
    finally:
        _fetch_budget.reset(token)


def count_connector_request():
    budget = _fetch_budget.get()
    if budget is not None:
        budget.requests += 1
        if budget.requests > MAX_CONNECTOR_REQUESTS:
            raise IngestionLimitExceeded("This sync requested too many pages. Try a smaller date range or fewer records.")


def connector_response_limit():
    budget = _fetch_budget.get()
    return min(MAX_CONNECTOR_PAGE_BYTES, MAX_CONNECTOR_FETCH_BYTES - budget.bytes) if budget else MAX_CONNECTOR_PAGE_BYTES


def accept_connector_response(size, limit):
    if size > limit:
        raise IngestionLimitExceeded("This sync returned too much data. Try a smaller date range or fewer records.")
    budget = _fetch_budget.get()
    if budget is not None:
        budget.bytes += size
