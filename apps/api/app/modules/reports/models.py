from uuid import uuid4

from sqlalchemy import Column, DateTime, String, Text

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
