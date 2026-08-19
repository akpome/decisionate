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
            "decisions.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    # =========================
    # Decision Activity Workspace Ownership For Shared Workspace History
    # =========================

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    actor_user_id = Column(
        String,
        nullable=True,
        index=True,
    )

    activity_type = Column(
        String,
        nullable=False,
    )

    decision_title = Column(
        String,
        nullable=True,
    )

    message = Column(
        String,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )
