from datetime import datetime
from re import escape
from typing import Literal
from typing import get_args

from pydantic import BaseModel

from app.modules.ai.schemas import AIAnalysis


DecisionStatus = Literal[
    "planned",
    "in_progress",
    "completed",
    "cancelled",
    "archived",
]

DecisionPriority = Literal[
    "high",
    "medium",
    "low",
]

DecisionCategory = Literal[
    "general",
    "marketing",
    "sales",
    "operations",
    "finance",
    "hiring",
    "product",
]

DecisionOutcomeStatus = Literal[
    "successful",
    "partially_successful",
    "unsuccessful",
]

DecisionConfidenceScore = Literal[
    "high",
    "medium",
    "low",
]

AIAnalysisSource = Literal[
    "openai",
    "rules",
]

DecisionActivityType = Literal[
    "created",
    "status",
    "archive",
    "restore",
    "overview",
    "details",
    "notes",
    "outcome",
    "learning",
    "review",
    "priority",
    "category",
    "confidence",
]

DecisionListLifecycle = Literal[
    "all",
    "active",
    "archived",
]

DecisionAttentionWorkflowState = Literal[
    "required",
]

DecisionOutcomeWorkflowState = Literal[
    "planned",
    "pending",
    "recorded",
    "evaluated",
]

DecisionLearningWorkflowState = Literal[
    "captured",
    "pending",
]

DecisionNotesWorkflowState = Literal[
    "added",
    "pending",
]

DecisionReviewWorkflowState = Literal[
    "scheduled",
    "overdue",
    "upcoming",
]

DecisionListSort = Literal[
    "created_desc",
    "created_asc",
    "updated_desc",
    "review_asc",
    "review_desc",
]


def build_literal_pattern(
    literal_type,
) -> str:
    escaped_values = [
        escape(value)
        for value in get_args(literal_type)
    ]

    return f"^({'|'.join(escaped_values)})$"


VALID_DECISION_STATUSES = set(
    get_args(DecisionStatus)
)

VALID_DECISION_PRIORITIES = set(
    get_args(DecisionPriority)
)

VALID_DECISION_CATEGORIES = set(
    get_args(DecisionCategory)
)

VALID_DECISION_OUTCOME_STATUSES = set(
    get_args(DecisionOutcomeStatus)
)

VALID_DECISION_CONFIDENCE_SCORES = set(
    get_args(DecisionConfidenceScore)
)

VALID_DECISION_ACTIVITY_TYPES = set(
    get_args(DecisionActivityType)
)

VALID_DECISION_LIST_LIFECYCLES = set(
    get_args(DecisionListLifecycle)
)

VALID_DECISION_ATTENTION_WORKFLOW_STATES = set(
    get_args(DecisionAttentionWorkflowState)
)

VALID_DECISION_OUTCOME_WORKFLOW_STATES = set(
    get_args(DecisionOutcomeWorkflowState)
)

VALID_DECISION_LEARNING_WORKFLOW_STATES = set(
    get_args(DecisionLearningWorkflowState)
)

VALID_DECISION_NOTES_WORKFLOW_STATES = set(
    get_args(DecisionNotesWorkflowState)
)

VALID_DECISION_REVIEW_WORKFLOW_STATES = set(
    get_args(DecisionReviewWorkflowState)
)

VALID_DECISION_LIST_SORTS = set(
    get_args(DecisionListSort)
)

DEFAULT_DECISION_STATUS: DecisionStatus = "planned"
ARCHIVED_DECISION_STATUS: DecisionStatus = "archived"
DEFAULT_DECISION_PRIORITY: DecisionPriority = "medium"
DEFAULT_DECISION_CATEGORY: DecisionCategory = "general"
HIGH_DECISION_CONFIDENCE: DecisionConfidenceScore = "high"
MEDIUM_DECISION_CONFIDENCE: DecisionConfidenceScore = "medium"
LOW_DECISION_CONFIDENCE: DecisionConfidenceScore = "low"
DEFAULT_DECISION_LIST_LIFECYCLE: DecisionListLifecycle = "all"
ACTIVE_DECISION_LIST_LIFECYCLE: DecisionListLifecycle = "active"
ARCHIVED_DECISION_LIST_LIFECYCLE: DecisionListLifecycle = "archived"
DEFAULT_DECISION_LIST_SORT: DecisionListSort = "created_desc"
UPDATED_DECISION_LIST_SORT: DecisionListSort = "updated_desc"
CREATED_ASC_DECISION_LIST_SORT: DecisionListSort = "created_asc"
REVIEW_ASC_DECISION_LIST_SORT: DecisionListSort = "review_asc"
REVIEW_DESC_DECISION_LIST_SORT: DecisionListSort = "review_desc"
CREATED_DECISION_ACTIVITY: DecisionActivityType = "created"
STATUS_DECISION_ACTIVITY: DecisionActivityType = "status"
ARCHIVE_DECISION_ACTIVITY: DecisionActivityType = "archive"
RESTORE_DECISION_ACTIVITY: DecisionActivityType = "restore"
OVERVIEW_DECISION_ACTIVITY: DecisionActivityType = "overview"
DETAILS_DECISION_ACTIVITY: DecisionActivityType = "details"
NOTES_DECISION_ACTIVITY: DecisionActivityType = "notes"
OUTCOME_DECISION_ACTIVITY: DecisionActivityType = "outcome"
LEARNING_DECISION_ACTIVITY: DecisionActivityType = "learning"
REVIEW_DECISION_ACTIVITY: DecisionActivityType = "review"
PRIORITY_DECISION_ACTIVITY: DecisionActivityType = "priority"
CATEGORY_DECISION_ACTIVITY: DecisionActivityType = "category"
CONFIDENCE_DECISION_ACTIVITY: DecisionActivityType = "confidence"
DECISION_LIST_LIFECYCLE_PATTERN = build_literal_pattern(
    DecisionListLifecycle
)
DECISION_ATTENTION_WORKFLOW_STATE_PATTERN = build_literal_pattern(
    DecisionAttentionWorkflowState
)
DECISION_OUTCOME_WORKFLOW_STATE_PATTERN = build_literal_pattern(
    DecisionOutcomeWorkflowState
)
DECISION_LEARNING_WORKFLOW_STATE_PATTERN = build_literal_pattern(
    DecisionLearningWorkflowState
)
DECISION_NOTES_WORKFLOW_STATE_PATTERN = build_literal_pattern(
    DecisionNotesWorkflowState
)
DECISION_REVIEW_WORKFLOW_STATE_PATTERN = build_literal_pattern(
    DecisionReviewWorkflowState
)
DECISION_LIST_SORT_PATTERN = build_literal_pattern(
    DecisionListSort
)


# =========================
# Decision Create And Basic Status Update Request Schemas
# =========================

class DecisionCreate(BaseModel):
    dataset_id: int
    metric_column: str | None = None
    title: str
    description: str | None = None
    expected_outcome: str | None = None
    priority: DecisionPriority | None = None
    category: DecisionCategory | None = None
    confidence_score: DecisionConfidenceScore | None = None
    review_date: datetime | None = None


class DecisionUpdate(BaseModel):
    status: DecisionStatus


# =========================
# Decision Detail Page Consolidated Edit Request Schemas
# =========================

class DecisionOverviewUpdate(BaseModel):
    status: DecisionStatus | None = None
    priority: DecisionPriority | None = None
    category: DecisionCategory | None = None
    confidence_score: DecisionConfidenceScore | None = None
    review_date: datetime | None = None


class DecisionDetailsUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    metric_column: str | None = None


# =========================
# Decision Record Response Schema Returned To Frontend Pages
# =========================

class DecisionResponse(BaseModel):
    id: int
    workspace_id: str | None = None
    dataset_id: int
    metric_column: str | None = None
    title: str
    description: str | None
    notes: str | None
    expected_outcome: str | None
    actual_outcome: str | None
    outcome_status: DecisionOutcomeStatus | None
    lessons_learned: str | None
    review_date: datetime | None
    priority: DecisionPriority | None
    category: DecisionCategory | None
    confidence_score: DecisionConfidenceScore | None = None
    status: DecisionStatus
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


# =========================
# Decision Detail Timeline And Workspace Activity Feed Schemas
# =========================

class DecisionActivityResponse(BaseModel):
    id: int
    decision_id: int
    workspace_id: str | None = None
    activity_type: DecisionActivityType
    message: str
    created_at: datetime

    class Config:
        from_attributes = True


class DecisionActivityFeedResponse(BaseModel):
    id: int
    decision_id: int
    workspace_id: str | None = None
    decision_title: str
    decision_available: bool = True
    activity_type: DecisionActivityType
    message: str
    created_at: datetime


# =========================
# Decision Portfolio Summary Metrics Response Schema
# =========================

class DecisionAIAnalysis(AIAnalysis):
    pass


class DecisionOutcomeAnalysisResponse(BaseModel):
    decision_id: int
    ai_analysis: DecisionAIAnalysis


class DecisionSummaryResponse(BaseModel):
    total: int
    active: int
    archived: int
    attention_required: int
    learning_captured: int
    learning_pending: int
    notes_added: int
    notes_pending: int
    outcomes_planned: int
    outcomes_pending: int
    outcomes_recorded: int
    outcomes_evaluated: int
    reviews_overdue: int
    reviews_scheduled: int
    reviews_upcoming: int
    by_created_month: dict[str, int]
    by_status: dict[str, int]
    by_outcome_status: dict[str, int]
    by_category: dict[str, int]
    ai_analysis: DecisionAIAnalysis | None = None


# =========================
# Decision Notes Outcome Learning And Legacy Field Request Schemas
# =========================

class DecisionNotesUpdate(BaseModel):
    notes: str | None = None


class DecisionOutcomeUpdate(BaseModel):
    expected_outcome: str | None = None

    actual_outcome: str | None = None

    outcome_status: DecisionOutcomeStatus | None = None


class DecisionLearningUpdate(BaseModel):
    lessons_learned: str | None = None


class DecisionReviewUpdate(BaseModel):
    review_date: datetime | None = None


class DecisionPriorityUpdate(BaseModel):
    priority: DecisionPriority


class DecisionCategoryUpdate(BaseModel):
    category: DecisionCategory


class DecisionConfidenceUpdate(BaseModel):
    confidence_score: DecisionConfidenceScore | None = None
