import asyncio

from app.db.database import SessionLocal
from app.db.models import (
    Dataset,
)
from app.modules.decisions.models import (
    Decision,
)
from app.modules.decisions.activity_models import (
    DecisionActivity,
)
from app.modules.ai.service import (
    generate_structured_analysis,
)
from app.modules.ai.learning import (
    build_dataset_decision_learning_filter,
    build_workspace_decision_learning_context,
)
from app.modules.decisions.schemas import (
    ACTIVE_DECISION_LIST_LIFECYCLE,
    ARCHIVE_DECISION_ACTIVITY,
    ARCHIVED_DECISION_STATUS,
    ARCHIVED_DECISION_LIST_LIFECYCLE,
    CATEGORY_DECISION_ACTIVITY,
    CONFIDENCE_DECISION_ACTIVITY,
    CREATED_DECISION_ACTIVITY,
    DECISION_ATTENTION_WORKFLOW_STATE_PATTERN,
    DECISION_LIST_LIFECYCLE_PATTERN,
    DECISION_LEARNING_WORKFLOW_STATE_PATTERN,
    DECISION_OUTCOME_WORKFLOW_STATE_PATTERN,
    DECISION_NOTES_WORKFLOW_STATE_PATTERN,
    DECISION_REVIEW_WORKFLOW_STATE_PATTERN,
    DECISION_LIST_SORT_PATTERN,
    DEFAULT_DECISION_LIST_LIFECYCLE,
    DEFAULT_DECISION_LIST_SORT,
    DEFAULT_DECISION_STATUS,
    CREATED_ASC_DECISION_LIST_SORT,
    DETAILS_DECISION_ACTIVITY,
    DecisionActivityFeedResponse,
    DecisionActivityResponse,
    DecisionActivityType,
    DecisionAttentionWorkflowState,
    DecisionCategory,
    DecisionCategoryUpdate,
    DecisionConfidenceUpdate,
    DecisionCreate,
    DecisionDetailsUpdate,
    DecisionLearningWorkflowState,
    DecisionListLifecycle,
    DecisionOutcomeWorkflowState,
    DecisionReviewWorkflowState,
    DecisionListSort,
    DecisionOverviewUpdate,
    DecisionResponse,
    DecisionReviewUpdate,
    DecisionSummaryResponse,
    DecisionUpdate,
    DecisionNotesUpdate,
    DecisionOutcomeUpdate,
    DecisionOutcomeAnalysisResponse,
    DecisionLearningUpdate,
    DecisionPriorityUpdate,
    DecisionNotesWorkflowState,
    DecisionStatus,
    LEARNING_DECISION_ACTIVITY,
    NOTES_DECISION_ACTIVITY,
    OUTCOME_DECISION_ACTIVITY,
    OVERVIEW_DECISION_ACTIVITY,
    PRIORITY_DECISION_ACTIVITY,
    REVIEW_ASC_DECISION_LIST_SORT,
    REVIEW_DECISION_ACTIVITY,
    REVIEW_DESC_DECISION_LIST_SORT,
    RESTORE_DECISION_ACTIVITY,
    STATUS_DECISION_ACTIVITY,
    UPDATED_DECISION_LIST_SORT,
    VALID_DECISION_ATTENTION_WORKFLOW_STATES,
    VALID_DECISION_CATEGORIES,
    VALID_DECISION_ACTIVITY_TYPES,
    VALID_DECISION_CONFIDENCE_SCORES,
    VALID_DECISION_LEARNING_WORKFLOW_STATES,
    VALID_DECISION_NOTES_WORKFLOW_STATES,
    VALID_DECISION_OUTCOME_STATUSES,
    VALID_DECISION_OUTCOME_WORKFLOW_STATES,
    VALID_DECISION_REVIEW_WORKFLOW_STATES,
    VALID_DECISION_PRIORITIES,
    VALID_DECISION_STATUSES,
)

from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
)
from sqlalchemy import and_, func, or_

from app.modules.auth_context import (
    get_auth_context,
)

router = APIRouter(
    prefix="/decisions",
    tags=["decisions"],
)


def require_decision_manager(
    request: Request,
):
    if get_auth_context(request).workspace_role == "client":
        raise HTTPException(
            status_code=403,
            detail="Client users can review decisions but cannot modify them",
        )

DECISION_ACTIVITY_MESSAGES: dict[DecisionActivityType, str] = {
    CREATED_DECISION_ACTIVITY:
        "Decision created",
    STATUS_DECISION_ACTIVITY:
        "Status updated",
    ARCHIVE_DECISION_ACTIVITY:
        "Decision archived",
    RESTORE_DECISION_ACTIVITY:
        "Decision restored to active work",
    OVERVIEW_DECISION_ACTIVITY:
        "Decision overview updated",
    DETAILS_DECISION_ACTIVITY:
        "Decision details updated",
    NOTES_DECISION_ACTIVITY:
        "Notes updated",
    OUTCOME_DECISION_ACTIVITY:
        "Outcome tracking updated",
    LEARNING_DECISION_ACTIVITY:
        "Learning captured",
    REVIEW_DECISION_ACTIVITY:
        "Review date updated",
    PRIORITY_DECISION_ACTIVITY:
        "Priority updated",
    CATEGORY_DECISION_ACTIVITY:
        "Category updated",
    CONFIDENCE_DECISION_ACTIVITY:
        "Confidence updated",
}


def utc_now() -> datetime:
    return datetime.now(UTC).replace(
        tzinfo=None,
    )

# =========================
# Workspace Ownership Helpers For Personal And Shared Access
# =========================

def get_active_user_id(
    x_user_id: str,
) -> str:
    clean_user_id = str(
        x_user_id or ""
    ).strip()

    if not clean_user_id:
        raise HTTPException(
            status_code=400,
            detail="User id is required",
        )

    return clean_user_id


def get_active_workspace_id(
    x_user_id: str,
    x_workspace_id: str | None,
) -> str:
    clean_user_id = get_active_user_id(
        x_user_id
    )
    clean_workspace_id = (
        str(x_workspace_id).strip()
        if x_workspace_id is not None
        else ""
    )

    return clean_workspace_id or clean_user_id


def filter_decision_for_workspace(
    decision_id: int,
    x_user_id: str,
    x_workspace_id: str | None,
):
    clean_user_id = get_active_user_id(
        x_user_id
    )
    workspace_id = get_active_workspace_id(
        clean_user_id,
        x_workspace_id,
    )

    return and_(
        Decision.id == decision_id,
        or_(
            Decision.workspace_id == workspace_id,
            and_(
                Decision.workspace_id.is_(None),
                Decision.clerk_user_id == clean_user_id,
            ),
        ),
    )


def filter_decisions_for_workspace(
    x_user_id: str,
    x_workspace_id: str | None,
):
    clean_user_id = get_active_user_id(
        x_user_id
    )
    workspace_id = get_active_workspace_id(
        clean_user_id,
        x_workspace_id,
    )

    return and_(
        or_(
            Decision.workspace_id == workspace_id,
            and_(
                Decision.workspace_id.is_(None),
                Decision.clerk_user_id == clean_user_id,
            ),
        ),
    )


# =========================
# Workspace Activity Ownership Filter For Decision History Queries
# =========================

def filter_decision_activities_for_workspace(
    x_user_id: str,
    x_workspace_id: str | None,
):
    clean_user_id = get_active_user_id(
        x_user_id
    )
    workspace_id = get_active_workspace_id(
        clean_user_id,
        x_workspace_id,
    )

    return or_(
        DecisionActivity.workspace_id == workspace_id,
        DecisionActivity.workspace_id.is_(None),
    )


def filter_decision_activity_feed_for_workspace(
    x_user_id: str,
    x_workspace_id: str | None,
):
    return and_(
        filter_decisions_for_workspace(
            x_user_id,
            x_workspace_id,
        ),
        filter_decision_activities_for_workspace(
            x_user_id,
            x_workspace_id,
        ),
    )


def filter_dataset_for_workspace(
    dataset_id: int,
    x_user_id: str,
    x_workspace_id: str | None,
):
    clean_user_id = get_active_user_id(
        x_user_id
    )
    workspace_id = get_active_workspace_id(
        clean_user_id,
        x_workspace_id,
    )

    return and_(
        Dataset.id == dataset_id,
        or_(
            Dataset.workspace_id == workspace_id,
            and_(
                Dataset.workspace_id.is_(None),
                Dataset.user_id == clean_user_id,
            ),
        ),
    )


def get_accessible_dataset(
    db,
    dataset_id: int,
    x_user_id: str,
    x_workspace_id: str | None,
):
    return (
        db.query(Dataset)
        .filter(
            filter_dataset_for_workspace(
                dataset_id,
                x_user_id,
                x_workspace_id,
            )
        )
        .first()
    )


# =========================
# Workspace Decision Lookup Helper For Detail And Patch Routes
# =========================

def get_accessible_decision_or_404(
    db,
    decision_id: int,
    x_user_id: str,
    x_workspace_id: str | None,
):
    decision = (
        db.query(Decision)
        .filter(
            filter_decision_for_workspace(
                decision_id,
                x_user_id,
                x_workspace_id,
            )
        )
        .first()
    )

    if not decision:
        raise HTTPException(
            status_code=404,
            detail="Decision not found",
        )

    return decision


# =========================
# Archived Decision Edit Guard For Historical Record Protection
# =========================

def ensure_decision_is_editable(
    decision: Decision,
):
    if decision.status == ARCHIVED_DECISION_STATUS:
        raise HTTPException(
            status_code=400,
            detail="Restore this decision before editing it",
        )


# =========================
# Decision Activity Recording Helper For Timeline And Feed Events
# =========================

def record_decision_activity(
    db,
    decision: Decision,
    activity_type: DecisionActivityType,
    message: str,
    touch_decision_record: bool = True,
):
    if activity_type not in VALID_DECISION_ACTIVITY_TYPES:
        raise ValueError(
            f"Invalid decision activity type: {activity_type}"
        )

    if touch_decision_record:
        decision.updated_at = utc_now()

    activity = DecisionActivity(
        decision_id=decision.id,
        workspace_id=decision.workspace_id,
        activity_type=activity_type,
        message=message,
    )

    db.add(activity)

    return activity


def values_differ(
    current_value,
    next_value,
) -> bool:
    return current_value != next_value


def normalize_decision_datetime(
    value: datetime | None,
) -> datetime | None:
    if value is None:
        return None

    if (
        value.tzinfo is not None
        and value.utcoffset() is not None
    ):
        return value.astimezone(UTC).replace(
            tzinfo=None,
        )

    return value.replace(
        tzinfo=None,
    )


def get_overview_activity_type(
    changed_fields: list[DecisionActivityType],
) -> DecisionActivityType | None:
    if not changed_fields:
        return None

    if len(changed_fields) == 1:
        return changed_fields[0]

    return OVERVIEW_DECISION_ACTIVITY


# =========================
# Decision Text Validation Helpers For Create And Detail Updates
# =========================

def clean_required_decision_title(
    title: str,
) -> str:
    if not isinstance(title, str):
        raise HTTPException(
            status_code=400,
            detail="Decision title must be a string",
        )

    clean_title = title.strip()

    if not clean_title:
        raise HTTPException(
            status_code=400,
            detail="Decision title is required",
        )

    return clean_title


def clean_optional_single_line_text(
    value: str | None,
) -> str | None:
    if value is None:
        return None

    if not isinstance(value, str):
        raise HTTPException(
            status_code=400,
            detail="Decision text fields must be strings",
        )

    clean_value = value.strip()

    return clean_value or None


def clean_optional_multiline_text(
    value: str | None,
) -> str | None:
    if value is None:
        return None

    if not isinstance(value, str):
        raise HTTPException(
            status_code=400,
            detail="Decision text fields must be strings",
        )

    clean_value = value.strip()

    return clean_value or None


def clean_required_decision_expected_outcome(
    value: str | None,
) -> str:
    clean_value = clean_optional_multiline_text(
        value,
    )

    if not clean_value:
        raise HTTPException(
            status_code=400,
            detail="Expected outcome is required",
        )

    return clean_value


# =========================
# Decision Controlled Value Validators For Metrics And Filters
# =========================

def validate_decision_controlled_value(
    value: str,
    allowed_values: set[str],
    field_label: str,
) -> str:
    if not isinstance(value, str):
        raise HTTPException(
            status_code=400,
            detail=f"Decision {field_label} must be a string",
        )

    if value not in allowed_values:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid decision {field_label}",
        )

    return value


def validate_optional_decision_controlled_value(
    value: str | None,
    allowed_values: set[str],
    field_label: str,
) -> str | None:
    if value is not None and not isinstance(value, str):
        raise HTTPException(
            status_code=400,
            detail=f"Decision {field_label} must be a string",
        )

    clean_value = clean_optional_single_line_text(
        value,
    )

    if clean_value is None:
        return None

    return validate_decision_controlled_value(
        clean_value,
        allowed_values,
        field_label,
    )


# =========================
# Decision List Query Helpers For Filtering Pagination And Counts
# =========================

def apply_decision_list_filters(
    query,
    status: DecisionStatus | None,
    lifecycle: DecisionListLifecycle,
    category: DecisionCategory | None,
    attention_state: DecisionAttentionWorkflowState | None,
    outcome_state: DecisionOutcomeWorkflowState | None,
    learning_state: DecisionLearningWorkflowState | None,
    notes_state: DecisionNotesWorkflowState | None,
    review_state: DecisionReviewWorkflowState | None,
    search: str | None,
):
    if status:
        query = query.filter(
            Decision.status == status,
        )
    elif lifecycle == ACTIVE_DECISION_LIST_LIFECYCLE:
        query = query.filter(
            Decision.status != ARCHIVED_DECISION_STATUS,
        )
    elif lifecycle == ARCHIVED_DECISION_LIST_LIFECYCLE:
        query = query.filter(
            Decision.status == ARCHIVED_DECISION_STATUS,
        )

    if category:
        query = query.filter(
            Decision.category == category,
        )

    if attention_state == "required":
        query = query.filter(
            has_required_attention(
                get_decision_today_start(),
            )
        )

    if outcome_state == "planned":
        query = query.filter(
            has_meaningful_text(
                Decision.expected_outcome,
            )
        )
    elif outcome_state == "pending":
        query = query.filter(
            has_pending_outcome(),
        )
    elif outcome_state == "recorded":
        query = query.filter(
            has_recorded_outcome(),
        )
    elif outcome_state == "evaluated":
        query = query.filter(
            has_meaningful_text(
                Decision.outcome_status,
            )
        )

    if learning_state == "captured":
        query = query.filter(
            has_meaningful_text(
                Decision.lessons_learned,
            )
        )
    elif learning_state == "pending":
        query = query.filter(
            has_pending_learning(),
        )

    if notes_state == "added":
        query = query.filter(
            has_meaningful_text(
                Decision.notes,
            )
        )
    elif notes_state == "pending":
        query = query.filter(
            has_pending_notes(),
        )

    if review_state:
        today_start = get_decision_today_start()

        query = query.filter(
            is_active_decision_record(),
            Decision.review_date.isnot(None),
        )

        if review_state == "overdue":
            query = query.filter(
                Decision.review_date < today_start,
            )
        elif review_state == "upcoming":
            query = query.filter(
                Decision.review_date >= today_start,
            )

    if search and search.strip():
        search_pattern = f"%{search.strip()}%"

        query = query.filter(
            or_(
                Decision.title.ilike(search_pattern),
                Decision.description.ilike(search_pattern),
                Decision.expected_outcome.ilike(search_pattern),
                Decision.actual_outcome.ilike(search_pattern),
                Decision.status.ilike(search_pattern),
                Decision.priority.ilike(search_pattern),
                Decision.category.ilike(search_pattern),
                Decision.outcome_status.ilike(search_pattern),
            )
        )

    return query


def apply_decision_list_pagination(
    query,
    limit: int | None,
    offset: int,
):
    if offset < 0:
        raise HTTPException(
            status_code=400,
            detail="Decision list offset must be zero or greater",
        )

    if limit is not None and limit <= 0:
        raise HTTPException(
            status_code=400,
            detail="Decision list limit must be greater than zero",
        )

    if offset:
        query = query.offset(offset)

    if limit is not None:
        query = query.limit(limit)

    return query


def apply_decision_list_sort(
    query,
    sort: DecisionListSort,
):
    if sort == UPDATED_DECISION_LIST_SORT:
        return query.order_by(
            Decision.updated_at.is_(None),
            Decision.updated_at.desc(),
            Decision.created_at.desc(),
            Decision.id.desc(),
        )

    if sort == CREATED_ASC_DECISION_LIST_SORT:
        return query.order_by(
            Decision.created_at.asc(),
            Decision.id.asc(),
        )

    if sort == REVIEW_ASC_DECISION_LIST_SORT:
        return query.order_by(
            Decision.review_date.is_(None),
            Decision.review_date.asc(),
            Decision.created_at.desc(),
            Decision.id.desc(),
        )

    if sort == REVIEW_DESC_DECISION_LIST_SORT:
        return query.order_by(
            Decision.review_date.is_(None),
            Decision.review_date.desc(),
            Decision.created_at.desc(),
            Decision.id.desc(),
        )

    return query.order_by(
        Decision.created_at.desc(),
        Decision.id.desc(),
    )


# =========================
# Decision Summary Content Filters For Meaningful Text Metrics
# =========================

def has_meaningful_text(field):
    return and_(
        field.isnot(None),
        func.trim(field) != "",
    )


def has_recorded_outcome():
    return or_(
        has_meaningful_text(
            Decision.outcome_status,
        ),
        has_meaningful_text(
            Decision.actual_outcome,
        ),
    )


def has_pending_outcome():
    return and_(
        is_active_decision_record(),
        has_meaningful_text(
            Decision.expected_outcome,
        ),
        ~has_recorded_outcome(),
    )


def has_pending_learning():
    return and_(
        is_active_decision_record(),
        has_recorded_outcome(),
        ~has_meaningful_text(
            Decision.lessons_learned,
        ),
    )


def has_pending_notes():
    return and_(
        is_active_decision_record(),
        ~has_meaningful_text(
            Decision.notes,
        ),
    )


def is_active_decision_record():
    return Decision.status != ARCHIVED_DECISION_STATUS


def get_decision_today_start():
    return utc_now().replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )


def has_overdue_review(today_start):
    return and_(
        is_active_decision_record(),
        Decision.review_date.isnot(None),
        Decision.review_date < today_start,
    )


def has_required_attention(today_start):
    return or_(
        has_pending_outcome(),
        has_pending_learning(),
        has_overdue_review(today_start),
    )


def get_decision_count_map(
    db,
    x_user_id: str,
    x_workspace_id: str | None,
    field,
    allowed_values: set[str] | None = None,
    dataset_id: int | None = None,
):
    filters = [
        filter_decisions_for_workspace(
            x_user_id,
            x_workspace_id,
        ),
        has_meaningful_text(field),
    ]

    if dataset_id is not None:
        filters.append(
            Decision.dataset_id == dataset_id,
        )

    if allowed_values:
        filters.append(
            field.in_(allowed_values),
        )

    rows = (
        db.query(
            field,
            func.count(Decision.id),
        )
        .filter(*filters)
        .group_by(field)
        .all()
    )

    return {
        value: count
        for value, count in rows
    }


def get_decision_month_count_map(
    db,
    x_user_id: str,
    x_workspace_id: str | None,
    dataset_id: int | None = None,
):
    month_key = func.strftime(
        "%Y-%m",
        Decision.created_at,
    )

    filters = [
        filter_decisions_for_workspace(
            x_user_id,
            x_workspace_id,
        ),
        Decision.created_at.isnot(None),
    ]

    if dataset_id is not None:
        filters.append(
            Decision.dataset_id == dataset_id,
        )

    rows = (
        db.query(
            month_key,
            func.count(Decision.id),
        )
        .filter(*filters)
        .group_by(month_key)
        .order_by(month_key)
        .all()
    )

    return {
        value: count
        for value, count in rows
    }


# =========================
# Decision Create And List Routes
# =========================

@router.post(
    "/",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def create_decision(
    payload: DecisionCreate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()
    clean_user_id = get_active_user_id(
        x_user_id
    )

    try:
        dataset = get_accessible_dataset(
            db,
            payload.dataset_id,
            clean_user_id,
            x_workspace_id,
        )

        if not dataset:
            raise HTTPException(
                status_code=404,
                detail="Dataset not found",
            )

        clean_title = clean_required_decision_title(
            payload.title,
        )

        decision = Decision(
            clerk_user_id=clean_user_id,
            workspace_id=get_active_workspace_id(
                clean_user_id,
                x_workspace_id,
            ),
            dataset_id=payload.dataset_id,
            metric_column=clean_optional_single_line_text(
                payload.metric_column,
            ),
            recommendation_text=clean_optional_multiline_text(
                payload.recommendation_text,
            ),
            recommendation_source=validate_optional_decision_controlled_value(
                payload.recommendation_source,
                {"openai", "rules"},
                "recommendation source",
            ),
            recommendation_context=clean_optional_multiline_text(
                payload.recommendation_context,
            ),
            title=clean_title,
            description=clean_optional_single_line_text(
                payload.description,
            ),
            expected_outcome=clean_required_decision_expected_outcome(
                payload.expected_outcome,
            ),
            priority=validate_optional_decision_controlled_value(
                payload.priority,
                VALID_DECISION_PRIORITIES,
                "priority",
            ),
            category=validate_optional_decision_controlled_value(
                payload.category,
                VALID_DECISION_CATEGORIES,
                "category",
            ),
            confidence_score=validate_optional_decision_controlled_value(
                payload.confidence_score,
                VALID_DECISION_CONFIDENCE_SCORES,
                "confidence score",
            ),
            review_date=normalize_decision_datetime(
                payload.review_date,
            ),
        )

        db.add(decision)

        db.flush()

        record_decision_activity(
            db,
            decision,
            CREATED_DECISION_ACTIVITY,
            DECISION_ACTIVITY_MESSAGES[CREATED_DECISION_ACTIVITY],
            touch_decision_record=False,
        )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.get(
    "/",
    response_model=list[DecisionResponse],
)
async def get_decisions(
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
    status: DecisionStatus | None = Query(
        default=None,
    ),
    lifecycle: DecisionListLifecycle = Query(
        default=DEFAULT_DECISION_LIST_LIFECYCLE,
        pattern=DECISION_LIST_LIFECYCLE_PATTERN,
    ),
    category: DecisionCategory | None = Query(
        default=None,
    ),
    attention_state: DecisionAttentionWorkflowState | None = Query(
        default=None,
        pattern=DECISION_ATTENTION_WORKFLOW_STATE_PATTERN,
    ),
    outcome_state: DecisionOutcomeWorkflowState | None = Query(
        default=None,
        pattern=DECISION_OUTCOME_WORKFLOW_STATE_PATTERN,
    ),
    learning_state: DecisionLearningWorkflowState | None = Query(
        default=None,
        pattern=DECISION_LEARNING_WORKFLOW_STATE_PATTERN,
    ),
    notes_state: DecisionNotesWorkflowState | None = Query(
        default=None,
        pattern=DECISION_NOTES_WORKFLOW_STATE_PATTERN,
    ),
    review_state: DecisionReviewWorkflowState | None = Query(
        default=None,
        pattern=DECISION_REVIEW_WORKFLOW_STATE_PATTERN,
    ),
    search: str | None = Query(
        default=None,
    ),
    sort: DecisionListSort = Query(
        default=DEFAULT_DECISION_LIST_SORT,
        pattern=DECISION_LIST_SORT_PATTERN,
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        default=0,
        ge=0,
    ),
):
    db = SessionLocal()

    try:
        query = (
            db.query(Decision)
            .filter(
                filter_decisions_for_workspace(
                    x_user_id,
                    x_workspace_id,
                )
            )
        )

        clean_status = (
            validate_decision_controlled_value(
                status,
                VALID_DECISION_STATUSES,
                "status",
            )
            if status
            else None
        )

        clean_category = (
            validate_decision_controlled_value(
                category,
                VALID_DECISION_CATEGORIES,
                "category",
            )
            if category
            else None
        )

        clean_attention_state = (
            validate_decision_controlled_value(
                attention_state,
                VALID_DECISION_ATTENTION_WORKFLOW_STATES,
                "attention workflow state",
            )
            if attention_state
            else None
        )

        clean_outcome_state = (
            validate_decision_controlled_value(
                outcome_state,
                VALID_DECISION_OUTCOME_WORKFLOW_STATES,
                "outcome workflow state",
            )
            if outcome_state
            else None
        )

        clean_learning_state = (
            validate_decision_controlled_value(
                learning_state,
                VALID_DECISION_LEARNING_WORKFLOW_STATES,
                "learning workflow state",
            )
            if learning_state
            else None
        )

        clean_notes_state = (
            validate_decision_controlled_value(
                notes_state,
                VALID_DECISION_NOTES_WORKFLOW_STATES,
                "notes workflow state",
            )
            if notes_state
            else None
        )

        clean_review_state = (
            validate_decision_controlled_value(
                review_state,
                VALID_DECISION_REVIEW_WORKFLOW_STATES,
                "review workflow state",
            )
            if review_state
            else None
        )

        filtered_query = (
            apply_decision_list_filters(
                query,
                clean_status,
                lifecycle,
                clean_category,
                clean_attention_state,
                clean_outcome_state,
                clean_learning_state,
                clean_notes_state,
                clean_review_state,
                search,
            )
        )

        return (
            apply_decision_list_pagination(
                apply_decision_list_sort(
                    filtered_query,
                    sort,
                ),
                limit,
                offset,
            )
            .all()
        )

    finally:
        db.close()


# =========================
# Decision Summary Route For Portfolio Metrics And Counts
# =========================

@router.get(
    "/summary",
    response_model=DecisionSummaryResponse,
)
async def get_decision_summary(
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
    dataset_id: int | None = Query(
        default=None,
        ge=1,
    ),
):
    db = SessionLocal()

    try:
        base_filter = filter_decisions_for_workspace(
            x_user_id,
            x_workspace_id,
        )

        if dataset_id is not None:
            base_filter = and_(
                base_filter,
                Decision.dataset_id == dataset_id,
            )

        total = (
            db.query(Decision)
            .filter(base_filter)
            .count()
        )

        archived = (
            db.query(Decision)
            .filter(
                base_filter,
                Decision.status == ARCHIVED_DECISION_STATUS,
            )
            .count()
        )

        learning_captured = (
            db.query(Decision)
            .filter(
                base_filter,
                has_meaningful_text(
                    Decision.lessons_learned,
                ),
            )
            .count()
        )

        learning_pending = (
            db.query(Decision)
            .filter(
                base_filter,
                is_active_decision_record(),
                has_pending_learning(),
            )
            .count()
        )

        notes_added = (
            db.query(Decision)
            .filter(
                base_filter,
                has_meaningful_text(
                    Decision.notes,
                ),
            )
            .count()
        )

        notes_pending = (
            db.query(Decision)
            .filter(
                base_filter,
                has_pending_notes(),
            )
            .count()
        )

        outcomes_planned = (
            db.query(Decision)
            .filter(
                base_filter,
                has_meaningful_text(
                    Decision.expected_outcome,
                ),
            )
            .count()
        )

        outcomes_pending = (
            db.query(Decision)
            .filter(
                base_filter,
                has_pending_outcome(),
            )
            .count()
        )

        outcomes_recorded = (
            db.query(Decision)
            .filter(
                base_filter,
                has_recorded_outcome(),
            )
            .count()
        )

        outcomes_evaluated = (
            db.query(Decision)
            .filter(
                base_filter,
                has_meaningful_text(
                    Decision.outcome_status,
                ),
            )
            .count()
        )

        reviews_scheduled = (
            db.query(Decision)
            .filter(
                base_filter,
                is_active_decision_record(),
                Decision.review_date.isnot(None),
            )
            .count()
        )

        # Review summary counts use date-only urgency so decisions due today are not overdue.
        today_start = get_decision_today_start()

        reviews_overdue = (
            db.query(Decision)
            .filter(
                base_filter,
                is_active_decision_record(),
                Decision.review_date.isnot(None),
                Decision.review_date < today_start,
            )
            .count()
        )

        reviews_upcoming = (
            db.query(Decision)
            .filter(
                base_filter,
                is_active_decision_record(),
                Decision.review_date.isnot(None),
                Decision.review_date >= today_start,
            )
            .count()
        )

        attention_required = (
            db.query(Decision)
            .filter(
                base_filter,
                has_required_attention(today_start),
            )
            .count()
        )

        by_status = get_decision_count_map(
            db,
            x_user_id,
            x_workspace_id,
            Decision.status,
            VALID_DECISION_STATUSES,
            dataset_id,
        )
        by_outcome_status = get_decision_count_map(
            db,
            x_user_id,
            x_workspace_id,
            Decision.outcome_status,
            VALID_DECISION_OUTCOME_STATUSES,
            dataset_id,
        )
        by_category = get_decision_count_map(
            db,
            x_user_id,
            x_workspace_id,
            Decision.category,
            VALID_DECISION_CATEGORIES,
            dataset_id,
        )
        learning_context = build_workspace_decision_learning_context(
            db,
            x_user_id,
            get_active_workspace_id(
                x_user_id,
                x_workspace_id,
            ),
            base_filter=base_filter,
            learning_scope=(
                "dataset"
                if dataset_id is not None
                else "workspace"
            ),
        )
        learning_recommendations = []
        recorded_outcomes = learning_context.get(
            "recorded_outcome_count",
            0,
        )
        recorded_lessons = learning_context.get(
            "recorded_lesson_count",
            0,
        )
        if recorded_outcomes:
            learning_recommendations.append(
                f"Use the {recorded_outcomes} recorded decision outcome"
                f"{'s' if recorded_outcomes != 1 else ''} as evidence when shaping the next decision."
            )
        if recorded_lessons:
            learning_recommendations.append(
                f"Use the {recorded_lessons} recorded lesson"
                f"{'s' if recorded_lessons != 1 else ''} when shaping the next decision."
            )

        decision_ai_analysis = await asyncio.to_thread(
            generate_structured_analysis,
            context="decision portfolio health and recommendation",
            facts={
                "total": total,
                "active": total - archived,
                "attention_required": attention_required,
                "reviews_overdue": reviews_overdue,
                "reviews_upcoming": reviews_upcoming,
                "outcomes_evaluated": outcomes_evaluated,
                "by_outcome_status": by_outcome_status,
                "by_category": by_category,
                "historical_decision_learning": learning_context,
            },
            fallback_summary=(
                f"{attention_required} active decision"
                f"{'s' if attention_required != 1 else ''} require"
                " attention."
            ),
            fallback_recommendations=(
                [
                    "Review decisions requiring attention before creating new commitments."
                ]
                if attention_required
                else [
                    "Continue scheduled outcome reviews and capture lessons learned."
                ]
            ) + learning_recommendations,
            fallback_risks=(
                [
                    f"{reviews_overdue} decision review"
                    f"{'s are' if reviews_overdue != 1 else ' is'} overdue."
                ]
                if reviews_overdue
                else []
            ),
        )

        return DecisionSummaryResponse(
            total=total,
            active=total - archived,
            archived=archived,
            attention_required=attention_required,
            learning_captured=learning_captured,
            learning_pending=learning_pending,
            notes_added=notes_added,
            notes_pending=notes_pending,
            outcomes_planned=outcomes_planned,
            outcomes_pending=outcomes_pending,
            outcomes_recorded=outcomes_recorded,
            outcomes_evaluated=outcomes_evaluated,
            reviews_overdue=reviews_overdue,
            reviews_scheduled=reviews_scheduled,
            reviews_upcoming=reviews_upcoming,
            by_created_month=get_decision_month_count_map(
                db,
                x_user_id,
                x_workspace_id,
                dataset_id,
            ),
            by_status=by_status,
            by_outcome_status=by_outcome_status,
            by_category=by_category,
            ai_analysis=decision_ai_analysis,
        )

    finally:
        db.close()


# =========================
# Workspace Decision Activity Feed Route For Recent Changes
# =========================

@router.get(
    "/activities",
    response_model=list[DecisionActivityFeedResponse],
)
async def get_decision_activity_feed(
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        default=0,
        ge=0,
    ),
):
    db = SessionLocal()

    try:
        # Workspace activity pagination: supports scrollable feeds without changing the default first page.
        rows = (
            db.query(
                DecisionActivity,
                Decision.title,
                Decision.id,
            )
            .outerjoin(
                Decision,
                Decision.id == DecisionActivity.decision_id,
            )
            .filter(
                filter_decision_activity_feed_for_workspace(
                    x_user_id,
                    x_workspace_id,
                ),
            )
            .order_by(
                DecisionActivity.created_at.desc(),
                DecisionActivity.id.desc(),
            )
            .offset(offset)
            .limit(limit)
            .all()
        )

        return [
            DecisionActivityFeedResponse(
                id=activity.id,
                decision_id=activity.decision_id,
                workspace_id=activity.workspace_id,
                decision_title=decision_title or "Unavailable decision",
                decision_available=decision_id is not None,
                activity_type=activity.activity_type,
                message=activity.message,
                created_at=activity.created_at,
            )
            for activity, decision_title, decision_id in rows
        ]

    finally:
        db.close()


# =========================
# Basic Decision Status Patch Route For Legacy List Actions
# =========================

@router.patch(
    "/{decision_id}",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision(
    decision_id: int,
    payload: DecisionUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )

        clean_status = validate_decision_controlled_value(
            payload.status,
            VALID_DECISION_STATUSES,
            "status",
        )

        if (
            decision.status == ARCHIVED_DECISION_STATUS
            and clean_status == ARCHIVED_DECISION_STATUS
        ):
            ensure_decision_is_editable(
                decision,
            )

        changed = values_differ(
            decision.status,
            clean_status,
        )
        restored_from_archive = (
            decision.status == ARCHIVED_DECISION_STATUS
            and clean_status != ARCHIVED_DECISION_STATUS
        )
        archived_from_active = (
            decision.status != ARCHIVED_DECISION_STATUS
            and clean_status == ARCHIVED_DECISION_STATUS
        )

        decision.status = clean_status

        if changed:
            activity_type = (
                RESTORE_DECISION_ACTIVITY
                if restored_from_archive
                else ARCHIVE_DECISION_ACTIVITY
                if archived_from_active
                else STATUS_DECISION_ACTIVITY
            )

            record_decision_activity(
                db,
                decision,
                activity_type,
                DECISION_ACTIVITY_MESSAGES[activity_type],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Decision Overview Patch Route For Status Priority Category And Review Date
# =========================

@router.patch(
    "/{decision_id}/overview",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_overview(
    decision_id: int,
    payload: DecisionOverviewUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        changed_fields = []

        if payload.status is not None:
            clean_status = validate_decision_controlled_value(
                payload.status,
                VALID_DECISION_STATUSES,
                "status",
            )

            if values_differ(
                decision.status,
                clean_status,
            ):
                status_activity_type = (
                    ARCHIVE_DECISION_ACTIVITY
                    if clean_status == ARCHIVED_DECISION_STATUS
                    else STATUS_DECISION_ACTIVITY
                )
                decision.status = clean_status
                changed_fields.append(
                    status_activity_type,
                )

        if payload.priority is not None:
            clean_priority = validate_decision_controlled_value(
                payload.priority,
                VALID_DECISION_PRIORITIES,
                "priority",
            )

            if values_differ(
                decision.priority,
                clean_priority,
            ):
                decision.priority = clean_priority
                changed_fields.append(
                    PRIORITY_DECISION_ACTIVITY,
                )

        if payload.category is not None:
            clean_category = validate_decision_controlled_value(
                payload.category,
                VALID_DECISION_CATEGORIES,
                "category",
            )

            if values_differ(
                decision.category,
                clean_category,
            ):
                decision.category = clean_category
                changed_fields.append(
                    CATEGORY_DECISION_ACTIVITY,
                )

        if "confidence_score" in payload.model_fields_set:
            clean_confidence_score = validate_optional_decision_controlled_value(
                payload.confidence_score,
                VALID_DECISION_CONFIDENCE_SCORES,
                "confidence score",
            )

            if values_differ(
                decision.confidence_score,
                clean_confidence_score,
            ):
                decision.confidence_score = clean_confidence_score
                changed_fields.append(
                    CONFIDENCE_DECISION_ACTIVITY,
                )

        if (
            "review_date" in payload.model_fields_set
        ):
            clean_review_date = normalize_decision_datetime(
                payload.review_date,
            )

            if values_differ(
                decision.review_date,
                clean_review_date,
            ):
                decision.review_date = clean_review_date
                changed_fields.append(
                    REVIEW_DECISION_ACTIVITY,
                )

        activity_type = get_overview_activity_type(
            changed_fields,
        )

        if activity_type:
            activity_message = (
                DECISION_ACTIVITY_MESSAGES[activity_type]
            )

            record_decision_activity(
                db,
                decision,
                activity_type,
                activity_message,
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Decision Details Patch Route For Title And Description Edits
# =========================

@router.patch(
    "/{decision_id}/details",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_details(
    decision_id: int,
    payload: DecisionDetailsUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        changed = False

        if payload.title is not None:
            clean_title = clean_required_decision_title(
                payload.title,
            )

            if values_differ(
                decision.title,
                clean_title,
            ):
                decision.title = clean_title
                changed = True

        if "description" in payload.model_fields_set:
            clean_description = clean_optional_single_line_text(
                payload.description,
            )

            if values_differ(
                decision.description,
                clean_description,
            ):
                decision.description = clean_description
                changed = True

        if "metric_column" in payload.model_fields_set:
            clean_metric_column = clean_optional_single_line_text(
                payload.metric_column,
            )

            if values_differ(
                decision.metric_column,
                clean_metric_column,
            ):
                decision.metric_column = clean_metric_column
                changed = True

        if changed:
            record_decision_activity(
                db,
                decision,
                DETAILS_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[DETAILS_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Single Decision Activity Timeline Route For Detail Page
# =========================

@router.get(
    "/{decision_id}/activities",
    response_model=list[DecisionActivityResponse],
)
async def get_decision_activities(
    decision_id: int,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        default=0,
        ge=0,
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )

        # Decision timeline pagination: keeps long activity histories efficient on detail pages.
        return (
            db.query(DecisionActivity)
            .filter(
                DecisionActivity.decision_id == decision_id,
                filter_decision_activities_for_workspace(
                    x_user_id,
                    x_workspace_id,
                ),
            )
            .order_by(
                DecisionActivity.created_at.desc(),
                DecisionActivity.id.desc(),
            )
            .offset(offset)
            .limit(limit)
            .all()
        )

    finally:
        db.close()


# =========================
# Decision Lifecycle Routes For Archive And Restore Actions
# =========================

@router.patch(
    "/{decision_id}/archive",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def archive_decision(
    decision_id: int,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )

        changed = values_differ(
            decision.status,
            ARCHIVED_DECISION_STATUS,
        )

        decision.status = ARCHIVED_DECISION_STATUS

        if changed:
            record_decision_activity(
                db,
                decision,
                ARCHIVE_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[ARCHIVE_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


@router.patch(
    "/{decision_id}/restore",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def restore_decision(
    decision_id: int,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )

        changed = values_differ(
            decision.status,
            DEFAULT_DECISION_STATUS,
        )

        decision.status = DEFAULT_DECISION_STATUS

        if changed:
            record_decision_activity(
                db,
                decision,
                RESTORE_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[RESTORE_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Single Decision Read Route For Detail Page Loading
# =========================

@router.get(
    "/{decision_id}",
    response_model=DecisionResponse,
)
async def get_decision(
    decision_id: int,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )

        return decision

    finally:
        db.close()


# =========================
# AI Outcome Review Route For Recorded Decision Results
# =========================

@router.get(
    "/{decision_id}/outcome-analysis",
    response_model=DecisionOutcomeAnalysisResponse,
)
async def get_decision_outcome_analysis(
    request: Request,
    decision_id: int,
):
    auth_context = get_auth_context(request)
    user_id = auth_context.user_id
    workspace_id = auth_context.workspace_id
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            user_id,
            workspace_id,
        )

        expected_outcome = (
            decision.expected_outcome or ""
        ).strip()
        actual_outcome = (
            decision.actual_outcome or ""
        ).strip()

        if not expected_outcome or (
            not actual_outcome and
            not decision.outcome_status
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "An expected outcome and either actual outcome "
                    "evidence or an outcome status are required "
                    "before generating an AI outcome review"
                ),
            )

        outcome_status = (
            decision.outcome_status or "not classified"
        )
        historical_learning = build_workspace_decision_learning_context(
            db,
            user_id,
            workspace_id,
            base_filter=build_dataset_decision_learning_filter(
                decision.dataset_id,
                decision.metric_column,
            ),
            exclude_decision_id=decision.id,
            learning_scope="decision",
        )
        outcome_analysis = await asyncio.to_thread(
            generate_structured_analysis,
            context="decision outcome comparison and learning review",
            facts={
                "decision_title": decision.title,
                "category": decision.category,
                "metric_column": decision.metric_column,
                "expected_outcome": expected_outcome,
                "actual_outcome": actual_outcome,
                "outcome_status": outcome_status,
                "existing_lesson_learned": decision.lessons_learned,
                "historical_decision_learning": historical_learning,
            },
            fallback_summary=(
                f"The recorded outcome is classified as {outcome_status}. "
                "Compare the evidence with the original success criteria "
                "before closing the learning follow-up."
            ),
            fallback_recommendations=[
                "Capture the evidence that explains the gap between expected and actual results.",
                "Record one lesson learned before closing the decision follow-up.",
            ],
            fallback_risks=(
                [
                    "The outcome is unsuccessful; review the original assumptions before repeating the decision."
                ]
                if outcome_status == "unsuccessful"
                else []
            ),
        )

        return DecisionOutcomeAnalysisResponse(
            decision_id=decision.id,
            ai_analysis=outcome_analysis,
        )

    finally:
        db.close()


# =========================
# Decision Notes Patch Route For Detail Page Notes Card
# =========================

@router.patch(
    "/{decision_id}/notes",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_notes(
    decision_id: int,
    payload: DecisionNotesUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        clean_notes = clean_optional_multiline_text(
            payload.notes,
        )

        changed = values_differ(
            decision.notes,
            clean_notes,
        )

        decision.notes = clean_notes

        if changed:
            record_decision_activity(
                db,
                decision,
                NOTES_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[NOTES_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Decision Outcome Patch Route For Expected Actual And Status Fields
# =========================

@router.patch(
    "/{decision_id}/outcome",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_outcome(
    decision_id: int,
    payload: DecisionOutcomeUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        changed = False

        if "expected_outcome" in payload.model_fields_set:
            clean_expected_outcome = clean_optional_multiline_text(
                payload.expected_outcome,
            )

            if values_differ(
                decision.expected_outcome,
                clean_expected_outcome,
            ):
                decision.expected_outcome = clean_expected_outcome
                changed = True

        if "actual_outcome" in payload.model_fields_set:
            clean_actual_outcome = clean_optional_multiline_text(
                payload.actual_outcome,
            )

            if values_differ(
                decision.actual_outcome,
                clean_actual_outcome,
            ):
                decision.actual_outcome = clean_actual_outcome
                changed = True

        if "outcome_status" in payload.model_fields_set:
            clean_outcome_status = validate_optional_decision_controlled_value(
                payload.outcome_status,
                VALID_DECISION_OUTCOME_STATUSES,
                "outcome status",
            )

            if values_differ(
                decision.outcome_status,
                clean_outcome_status,
            ):
                decision.outcome_status = clean_outcome_status
                changed = True

        if changed:
            record_decision_activity(
                db,
                decision,
                OUTCOME_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[OUTCOME_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Decision Learning Patch Route For Lessons Learned Field
# =========================

@router.patch(
    "/{decision_id}/learning",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_learning(
    decision_id: int,
    payload: DecisionLearningUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        clean_lessons_learned = clean_optional_multiline_text(
            payload.lessons_learned,
        )

        changed = values_differ(
            decision.lessons_learned,
            clean_lessons_learned,
        )

        decision.lessons_learned = clean_lessons_learned

        if changed:
            record_decision_activity(
                db,
                decision,
                LEARNING_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[LEARNING_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Legacy Single Field Routes Kept For Backward Compatibility
# =========================

# =========================
# Legacy Review Date Patch Route Kept For Older Review UI Calls
# =========================

@router.patch(
    "/{decision_id}/review-date",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_review_date(
    decision_id: int,
    payload: DecisionReviewUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        clean_review_date = normalize_decision_datetime(
            payload.review_date,
        )

        changed = values_differ(
            decision.review_date,
            clean_review_date,
        )

        decision.review_date = clean_review_date

        if changed:
            record_decision_activity(
                db,
                decision,
                REVIEW_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[REVIEW_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Legacy Priority Patch Route Kept For Older Priority UI Calls
# =========================

@router.patch(
    "/{decision_id}/priority",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_priority(
    decision_id: int,
    payload: DecisionPriorityUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        clean_priority = validate_decision_controlled_value(
            payload.priority,
            VALID_DECISION_PRIORITIES,
            "priority",
        )

        changed = values_differ(
            decision.priority,
            clean_priority,
        )

        decision.priority = clean_priority

        if changed:
            record_decision_activity(
                db,
                decision,
                PRIORITY_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[PRIORITY_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Legacy Category Patch Route Kept For Older Category UI Calls
# =========================

@router.patch(
    "/{decision_id}/category",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_category(
    decision_id: int,
    payload: DecisionCategoryUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        clean_category = validate_decision_controlled_value(
            payload.category,
            VALID_DECISION_CATEGORIES,
            "category",
        )

        changed = values_differ(
            decision.category,
            clean_category,
        )

        decision.category = clean_category

        if changed:
            record_decision_activity(
                db,
                decision,
                CATEGORY_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[CATEGORY_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Legacy Confidence Patch Route Kept For Older Confidence UI Calls
# =========================

@router.patch(
    "/{decision_id}/confidence",
    dependencies=[Depends(require_decision_manager)],
    response_model=DecisionResponse,
)
async def update_decision_confidence(
    decision_id: int,
    payload: DecisionConfidenceUpdate,
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
):
    db = SessionLocal()

    try:
        decision = get_accessible_decision_or_404(
            db,
            decision_id,
            x_user_id,
            x_workspace_id,
        )
        ensure_decision_is_editable(
            decision,
        )

        clean_confidence_score = validate_optional_decision_controlled_value(
            payload.confidence_score,
            VALID_DECISION_CONFIDENCE_SCORES,
            "confidence score",
        )

        changed = values_differ(
            decision.confidence_score,
            clean_confidence_score,
        )

        decision.confidence_score = (
            clean_confidence_score
        )

        if changed:
            record_decision_activity(
                db,
                decision,
                CONFIDENCE_DECISION_ACTIVITY,
                DECISION_ACTIVITY_MESSAGES[CONFIDENCE_DECISION_ACTIVITY],
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()
