from datetime import UTC, datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
)

from app.db.database import Base
from app.modules.decisions.schemas import (
    DEFAULT_DECISION_CATEGORY,
    DEFAULT_DECISION_PRIORITY,
    DEFAULT_DECISION_STATUS,
)


def utc_now() -> datetime:
    return datetime.now(UTC).replace(
        tzinfo=None,
    )


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

    workspace_id = Column(
        String,
        nullable=True,
        index=True,
    )

    dataset_id = Column(
        Integer,
        nullable=False,
    )

    metric_column = Column(
        String,
        nullable=True,
    )

    recommendation_text = Column(
        Text,
        nullable=True,
    )

    recommendation_source = Column(
        String,
        nullable=True,
    )

    recommendation_context = Column(
        Text,
        nullable=True,
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

    priority = Column(String, default=DEFAULT_DECISION_PRIORITY)

    status = Column(
        String,
        default=DEFAULT_DECISION_STATUS,
    )

    created_at = Column(
        DateTime,
        default=utc_now,
    )

    updated_at = Column(
        DateTime,
        nullable=True,
        onupdate=utc_now,
    )

    category = Column(String, default=DEFAULT_DECISION_CATEGORY)

    confidence_score = Column(String, nullable=True)
