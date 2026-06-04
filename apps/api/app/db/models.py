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


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    name = Column(
        String,
        nullable=False,
    )

    owner_user_id = Column(
        String,
        nullable=False,
        unique=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    organization_id = Column(
        Integer,
        nullable=False,
    )

    clerk_user_id = Column(
        String,
        nullable=False,
    )

    role = Column(
        String,
        nullable=False,
        default="member",
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )
