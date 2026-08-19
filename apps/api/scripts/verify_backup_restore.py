#!/usr/bin/env python3
"""Verify an isolated Decisionate database restore without exposing records."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, inspect, text


REQUIRED_TABLES = (
    "organizations",
    "datasets",
    "decisions",
    "auth_identities",
)


def normalize_database_url(value: str) -> str:
    database_url = str(value or "").strip()
    if database_url.startswith("postgres://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgres://")
    if database_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + database_url.removeprefix("postgresql://")
    return database_url


def verify_sqlite_backup(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"SQLite backup does not exist: {path}")

    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        integrity = str(
            connection.execute("PRAGMA integrity_check").fetchone()[0]
        )
        foreign_keys = [
            tuple(row)
            for row in connection.execute("PRAGMA foreign_key_check")
        ]
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        row_counts = {
            table: int(
                connection.execute(
                    f'SELECT COUNT(*) FROM "{table}"'
                ).fetchone()[0]
            )
            for table in sorted(tables)
        }

    return {
        "source": "sqlite_backup",
        "integrity_check": integrity,
        "foreign_key_errors": len(foreign_keys),
        "required_tables_present": all(
            table in tables for table in REQUIRED_TABLES
        ),
        "tables": sorted(tables),
        "row_counts": row_counts,
    }


def verify_database_url(database_url: str) -> dict[str, Any]:
    normalized_url = normalize_database_url(database_url)
    if not normalized_url:
        raise ValueError("A restored database URL is required")

    engine = create_engine(normalized_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            tables = set(inspect(connection).get_table_names())
            row_counts = {
                table: int(
                    connection.execute(
                        text(f'SELECT COUNT(*) FROM "{table}"')
                    ).scalar_one()
                )
                for table in sorted(tables)
                if table in REQUIRED_TABLES
            }
    finally:
        engine.dispose()

    return {
        "source": "restored_database_url",
        "connectivity_check": "ok",
        "required_tables_present": all(
            table in tables for table in REQUIRED_TABLES
        ),
        "tables": sorted(tables),
        "row_counts": row_counts,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify a restored Decisionate database in an isolated target. "
            "This command never writes to the target."
        )
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--sqlite-backup",
        type=Path,
        help="Path to an isolated SQLite backup file.",
    )
    source.add_argument(
        "--database-url",
        help="URL for an isolated restored PostgreSQL or SQLite database.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = (
            verify_sqlite_backup(args.sqlite_backup)
            if args.sqlite_backup
            else verify_database_url(args.database_url)
        )
    except Exception as error:
        if args.json:
            print(json.dumps({"verified": False, "error": str(error)}))
        else:
            print(f"Restore verification failed: {error}", file=sys.stderr)
        return 1

    result["verified"] = bool(
        result["required_tables_present"]
        and result.get("integrity_check", "ok") == "ok"
        and result.get("foreign_key_errors", 0) == 0
        and result.get("connectivity_check", "ok") == "ok"
    )
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(
            "Restore verification: "
            f"{'verified' if result['verified'] else 'failed'}"
        )
        print(f"Required tables present: {result['required_tables_present']}")
        print(f"Tables checked: {len(result['tables'])}")
    return 0 if result["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
