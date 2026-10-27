import asyncio
import json
import logging
import math
import os
import re
from datetime import datetime
from datetime import timezone
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from sqlalchemy import and_
from sqlalchemy import false
from sqlalchemy import func
from sqlalchemy import or_

from app.db.database import SessionLocal
from app.configuration import get_runtime_configuration
from app.infrastructure.email_branding import build_decisionate_logo_url
from app.db.models import Dataset
from app.db.models import DatasetRelationship
from app.db.models import Organization
from app.db.models import WeeklyReportDeliveryLog
from app.db.models import WeeklyReportPreference
from app.modules.alerts.email_delivery import (
    get_email_delivery_source,
    get_platform_email_settings,
    is_email_delivery_configured,
    send_weekly_report_email,
)
from app.modules.alerts.schemas import (
    WeeklyReportDeliveryConfigResponse,
    WeeklyReportDeliveryLogResponse,
    WeeklyReportDeliveryResponse,
    WeeklyReportDigestResponse,
    WeeklyReportPreferenceResponse,
    WeeklyReportSchedulerResponse,
    WeeklyReportPreferenceUpdate,
)
from app.modules.auth_context import (
    get_auth_context,
    is_client_workspace_role,
)
from app.modules.organizations.branding import get_managing_agency
from app.modules.ai.service import (
    build_ai_status,
    generate_structured_analysis,
)
from app.modules.ai.learning import (
    build_workspace_decision_learning_context,
)
from app.modules.datasets.services.dataset_loader import (
    load_dataframe_from_dataset,
)
from app.modules.datasets.services.relationships import (
    build_dataset_relationship,
    relationship_definition_from_record,
)
from app.modules.decisions.models import Decision
from app.modules.reports.models import BusinessReport
from app.modules.reports.service import attach_report_decisions, build_report, complete_week, previous_window, report_analysis_facts, report_anomalies, scoped_frame
from app.modules.reports.catalog import prepare_report_source
from app.modules.reports.relationships import metric_key
from app.modules.reports.schemas import MINIMUM_REPORT_OBSERVATIONS
from app.modules.correlation.defaults import DEFAULT_MINIMUM_OBSERVATIONS
from app.modules.correlation.catalog import metric_catalog, reporting_timezone
from app.modules.decisions.templates import build_decision_template_url

router = APIRouter()
logger = logging.getLogger(__name__)

allowed_delivery_days = {
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
}

default_weekly_report_brand_name = "Decisionate"
default_weekly_report_primary_color = "#2563EB"
default_weekly_report_accent_color = "#14B8A6"


def clean_weekly_report_brand_name(
    value: str | None,
) -> str:
    clean_value = " ".join(str(value or "").split())

    return (
        clean_value
        or default_weekly_report_brand_name
    )


def clean_optional_text(
    value: str | None,
    field_name: str,
    max_length: int = 120,
) -> str:
    clean_value = str(
        value or "",
    ).strip()

    if len(clean_value) > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be {max_length} characters or fewer",
        )

    return clean_value


def clean_delivery_day(
    delivery_day: str,
) -> str:
    if not isinstance(
        delivery_day,
        str,
    ):
        raise HTTPException(
            status_code=400,
            detail="Delivery day must be text",
        )

    clean_day = delivery_day.strip().lower()

    if clean_day not in allowed_delivery_days:
        raise HTTPException(
            status_code=400,
            detail="Delivery day must be a weekday from Monday to Friday",
        )

    return clean_day


def clean_metric_focus(
    metric_focus: list[str],
) -> list[str]:
    clean_values = []
    seen_values = set()

    for metric in metric_focus or []:
        if not isinstance(
            metric,
            str,
        ):
            continue

        clean_metric = metric.strip()

        if not clean_metric:
            continue

        if len(clean_metric) > 120:
            raise HTTPException(
                status_code=400,
                detail="Metric focus values must be 120 characters or fewer",
            )

        metric_key = clean_metric.lower()

        if metric_key not in seen_values:
            seen_values.add(metric_key)
            clean_values.append(clean_metric)

    return clean_values


def clean_metric_targets(
    metric_targets: dict,
    metric_focus: list[str],
) -> dict[str, float]:
    focus_by_key = {
        normalize_metric_key(metric): metric
        for metric in metric_focus
        if normalize_metric_key(metric)
    }
    clean_targets = {}

    for metric, target in (metric_targets or {}).items():
        if not isinstance(metric, str):
            continue

        canonical_metric = focus_by_key.get(
            normalize_metric_key(metric)
        )
        if not canonical_metric or target is None:
            continue

        try:
            numeric_target = float(target)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="KPI targets must be numeric values",
            )

        if not math.isfinite(numeric_target):
            raise HTTPException(
                status_code=400,
                detail="KPI targets must be finite numeric values",
            )

        clean_targets[canonical_metric] = numeric_target

    return clean_targets


def clean_relationship_focus(
    relationship_focus: list[int],
) -> list[int]:
    clean_values = []
    seen_values = set()

    for relationship_id in relationship_focus or []:
        try:
            clean_id = int(relationship_id)
        except (TypeError, ValueError):
            continue

        if clean_id < 1 or clean_id in seen_values:
            continue

        seen_values.add(clean_id)
        clean_values.append(clean_id)

    return clean_values


def clean_recipient_emails(
    recipient_emails: list[str],
) -> list[str]:
    clean_emails = []

    for email in recipient_emails or []:
        if not isinstance(
            email,
            str,
        ):
            continue

        clean_email = email.strip().lower()

        if not clean_email:
            continue

        if not re.fullmatch(
            r"[^@\s]+@[^@\s]+\.[^@\s]+",
            clean_email,
        ):
            raise HTTPException(
                status_code=400,
                detail="Recipient emails must be valid email addresses",
            )

        if clean_email not in clean_emails:
            clean_emails.append(clean_email)

    return clean_emails


def parse_json_list(
    value: str | None,
) -> list[str]:
    if not value:
        return []

    try:
        parsed_value = json.loads(
            value
        )
    except json.JSONDecodeError:
        return []

    if not isinstance(
        parsed_value,
        list,
    ):
        return []

    return [
        item
        for item in parsed_value
        if isinstance(item, str)
    ]


def parse_json_dict(
    value: str | None,
) -> dict:
    if not value:
        return {}

    try:
        parsed_value = json.loads(value)
    except json.JSONDecodeError:
        return {}

    return parsed_value if isinstance(parsed_value, dict) else {}


def parse_json_int_list(
    value: str | None,
) -> list[int]:
    if not value:
        return []

    try:
        parsed_value = json.loads(value)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed_value, list):
        return []

    return clean_relationship_focus(parsed_value)


def build_weekly_report_preference_response(
    preference: WeeklyReportPreference | None,
) -> WeeklyReportPreferenceResponse:
    if not preference:
        return WeeklyReportPreferenceResponse(
            enabled=False,
            cadence="weekly",
            delivery_day="monday",
            recipient_emails=[],
            metric_focus=[],
            metric_targets={},
            relationship_focus=[],
            include_recommendations=True,
            subject_prefix="",
            last_sent_at=None,
            last_send_status=None,
            last_send_error=None,
        )

    clean_metric_focus_values = clean_metric_focus(
        parse_json_list(
            preference.metric_focus
        )
    )

    return WeeklyReportPreferenceResponse(
        enabled=bool(preference.enabled),
        business_report_id=getattr(preference, "business_report_id", None),
        weekly_settings_configured=bool(getattr(preference, "weekly_report_definition", None) or getattr(preference, "business_report_id", None)),
        cadence=preference.cadence or "weekly",
        delivery_day=preference.delivery_day or "monday",
        recipient_emails=parse_json_list(
            preference.recipient_emails
        ),
        metric_focus=clean_metric_focus_values,
        metric_targets=clean_metric_targets(
            parse_json_dict(
                getattr(
                    preference,
                    "metric_targets",
                    None,
                )
            ),
            clean_metric_focus_values,
        ),
        relationship_focus=parse_json_int_list(
            getattr(
                preference,
                "relationship_focus",
                None,
            )
        ),
        include_recommendations=bool(
            preference.include_recommendations
        ),
        subject_prefix=preference.subject_prefix or "",
        last_sent_at=(
            format_sent_at(preference.last_sent_at)
            if preference.last_sent_at
            else None
        ),
        last_send_status=preference.last_send_status,
        last_send_error=preference.last_send_error,
    )


def filter_alert_datasets_for_workspace(
    workspace_id: str,
):
    # Alerts must never use a user's legacy workspace-less datasets. A user
    # may belong to multiple workspaces, so user_id is not an isolation key.
    return Dataset.workspace_id == workspace_id


def normalize_metric_key(
    metric: str,
) -> str:
    return str(
        metric or ""
    ).strip().lower()


def parse_metric_focus_key(
    metric: str,
):
    clean_metric = normalize_metric_key(metric)
    if ":" not in clean_metric:
        return None, clean_metric

    dataset_id_text, column = clean_metric.split(
        ":",
        1,
    )
    if not dataset_id_text.isdigit():
        return None, clean_metric

    return int(dataset_id_text), column


def metric_focus_matches(
    focus_keys: set[str],
    dataset_id: int,
    column: str,
) -> bool:
    column_key = normalize_metric_key(column)

    for focus_key in focus_keys:
        scoped_dataset_id, focus_column = parse_metric_focus_key(
            focus_key
        )
        if focus_column != column_key:
            continue

        if (
            scoped_dataset_id is None or
            scoped_dataset_id == dataset_id
        ):
            return True

    return False


def get_metric_number(
    metric,
    *keys,
):
    for key in keys:
        value = metric.get(
            key,
        )

        if isinstance(
            value,
            bool,
        ):
            continue

        if isinstance(
            value,
            int | float,
        ):
            return float(value)

    return None


def clean_weekly_report_brand_color(
    value: str | None,
    default: str,
) -> str:
    clean_value = str(value or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", clean_value):
        return clean_value
    return default


def get_weekly_report_branding(
    db,
    workspace_id: str,
) -> dict:
    organization = (
        db.query(Organization)
        .filter(
            Organization.owner_user_id ==
            workspace_id
        )
        .first()
    )

    if not organization:
        return {
            "brand_name": default_weekly_report_brand_name,
            "agency_name": "",
            "workspace_name": "",
            "brand_logo_url": build_decisionate_logo_url(),
            "brand_primary_color": default_weekly_report_primary_color,
            "brand_accent_color": default_weekly_report_accent_color,
            "is_managed_client": False,
            "review_url": build_weekly_report_review_url(),
        }

    is_managed_client = ":client:" in str(
        organization.owner_user_id or "",
    )
    brand_organization = get_managing_agency(db, organization)
    agency_name = ""

    if is_managed_client and brand_organization:
        agency_name = clean_weekly_report_brand_name(brand_organization.name)
        brand_name = clean_weekly_report_brand_name(
            str(brand_organization.report_display_name or "").strip()
            or brand_organization.name,
        )
        brand_logo_url = brand_organization.logo_url
        primary_color = clean_weekly_report_brand_color(
            brand_organization.primary_color,
            default_weekly_report_primary_color,
        )
        accent_color = clean_weekly_report_brand_color(
            brand_organization.accent_color,
            default_weekly_report_accent_color,
        )
    else:
        brand_name = default_weekly_report_brand_name
        brand_logo_url = None if is_managed_client else build_decisionate_logo_url()
        primary_color = default_weekly_report_primary_color
        accent_color = default_weekly_report_accent_color

    return {
        "brand_name": brand_name,
        "agency_name": agency_name,
        "workspace_name": clean_weekly_report_brand_name(
            organization.name,
        ),
        "brand_logo_url": brand_logo_url,
        "brand_primary_color": primary_color,
        "brand_accent_color": accent_color,
        "is_managed_client": is_managed_client,
        "review_url": build_weekly_report_review_url(),
    }


def build_weekly_report_review_url() -> str | None:
    try:
        return (
            get_runtime_configuration().web_url.rstrip("/")
            + "/dashboard/reports/weekly?weekly=1"
        )
    except Exception:
        return None


def build_weekly_report_digest(
    preference: WeeklyReportPreferenceResponse,
    datasets,
    brand_name: str | None = None,
    learning_context: dict | None = None,
    workspace_id: str | None = None,
    relationships: list[dict] | None = None,
    include_ai_analysis: bool = True,
    branding: dict | None = None,
    report_definition: dict | None = None,
    analysis_date: date | None = None,
) -> WeeklyReportDigestResponse:
    branding = branding or {}
    clean_brand_name = clean_weekly_report_brand_name(
        brand_name,
    )
    workspace_name = clean_weekly_report_brand_name(
        branding.get("workspace_name"),
    ) if branding.get("workspace_name") else ""
    is_managed_client = bool(
        branding.get("is_managed_client", False)
    )
    agency_name = (
        clean_weekly_report_brand_name(branding.get("agency_name") or clean_brand_name)
        if is_managed_client else ""
    )
    relationship_results = relationships or []
    target_by_key = {
        normalize_metric_key(metric): target
        for metric, target in preference.metric_targets.items()
        if normalize_metric_key(metric)
    }
    digest_metrics = []
    available_digest_metrics = []
    unavailable_datasets = []
    report_frames = {}

    for dataset in datasets:
        dataset_name = (
            dataset.file_name
            or f"Dataset {dataset.id}"
        )

        try:
            dataframe = load_dataframe_from_dataset(
                dataset
            )
            report_dataset, dataframe = prepare_report_source(dataset, dataframe)
            catalog = metric_catalog(report_dataset, dataframe)
            report_frames[int(dataset.id)] = (report_dataset, dataframe)
            dataset_metrics = [{"column": metric["metric_key"], "unit": metric["unit"], "currency": metric.get("currency")} for metric in catalog["metrics"]]
        except Exception:
            unavailable_datasets.append(
                dataset_name
            )
            continue

        for metric in dataset_metrics:
            column = str(
                metric.get(
                    "column",
                    "",
                )
            ).strip()

            if not column:
                continue

            metric_record = {
                "dataset_id": dataset.id,
                "dataset_name": dataset_name,
                "column": column,
                "total": get_metric_number(
                    metric,
                    "total",
                ),
                "average": get_metric_number(
                    metric,
                    "average",
                ),
                "minimum": get_metric_number(
                    metric,
                    "minimum",
                    "min",
                ),
                "maximum": get_metric_number(
                    metric,
                    "maximum",
                    "max",
                ),
                "target": target_by_key.get(
                    normalize_metric_key(
                        f"{dataset.id}:{column}"
                    )
                ),
            }
            available_digest_metrics.append(metric_record)

    cross_report = build_weekly_cross_dataset_report(report_frames, preference, report_definition, unavailable_datasets, relationship_results, analysis_date=analysis_date)
    digest_metrics = [
        {"dataset_id": metric["dataset_id"], "dataset_name": metric["dataset_label"], "column": metric["metric_key"],
         "total": metric["value"], "previous_value": metric["previous_value"], "change_percent": metric["change_percent"],
         "target": target_by_key.get(normalize_metric_key(metric["id"])), "unit": metric["unit"],
         "currency": metric.get("currency"), "warnings": metric["warnings"]}
        for metric in cross_report["metrics"]
    ]

    generated_at = datetime.now(
        timezone.utc
    )
    generated_date = (
        f"{generated_at:%b} {generated_at.day}, {generated_at:%Y}"
    )
    metric_count = len(
        digest_metrics
    )
    subject_base = (
        f"{agency_name}: Weekly Performance Alert — {workspace_name}"
        if is_managed_client and workspace_name
        else f"{agency_name or clean_brand_name} KPI digest — {generated_date}"
    )
    subject_prefix = clean_optional_text(
        preference.subject_prefix,
        "Subject prefix",
    )
    subject = (
        f"{subject_prefix} {subject_base}"
        if subject_prefix
        else subject_base
    )
    relationship_count = len(relationship_results)
    preview_parts = [
        f"{metric_count} dataset KPI metric"
        f"{'' if metric_count == 1 else 's'}"
    ]
    if relationship_count:
        preview_parts.append(
            f"{relationship_count} cross-source relationship"
            f"{'' if relationship_count == 1 else 's'}"
        )
    preview_text = (
        ", ".join(preview_parts)
        + " ready for review."
    )
    preview_text = (f"Cross-dataset weekly review: {cross_report['window']['start']} to {cross_report['window']['end']}; "
                    f"{cross_report['dataset_count']} datasets, {len(digest_metrics)} metrics. "
                    + ("Coverage limitations require attention." if cross_report["status"] != "ready" else "Compared with the preceding complete week."))
    fallback_recommendations = cross_report["recommendations"]
    ai_analysis = None
    recommendations = fallback_recommendations

    if include_ai_analysis and cross_report["status"] == "ready" and not cross_report.get("impact_analysis"):
        ai_facts = {
            "metrics": digest_metrics[:10],
            "relationships": relationship_results[:10],
            "unavailable_datasets": unavailable_datasets,
            "metric_focus": preference.metric_focus,
            "metric_targets": preference.metric_targets,
            "relationship_focus": preference.relationship_focus,
        }

        if learning_context:
            ai_facts["historical_decision_learning"] = learning_context

        report_facts = report_analysis_facts(cross_report)
        ai_facts["cross_dataset_report"] = {key: value for key, value in report_facts.items() if key not in {"anomaly_analysis", "weekly_anomaly_analysis"}}
        ai_facts["limitations"] = cross_report["limitations"]
        ai_facts["anomaly_analysis"] = report_facts["anomaly_analysis"]
        if "weekly_anomaly_analysis" in report_facts:
            ai_facts["weekly_anomaly_analysis"] = report_facts["weekly_anomaly_analysis"]
        ai_facts["reporting_window"] = cross_report["window"]

        ai_analysis = generate_structured_analysis(
            context="cross-dataset complete-week business review",
            facts=ai_facts,
            fallback_summary=preview_text,
            fallback_recommendations=fallback_recommendations,
            fallback_risks=(
                [
                    f"Dataset unavailable: {dataset_name}."
                    for dataset_name in unavailable_datasets[:5]
                ]
            ),
            workspace_id=workspace_id,
        )
        if ai_analysis is not None:
            recommendations = ai_analysis["recommendations"]

    if not preference.include_recommendations:
        recommendations = []
        if ai_analysis is not None:
            ai_analysis["recommendations"] = []

    decision_template_url = branding.get("review_url") or build_weekly_report_review_url()

    return WeeklyReportDigestResponse(
        enabled=preference.enabled,
        cadence=preference.cadence,
        delivery_day=preference.delivery_day,
        recipient_emails=preference.recipient_emails,
        metric_focus=preference.metric_focus,
        relationship_focus=preference.relationship_focus,
        sender_name="",
        sender_email="",
        reply_to_email="",
        subject_prefix=subject_prefix,
        brand_name=clean_brand_name,
        agency_name=agency_name,
        workspace_name=workspace_name,
        brand_logo_url=branding.get("brand_logo_url"),
        brand_primary_color=clean_weekly_report_brand_color(
            branding.get("brand_primary_color"),
            default_weekly_report_primary_color,
        ),
        brand_accent_color=clean_weekly_report_brand_color(
            branding.get("brand_accent_color"),
            default_weekly_report_accent_color,
        ),
        is_managed_client=is_managed_client,
        review_url=branding.get("review_url"),
        subject=subject,
        preview_text=preview_text,
        ai_analysis=ai_analysis,
        cross_dataset_report=cross_report,
        dataset_count=len(datasets),
        metrics=digest_metrics,
        available_metrics=available_digest_metrics,
        relationships=relationship_results,
        recommendations=recommendations,
        unavailable_datasets=unavailable_datasets,
        decision_template_url=decision_template_url,
    )


def build_weekly_cross_dataset_report(frames, preference, template=None, unavailable=None, relationships=None, *, analysis_date=None):
    from app.modules.reports.weekly import weekly_settings_copy

    template = weekly_settings_copy(template) if template else None
    frames = {identity: prepare_report_source(*pair) for identity, pair in frames.items()}
    references, warnings = [], [f"Dataset unavailable: {name}." for name in (unavailable or [])]
    if template:
        references = template["metrics"]
    else:
        focus = {normalize_metric_key(value) for value in preference.metric_focus}
        for relationship in relationships or []:
            for side in ("left", "right"):
                focus.add(normalize_metric_key(f"{relationship[side + '_dataset_id']}:{relationship[side + '_metric']}"))
        for dataset_id, (dataset, frame) in frames.items():
            try:
                catalog = metric_catalog(dataset, frame)
            except (ValueError, KeyError, AttributeError):
                warnings.append(f"Metric/date policy is unavailable for {dataset.file_name}.")
                continue
            if not catalog["date_columns"]:
                warnings.append(f"No approved date column in {dataset.file_name}.")
                continue
            for metric in catalog["metrics"]:
                if metric_focus_matches(focus, dataset_id, metric["metric_key"]):
                    references.append({"dataset_id": dataset_id, "metric_key": metric["metric_key"],
                                       "date_column": catalog["date_columns"][0], "aggregation": metric["aggregation"]})
    if len(references) > 25:
        warnings.append("Weekly review is limited to the first 25 selected metrics; narrow the selection for complete coverage.")
        references = references[:25]
    requested_references = list(references)
    valid_references = []
    for reference in references:
        pair = frames.get(reference["dataset_id"])
        if pair is None:
            warnings.append(f"Selected dataset {reference['dataset_id']} is unavailable.")
            continue
        try:
            catalog = metric_catalog(*pair)
            approved = {item["metric_key"]: item for item in catalog["metrics"]}
            metric = approved.get(reference["metric_key"])
            if metric is None or metric["aggregation"] != reference["aggregation"] or reference["date_column"] not in catalog["date_columns"]:
                raise ValueError("Saved metric policy changed")
        except (ValueError, KeyError, AttributeError):
            warnings.append(f"Selected metric {reference['metric_key']} in {pair[0].file_name} is no longer available under its saved policy.")
            continue
        valid_references.append(reference)
    references = valid_references
    lag = (template or {}).get("lag", {"enabled": False, "minimum": 0, "maximum": 0, "direction": "a_leads_b"})
    definition = {**(template or {}), "scope": "multi", "name": (template or {}).get("name", "Weekly cross-dataset review"),
                  "dimension_filters": [item for item in (template or {}).get("dimension_filters", [])
                                        if item["dataset_id"] in {reference["dataset_id"] for reference in references}],
                  "seasonal_business": (template or {}).get("seasonal_business", False),
                  "business_question": (template or {}).get("business_question", "What changed across the selected datasets, and which changes deserve investigation?"),
                  "metrics": references, "date_range": complete_week(analysis_date) if analysis_date else complete_week(),
                  "grain": "weekly",
                  "method": (template or {}).get("method", "spearman"),
                  "lag": lag,
                  "filters": {"minimum_abs_coefficient": .3, "minimum_observations": max(MINIMUM_REPORT_OBSERVATIONS, (template or {}).get("filters", {}).get("minimum_observations", DEFAULT_MINIMUM_OBSERVATIONS))}, "included_findings": None}
    selected_keys = {metric_key(item) for item in references}
    for setting in ("pair_directions", "excluded_pairs"):
        if definition.get(setting) is not None:
            definition[setting] = [pair for pair in definition[setting]
                                   if metric_key(pair["metric_a"]) in selected_keys and metric_key(pair["metric_b"]) in selected_keys]
    selected_frames = {key: value for key, value in frames.items() if any(item["dataset_id"] == key for item in references)}
    anchor = analysis_date or datetime.now(ZoneInfo(reporting_timezone())).date()
    impact_definition = None
    if template and template.get("impact"):
        # Weekly business-change estimates use weekly history, not a seven-day model.
        from app.modules.reports.anomalies import historical_start
        impact_definition = {"impact": template["impact"], "grain": "weekly",
                             "date_range": {"start": historical_start(anchor),
                                            "end": definition["date_range"]["end"]}}
    result = build_report(selected_frames, definition, unavailable=warnings, history_anchor=anchor,
                          impact_definition=impact_definition, summary_grain="daily",
                          relationship_history_end=previous_window(definition["date_range"])["end"], include_whole_week=True)
    result["weekly_report"] = True
    evaluated = {item["metric_id"] for item in result["anomaly_analysis"]["metrics"]}
    omitted = [item for item in requested_references if f"{item['dataset_id']}:{item['metric_key']}" not in evaluated]
    if omitted:
        for key, grain in (("anomaly_analysis", "daily"), ("weekly_anomaly_analysis", "weekly")):
            unavailable_metrics = report_anomalies({}, omitted, {**definition, "grain": grain, "reporting_timezone": reporting_timezone()}, {},
                                                   anchor=anchor, whole_week=key == "weekly_anomaly_analysis")["metrics"]
            for metric in unavailable_metrics:
                metric["warnings"] = ["The selected metric or its dataset is unavailable under the current policy; it could not be assessed."]
            result[key]["metrics"].extend(unavailable_metrics)
    selection = template.get("included_findings") if template else None
    if selection is not None:
        selected_pairs = {"|".join(key.split("|")[:2]) for key in selection}
        result["included_findings"] = [item["id"] for item in result["findings"] if "|".join(item["id"].split("|")[:2]) in selected_pairs]
    else:
        result["included_findings"] = [item["id"] for item in result["findings"]
                                       if item["eligible"] and abs(item["coefficient"] or 0) >= .3][:5]
    result["definition"]["included_findings"] = result["included_findings"]
    return result


def weekly_business_template(db, preference, workspace_id):
    from app.modules.reports.weekly import weekly_settings_copy

    saved = getattr(preference, "weekly_report_definition", None) if preference else None
    if saved:
        return weekly_settings_copy(json.loads(saved))
    identity = getattr(preference, "business_report_id", None) if preference else None
    if not identity:
        return None
    report = db.get(BusinessReport, identity)
    if report is None or report.workspace_id != workspace_id:
        raise HTTPException(400, "The weekly business report template is unavailable in this workspace")
    return weekly_settings_copy(json.loads(report.definition))


def get_alert_datasets(
    db,
    workspace_id: str,
):
    return (
        db.query(Dataset)
        .filter(
            filter_alert_datasets_for_workspace(
                workspace_id,
            )
        )
        .order_by(
            Dataset.created_at.desc(),
            Dataset.id.desc(),
        )
        .all()
    )


def get_alert_relationships(
    db,
    workspace_id: str,
    relationship_ids: list[int],
):
    if not relationship_ids:
        return []

    return (
        db.query(DatasetRelationship)
        .filter(
            DatasetRelationship.workspace_id == workspace_id,
            DatasetRelationship.id.in_(relationship_ids),
        )
        .order_by(DatasetRelationship.id.asc())
        .all()
    )


def build_weekly_report_relationships(
    db,
    preference: WeeklyReportPreferenceResponse,
    datasets,
    workspace_id: str,
):
    relationships = get_alert_relationships(
        db,
        workspace_id,
        preference.relationship_focus,
    )
    datasets_by_id = {
        int(dataset.id): dataset
        for dataset in datasets
    }
    results = []
    cached_frames = {}
    end = complete_week()["end"]
    history_window = {"start": str(date.fromisoformat(end) - timedelta(days=89)), "end": end}

    for relationship in relationships:
        left_dataset = datasets_by_id.get(
            int(relationship.left_dataset_id)
        )
        right_dataset = datasets_by_id.get(
            int(relationship.right_dataset_id)
        )
        if not left_dataset or not right_dataset:
            continue

        try:
            definition = relationship_definition_from_record(relationship)
            frames = []
            for dataset, side in ((left_dataset, "left"), (right_dataset, "right")):
                raw = definition[side].get("dimension_filter") is not None
                cache_key = (dataset.id, raw)
                if cache_key not in cached_frames:
                    cached_frames[cache_key] = (load_dataframe_from_dataset(dataset, apply_metric_selection=False)
                                                if raw else load_dataframe_from_dataset(dataset))
                frames.append((dataset, scoped_frame(cached_frames[cache_key], definition[side]["date_column"], history_window, reporting_timezone())[0]))
            result = build_dataset_relationship(
                frames,
                definition,
                relationship.id,
            )
            results.append({
                "id": result["id"],
                "name": result["name"],
                "left_dataset_id": result["left"]["dataset_id"],
                "right_dataset_id": result["right"]["dataset_id"],
                "left_dataset_name": result["left_dataset_name"],
                "right_dataset_name": result["right_dataset_name"],
                "left_metric": result["left"]["metric_column"],
                "right_metric": result["right"]["metric_column"],
                "period": result["period"],
                "aggregation": result["aggregation"],
                "method": result["method"],
                "minimum_observations": result["minimum_observations"],
                "maximum_lag": result["maximum_lag"],
                "lag_direction": result["lag_direction"],
                "lag_mode": result["lag_mode"],
                "lag_periods": result["lag_periods"],
                "matched_period_count": result["matched_period_count"],
                "correlation": result["correlation"],
                "relationship_strength": result["relationship_strength"],
                "direction": result["direction"],
                "decision_context": result["decision_context"],
                "delay_description": result.get("delay_description"),
                "lag_credibility": result.get("lag_credibility", "unknown"),
                "history_window": history_window,
            })
        except Exception as error:
            logger.warning(
                "Weekly report relationship %s could not be calculated: %s",
                relationship.id,
                error,
            )

    return results


def build_weekly_report_learning_filter(
    preference: WeeklyReportPreferenceResponse,
    datasets,
):
    focus_keys = {
        normalize_metric_key(metric)
        for metric in preference.metric_focus
        if normalize_metric_key(metric)
    }
    dataset_filters = []

    for dataset in datasets:
        dataset_filter = [
            Decision.dataset_id == dataset.id,
            Decision.workspace_id == dataset.workspace_id,
        ]

        if focus_keys:
            metric_filters = [
                Decision.metric_column.is_(None),
            ]
            matching_focus = False

            for focus_key in focus_keys:
                scoped_dataset_id, focus_column = parse_metric_focus_key(
                    focus_key
                )
                if (
                    scoped_dataset_id is not None and
                    scoped_dataset_id != dataset.id
                ):
                    continue

                matching_focus = True
                metric_filters.append(
                    func.lower(
                        func.trim(Decision.metric_column)
                    ) == focus_column
                )

            if not matching_focus:
                continue

            dataset_filter.append(
                or_(*metric_filters)
            )

        dataset_filters.append(
            and_(*dataset_filter)
        )

    return (
        or_(*dataset_filters)
        if dataset_filters
        else false()
    )


def get_weekly_report_preference_record(
    db,
    workspace_id: str,
) -> WeeklyReportPreference | None:
    return (
        db.query(WeeklyReportPreference)
        .filter(
            WeeklyReportPreference.workspace_id ==
            workspace_id
        )
        .first()
    )


def build_weekly_report_digest_for_workspace(
    db,
    user_id: str,
    workspace_id: str,
    preference: WeeklyReportPreference | None,
    include_ai_analysis: bool = True,
    analysis_date: date | None = None,
) -> WeeklyReportDigestResponse:
    preference_response = build_weekly_report_preference_response(
        preference
    )
    datasets = get_alert_datasets(
        db,
        workspace_id,
    )
    relationship_results = build_weekly_report_relationships(
        db,
        preference_response,
        datasets,
        workspace_id,
    )
    branding = get_weekly_report_branding(
        db,
        workspace_id,
    )

    digest = build_weekly_report_digest(
        preference_response,
        datasets,
        branding["brand_name"],
        build_workspace_decision_learning_context(
            db,
            user_id,
            workspace_id,
            base_filter=build_weekly_report_learning_filter(
                preference_response,
                datasets,
            ),
            learning_scope="dataset",
        ) if include_ai_analysis else None,
        workspace_id,
        relationship_results,
        branding=branding,
        report_definition=weekly_business_template(db, preference, workspace_id),
        include_ai_analysis=include_ai_analysis,
        analysis_date=analysis_date,
    )
    digest.cross_dataset_report["decision_report_id"] = preference.business_report_id if preference else None
    attach_report_decisions(
        digest.cross_dataset_report, db, workspace_id, {metric.dataset_id for metric in digest.metrics},
        preference.business_report_id if preference else None,
    )
    return digest


async def build_weekly_report_digest_for_workspace_async(
    db, user_id: str, workspace_id: str, preference: WeeklyReportPreference | None,
    include_ai_analysis: bool = True,
) -> WeeklyReportDigestResponse:
    from app.modules.reports.jobs import enqueue_weekly, wait_for_job

    job = enqueue_weekly(db, user_id, workspace_id, preference, include_ai=include_ai_analysis)
    value = await wait_for_job(job.id, user_id, workspace_id)
    return WeeklyReportDigestResponse.model_validate(value)


def validate_weekly_report_digest_for_delivery(
    digest: WeeklyReportDigestResponse,
):
    if not digest.enabled:
        raise HTTPException(
            status_code=400,
            detail="Weekly KPI email notifications are not enabled",
        )

    if digest.cross_dataset_report is not None and (digest.cross_dataset_report.get("status") != "ready"
                                                  or digest.cross_dataset_report.get("dataset_count", 0) < 2):
        raise HTTPException(400, "Weekly reports require usable metrics from at least two datasets in the latest complete week. Review report coverage and selections.")

    if not digest.recipient_emails:
        raise HTTPException(
            status_code=400,
            detail="Add at least one weekly KPI email recipient",
        )

    if not digest.metric_focus and not digest.relationship_focus:
        raise HTTPException(
            status_code=400,
            detail="Select at least one dataset KPI metric or relationship",
        )

    if not digest.metrics and not digest.relationships:
        raise HTTPException(
            status_code=400,
            detail="No matching dataset KPI metrics or relationships are available to send",
        )


def get_utc_now():
    return datetime.now(
        timezone.utc
    ).replace(
        tzinfo=None,
    )


def format_sent_at(
    sent_at: datetime,
) -> str:
    return (
        sent_at.replace(
            tzinfo=timezone.utc
        )
        .isoformat()
        .replace(
            "+00:00",
            "Z",
        )
    )


def update_weekly_report_delivery_status(
    preference: WeeklyReportPreference | None,
    status: str,
    error: str | None = None,
    sent_at: datetime | None = None,
):
    if not preference:
        return

    preference.last_send_status = status
    preference.last_send_error = error

    if sent_at is not None:
        preference.last_sent_at = sent_at


def build_weekly_report_delivery_response(
    workspace_id: str,
    digest: WeeklyReportDigestResponse,
    delivered_count: int,
    recipients: list[str],
    sent_at: datetime,
) -> WeeklyReportDeliveryResponse:
    return WeeklyReportDeliveryResponse(
        status="sent",
        workspace_id=workspace_id,
        delivered_count=delivered_count,
        recipients=recipients,
        subject=digest.subject,
        metrics_count=len(
            digest.metrics
        ),
        sent_at=format_sent_at(
            sent_at
        ),
    )


def record_weekly_report_delivery_log(
    db,
    workspace_id: str,
    status: str,
    recipients: list[str] | None = None,
    subject: str = "",
    delivered_count: int = 0,
    metrics_count: int = 0,
    error: str | None = None,
):
    try:
        db.add(
            WeeklyReportDeliveryLog(
                workspace_id=workspace_id,
                status=status,
                recipient_emails=json.dumps(
                    recipients or [],
                    sort_keys=True,
                ),
                subject=subject,
                delivered_count=delivered_count,
                metrics_count=metrics_count,
                error=error,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Weekly report delivery history could not be recorded for workspace %s",
            workspace_id,
        )


def get_weekly_report_delivery_failure_details(
    error: HTTPException,
    digest: WeeklyReportDigestResponse | None,
):
    recipients = getattr(
        error,
        "delivery_recipients",
        None,
    )
    delivered_recipients = getattr(
        error,
        "delivered_recipients",
        None,
    )
    return (
        list(recipients)
        if isinstance(recipients, list)
        else digest.recipient_emails if digest else [],
        len(delivered_recipients)
        if isinstance(delivered_recipients, list)
        else 0,
    )


def build_weekly_report_delivery_log_response(log):
    return WeeklyReportDeliveryLogResponse(
        id=log.id,
        status=log.status,
        recipients=parse_json_list(log.recipient_emails),
        subject=log.subject or "",
        delivered_count=log.delivered_count or 0,
        metrics_count=log.metrics_count or 0,
        error=log.error,
        attempted_at=format_sent_at(log.attempted_at),
    )


def build_weekly_report_test_digest(
    preference: WeeklyReportPreference | None,
    brand_name: str,
    branding: dict | None = None,
) -> WeeklyReportDigestResponse:
    branding = branding or {}
    preference_response = build_weekly_report_preference_response(
        preference
    )
    generated_at = get_utc_now()
    generated_date = (
        f"{generated_at:%b} {generated_at.day}, {generated_at:%Y}"
    )
    clean_brand_name = clean_weekly_report_brand_name(
        brand_name
    )
    agency_name = (
        clean_weekly_report_brand_name(branding.get("agency_name") or clean_brand_name)
        if branding.get("is_managed_client") else ""
    )
    subject = (
        (
            f"{agency_name}: Weekly Performance Alert — {branding['workspace_name']}"
            if branding.get("is_managed_client")
            and branding.get("workspace_name")
            else f"{agency_name or clean_brand_name} KPI email test — {generated_date}"
        )
    )

    return WeeklyReportDigestResponse(
        enabled=True,
        cadence="weekly",
        delivery_day=preference_response.delivery_day,
        recipient_emails=preference_response.recipient_emails,
        metric_focus=[],
        sender_name="",
        sender_email="",
        reply_to_email="",
        subject_prefix="",
        brand_name=clean_brand_name,
        agency_name=agency_name,
        workspace_name=branding.get("workspace_name", ""),
        brand_logo_url=branding.get("brand_logo_url"),
        brand_primary_color=clean_weekly_report_brand_color(
            branding.get("brand_primary_color"),
            default_weekly_report_primary_color,
        ),
        brand_accent_color=clean_weekly_report_brand_color(
            branding.get("brand_accent_color"),
            default_weekly_report_accent_color,
        ),
        is_managed_client=bool(
            branding.get("is_managed_client", False)
        ),
        review_url=branding.get("review_url"),
        subject=subject,
        preview_text=(
            "This test confirms KPI email delivery is configured."
        ),
        dataset_count=0,
        metrics=[],
        recommendations=[
            "If you received this message, Delivery configuration can send email.",
        ],
        unavailable_datasets=[],
        decision_template_url=build_decision_template_url(),
    )


def was_weekly_report_sent_today(
    preference: WeeklyReportPreference,
    current_time: datetime,
) -> bool:
    if not preference.last_sent_at:
        return False

    return (
        preference.last_sent_at.date()
        == current_time.date()
    )


def get_delivery_day_for_time(
    current_time: datetime,
) -> str:
    return current_time.strftime(
        "%A"
    ).lower()


def get_alerts_scheduler_secret():
    return str(
        os.getenv(
            "ALERTS_SCHEDULER_SECRET",
            "",
        )
        or ""
    ).strip()


def require_alerts_scheduler_secret(
    request: Request,
):
    expected_secret = get_alerts_scheduler_secret()

    if not expected_secret:
        raise HTTPException(
            status_code=503,
            detail="Alert scheduler secret is not configured",
        )

    provided_secret = str(
        request.headers.get(
            "X-Alerts-Scheduler-Secret",
            "",
        )
        or ""
    ).strip()

    if provided_secret != expected_secret:
        raise HTTPException(
            status_code=401,
            detail="Invalid alert scheduler secret",
        )


def require_weekly_report_manager(
    workspace_role: str,
):
    if (
        workspace_role != "owner" and
        workspace_role != "managed_client" and
        not is_client_workspace_role(workspace_role)
    ):
        raise HTTPException(
            status_code=403,
            detail="Only workspace owners, client workspace owners, or approved agency owners can change alert analysis",
        )


@router.get(
    "/weekly-report",
    response_model=WeeklyReportPreferenceResponse,
)
async def get_weekly_report_preference(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    require_weekly_report_manager(
        auth_context.workspace_role
    )

    db = SessionLocal()

    try:
        preference = get_weekly_report_preference_record(
            db,
            auth_context.workspace_id,
        )

        return build_weekly_report_preference_response(
            preference
        )

    finally:
        db.close()


@router.get(
    "/weekly-report/digest",
    response_model=WeeklyReportDigestResponse,
)
async def get_weekly_report_digest(
    request: Request,
    include_ai_analysis: bool = True,
):
    auth_context = get_auth_context(
        request,
    )
    require_weekly_report_manager(
        auth_context.workspace_role
    )

    db = SessionLocal()

    try:
        preference = get_weekly_report_preference_record(
            db,
            auth_context.workspace_id,
        )

        return await build_weekly_report_digest_for_workspace_async(
            db,
            auth_context.user_id,
            auth_context.workspace_id,
            preference,
            include_ai_analysis,
        )

    finally:
        db.close()


@router.get(
    "/weekly-report/delivery-config",
    response_model=WeeklyReportDeliveryConfigResponse,
)
async def get_weekly_report_delivery_config(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    require_weekly_report_manager(
        auth_context.workspace_role
    )
    db = SessionLocal()

    try:
        platform_settings = get_platform_email_settings()
        platform_provider = platform_settings["provider"] or (
            "smtp"
            if platform_settings["smtp_host"]
            and platform_settings["smtp_from_email"]
            else "unconfigured"
        )
        required_email_keys = []
        if platform_provider == "resend":
            if not platform_settings["resend_api_key"]:
                required_email_keys.append("RESEND_API_KEY")
            if not platform_settings["resend_from_email"]:
                required_email_keys.append("RESEND_FROM_EMAIL")
        elif platform_provider == "smtp":
            if not platform_settings["smtp_host"]:
                required_email_keys.append("SMTP_HOST")
            if not platform_settings["smtp_from_email"]:
                required_email_keys.append("SMTP_FROM_EMAIL")
        ai_status = build_ai_status()

        return WeeklyReportDeliveryConfigResponse(
            email_delivery_configured=is_email_delivery_configured(),
            email_delivery_source=get_email_delivery_source(),
            email_delivery_provider=platform_provider,
            scheduler_configured=bool(
                get_alerts_scheduler_secret()
            ),
            required_email_environment_keys=required_email_keys,
            optional_email_environment_keys=[
                "EMAIL_PROVIDER",
                "RESEND_API_KEY",
                "RESEND_FROM_EMAIL",
                "RESEND_FROM_NAME",
                "SMTP_PORT",
                "SMTP_USERNAME",
                "SMTP_PASSWORD",
                "SMTP_FROM_NAME",
                "SMTP_USE_TLS",
                "SMTP_USE_SSL",
                "SMTP_TIMEOUT_SECONDS",
            ],
            scheduler_environment_key="ALERTS_SCHEDULER_SECRET",
            scheduler_header_name="X-Alerts-Scheduler-Secret",
            send_due_endpoint="/alerts/weekly-report/send-due",
            ai_provider_configured=ai_status["configured"],
            ai_provider=ai_status["provider"],
            ai_model=ai_status["model"],
        )

    finally:
        db.close()


@router.get(
    "/weekly-report/delivery-history",
    response_model=list[WeeklyReportDeliveryLogResponse],
)
async def get_weekly_report_delivery_history(
    request: Request,
    limit: int = 20,
):
    auth_context = get_auth_context(
        request,
    )
    require_weekly_report_manager(
        auth_context.workspace_role
    )
    db = SessionLocal()

    try:
        safe_limit = min(max(limit, 1), 50)
        logs = (
            db.query(WeeklyReportDeliveryLog)
            .filter(
                WeeklyReportDeliveryLog.workspace_id
                == auth_context.workspace_id,
            )
            .order_by(
                WeeklyReportDeliveryLog.attempted_at.desc(),
                WeeklyReportDeliveryLog.id.desc(),
            )
            .limit(safe_limit)
            .all()
        )
        return [
            build_weekly_report_delivery_log_response(log)
            for log in logs
        ]
    finally:
        db.close()


@router.post("/weekly-report/send", response_model=WeeklyReportDeliveryResponse, deprecated=True)
async def send_weekly_report_now(request: Request):
    from app.modules.reports.jobs import enqueue_weekly, wait_for_job

    auth = get_auth_context(request)
    require_weekly_report_manager(auth.workspace_role)
    with SessionLocal() as db:
        preference = get_weekly_report_preference_record(db, auth.workspace_id)
        job = enqueue_weekly(db, auth.user_id, auth.workspace_id, preference, send=True,
                             request_key=request.headers.get("Idempotency-Key"))
        identity = job.id
    return await wait_for_job(identity, auth.user_id, auth.workspace_id)


@router.post(
    "/weekly-report/send-test",
    response_model=WeeklyReportDeliveryResponse,
)
async def send_weekly_report_test_email(
    request: Request,
):
    auth_context = get_auth_context(
        request,
    )
    require_weekly_report_manager(
        auth_context.workspace_role
    )

    db = SessionLocal()

    try:
        preference = get_weekly_report_preference_record(
            db,
            auth_context.workspace_id,
        )
        digest = None
        try:
            branding = get_weekly_report_branding(
                db,
                auth_context.workspace_id,
            )
            digest = build_weekly_report_test_digest(
                preference,
                branding["brand_name"],
                branding,
            )
            delivery_result = await asyncio.to_thread(
                send_weekly_report_email,
                digest,
            )
            sent_at = get_utc_now()
            update_weekly_report_delivery_status(
                preference,
                "test_sent",
            )
            db.commit()
            record_weekly_report_delivery_log(
                db,
                auth_context.workspace_id,
                "test_sent",
                delivery_result["recipients"],
                digest.subject,
                delivery_result["delivered_count"],
                len(digest.metrics),
            )

            return build_weekly_report_delivery_response(
                auth_context.workspace_id,
                digest,
                delivery_result["delivered_count"],
                delivery_result["recipients"],
                sent_at,
            )
        except HTTPException as error:
            failure_recipients, delivered_count = (
                get_weekly_report_delivery_failure_details(
                    error,
                    digest,
                )
            )
            update_weekly_report_delivery_status(
                preference,
                "test_failed",
                str(error.detail),
            )
            db.commit()
            record_weekly_report_delivery_log(
                db,
                auth_context.workspace_id,
                "test_failed",
                failure_recipients,
                digest.subject if digest else "",
                delivered_count=delivered_count,
                error=str(error.detail),
                metrics_count=len(digest.metrics) if digest else 0,
            )
            raise error
        except Exception:
            logger.exception(
                "Weekly report test email failed for workspace %s",
                auth_context.workspace_id,
            )
            db.rollback()
            failure_detail = (
                "Weekly report test email could not be sent."
            )
            update_weekly_report_delivery_status(
                preference,
                "test_failed",
                failure_detail,
            )
            db.commit()
            record_weekly_report_delivery_log(
                db,
                auth_context.workspace_id,
                "test_failed",
                digest.recipient_emails if digest else [],
                digest.subject if digest else "",
                error=failure_detail,
                metrics_count=len(digest.metrics) if digest else 0,
            )
            raise HTTPException(
                status_code=502,
                detail=failure_detail,
            ) from None

    finally:
        db.close()


@router.post("/weekly-report/send-due", response_model=WeeklyReportSchedulerResponse)
def send_due_weekly_reports(request: Request):
    from app.modules.reports.jobs import enqueue_weekly

    require_alerts_scheduler_secret(request)
    current_time = get_utc_now()
    delivery_day = get_delivery_day_for_time(current_time)
    results = []
    with SessionLocal() as db:
        preferences = db.query(WeeklyReportPreference).filter_by(enabled=1, delivery_day=delivery_day).all()
        for preference in preferences:
            workspace = preference.workspace_id
            if was_weekly_report_sent_today(preference, current_time):
                results.append({"workspace_id": workspace, "status": "skipped", "detail": "Already sent today"})
                continue
            try:
                job = enqueue_weekly(db, workspace, workspace, preference, send=True, scheduled=True)
                status = "queued" if job.status in {"queued", "running"} else "sent" if job.status == "succeeded" else "skipped" if job.status == "cancelled" else "failed"
                results.append({"workspace_id": workspace, "status": status, "job_id": job.id, "detail": job.error})
            except HTTPException as error:
                db.rollback()
                results.append({"workspace_id": workspace, "status": "deferred" if error.status_code == 429 else "failed",
                                "detail": str(error.detail)})
            except Exception:
                db.rollback()
                logger.exception("Weekly report enqueue failed", extra={"workspace_id": workspace})
                results.append({"workspace_id": workspace, "status": "failed", "detail": "Weekly report could not be queued."})
        return WeeklyReportSchedulerResponse(
            status="processed", delivery_day=delivery_day, processed_count=len(results),
            sent_count=sum(item["status"] == "sent" for item in results),
            queued_count=sum(item["status"] == "queued" for item in results),
            skipped_count=sum(item["status"] in {"skipped", "deferred"} for item in results),
            failed_count=sum(item["status"] == "failed" for item in results), results=results,
        )


@router.put(
    "/weekly-report",
    response_model=WeeklyReportPreferenceResponse,
)
async def update_weekly_report_preference(
    request: Request,
    payload: WeeklyReportPreferenceUpdate,
):
    auth_context = get_auth_context(
        request,
    )
    require_weekly_report_manager(
        auth_context.workspace_role
    )

    clean_recipients = clean_recipient_emails(
        payload.recipient_emails
    )
    clean_day = clean_delivery_day(
        payload.delivery_day
    )
    clean_focus = clean_metric_focus(
        payload.metric_focus
    )
    clean_relationships = clean_relationship_focus(
        payload.relationship_focus
    )
    clean_targets = clean_metric_targets(
        payload.metric_targets,
        clean_focus,
    )
    clean_subject_prefix = clean_optional_text(
        payload.subject_prefix,
        "Subject prefix",
    )

    db = SessionLocal()

    try:
        preference = get_weekly_report_preference_record(
            db,
            auth_context.workspace_id,
        )

        if not preference:
            preference = WeeklyReportPreference(
                workspace_id=auth_context.workspace_id,
            )
            db.add(preference)

        preference.enabled = 1 if payload.enabled else 0
        preference.cadence = "weekly"
        preference.delivery_day = clean_day
        preference.recipient_emails = json.dumps(
            clean_recipients,
            sort_keys=True,
        )
        preference.metric_focus = json.dumps(
            clean_focus,
            sort_keys=True,
        )
        if getattr(preference, "business_report_id", None) or getattr(preference, "weekly_report_definition", None):
            template = weekly_business_template(db, preference, auth_context.workspace_id)
            expected = {f"{item['dataset_id']}:{item['metric_key']}" for item in template["metrics"]} if template else set()
            if set(clean_focus) != expected:
                raise HTTPException(409, "Change the selected metrics on the Weekly reports page before saving delivery settings.")
        preference.metric_targets = json.dumps(
            clean_targets,
            sort_keys=True,
        )
        available_relationship_ids = {
            int(relationship.id)
            for relationship in get_alert_relationships(
                db,
                auth_context.workspace_id,
                clean_relationships,
            )
        }
        invalid_relationship_ids = [
            relationship_id
            for relationship_id in clean_relationships
            if relationship_id not in available_relationship_ids
        ]
        if invalid_relationship_ids:
            raise HTTPException(
                status_code=400,
                detail="One or more selected relationships are not available in this workspace",
            )
        preference.relationship_focus = json.dumps(
            clean_relationships,
            sort_keys=True,
        )
        preference.include_recommendations = (
            1 if payload.include_recommendations else 0
        )
        preference.subject_prefix = clean_subject_prefix
        # Workspace mail transport is platform-managed. Clear legacy values
        # so older workspace SMTP overrides can never be used for delivery.
        preference.sender_name = ""
        preference.sender_email = ""
        preference.reply_to_email = ""
        preference.smtp_host = ""
        preference.smtp_port = None
        preference.smtp_username = ""
        preference.smtp_password = ""
        preference.smtp_use_tls = 1
        preference.smtp_use_ssl = 0
        preference.last_send_error = None
        preference.last_send_status = (
            "configured"
            if payload.enabled
            else "disabled"
        )

        db.commit()
        db.refresh(preference)

        return build_weekly_report_preference_response(
            preference
        )

    finally:
        db.close()
