from __future__ import annotations

import json
import os
import re
from datetime import date
from typing import Any

import pandas as pd


DEFAULT_DIMENSIONS = ["date"]
DEFAULT_METRICS = [
    "activeUsers",
    "sessions",
    "totalRevenue",
]
MAX_DIMENSIONS = 5
MAX_METRICS = 10
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


class GoogleAnalyticsConnectorUnavailable(RuntimeError):
    pass


def get_google_analytics_service_account_path() -> str:
    return str(
        os.getenv(
            "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE",
            "",
        )
        or ""
    ).strip()


def get_google_analytics_service_account_json() -> str:
    return str(
        os.getenv(
            "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON",
            "",
        )
        or ""
    ).strip()


def get_google_analytics_scope() -> str:
    return str(
        os.getenv("GOOGLE_ANALYTICS_SCOPE", "") or ""
    ).strip()


def is_google_analytics_connector_available() -> bool:
    service_account_file = get_google_analytics_service_account_path()
    service_account_json = get_google_analytics_service_account_json()

    if service_account_file and not os.path.isfile(
        service_account_file
    ):
        return False

    if not service_account_file and service_account_json:
        try:
            parsed_json = json.loads(
                service_account_json
            )
        except json.JSONDecodeError:
            return False

        if not isinstance(parsed_json, dict):
            return False

    if not (service_account_file or service_account_json):
        return False

    try:
        from google.analytics.data_v1beta import (
            BetaAnalyticsDataClient,
        )
        from google.oauth2 import service_account
    except ModuleNotFoundError:
        return False

    return bool(
        BetaAnalyticsDataClient and service_account
    )


def validate_report_request(
    property_id: str,
    start_date: str,
    end_date: str,
    dimensions: list[str] | None = None,
    metrics: list[str] | None = None,
) -> tuple[str, str, str, list[str], list[str]]:
    clean_property_id = str(property_id or "").strip()
    if not clean_property_id.isdigit():
        raise ValueError("Google Analytics property_id must be numeric")

    try:
        parsed_start_date = date.fromisoformat(
            str(start_date or "").strip()
        )
        parsed_end_date = date.fromisoformat(
            str(end_date or "").strip()
        )
    except ValueError as error:
        raise ValueError(
            "Google Analytics dates must use YYYY-MM-DD format"
        ) from error

    if parsed_start_date > parsed_end_date:
        raise ValueError(
            "Google Analytics start_date must be on or before end_date"
        )

    clean_dimensions = normalize_report_fields(
        dimensions or DEFAULT_DIMENSIONS,
        "dimensions",
        MAX_DIMENSIONS,
    )
    clean_metrics = normalize_report_fields(
        metrics or DEFAULT_METRICS,
        "metrics",
        MAX_METRICS,
    )

    return (
        clean_property_id,
        parsed_start_date.isoformat(),
        parsed_end_date.isoformat(),
        clean_dimensions,
        clean_metrics,
    )


def normalize_report_fields(
    values: list[str],
    field_name: str,
    maximum: int,
) -> list[str]:
    if not isinstance(values, list) or not values:
        raise ValueError(
            f"Google Analytics {field_name} must contain at least one field"
        )

    normalized = []
    for value in values:
        clean_value = str(value or "").strip()
        if not IDENTIFIER_PATTERN.fullmatch(clean_value):
            raise ValueError(
                f"Invalid Google Analytics {field_name[:-1]} name"
            )
        if clean_value not in normalized:
            normalized.append(clean_value)

    if len(normalized) > maximum:
        raise ValueError(
            f"Google Analytics supports at most {maximum} {field_name}"
        )

    return normalized


def load_google_analytics_report(
    *,
    property_id: str,
    start_date: str,
    end_date: str,
    dimensions: list[str] | None = None,
    metrics: list[str] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    (
        clean_property_id,
        clean_start_date,
        clean_end_date,
        clean_dimensions,
        clean_metrics,
    ) = validate_report_request(
        property_id,
        start_date,
        end_date,
        dimensions,
        metrics,
    )

    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import (
            DateRange,
            Dimension,
            Metric,
            RunReportRequest,
        )
        from google.oauth2 import service_account
    except ModuleNotFoundError as error:
        raise GoogleAnalyticsConnectorUnavailable(
            "Google Analytics connector requires the optional google-analytics-data package"
        ) from error

    credentials = build_google_analytics_credentials(
        service_account,
    )

    client = BetaAnalyticsDataClient(
        credentials=credentials,
    )
    response = client.run_report(
        RunReportRequest(
            property=f"properties/{clean_property_id}",
            dimensions=[
                Dimension(name=dimension)
                for dimension in clean_dimensions
            ],
            metrics=[
                Metric(name=metric)
                for metric in clean_metrics
            ],
            date_ranges=[
                DateRange(
                    start_date=clean_start_date,
                    end_date=clean_end_date,
                )
            ],
        )
    )

    columns = [
        header.name
        for header in response.dimension_headers
    ] + [
        header.name
        for header in response.metric_headers
    ]
    rows = []
    for row in response.rows:
        rows.append(
            [
                value.value
                for value in row.dimension_values
            ]
            + [
                value.value
                for value in row.metric_values
            ]
        )

    return pd.DataFrame(rows, columns=columns), {
        "property_id": clean_property_id,
        "start_date": clean_start_date,
        "end_date": clean_end_date,
        "dimensions": clean_dimensions,
        "metrics": clean_metrics,
        "row_count": len(rows),
    }


def build_google_analytics_credentials(service_account_module):
    scope = get_google_analytics_scope()
    if not scope:
        raise GoogleAnalyticsConnectorUnavailable(
            "GOOGLE_ANALYTICS_SCOPE is required for the Google Analytics connector"
        )
    service_account_file = get_google_analytics_service_account_path()
    if service_account_file:
        if not os.path.isfile(service_account_file):
            raise GoogleAnalyticsConnectorUnavailable(
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE does not exist"
            )
        return service_account_module.Credentials.from_service_account_file(
            service_account_file,
            scopes=[scope],
        )

    service_account_json = get_google_analytics_service_account_json()
    if service_account_json:
        try:
            info = json.loads(service_account_json)
        except json.JSONDecodeError as error:
            raise GoogleAnalyticsConnectorUnavailable(
                "GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON must be valid JSON"
            ) from error
        return service_account_module.Credentials.from_service_account_info(
            info,
            scopes=[scope],
        )

    raise GoogleAnalyticsConnectorUnavailable(
        "Configure GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE or GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON"
    )
