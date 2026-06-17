from pydantic import BaseModel
from datetime import datetime


class DecisionCreate(BaseModel):
    dataset_id: int
    title: str
    description: str | None = None


class DecisionUpdate(BaseModel):
    status: str


class DecisionResponse(BaseModel):
    id: int
    dataset_id: int
    title: str
    description: str | None
    notes: str | None
    expected_outcome: str | None
    actual_outcome: str | None
    outcome_status: str | None
    lessons_learned: str | None
    review_date: datetime | None
    priority: str | None
    priority: str | None
    category: str | None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class DecisionNotesUpdate(BaseModel):
    notes: str


class DecisionOutcomeUpdate(BaseModel):
    expected_outcome: str | None = None

    actual_outcome: str | None = None

    outcome_status: str | None = None


class DecisionLearningUpdate(BaseModel):
    lessons_learned: str | None = None


class DecisionLearningUpdate(BaseModel):
    lessons_learned: str | None = None


class DecisionReviewUpdate(BaseModel):
    review_date: datetime | None = None


class DecisionPriorityUpdate(BaseModel):
    priority: str


class DecisionCategoryUpdate(BaseModel):
    category: str
