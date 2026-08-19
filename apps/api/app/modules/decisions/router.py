import asyncio
import csv
import io
import json

from app.configuration import get_runtime_configuration
from app.db.database import SessionLocal
from app.db.models import (
    Dataset,
    Organization,
    OrganizationMember,
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
    DELETE_DECISION_ACTIVITY,
    EXPORT_DECISION_ACTIVITY,
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
    DecisionTemplateResponse,
    DecisionReviewUpdate,
    DecisionSummaryResponse,
    DecisionUpdate,
    DecisionNotesUpdate,
    DecisionOutcomeUpdate,
    DecisionOutcomeAnalysisResponse,
    DecisionLearningUpdate,
    DecisionLifecycleAccessResponse,
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
    Response,
)
from sqlalchemy import and_, extract, func, or_

from app.modules.auth_context import (
    get_auth_context,
)
from app.modules.identity.service import (
    resolve_user_reference,
    resolve_workspace_reference,
)
from app.modules.decisions.templates import (
    list_decision_templates,
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
    DELETE_DECISION_ACTIVITY:
        "Decision deleted",
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

    try:
        return resolve_user_reference(
            clean_user_id,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


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

    return resolve_workspace_reference(
        clean_workspace_id,
        clean_user_id,
        external_subject=x_user_id,
    )


def filter_decision_for_workspace(
    decision_id: int,
    x_user_id: str,
    x_workspace_id: str | None,
):
    clean_user_id = get_active_user_id(
        x_user_id
    )
    workspace_id = get_active_workspace_id(
        x_user_id,
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
        x_user_id,
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
        x_user_id,
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
    clean_user_id = get_active_user_id(
        x_user_id
    )
    workspace_id = get_active_workspace_id(
        x_user_id,
        x_workspace_id,
    )

    return and_(
        filter_decision_activities_for_workspace(
            x_user_id,
            x_workspace_id,
        ),
        or_(
            filter_decisions_for_workspace(
                x_user_id,
                x_workspace_id,
            ),
            and_(
                Decision.id.is_(None),
                DecisionActivity.workspace_id == workspace_id,
            ),
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
        x_user_id,
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


def is_workspace_owner(
    db,
    request: Request,
) -> bool:
    auth_context = get_auth_context(request)
    organization = (
        db.query(Organization)
        .filter(
            Organization.owner_user_id == auth_context.workspace_id,
        )
        .first()
    )

    if not organization:
        return auth_context.workspace_id == auth_context.user_id

    if organization.owner_user_id == auth_context.user_id:
        return True

    membership = (
        db.query(OrganizationMember)
        .filter(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.clerk_user_id == auth_context.user_id,
        )
        .first()
    )

    if membership and membership.role == "owner":
        return True

    # Client workspace owners use the client role so they remain client-scoped.
    return bool(
        ":client:" in str(organization.owner_user_id or "")
        and membership
        and membership.role == "client"
    )


def require_decision_owner_or_workspace_owner(
    db,
    decision: Decision,
    request: Request,
):
    auth_context = get_auth_context(request)
    if auth_context.workspace_role == "managed_client":
        raise HTTPException(
            status_code=403,
            detail="Agency owners cannot archive or delete client decisions",
        )

    current_user_ids = {
        str(auth_context.external_user_id or "").strip(),
        str(auth_context.user_id or "").strip(),
    }
    if str(decision.clerk_user_id or "").strip() in current_user_ids:
        return

    if is_workspace_owner(db, request):
        return

    raise HTTPException(
        status_code=403,
        detail=(
            "Only the decision owner or workspace owner can archive or "
            "delete this decision"
        ),
    )


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
    actor_user_id: str | None = None,
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
        actor_user_id=actor_user_id,
        decision_title=decision.title,
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


def validate_decision_outcome_evidence(
    expected_outcome: str | None,
    actual_outcome: str | None,
    outcome_status: str | None,
):
    if (actual_outcome or outcome_status) and not expected_outcome:
        raise HTTPException(
            status_code=400,
            detail=(
                "Expected outcome is required before recording "
                "actual outcome or status"
            ),
        )


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


def validate_recommendation_source(value: str | None) -> str | None:
    clean_value = clean_optional_single_line_text(value)
    if clean_value is None:
        return None

    allowed_values = {"rules"}
    configured_provider = get_runtime_configuration().ai_provider
    if configured_provider:
        allowed_values.add(configured_provider)

    return validate_decision_controlled_value(
        clean_value,
        allowed_values,
        "recommendation source",
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
            has_evaluated_outcome(),
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
                Decision.action.ilike(search_pattern),
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
    return and_(
        has_meaningful_text(
            Decision.expected_outcome,
        ),
        or_(
            has_meaningful_text(
                Decision.outcome_status,
            ),
            has_meaningful_text(
                Decision.actual_outcome,
            ),
        ),
    )


def has_evaluated_outcome():
    return and_(
        has_meaningful_text(
            Decision.expected_outcome,
        ),
        has_meaningful_text(
            Decision.outcome_status,
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
    additional_filter=None,
    owner_user_ids: set[str] | None = None,
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

    if owner_user_ids:
        filters.append(
            Decision.clerk_user_id.in_(owner_user_ids),
        )

    if additional_filter is not None:
        filters.append(additional_filter)

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
    owner_user_ids: set[str] | None = None,
):
    year_key = extract(
        "year",
        Decision.created_at,
    )
    month_key = extract(
        "month",
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

    if owner_user_ids:
        filters.append(
            Decision.clerk_user_id.in_(owner_user_ids),
        )

    rows = (
        db.query(
            year_key,
            month_key,
            func.count(Decision.id),
        )
        .filter(*filters)
        .group_by(year_key, month_key)
        .order_by(year_key, month_key)
        .all()
    )

    return {
        f"{int(year):04d}-{int(month):02d}": count
        for year, month, count in rows
    }


# =========================
# Decision Create And List Routes
# =========================

@router.get(
    "/templates",
    response_model=list[DecisionTemplateResponse],
)
async def get_decision_templates():
    return list_decision_templates()

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
            x_user_id,
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
                x_user_id,
                x_workspace_id,
            ),
            dataset_id=payload.dataset_id,
            metric_column=clean_optional_single_line_text(
                payload.metric_column,
            ),
            recommendation_text=clean_optional_multiline_text(
                payload.recommendation_text,
            ),
            recommendation_source=validate_recommendation_source(
                payload.recommendation_source,
            ),
            recommendation_context=clean_optional_multiline_text(
                payload.recommendation_context,
            ),
            title=clean_title,
            action=clean_optional_multiline_text(
                payload.action,
            ) or clean_optional_multiline_text(
                payload.recommendation_text,
            ) or clean_title,
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
            actor_user_id=x_user_id,
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
    mine: bool = Query(
        default=False,
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

        if mine:
            owner_user_ids = {
                get_active_user_id(x_user_id),
                str(x_user_id).strip(),
            }
            query = query.filter(
                Decision.clerk_user_id.in_(owner_user_ids),
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
# Decision Portfolio Export For Filtered CSV And JSON Records
# =========================

@router.get("/export")
async def export_decisions(
    request: Request,
    format: str = Query(
        default="csv",
        pattern="^(csv|json)$",
    ),
    x_user_id: str = Header(alias="X-User-Id"),
    x_workspace_id: str | None = Header(
        default=None,
        alias="X-Workspace-Id",
    ),
    status: DecisionStatus | None = Query(default=None),
    lifecycle: DecisionListLifecycle = Query(
        default=DEFAULT_DECISION_LIST_LIFECYCLE,
        pattern=DECISION_LIST_LIFECYCLE_PATTERN,
    ),
    category: DecisionCategory | None = Query(default=None),
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
    mine: bool = Query(default=False),
    search: str | None = Query(default=None),
    sort: DecisionListSort = Query(
        default=DEFAULT_DECISION_LIST_SORT,
        pattern=DECISION_LIST_SORT_PATTERN,
    ),
):
    if get_auth_context(request).workspace_role not in {
        "owner",
        "client",
    }:
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners can export decisions",
        )

    decisions = await get_decisions(
        x_user_id=x_user_id,
        x_workspace_id=x_workspace_id,
        status=status,
        lifecycle=lifecycle,
        category=category,
        attention_state=attention_state,
        outcome_state=outcome_state,
        learning_state=learning_state,
        notes_state=notes_state,
        review_state=review_state,
        mine=mine,
        search=search,
        sort=sort,
        limit=None,
        offset=0,
    )

    db = SessionLocal()
    try:
        decision_ids = [decision.id for decision in decisions]
        activities_by_decision: dict[int, list[dict]] = {
            decision_id: []
            for decision_id in decision_ids
        }
        if decision_ids:
            activities = (
                db.query(DecisionActivity)
                .filter(
                    DecisionActivity.decision_id.in_(decision_ids),
                    filter_decision_activities_for_workspace(
                        x_user_id,
                        x_workspace_id,
                    ),
                )
                .order_by(
                    DecisionActivity.created_at.asc(),
                    DecisionActivity.id.asc(),
                )
                .all()
            )
            for activity in activities:
                if activity.decision_id in activities_by_decision:
                    activities_by_decision[activity.decision_id].append({
                        "id": activity.id,
                        "actor_user_id": activity.actor_user_id,
                        "activity_type": activity.activity_type,
                        "message": activity.message,
                        "created_at": (
                            activity.created_at.isoformat()
                            if activity.created_at
                            else None
                        ),
                    })

        export_rows = []
        for decision in decisions:
            export_rows.append({
                "id": decision.id,
                "workspace_id": decision.workspace_id,
                "owner_user_id": decision.owner_user_id,
                "dataset_id": decision.dataset_id,
                "metric_column": decision.metric_column,
                "recommendation_text": decision.recommendation_text,
                "recommendation_source": decision.recommendation_source,
                "recommendation_context": decision.recommendation_context,
                "title": decision.title,
                "action": decision.action,
                "description": decision.description,
                "notes": decision.notes,
                "expected_outcome": decision.expected_outcome,
                "actual_outcome": decision.actual_outcome,
                "outcome_status": decision.outcome_status,
                "lessons_learned": decision.lessons_learned,
                "review_date": (
                    decision.review_date.isoformat()
                    if decision.review_date
                    else None
                ),
                "priority": decision.priority,
                "category": decision.category,
                "confidence_score": decision.confidence_score,
                "status": decision.status,
                "created_at": (
                    decision.created_at.isoformat()
                    if decision.created_at
                    else None
                ),
                "updated_at": (
                    decision.updated_at.isoformat()
                    if decision.updated_at
                    else None
                ),
                "activity_history": activities_by_decision.get(
                    decision.id,
                    [],
                ),
            })

        db.add(
            DecisionActivity(
                decision_id=None,
                workspace_id=get_active_workspace_id(
                    x_user_id,
                    x_workspace_id,
                ),
                actor_user_id=x_user_id,
                decision_title="Decision portfolio export",
                activity_type=EXPORT_DECISION_ACTIVITY,
                message=(
                    f"Decision portfolio exported as {format.upper()}"
                ),
            )
        )
        db.commit()

        clean_format = format.lower()
        headers = {
            "Content-Disposition": (
                f'attachment; filename="decisionate-decisions.{clean_format}"'
            )
        }
        if clean_format == "json":
            return Response(
                content=json.dumps(
                    export_rows,
                    ensure_ascii=False,
                ),
                media_type="application/json",
                headers=headers,
            )

        csv_buffer = io.StringIO(newline="")
        fieldnames = [
            key
            for key in export_rows[0].keys()
            if key != "activity_history"
        ] if export_rows else [
            "id",
            "workspace_id",
            "owner_user_id",
            "dataset_id",
            "metric_column",
            "recommendation_text",
            "recommendation_source",
            "recommendation_context",
            "title",
            "action",
            "description",
            "notes",
            "expected_outcome",
            "actual_outcome",
            "outcome_status",
            "lessons_learned",
            "review_date",
            "priority",
            "category",
            "confidence_score",
            "status",
            "created_at",
            "updated_at",
        ]
        fieldnames.append("activity_history_json")
        writer = csv.DictWriter(
            csv_buffer,
            fieldnames=fieldnames,
            extrasaction="ignore",
        )
        writer.writeheader()
        for row in export_rows:
            csv_row = dict(row)
            csv_row["activity_history_json"] = json.dumps(
                csv_row.pop("activity_history"),
                ensure_ascii=False,
            )
            writer.writerow(csv_row)

        return Response(
            content=csv_buffer.getvalue(),
            media_type="text/csv",
            headers=headers,
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
    mine: bool = Query(
        default=False,
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

        owner_user_ids = None
        if mine:
            owner_user_ids = {
                get_active_user_id(x_user_id),
                str(x_user_id).strip(),
            }
            base_filter = and_(
                base_filter,
                Decision.clerk_user_id.in_(owner_user_ids),
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
                has_evaluated_outcome(),
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
            owner_user_ids=owner_user_ids,
        )
        by_outcome_status = get_decision_count_map(
            db,
            x_user_id,
            x_workspace_id,
            Decision.outcome_status,
            VALID_DECISION_OUTCOME_STATUSES,
            dataset_id,
            additional_filter=has_recorded_outcome(),
            owner_user_ids=owner_user_ids,
        )
        by_category = get_decision_count_map(
            db,
            x_user_id,
            x_workspace_id,
            Decision.category,
            VALID_DECISION_CATEGORIES,
            dataset_id,
            owner_user_ids=owner_user_ids,
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
            workspace_id=x_workspace_id or x_user_id,
            actor_user_id=x_user_id,
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
                owner_user_ids=owner_user_ids,
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
                DecisionActivity.decision_title,
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
                actor_user_id=activity.actor_user_id,
                decision_title=(
                    decision_title
                    or activity_title
                    or "Unavailable decision"
                ),
                decision_available=decision_id is not None,
                activity_type=activity.activity_type,
                message=activity.message,
                created_at=activity.created_at,
            )
            for (
                activity,
                decision_title,
                activity_title,
                decision_id,
            ) in rows
        ]

    finally:
        db.close()


# =========================
# Basic Decision Status Patch Route For Legacy List Actions
# =========================

@router.patch(
    "/{decision_id}",
    response_model=DecisionResponse,
)
async def update_decision(
    decision_id: int,
    payload: DecisionUpdate,
    request: Request,
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

        archived_from_active = (
            decision.status != ARCHIVED_DECISION_STATUS
            and clean_status == ARCHIVED_DECISION_STATUS
        )
        if archived_from_active:
            require_decision_owner_or_workspace_owner(
                db,
                decision,
                request,
            )
        else:
            require_decision_manager(request)

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
                actor_user_id=x_user_id,
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
    request: Request,
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
                if clean_status == ARCHIVED_DECISION_STATUS:
                    require_decision_owner_or_workspace_owner(
                        db,
                        decision,
                        request,
                    )
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
                actor_user_id=x_user_id,
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

        if "action" in payload.model_fields_set:
            clean_action = clean_optional_multiline_text(
                payload.action,
            )

            if values_differ(
                decision.action,
                clean_action,
            ):
                decision.action = clean_action
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
                actor_user_id=x_user_id,
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
    response_model=DecisionResponse,
)
async def archive_decision(
    decision_id: int,
    request: Request,
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
        require_decision_owner_or_workspace_owner(
            db,
            decision,
            request,
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
                actor_user_id=x_user_id,
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
                actor_user_id=x_user_id,
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()


# =========================
# Archived Decision Destructive Delete Route
# =========================

@router.delete(
    "/{decision_id}",
    status_code=204,
)
async def delete_decision(
    decision_id: int,
    request: Request,
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
        require_decision_owner_or_workspace_owner(
            db,
            decision,
            request,
        )

        if decision.status != ARCHIVED_DECISION_STATUS:
            raise HTTPException(
                status_code=400,
                detail="Archive the decision before deleting it",
            )

        db.query(DecisionActivity).filter(
            DecisionActivity.decision_id == decision.id,
        ).update(
            {
                "decision_title": decision.title,
            },
            synchronize_session=False,
        )
        record_decision_activity(
            db,
            decision,
            DELETE_DECISION_ACTIVITY,
            DECISION_ACTIVITY_MESSAGES[DELETE_DECISION_ACTIVITY],
            actor_user_id=x_user_id,
            touch_decision_record=False,
        )

        # Preserve the audit trail after the decision is removed. The activity
        # rows retain their title, workspace, actor, and message, but no longer
        # point at a deleted decision.
        db.flush()
        db.query(DecisionActivity).filter(
            DecisionActivity.decision_id == decision.id,
        ).update(
            {"decision_id": None},
            synchronize_session=False,
        )
        db.delete(decision)
        db.commit()

        return Response(status_code=204)

    finally:
        db.close()


@router.get(
    "/{decision_id}/lifecycle-access",
    response_model=DecisionLifecycleAccessResponse,
)
async def get_decision_lifecycle_access(
    decision_id: int,
    request: Request,
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
        auth_context = get_auth_context(request)
        current_user_ids = {
            str(auth_context.external_user_id or "").strip(),
            str(auth_context.user_id or "").strip(),
        }
        is_decision_owner = (
            str(decision.clerk_user_id or "").strip()
            in current_user_ids
        )
        is_owner = is_workspace_owner(db, request)
        can_manage_lifecycle = (
            auth_context.workspace_role != "managed_client"
            and (is_decision_owner or is_owner)
        )

        return DecisionLifecycleAccessResponse(
            owner_user_id=str(decision.clerk_user_id),
            is_decision_owner=is_decision_owner,
            is_workspace_owner=is_owner,
            can_archive=can_manage_lifecycle,
            can_delete=can_manage_lifecycle,
        )
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
    metric_column: str | None = Query(
        default=None,
        max_length=120,
    ),
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
        selected_metric = (
            clean_optional_single_line_text(
                metric_column,
            )
            if metric_column is not None
            else decision.metric_column
        )
        recommendation_text = (
            decision.recommendation_text or ""
        ).strip()
        recommendation_context = (
            decision.recommendation_context or ""
        ).strip()
        recommendation_source = (
            decision.recommendation_source or ""
        ).strip()
        historical_learning = build_workspace_decision_learning_context(
            db,
            user_id,
            workspace_id,
            base_filter=build_dataset_decision_learning_filter(
                decision.dataset_id,
                selected_metric,
            ),
            exclude_decision_id=decision.id,
            learning_scope=(
                "metric"
                if selected_metric
                else "dataset"
            ),
        )
        fallback_recommendations = [
            "Capture the evidence that explains the gap between expected and actual results.",
            "Record one lesson learned before closing the decision follow-up.",
        ]
        if recommendation_text:
            fallback_recommendations.insert(
                0,
                "Compare the recorded result with the original recommendation before deciding whether to repeat, revise, or retire it.",
            )
        if selected_metric:
            fallback_recommendations.insert(
                0,
                f"Review the expected and actual outcome specifically for the selected metric: {selected_metric}.",
            )
        outcome_analysis = await asyncio.to_thread(
            generate_structured_analysis,
            context="decision outcome comparison and learning review",
            facts={
                "decision_title": decision.title,
                "action": decision.action,
                "category": decision.category,
                "metric_column": selected_metric,
                "recommendation": recommendation_text,
                "recommendation_context": recommendation_context,
                "recommendation_source": recommendation_source,
                "expected_outcome": expected_outcome,
                "actual_outcome": actual_outcome,
                "outcome_status": outcome_status,
                "existing_lesson_learned": decision.lessons_learned,
                "historical_decision_learning": historical_learning,
            },
            fallback_summary=(
                f"The recorded outcome for {selected_metric or 'the selected metric'} "
                f"is classified as {outcome_status}. "
                "Compare the evidence with the original success criteria "
                "before closing the learning follow-up."
            ),
            fallback_recommendations=fallback_recommendations,
            fallback_risks=(
                [
                    "The outcome is unsuccessful; review the original assumptions before repeating the decision."
                ]
                if outcome_status == "unsuccessful"
                else []
            ),
            workspace_id=workspace_id,
            actor_user_id=user_id,
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
                actor_user_id=x_user_id,
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
        clean_expected_outcome = clean_optional_multiline_text(
            decision.expected_outcome,
        )
        clean_actual_outcome = clean_optional_multiline_text(
            decision.actual_outcome,
        )
        clean_outcome_status = validate_optional_decision_controlled_value(
            decision.outcome_status,
            VALID_DECISION_OUTCOME_STATUSES,
            "outcome status",
        )

        if "expected_outcome" in payload.model_fields_set:
            clean_expected_outcome = clean_optional_multiline_text(
                payload.expected_outcome,
            )

        if "actual_outcome" in payload.model_fields_set:
            clean_actual_outcome = clean_optional_multiline_text(
                payload.actual_outcome,
            )

        if "outcome_status" in payload.model_fields_set:
            clean_outcome_status = validate_optional_decision_controlled_value(
                payload.outcome_status,
                VALID_DECISION_OUTCOME_STATUSES,
                "outcome status",
            )

        validate_decision_outcome_evidence(
            clean_expected_outcome,
            clean_actual_outcome,
            clean_outcome_status,
        )

        if values_differ(
            decision.expected_outcome,
            clean_expected_outcome,
        ):
            decision.expected_outcome = clean_expected_outcome
            changed = True

        if values_differ(
            decision.actual_outcome,
            clean_actual_outcome,
        ):
            decision.actual_outcome = clean_actual_outcome
            changed = True

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
                actor_user_id=x_user_id,
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
                actor_user_id=x_user_id,
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
                actor_user_id=x_user_id,
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
                actor_user_id=x_user_id,
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
                actor_user_id=x_user_id,
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
                actor_user_id=x_user_id,
            )

        db.commit()

        db.refresh(decision)

        return decision

    finally:
        db.close()
