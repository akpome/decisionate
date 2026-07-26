#!/usr/bin/env python3
"""Send due weekly KPI report emails through the Decisionate API.

This runner is intentionally tiny: deploy it as a cron job, Render/Railway
scheduled job, GitHub Actions step, or any scheduler that can run Python.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


default_api_url = "http://localhost:8000"
default_timeout_seconds = 30
scheduler_secret_header = "X-Alerts-Scheduler-Secret"


def clean_env_value(
    name: str,
    default: str = "",
) -> str:
    return str(
        os.getenv(
            name,
            default,
        )
        or ""
    ).strip()


def clean_positive_int(
    value: str,
    default: int,
) -> int:
    try:
        clean_value = int(value)
    except ValueError:
        return default

    return (
        clean_value
        if clean_value > 0
        else default
    )


def build_send_due_url(
    api_url: str,
) -> str:
    return (
        f"{api_url.rstrip('/')}"
        "/alerts/weekly-report/send-due"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Send due Decisionate weekly KPI email reports.",
    )
    parser.add_argument(
        "--api-url",
        default=clean_env_value(
            "DECISIONATE_API_URL",
            default_api_url,
        ),
        help=(
            "Decisionate API base URL. Defaults to DECISIONATE_API_URL "
            f"or {default_api_url}."
        ),
    )
    parser.add_argument(
        "--secret",
        default=clean_env_value(
            "ALERTS_SCHEDULER_SECRET",
        ),
        help=(
            "Scheduler secret. Defaults to ALERTS_SCHEDULER_SECRET."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=clean_positive_int(
            clean_env_value(
                "ALERTS_SCHEDULER_TIMEOUT_SECONDS",
                str(default_timeout_seconds),
            ),
            default_timeout_seconds,
        ),
        help=(
            "HTTP timeout in seconds. Defaults to "
            "ALERTS_SCHEDULER_TIMEOUT_SECONDS or 30."
        ),
    )

    return parser


def send_due_weekly_reports(
    api_url: str,
    scheduler_secret: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    request = urllib.request.Request(
        build_send_due_url(
            api_url,
        ),
        method="POST",
        headers={
            "Accept": "application/json",
            scheduler_secret_header: scheduler_secret,
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=timeout_seconds,
    ) as response:
        body = response.read().decode(
            "utf-8"
        )

    if not body:
        return {}

    parsed_body = json.loads(
        body
    )

    if not isinstance(
        parsed_body,
        dict,
    ):
        return {}

    return parsed_body


def print_scheduler_result(
    result: dict[str, Any],
):
    print(
        "Weekly KPI reports processed: "
        f"{result.get('processed_count', 0)}; "
        f"sent: {result.get('sent_count', 0)}; "
        f"skipped: {result.get('skipped_count', 0)}; "
        f"failed: {result.get('failed_count', 0)}."
    )

    for item in result.get(
        "results",
        [],
    ):
        if not isinstance(
            item,
            dict,
        ):
            continue

        workspace_id = item.get(
            "workspace_id",
            "unknown-workspace",
        )
        status = item.get(
            "status",
            "unknown",
        )
        delivered_count = item.get(
            "delivered_count",
            0,
        )
        detail = item.get(
            "detail",
        )
        detail_text = (
            f" — {detail}"
            if detail
            else ""
        )

        print(
            f"- {workspace_id}: {status} "
            f"({delivered_count} delivered){detail_text}"
        )


def main(
    argv: list[str] | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(
        argv,
    )

    if not args.secret:
        print(
            "ALERTS_SCHEDULER_SECRET is required.",
            file=sys.stderr,
        )
        return 1

    try:
        result = send_due_weekly_reports(
            args.api_url,
            args.secret,
            args.timeout,
        )
    except urllib.error.HTTPError as error:
        body = error.read().decode(
            "utf-8",
            errors="replace",
        )
        print(
            f"Scheduler request failed with HTTP {error.code}: {body}",
            file=sys.stderr,
        )
        return 1
    except Exception as error:
        print(
            f"Scheduler request failed: {error}",
            file=sys.stderr,
        )
        return 1

    print_scheduler_result(
        result,
    )

    return (
        2
        if int(
            result.get(
                "failed_count",
                0,
            )
            or 0
        )
        > 0
        else 0
    )


if __name__ == "__main__":
    raise SystemExit(
        main()
    )
