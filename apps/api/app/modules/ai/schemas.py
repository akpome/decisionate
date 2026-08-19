from typing import Literal

from pydantic import BaseModel


class AILearningContext(BaseModel):
    learning_scope: Literal[
        "workspace",
        "dataset",
        "metric",
        "decision",
    ] = "workspace"
    recorded_lesson_count: int = 0
    recorded_outcome_count: int = 0
    recorded_recommendation_count: int = 0
    successful_outcome_count: int = 0
    partially_successful_outcome_count: int = 0
    unsuccessful_outcome_count: int = 0
    historical_success_rate: float | None = None
    sampled_lesson_count: int = 0
    sampled_evidence_count: int = 0


class AIAnalysis(BaseModel):
    source: str
    model: str | None = None
    fallback_reason: Literal[
        "not_configured",
        "unsupported_provider",
        "provider_unavailable",
        "credits_exhausted",
    ] | None = None
    summary: str
    recommendations: list[str]
    risks: list[str]
    confidence: Literal["high", "medium", "low"]
    learning_context: AILearningContext | None = None
