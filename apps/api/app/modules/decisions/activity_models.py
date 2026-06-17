from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
)

from app.db.database import Base


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
        default=datetime.utcnow,
    )