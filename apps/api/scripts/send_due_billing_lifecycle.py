#!/usr/bin/env python3
"""Send due subscription lifecycle notifications through the API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def clean_env_value(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Send due Decisionate subscription lifecycle notifications.",
    )
    parser.add_argument(
        "--api-url",
        default=clean_env_value(
            "DECISIONATE_API_URL",
            "http://localhost:8000",
        ),
    )
    parser.add_argument(
        "--secret",
        default=clean_env_value("BILLING_SCHEDULER_SECRET"),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=max(
            int(clean_env_value("BILLING_SCHEDULER_TIMEOUT_SECONDS", "30") or 30),
            1,
        ),
    )
    args = parser.parse_args(argv)

    if not args.secret:
        print(
            "BILLING_SCHEDULER_SECRET is required.",
            file=sys.stderr,
        )
        return 1

    request = urllib.request.Request(
        f"{args.api_url.rstrip('/')}/billing/lifecycle/send-due",
        method="POST",
        headers={
            "Accept": "application/json",
            "X-Billing-Scheduler-Secret": args.secret,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(
            f"Billing lifecycle request failed with HTTP {error.code}: {detail}",
            file=sys.stderr,
        )
        return 1
    except (OSError, json.JSONDecodeError) as error:
        print(
            f"Billing lifecycle request failed: {error}",
            file=sys.stderr,
        )
        return 1

    print(
        "Billing lifecycle notifications processed: "
        f"{result.get('processed', 0)}; "
        f"sent: {result.get('notified', 0)}; "
        f"data purged: {result.get('data_purged', 0)}; "
        f"data purge failures: {result.get('data_purge_failed', 0)}; "
        f"skipped: {result.get('skipped', 0)}; "
        f"failed: {result.get('failed', 0)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
