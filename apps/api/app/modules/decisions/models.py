from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
)

from app.db.database import Base


class Decision(Base):
    __tablename__ = "decisions"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    clerk_user_id = Column(
        String,
        nullable=False,
        index=True,
    )

    dataset_id = Column(
        Integer,
        nullable=False,
    )

    title = Column(
        String,
        nullable=False,
    )

    description = Column(
        Text,
    )

    notes = Column(
        Text,
    )

    expected_outcome = Column(
        Text,
    )

    actual_outcome = Column(
        Text,
    )

    outcome_status = Column(
        String,
    )

    lessons_learned = Column(
        Text,
    )

    review_date = Column(DateTime)

    priority = Column(String, default="medium")

    status = Column(
        String,
        default="planned",
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    category = Column(String, default="general")
