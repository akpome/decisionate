from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.database import Base
from app.db.models import utc_now


class BusinessReport(Base):
    __tablename__ = "business_reports"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    name = Column(String(120), nullable=False)
    definition = Column(Text, nullable=False)
    snapshot = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class CurrentWeeklyReport(Base):
    __tablename__ = "current_weekly_reports"
    workspace_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    job_id = Column(String, nullable=False)
    definition = Column(Text, nullable=False)
    snapshot = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=utc_now)


class ReportAnalysisJob(Base):
    __tablename__ = "report_analysis_jobs"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False)
    request_key = Column(String, nullable=False, unique=True)
    definition = Column(Text, nullable=False)
    sources = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="queued", index=True)
    phase = Column(String, nullable=False, default="queued")
    attempts = Column(Integer, nullable=False, default=0)
    result = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    error_status = Column(Integer, nullable=True)
    saved_report_id = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


class DecisionImpactReview(Base):
    __tablename__ = "decision_impact_reviews"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    decision_id = Column(Integer, ForeignKey("decisions.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    job_id = Column(String, nullable=False, unique=True)
    report_id = Column(String, ForeignKey("business_reports.id", ondelete="SET NULL"), nullable=True, unique=True)
    definition = Column(Text, nullable=False)
    analysis = Column(Text, nullable=False)
    decision_revision = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)
