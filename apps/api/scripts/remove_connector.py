"""Remove a connector's saved configuration and OAuth material.

This command is intentionally dry-run by default. It removes connector
configuration, OAuth credentials, and pending OAuth state, but does not
delete datasets that were already ingested from that connector.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1]),
)

from app.db.database import SessionLocal
from app.db.models import DataSourceConnection
from app.db.models import OAuthConnectionState
from app.db.models import OAuthCredential


def remove_connector(source_type: str, apply: bool) -> dict:
    normalized_source_type = source_type.strip().lower()
    if not normalized_source_type:
        raise ValueError("source_type must not be empty")

    db = SessionLocal()
    try:
        connections = (
            db.query(DataSourceConnection)
            .filter(DataSourceConnection.source_type == normalized_source_type)
            .all()
        )
        connection_ids = [connection.id for connection in connections]

        states_query = db.query(OAuthConnectionState).filter(
            OAuthConnectionState.source_type == normalized_source_type
        )
        credentials_query = db.query(OAuthCredential).filter(
            OAuthCredential.source_type == normalized_source_type
        )
        if connection_ids:
            states_query = states_query.union(
                db.query(OAuthConnectionState).filter(
                    OAuthConnectionState.connection_id.in_(connection_ids)
                )
            )
            credentials_query = credentials_query.union(
                db.query(OAuthCredential).filter(
                    OAuthCredential.connection_id.in_(connection_ids)
                )
            )

        states = states_query.all()
        credentials = credentials_query.all()

        result = {
            "source_type": normalized_source_type,
            "dry_run": not apply,
            "connection_count": len(connections),
            "oauth_state_count": len(states),
            "oauth_credential_count": len(credentials),
            "datasets_deleted": 0,
        }

        if apply:
            for state in states:
                db.delete(state)
            for credential in credentials:
                db.delete(credential)
            for connection in connections:
                db.delete(connection)
            db.commit()
            result["deleted"] = True
        else:
            db.rollback()
            result["deleted"] = False

        return result
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Remove saved connector configuration, OAuth credentials, and "
            "pending OAuth state."
        )
    )
    parser.add_argument(
        "--source-type",
        required=True,
        help="Connector source type to remove, for example salesforce",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform deletion. Without this flag, only report matching rows.",
    )
    args = parser.parse_args()
    print(
        json.dumps(
            remove_connector(args.source_type, args.apply),
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
