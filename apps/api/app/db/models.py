from datetime import datetime

from sqlalchemy import Column
from sqlalchemy import DateTime
from sqlalchemy import Integer
from sqlalchemy import String

from app.db.database import Base


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    file_name = Column(
        String,
        nullable=False,
    )

    file_path = Column(
        String,
        nullable=False,
    )

    row_count = Column(
        Integer,
        nullable=False,
    )

    column_count = Column(
        Integer,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    user_id = Column(
        String,
        nullable=False,
        index=True,
    )
