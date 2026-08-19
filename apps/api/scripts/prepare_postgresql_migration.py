#!/usr/bin/env python3
"""Preflight and optionally migrate the local SQLite database to PostgreSQL.

The default command is read-only apart from the SQLite backup and JSON report.
Migration requires an explicit --migrate-to URL and refuses a non-empty target.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import (
    MetaData,
    Table,
    UniqueConstraint,
    and_,
    create_engine,
    func,
    inspect,
    select,
    text,
)


SCRIPT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preflight and optionally migrate Decisionate SQLite data."
    )
    parser.add_argument(
        "--source",
        default=os.getenv("DATABASE_URL", "sqlite:///./decisionate.db"),
        help="SQLite source URL; defaults to DATABASE_URL.",
    )
    parser.add_argument(
        "--report",
        default="postgres-migration-report.json",
        help="JSON report path.",
    )
    parser.add_argument(
        "--backup",
        default="decisionate-pre-postgres-migration.sqlite",
        help="SQLite backup path.",
    )
    parser.add_argument(
        "--migrate-to",
        help="PostgreSQL URL. Omit for preflight-only mode.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows copied per transaction batch.",
    )
    return parser.parse_args()


def require_sqlite(source_url: str) -> None:
    if not source_url.startswith("sqlite://"):
        raise SystemExit("--source must be a SQLite SQLAlchemy URL")


def import_application_models():
    # Import every model module without importing app.main, whose startup
    # migrations are intentionally not part of a data-copy operation.
    from app.db.database import Base
    import app.db.models  # noqa: F401
    import app.modules.decisions.activity_models  # noqa: F401
    import app.modules.decisions.models  # noqa: F401
    import app.modules.platform_admin  # noqa: F401

    return Base


def source_database_path(engine) -> Path:
    database = engine.url.database
    if not database or database == ":memory:":
        raise SystemExit("A file-backed SQLite database is required")
    return Path(database).resolve()


def backup_sqlite(engine, destination: str) -> str:
    source_path = source_database_path(engine)
    destination_path = Path(destination).resolve()
    if source_path == destination_path:
        raise SystemExit("Backup path must differ from the SQLite source")
    destination_path.parent.mkdir(parents=True, exist_ok=True)

    source_connection = sqlite3.connect(str(source_path))
    backup_connection = sqlite3.connect(str(destination_path))
    try:
        source_connection.backup(backup_connection)
    finally:
        backup_connection.close()
        source_connection.close()
    return str(destination_path)


def quote_identifier(engine, value: str) -> str:
    return engine.dialect.identifier_preparer.quote(value)


def get_model_tables(base) -> dict[str, Any]:
    return dict(base.metadata.tables)


def table_row_count(connection, table: Table) -> int:
    return int(
        connection.execute(
            select(func.count()).select_from(table)
        ).scalar_one()
        or 0
    )


def check_unique_constraints(connection, table: Table) -> list[dict[str, Any]]:
    constraints = []
    for constraint in table.constraints:
        columns = [column.name for column in constraint.columns]
        if not isinstance(constraint, UniqueConstraint) or not columns:
            continue
        grouped = (
            select(*[table.c[column] for column in columns], func.count().label("count"))
            .where(and_(*[table.c[column].is_not(None) for column in columns]))
            .group_by(*[table.c[column] for column in columns])
            .having(func.count() > 1)
            .limit(5)
        )
        duplicates = [
            dict(row._mapping)
            for row in connection.execute(grouped).fetchall()
        ]
        if duplicates:
            constraints.append({
                "columns": columns,
                "examples": duplicates,
            })
    for index in table.indexes:
        if not index.unique:
            continue
        columns = [column.name for column in index.columns]
        if not columns:
            continue
        grouped = (
            select(*[table.c[column] for column in columns], func.count().label("count"))
            .where(and_(*[table.c[column].is_not(None) for column in columns]))
            .group_by(*[table.c[column] for column in columns])
            .having(func.count() > 1)
            .limit(5)
        )
        duplicates = [
            dict(row._mapping)
            for row in connection.execute(grouped).fetchall()
        ]
        if duplicates:
            constraints.append({
                "index": index.name,
                "columns": columns,
                "examples": duplicates,
            })
    return constraints


def build_preflight_report(engine, base) -> dict[str, Any]:
    inspector = inspect(engine)
    source_table_names = set(inspector.get_table_names())
    model_tables = get_model_tables(base)
    report: dict[str, Any] = {
        "source_dialect": engine.dialect.name,
        "source_tables": sorted(source_table_names),
        "missing_model_tables": sorted(set(model_tables) - source_table_names),
        "unknown_source_tables": sorted(source_table_names - set(model_tables)),
        "integrity_check": None,
        "foreign_key_violations": [],
        "tables": {},
        "ready_for_copy": True,
    }

    with engine.connect() as connection:
        report["integrity_check"] = connection.exec_driver_sql(
            "PRAGMA integrity_check"
        ).scalar()
        foreign_key_rows = connection.exec_driver_sql(
            "PRAGMA foreign_key_check"
        ).fetchall()
        report["foreign_key_violations"] = [
            list(row)
            for row in foreign_key_rows
        ]

        for table_name in sorted(source_table_names):
            source_table = Table(
                table_name,
                MetaData(),
                autoload_with=engine,
            )
            model_table = model_tables.get(table_name)
            source_columns = {column.name for column in source_table.columns}
            model_columns = (
                {column.name for column in model_table.columns}
                if model_table is not None
                else set()
            )
            table_report: dict[str, Any] = {
                "rows": table_row_count(connection, source_table),
                "columns": sorted(source_columns),
                "missing_model_columns": sorted(model_columns - source_columns),
                "unknown_columns": sorted(source_columns - model_columns),
                "duplicate_unique_values": [],
            }
            if model_table is not None:
                table_report["duplicate_unique_values"] = check_unique_constraints(
                    connection,
                    source_table,
                )
                required_columns = [
                    column.name
                    for column in model_table.columns
                    if not column.nullable
                    and not column.primary_key
                    and column.name in source_columns
                    and column.default is None
                    and column.server_default is None
                ]
                table_report["null_required_columns"] = {
                    column_name: int(
                        connection.execute(
                            select(func.count())
                            .select_from(source_table)
                            .where(source_table.c[column_name].is_(None))
                        ).scalar_one()
                        or 0
                    )
                    for column_name in required_columns
                }
            report["tables"][table_name] = table_report

    report["ready_for_copy"] = not any([
        report["integrity_check"] != "ok",
        report["foreign_key_violations"],
        report["missing_model_tables"],
        report["unknown_source_tables"],
        any(
            table_report["missing_model_columns"]
            or table_report["duplicate_unique_values"]
            or any(table_report.get("null_required_columns", {}).values())
            for table_report in report["tables"].values()
        ),
    ])
    return report


def ensure_target_is_empty(engine) -> None:
    existing_tables = inspect(engine).get_table_names()
    if existing_tables:
        raise SystemExit(
            "Migration target is not empty. Use a fresh PostgreSQL database. "
            f"Existing tables: {', '.join(sorted(existing_tables)[:10])}"
        )


def reset_postgres_sequences(connection, base) -> None:
    for table in base.metadata.sorted_tables:
        id_column = table.c.get("id")
        if id_column is None or not id_column.primary_key:
            continue
        sequence = connection.execute(
            text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
            {"table_name": table.name},
        ).scalar()
        if not sequence:
            continue
        maximum = connection.execute(
            select(func.max(id_column))
        ).scalar()
        if maximum is None:
            continue
        connection.execute(
            text("SELECT setval(CAST(:sequence_name AS regclass), :value, true)"),
            {"sequence_name": sequence, "value": int(maximum)},
        )


def copy_to_postgres(
    source_engine,
    target_engine,
    base,
    batch_size: int,
) -> dict[str, int]:
    if target_engine.dialect.name != "postgresql":
        raise SystemExit("--migrate-to must be a PostgreSQL URL")
    if batch_size < 1:
        raise SystemExit("--batch-size must be greater than zero")

    ensure_target_is_empty(target_engine)
    base.metadata.create_all(target_engine)
    source_tables = set(inspect(source_engine).get_table_names())
    copied: dict[str, int] = {}

    with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
        for target_table in base.metadata.sorted_tables:
            if target_table.name not in source_tables:
                continue
            source_table = Table(
                target_table.name,
                MetaData(),
                autoload_with=source_engine,
            )
            columns = [
                column
                for column in target_table.columns
                if column.name in source_table.c
            ]
            source_statement = select(
                *[source_table.c[column.name] for column in columns]
            )
            result = source_connection.execute(source_statement)
            count = 0
            while True:
                rows = result.fetchmany(batch_size)
                if not rows:
                    break
                target_connection.execute(
                    target_table.insert(),
                    [
                        dict(row._mapping)
                        for row in rows
                    ],
                )
                count += len(rows)
            copied[target_table.name] = count
        reset_postgres_sequences(target_connection, base)

    return copied


def main() -> int:
    args = parse_args()
    require_sqlite(args.source)
    os.environ["DATABASE_URL"] = args.source
    base = import_application_models()
    source_engine = create_engine(
        args.source,
        connect_args={"check_same_thread": False},
    )

    backup_path = backup_sqlite(source_engine, args.backup)
    report = build_preflight_report(source_engine, base)
    report["backup_path"] = backup_path

    if args.migrate_to:
        from app.db.database import normalize_database_url

        target_engine = create_engine(
            normalize_database_url(args.migrate_to),
            pool_pre_ping=True,
        )
        if not report["ready_for_copy"]:
            raise SystemExit(
                "SQLite preflight failed. Review the report before copying."
            )
        report["copied_rows"] = copy_to_postgres(
            source_engine,
            target_engine,
            base,
            args.batch_size,
        )
        report["migration_completed"] = True
    else:
        report["migration_completed"] = False

    report_path = Path(args.report).resolve()
    report_path.write_text(
        json.dumps(report, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ready_for_copy": report["ready_for_copy"],
        "migration_completed": report["migration_completed"],
        "backup_path": backup_path,
        "report_path": str(report_path),
        "table_count": len(report["tables"]),
    }, indent=2))
    return 0 if report["ready_for_copy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
