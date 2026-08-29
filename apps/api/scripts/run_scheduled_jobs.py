#!/usr/bin/env python3
"""Run Decisionate's protected scheduled jobs through the public API.

Railway Cron runs one command per service. This runner keeps the individual
API jobs separate while giving a single cron service a deterministic entry
point for connector sync, alert delivery, and billing lifecycle work.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from time import sleep
from typing import Any
from urllib.parse import urlparse


DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_RETRY_ATTEMPTS = 3
DEFAULT_RETRY_DELAY_SECONDS = 5
RETRYABLE_HTTP_STATUS_CODES = {408, 429, 502, 503, 504}


@dataclass(frozen=True)
class ScheduledJob:
    name: str
    path: str
    secret_name: str
    header_name: str


JOBS = {
    "connectors": ScheduledJob(
        name="connectors",
        path="/datasets/source-connections/sync-due",
        secret_name="CONNECTORS_SCHEDULER_SECRET",
        header_name="X-Connectors-Scheduler-Secret",
    ),
    "alerts": ScheduledJob(
        name="alerts",
        path="/alerts/weekly-report/send-due",
        secret_name="ALERTS_SCHEDULER_SECRET",
        header_name="X-Alerts-Scheduler-Secret",
    ),
    "billing": ScheduledJob(
        name="billing",
        path="/billing/lifecycle/send-due",
        secret_name="BILLING_SCHEDULER_SECRET",
        header_name="X-Billing-Scheduler-Secret",
    ),
}


def clean_env_value(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def int_env(name: str, default: int, minimum: int = 0) -> int:
    try:
        value = int(clean_env_value(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value >= minimum else default


def normalize_api_url(value: str) -> str:
    clean_value = str(value or "").strip()
    if not clean_value:
        raise ValueError("DECISIONATE_API_URL is not configured")
    if "://" not in clean_value:
        clean_value = f"https://{clean_value}"
    parsed = urlparse(clean_value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(
            "DECISIONATE_API_URL must be the public API URL, for example "
            "https://decisionate-api.example.com"
        )
    return clean_value.rstrip("/")


def selected_jobs() -> list[ScheduledJob]:
    configured = clean_env_value(
        "SCHEDULED_JOBS",
        ",".join(JOBS),
    )
    names = [item.strip().lower() for item in configured.split(",")]
    unknown = [name for name in names if name and name not in JOBS]
    if unknown:
        raise ValueError(
            "Unknown SCHEDULED_JOBS value(s): "
            + ", ".join(sorted(set(unknown)))
        )
    return [JOBS[name] for name in names if name]


def run_job(
    api_url: str,
    job: ScheduledJob,
    timeout_seconds: int,
    retry_attempts: int = DEFAULT_RETRY_ATTEMPTS,
    retry_delay_seconds: int = DEFAULT_RETRY_DELAY_SECONDS,
) -> dict[str, Any]:
    secret = clean_env_value(job.secret_name)
    if not secret:
        return {
            "job": job.name,
            "status": "failed",
            "detail": f"{job.secret_name} is not configured",
        }

    attempts = max(retry_attempts, 1)
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            f"{api_url.rstrip('/')}{job.path}",
            method="POST",
            headers={
                "Accept": "application/json",
                job.header_name: secret,
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout_seconds,
            ) as response:
                body = response.read().decode("utf-8")
            result = json.loads(body) if body else {}
            if not isinstance(result, dict):
                result = {"response": result}
            return {
                "job": job.name,
                "status": "succeeded",
                "attempts": attempt,
                "result": result,
            }
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            failure = f"HTTP {error.code}: {detail[:500]}"
            should_retry = (
                error.code in RETRYABLE_HTTP_STATUS_CODES
                and attempt < attempts
            )
        except (OSError, TimeoutError) as error:
            failure = f"Request failed: {error}"
            should_retry = attempt < attempts
        except (TypeError, ValueError) as error:
            return {
                "job": job.name,
                "status": "failed",
                "attempts": attempt,
                "detail": f"Invalid scheduler response: {error}",
            }

        if not should_retry:
            return {
                "job": job.name,
                "status": "failed",
                "attempts": attempt,
                "detail": failure,
            }

        print(
            f"{job.name} request failed on attempt {attempt}/{attempts}; "
            f"retrying in {retry_delay_seconds}s: {failure}",
            file=sys.stderr,
        )
        sleep(max(retry_delay_seconds, 0))

    return {
        "job": job.name,
        "status": "failed",
        "attempts": attempts,
        "detail": "Scheduler request failed after all retry attempts",
    }


def main(argv: list[str] | None = None) -> int:
    del argv
    try:
        api_url = normalize_api_url(
            clean_env_value("DECISIONATE_API_URL", DEFAULT_API_URL)
        )
        timeout_seconds = int_env(
            "SCHEDULER_TIMEOUT_SECONDS",
            DEFAULT_TIMEOUT_SECONDS,
            minimum=1,
        )
        retry_attempts = int_env(
            "SCHEDULER_RETRY_ATTEMPTS",
            DEFAULT_RETRY_ATTEMPTS,
            minimum=1,
        )
        retry_delay_seconds = int_env(
            "SCHEDULER_RETRY_DELAY_SECONDS",
            DEFAULT_RETRY_DELAY_SECONDS,
            minimum=0,
        )
        jobs = selected_jobs()
    except (TypeError, ValueError) as error:
        print(f"Scheduler configuration error: {error}", file=sys.stderr)
        return 1

    if not jobs:
        print("Scheduler configuration error: no jobs selected", file=sys.stderr)
        return 1

    results = [
        run_job(
            api_url,
            job,
            timeout_seconds,
            retry_attempts,
            retry_delay_seconds,
        )
        for job in jobs
    ]
    payload = {
        "api_url": api_url,
        "jobs": results,
        "failed_count": sum(
            result["status"] == "failed"
            for result in results
        ),
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 1 if payload["failed_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
