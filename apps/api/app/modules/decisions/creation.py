"""Recognize repeated submissions without merging different actions or evidence."""

from hashlib import sha256
import json

from sqlalchemy import text

from .models import Decision
from .schemas import DEFAULT_DECISION_CATEGORY, DEFAULT_DECISION_PRIORITY


def creation_content(decision):
    content = {name: getattr(decision, name) for name in (
        "dataset_id", "metric_column", "outcome_dataset_id", "title", "action", "description",
        "expected_outcome", "recommendation_text", "recommendation_source", "confidence_score",
    )}
    content["priority"] = decision.priority or DEFAULT_DECISION_PRIORITY
    content["category"] = decision.category or DEFAULT_DECISION_CATEGORY
    content["review_date"] = decision.review_date.isoformat() if decision.review_date else None
    content["evidence_dataset_ids"] = sorted({decision.dataset_id, *(decision.evidence_dataset_ids or [])})
    content["evidence_metrics"] = sorted(
        (json.dumps(item, sort_keys=True) for item in (decision.evidence_metrics or [])),
    )
    try:
        content["recommendation_context"] = json.loads(decision.recommendation_context)
    except (TypeError, ValueError):
        content["recommendation_context"] = decision.recommendation_context
    return content


def lock_decision_creation(db, workspace_id):
    # The transaction lock covers check + insert across API replicas, not just one browser.
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(sha256(f"decision-create:{workspace_id}".encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def repeated_active_decision(db, submission):
    content = creation_content(submission)
    candidates = db.query(Decision).filter(
        Decision.workspace_id == submission.workspace_id,
        Decision.clerk_user_id == submission.clerk_user_id,
        Decision.dataset_id == submission.dataset_id,
        Decision.title == submission.title,
        Decision.action == submission.action,
        Decision.status.in_(("planned", "in_progress")),
    ).order_by(Decision.created_at, Decision.id)
    return next((item for item in candidates if creation_content(item) == content), None)
