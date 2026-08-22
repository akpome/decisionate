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
from typing import Any
from urllib.parse import urlparse


DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_TIMEOUT_SECONDS = 60


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
) -> dict[str, Any]:
    secret = clean_env_value(job.secret_name)
    if not secret:
        return {
            "job": job.name,
            "status": "failed",
            "detail": f"{job.secret_name} is not configured",
        }

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
            "result": result,
        }
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        return {
            "job": job.name,
            "status": "failed",
            "detail": f"HTTP {error.code}: {detail[:500]}",
        }
    except (OSError, TimeoutError) as error:
        return {
            "job": job.name,
            "status": "failed",
            "detail": f"Request failed: {error}",
        }
    except (TypeError, ValueError) as error:
        return {
            "job": job.name,
            "status": "failed",
            "detail": f"Invalid scheduler response: {error}",
        }


def main(argv: list[str] | None = None) -> int:
    del argv
    try:
        api_url = normalize_api_url(
            clean_env_value("DECISIONATE_API_URL", DEFAULT_API_URL)
        )
        timeout_seconds = max(
            int(
                clean_env_value(
                    "SCHEDULER_TIMEOUT_SECONDS",
                    str(DEFAULT_TIMEOUT_SECONDS),
                )
            ),
            1,
        )
        jobs = selected_jobs()
    except (TypeError, ValueError) as error:
        print(f"Scheduler configuration error: {error}", file=sys.stderr)
        return 1

    if not jobs:
        print("Scheduler configuration error: no jobs selected", file=sys.stderr)
        return 1

    results = [
        run_job(api_url, job, timeout_seconds)
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
