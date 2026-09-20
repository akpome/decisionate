from datetime import UTC, datetime
import json

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Float,
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

    assigned_user_id = Column(
        String,
        nullable=True,
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

    evidence_dataset_ids_json = Column(
        "evidence_dataset_ids",
        Text,
        nullable=True,
    )

    evidence_metrics_json = Column(
        "evidence_metrics",
        Text,
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

    action = Column(
        Text,
        nullable=True,
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

    outcome_baseline_value = Column(
        Float,
        nullable=True,
    )

    outcome_measured_value = Column(
        Float,
        nullable=True,
    )

    outcome_delta_percent = Column(
        Float,
        nullable=True,
    )

    outcome_measured_at = Column(
        DateTime,
        nullable=True,
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

    @property
    def owner_user_id(self) -> str:
        """Return the assignee, falling back to the decision creator."""
        return self.assigned_user_id or self.clerk_user_id

    @property
    def evidence_dataset_ids(self) -> list[int]:
        try:
            values = json.loads(self.evidence_dataset_ids_json or "[]")
        except (TypeError, ValueError):
            return []

        if not isinstance(values, list):
            return []

        return [
            int(value)
            for value in values
            if isinstance(value, int) or (
                isinstance(value, str) and value.isdigit()
            )
        ]

    @evidence_dataset_ids.setter
    def evidence_dataset_ids(self, values: list[int] | None):
        self.evidence_dataset_ids_json = json.dumps(
            values or [],
            separators=(",", ":"),
        )

    @property
    def evidence_metrics(self) -> list[dict]:
        try:
            values = json.loads(self.evidence_metrics_json or "[]")
        except (TypeError, ValueError):
            return []

        return values if isinstance(values, list) else []

    @evidence_metrics.setter
    def evidence_metrics(self, values: list[dict] | None):
        self.evidence_metrics_json = json.dumps(
            values or [],
            separators=(",", ":"),
        )
