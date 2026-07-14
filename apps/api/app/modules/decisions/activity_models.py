from datetime import UTC, datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
)

from app.db.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC).replace(
        tzinfo=None,
    )


class DecisionActivity(
    Base
):
    __tablename__ = (
        "decision_activities"
    )

    id = Column(
        Integer,
        primary_key=True,
    )

    decision_id = Column(
        Integer,
        ForeignKey(
            "decisions.id"
        ),
        nullable=False,
    )

    # =========================
    # Decision Activity Workspace Ownership For Agency Client History
    # =========================

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    activity_type = Column(
        String,
        nullable=False,
    )

    message = Column(
        String,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )
