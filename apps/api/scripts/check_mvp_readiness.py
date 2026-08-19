#!/usr/bin/env python3
"""Report Decisionate MVP service readiness without printing secrets."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1]),
)

from app.modules.ai.service import build_ai_status
from app.modules.alerts.email_delivery import (
    is_email_delivery_configured,
)
from app.modules.datasets.services.analytics_engine import (
    build_analytics_engine_status,
)
from app.modules.billing.service import (
    get_billing_config,
    is_billing_configured,
)
from app.modules.datasets.services.sources import (
    list_dataset_sources,
)
from app.infrastructure.cache import build_cache_status
from app.infrastructure.object_storage import build_storage_status
from app.security.config import build_security_configuration_status


def build_readiness() -> dict[str, Any]:
    ai_status = build_ai_status()
    try:
        analytics_status = build_analytics_engine_status()
        analytics_ready = True
    except (OSError, ValueError) as error:
        analytics_status = {
            "engine": "unavailable",
            "storage_format": "unknown",
            "error": str(error),
        }
        analytics_ready = False

    connector_readiness = {}
    for source in list_dataset_sources():
        if source.get("connection_type") == "upload":
            continue

        ready = source.get("status") == "available"
        connector_readiness[source["type"]] = {
            "ready": ready,
            "status": source.get("status"),
            "detail": (
                "Connector credentials and optional dependencies are configured"
                if ready
                else source.get("availability_note")
                or "Connector setup is incomplete"
            ),
        }

    return {
        "security": build_security_configuration_status(),
        "ai": {
            "ready": bool(ai_status["configured"]),
            "provider": ai_status["provider"],
            "model": ai_status["model"],
            "detail": (
                "Configured provider"
                if ai_status["configured"]
                else "Rules fallback active; configure OPENAI_API_KEY for AI output"
            ),
        },
        "analytics": {
            "ready": analytics_ready,
            **analytics_status,
        },
        "storage": build_storage_status(),
        "cache": build_cache_status(),
        "alerts": {
            "server_email_ready": is_email_delivery_configured(),
            "scheduler_ready": bool(
                os.getenv(
                    "ALERTS_SCHEDULER_SECRET",
                    "",
                ).strip()
            ),
            "detail": (
                "Workspace SMTP can also be configured per workspace"
            ),
        },
        "connectors": {
            "sources": connector_readiness,
            "scheduler_ready": bool(
                os.getenv("CONNECTORS_SCHEDULER_SECRET", "").strip()
            ),
        },
        "billing": {
            "ready": is_billing_configured(),
            "provider": get_billing_config()["provider"],
            "webhook_ready": bool(
                get_billing_config()["webhook_secret"]
            ),
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Report Decisionate MVP service readiness.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with status 1 unless AI, analytics, email, and scheduler are ready.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    readiness = build_readiness()

    if args.json:
        print(json.dumps(readiness, sort_keys=True))
    else:
        print("Decisionate MVP readiness")
        print(
            f"AI: {'ready' if readiness['ai']['ready'] else 'fallback'} "
            f"({readiness['ai']['detail']})"
        )
        print(
            f"Analytics: {'ready' if readiness['analytics']['ready'] else 'unavailable'} "
            f"({readiness['analytics'].get('engine', 'unknown')})"
        )
        print(
            "Alerts: "
            f"server email {'ready' if readiness['alerts']['server_email_ready'] else 'missing'}, "
            f"scheduler {'ready' if readiness['alerts']['scheduler_ready'] else 'missing'}"
        )
        print(
            "Connectors: "
            f"{sum(1 for source in readiness['connectors']['sources'].values() if source['ready'])}/"
            f"{len(readiness['connectors']['sources'])} configured, "
            f"scheduler {'ready' if readiness['connectors']['scheduler_ready'] else 'missing'}"
        )
        print(
            "Billing: "
            f"checkout {'ready' if readiness['billing']['ready'] else 'missing'}, "
            f"webhook {'ready' if readiness['billing']['webhook_ready'] else 'missing'}"
        )
        print(
            "Security: "
            f"{(
                'production ready'
                if readiness['security']['production_guard_enabled']
                and readiness['security']['production_ready']
                else 'development-only'
                if not readiness['security']['production_guard_enabled']
                else 'incomplete'
            )}"
            f" ({'; '.join(readiness['security']['issues']) or 'no reported configuration issues'})"
        )

    strict_checks = (
        readiness["ai"]["ready"]
        and readiness["analytics"]["ready"]
        and readiness["storage"]["configured"]
        and readiness["alerts"]["server_email_ready"]
        and readiness["alerts"]["scheduler_ready"]
        and readiness["billing"]["ready"]
        and readiness["billing"]["webhook_ready"]
        and readiness["connectors"]["scheduler_ready"]
        and readiness["security"]["production_guard_enabled"]
        and readiness["security"]["production_ready"]
    )
    return 0 if not args.strict or strict_checks else 1


if __name__ == "__main__":
    sys.exit(main())
