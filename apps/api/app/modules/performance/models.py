from uuid import uuid4

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.db.database import Base
from app.db.models import utc_now


class PerformanceAnalysis(Base):
    __tablename__ = "performance_analyses"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    workspace_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    job_id = Column(String, nullable=False, unique=True)
    name = Column(String(180), nullable=False)
    kind = Column(String(20), nullable=False)
    definition = Column(Text, nullable=False)
    snapshot = Column(Text, nullable=False)
    decision_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
