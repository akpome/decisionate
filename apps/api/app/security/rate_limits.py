"""A shared database-backed limit for authenticated product traffic."""

import os
from sqlalchemy import case
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db.database import SessionLocal
from app.db.models import WorkspaceRequestBudget, utc_now


def consume_workspace_request(workspace_id: str) -> bool:
    window = utc_now().replace(second=0, microsecond=0)
    limit = max(30, int(os.getenv("WORKSPACE_REQUESTS_PER_MINUTE", "300")))
    with SessionLocal() as db:
        insert = postgres_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        statement = insert(WorkspaceRequestBudget).values(
            workspace_id=workspace_id, window_started_at=window, request_count=1,
        ).on_conflict_do_update(
            index_elements=[WorkspaceRequestBudget.workspace_id],
            set_={
                "window_started_at": window,
                "request_count": case(
                    (WorkspaceRequestBudget.window_started_at != window, 1),
                    else_=WorkspaceRequestBudget.request_count + 1,
                ),
            },
        ).returning(WorkspaceRequestBudget.request_count)
        count = db.execute(statement).scalar_one()
        db.commit()
        return count <= limit
