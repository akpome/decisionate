from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

from app.configuration import (
    get_runtime_configuration,
    normalize_database_url,
)


DATABASE_URL = get_runtime_configuration().database_url

connect_args = (
    {
        "check_same_thread": False,
    }
    if DATABASE_URL.startswith("sqlite")
    else {}
)

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=1800,
)


if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def configure_sqlite_connection(
        dbapi_connection,
        connection_record,
    ):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_table_columns(connection, table_name: str) -> set[str]:
    """Return column names through SQLAlchemy for SQLite and Postgres alike."""
    from sqlalchemy import inspect

    return {
        str(column["name"])
        for column in inspect(connection).get_columns(table_name)
    }
