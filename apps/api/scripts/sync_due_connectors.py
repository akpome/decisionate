#!/usr/bin/env python3
"""Run due Decisionate connector syncs through the protected API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_TIMEOUT_SECONDS = 30
SCHEDULER_SECRET_HEADER = "X-Connectors-Scheduler-Secret"


def clean_env_value(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def build_sync_due_url(api_url: str) -> str:
    return f"{api_url.rstrip('/')}/datasets/source-connections/sync-due"


def sync_due_connectors(
    api_url: str,
    scheduler_secret: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    request = urllib.request.Request(
        build_sync_due_url(api_url),
        method="POST",
        headers={
            "Accept": "application/json",
            SCHEDULER_SECRET_HEADER: scheduler_secret,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Connector scheduler returned HTTP {error.code}: {detail[:240]}"
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RuntimeError("Connector scheduler API is unavailable") from error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run due Decisionate connector syncs."
    )
    parser.add_argument(
        "--api-url",
        default=clean_env_value("DECISIONATE_API_URL", DEFAULT_API_URL),
    )
    parser.add_argument(
        "--secret",
        default=clean_env_value("CONNECTORS_SCHEDULER_SECRET"),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(
            clean_env_value(
                "CONNECTORS_SCHEDULER_TIMEOUT_SECONDS",
                str(DEFAULT_TIMEOUT_SECONDS),
            )
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.secret:
        print("Missing connector scheduler secret", file=sys.stderr)
        return 1
    try:
        result = sync_due_connectors(
            args.api_url,
            args.secret,
            max(1, args.timeout),
        )
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if result.get("failed_count", 0) else 0


if __name__ == "__main__":
    raise SystemExit(main())
