from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from app.db.database import Base
from app.db.models import utc_now


def new_id():
    return str(uuid4())


class CorrelationAnalysis(Base):
    __tablename__ = "correlation_analyses"
    __table_args__ = (UniqueConstraint("workspace_id", "creation_key"),)
    id = Column(String, primary_key=True, default=new_id)
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    name = Column(String(120), nullable=False)
    definition = Column(Text, nullable=False)
    request_hash = Column(String(64), nullable=False)
    creation_key = Column(String(64), nullable=False)
    latest_successful_run_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)


class CorrelationMetric(Base):
    __tablename__ = "correlation_analysis_metrics"
    __table_args__ = (UniqueConstraint("analysis_id", "dataset_id", "metric_key"),)
    id = Column(Integer, primary_key=True)
    analysis_id = Column(String, ForeignKey("correlation_analyses.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    metric_key = Column(String, nullable=False)
    position = Column(Integer, nullable=False)


class CorrelationRun(Base):
    __tablename__ = "correlation_runs"
    __table_args__ = (Index("ix_correlation_queue", "status", "created_at"),)
    id = Column(String, primary_key=True, default=new_id)
    analysis_id = Column(String, ForeignKey("correlation_analyses.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    identity_hash = Column(String(64), unique=True, nullable=False)
    definition = Column(Text, nullable=False)
    watermark = Column(Text, nullable=False)
    engine_version = Column(String, nullable=False)
    code_version = Column(String, nullable=False)
    status = Column(String, default="queued", nullable=False)
    phase = Column(String, default="queued", nullable=False)
    completed_pairs = Column(Integer, default=0, nullable=False)
    prepared_metrics = Column(Integer, default=0, nullable=False)
    total_pairs = Column(Integer, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    cancel_requested = Column(Boolean, default=False, nullable=False)
    worker_token = Column(String, nullable=True)
    error_code = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    started_at = Column(DateTime, nullable=True)
    heartbeat_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


class CorrelationResult(Base):
    __tablename__ = "correlation_results"
    __table_args__ = (
        UniqueConstraint("run_id", "metric_a", "metric_b", "lag"),
        Index("ix_correlation_result_rank", "run_id", "selected", "score"),
    )
    id = Column(String, primary_key=True, default=new_id)
    run_id = Column(String, ForeignKey("correlation_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    metric_a = Column(String, nullable=False)
    metric_b = Column(String, nullable=False)
    lead_metric = Column(String, nullable=False)
    lag = Column(Integer, nullable=False)
    coefficient = Column(Float, nullable=True)
    observations = Column(Integer, nullable=False)
    p_value = Column(Float, nullable=True)
    adjusted_p_value = Column(Float, nullable=True)
    score = Column(Float, default=0, nullable=False)
    selected = Column(Boolean, default=False, nullable=False)
    eligible = Column(Boolean, default=False, nullable=False)
    reliability = Column(String, default="insufficient", nullable=False)
    flags = Column(Text, default="[]", nullable=False)
    evidence = Column(Text, default="[]", nullable=False)


class CorrelationRunRequest(Base):
    __tablename__ = "correlation_run_requests"
    __table_args__ = (UniqueConstraint("analysis_id", "request_key"),)
    id = Column(Integer, primary_key=True)
    analysis_id = Column(String, ForeignKey("correlation_analyses.id", ondelete="CASCADE"), nullable=False)
    request_key = Column(String(64), nullable=False)
    run_id = Column(String, ForeignKey("correlation_runs.id", ondelete="CASCADE"), nullable=False)


class CorrelationWidget(Base):
    __tablename__ = "correlation_widgets"
    id = Column(String, primary_key=True, default=new_id)
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    analysis_id = Column(String, ForeignKey("correlation_analyses.id", ondelete="CASCADE"), nullable=False)
    dashboard_key = Column(String(120), nullable=False)
    widget_type = Column(String, nullable=False)
    configuration = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)


class CorrelationEvent(Base):
    __tablename__ = "correlation_events"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    analysis_id = Column(String, nullable=False, index=True)
    run_id = Column(String, nullable=True)
    event = Column(String, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)


class CorrelationInsight(Base):
    __tablename__ = "correlation_insights"
    __table_args__ = (UniqueConstraint("workspace_id", "result_id"),)
    id = Column(String, primary_key=True, default=new_id)
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    result_id = Column(String, ForeignKey("correlation_results.id", ondelete="CASCADE"), nullable=False)
    evidence = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
