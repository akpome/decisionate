from sqlalchemy import and_, func, or_

from app.modules.decisions.models import Decision


MAX_LEARNING_EXAMPLES = 12
LEARNING_SCOPES = {
    "workspace",
    "dataset",
    "metric",
    "decision",
}


def build_dataset_decision_learning_filter(
    dataset_id: int,
    metric_column: str | None = None,
):
    clean_metric = str(metric_column or "").strip()
    if not clean_metric:
        return Decision.dataset_id == dataset_id

    return and_(
        Decision.dataset_id == dataset_id,
        or_(
            Decision.metric_column == clean_metric,
            Decision.metric_column.is_(None),
        ),
    )


def build_workspace_decision_learning_context(
    db,
    user_id: str,
    workspace_id: str,
    base_filter=None,
    exclude_decision_id: int | None = None,
    learning_scope: str = "workspace",
):
    clean_user_id = str(user_id or "").strip()
    clean_workspace_id = str(workspace_id or "").strip()
    clean_learning_scope = str(
        learning_scope or "workspace"
    ).strip().lower()
    if clean_learning_scope not in LEARNING_SCOPES:
        clean_learning_scope = "workspace"

    if not clean_user_id or not clean_workspace_id:
        return {
            "recorded_lesson_count": 0,
            "recorded_outcome_count": 0,
            "recorded_recommendation_count": 0,
            "sampled_lesson_count": 0,
            "sampled_evidence_count": 0,
            "learning_scope": clean_learning_scope,
            "outcome_counts": {},
            "examples": [],
        }

    scope_filter = or_(
        Decision.workspace_id == clean_workspace_id,
        and_(
            Decision.workspace_id.is_(None),
            Decision.clerk_user_id == clean_user_id,
        ),
    )
    filter_parts = [scope_filter]
    if base_filter is not None:
        filter_parts.append(base_filter)
    if exclude_decision_id is not None:
        filter_parts.append(
            Decision.id != exclude_decision_id
        )

    has_actual_outcome = _has_meaningful_text(
        Decision.actual_outcome
    )
    has_outcome_status = _has_meaningful_text(
        Decision.outcome_status
    )
    has_recorded_outcome = or_(
        has_actual_outcome,
        has_outcome_status,
    )
    has_expected_outcome = _has_meaningful_text(
        Decision.expected_outcome
    )
    has_complete_outcome = and_(
        has_expected_outcome,
        has_recorded_outcome,
    )
    has_lesson = _has_meaningful_text(
        Decision.lessons_learned
    )
    lesson_filter = and_(
        *filter_parts,
        has_lesson,
    )
    evidence_filter = and_(
        *filter_parts,
        or_(
            has_complete_outcome,
            has_lesson,
        ),
    )
    lesson_count = (
        db.query(func.count(Decision.id))
        .filter(lesson_filter)
        .scalar()
        or 0
    )
    outcome_count = (
        db.query(func.count(Decision.id))
        .filter(
            and_(
                *filter_parts,
                has_complete_outcome,
            )
        )
        .scalar()
        or 0
    )
    recommendation_count = (
        db.query(func.count(Decision.id))
        .filter(
            and_(
                *filter_parts,
                has_complete_outcome,
                _has_meaningful_text(
                    Decision.recommendation_text
                ),
            )
        )
        .scalar()
        or 0
    )
    learning_decisions = (
        db.query(Decision)
        .filter(evidence_filter)
        .order_by(
            Decision.updated_at.is_(None),
            Decision.updated_at.desc(),
            Decision.created_at.desc(),
            Decision.id.desc(),
        )
        .limit(MAX_LEARNING_EXAMPLES)
        .all()
    )

    examples = []
    outcome_counts: dict[str, int] = {}
    sampled_lesson_count = 0

    for decision in learning_decisions:
        actual_outcome = _clean_learning_text(
            decision.actual_outcome,
            360,
        )
        outcome_status = _clean_learning_text(
            decision.outcome_status,
            100,
        )
        expected_outcome = _clean_learning_text(
            decision.expected_outcome,
            360,
        )
        if not expected_outcome or not (
            actual_outcome or outcome_status
        ):
            actual_outcome = ""
            outcome_status = ""
        if actual_outcome or outcome_status:
            normalized_outcome_status = (
                outcome_status or "unclassified"
            )
            outcome_counts[normalized_outcome_status] = (
                outcome_counts.get(
                    normalized_outcome_status,
                    0,
                ) + 1
            )
        if _clean_learning_text(
            decision.lessons_learned,
            420,
        ):
            sampled_lesson_count += 1
        examples.append({
            "title": _clean_learning_text(
                decision.title,
                160,
            ),
            "category": _clean_learning_text(
                decision.category,
                100,
            ),
            "metric_column": _clean_learning_text(
                decision.metric_column,
                120,
            ),
            "outcome_status": outcome_status or "unclassified",
            "expected_outcome": expected_outcome,
            "actual_outcome": actual_outcome,
            "lesson_learned": _clean_learning_text(
                decision.lessons_learned,
                420,
            ),
            "recommendation": _clean_learning_text(
                decision.recommendation_text,
                420,
            ),
            "recommendation_source": _clean_learning_text(
                decision.recommendation_source,
                40,
            ),
            "recommendation_context": _clean_learning_text(
                decision.recommendation_context,
                360,
            ),
        })

    return {
        "recorded_lesson_count": int(lesson_count),
        "recorded_outcome_count": int(outcome_count),
        "recorded_recommendation_count": int(
            recommendation_count
        ),
        "sampled_lesson_count": sampled_lesson_count,
        "sampled_evidence_count": len(examples),
        "learning_scope": clean_learning_scope,
        "outcome_counts": outcome_counts,
        "examples": examples,
    }


def _has_meaningful_text(column):
    return and_(
        column.is_not(None),
        func.length(func.trim(column)) > 0,
    )


def _clean_learning_text(
    value,
    max_length: int,
):
    clean_value = " ".join(
        str(value or "").split()
    )
    return clean_value[:max_length]
