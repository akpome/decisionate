#!/usr/bin/env python3
"""Add marketing tables without changing existing customers' consent."""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.database import Base, engine
from app.modules.marketing import models  # Register the additive schema.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create missing marketing tables")
    args = parser.parse_args()
    tables = [table for table in Base.metadata.sorted_tables if table.name.startswith("marketing_")]
    if not args.apply:
        print("Dry run: " + ", ".join(table.name for table in tables))
        return
    from sqlalchemy import text
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(59831, 2)"))
        elif engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        Base.metadata.create_all(connection, tables=tables)
    print("Marketing schema ready. Existing consent remains unknown; reconciliation backfills identities only.")


if __name__ == "__main__":
    main()
