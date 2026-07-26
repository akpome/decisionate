import asyncio
import json
import logging
import os
import re
from datetime import datetime
from datetime import timezone

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from sqlalchemy import and_
from sqlalchemy import or_

from app.db.database import SessionLocal
from app.db.models import Dataset
from app.db.models import Organization
from app.db.models import WeeklyReportPreference
from app.modules.alerts.email_delivery import (
    is_email_delivery_configured,
    send_weekly_report_email,
)
from app.modules.alerts.schemas import (
    WeeklyReportDeliveryConfigResponse,
    WeeklyReportDeliveryResponse,
    WeeklyReportDigestResponse,
    WeeklyReportPreferenceResponse,
    WeeklyReportSchedulerResponse,
    WeeklyReportPreferenceUpdate,
)
from app.modules.auth_context import (
    get_auth_context,
)
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
from app.modules.datasets.services.metrics import (
    generate_metrics,
)

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


def clean_weekly_report_brand_name(
    value: str | None,
) -> str:
    clean_value = str(
        value or "",
    ).strip()

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


def clean_optional_email(
    value: str | None,
    field_name: str,
) -> str:
    clean_value = clean_optional_text(
        value,
        field_name,
        254,
    ).lower()

    if not clean_value:
        return ""

    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        clean_value,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be a valid email address",
        )

    return clean_value


def clean_optional_port(
    value: int | None,
) -> int | None:
    if value in {
        None,
        "",
    }:
        return None

    try:
        clean_port = int(value)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="SMTP port must be a number",
        ) from None

    if clean_port < 1 or clean_port > 65535:
        raise HTTPException(
            status_code=400,
            detail="SMTP port must be between 1 and 65535",
        )

    return clean_port


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
            include_recommendations=True,
            sender_name="",
            sender_email="",
            reply_to_email="",
            subject_prefix="",
            smtp_host="",
            smtp_port=None,
            smtp_username="",
            smtp_password_set=False,
            smtp_use_tls=True,
            smtp_use_ssl=False,
            last_sent_at=None,
            last_send_status=None,
            last_send_error=None,
        )

    return WeeklyReportPreferenceResponse(
        enabled=bool(preference.enabled),
        cadence=preference.cadence or "weekly",
        delivery_day=preference.delivery_day or "monday",
        recipient_emails=parse_json_list(
            preference.recipient_emails
        ),
        metric_focus=clean_metric_focus(
            parse_json_list(
                preference.metric_focus
            )
        ),
        include_recommendations=bool(
            preference.include_recommendations
        ),
        sender_name=preference.sender_name or "",
        sender_email=preference.sender_email or "",
        reply_to_email=preference.reply_to_email or "",
        subject_prefix=preference.subject_prefix or "",
        smtp_host=preference.smtp_host or "",
        smtp_port=preference.smtp_port,
        smtp_username=preference.smtp_username or "",
        smtp_password_set=bool(
            preference.smtp_password
        ),
        smtp_use_tls=(
            True
            if preference.smtp_use_tls is None
            else bool(preference.smtp_use_tls)
        ),
        smtp_use_ssl=bool(
            preference.smtp_use_ssl
        ),
        last_sent_at=(
            format_sent_at(preference.last_sent_at)
            if preference.last_sent_at
            else None
        ),
        last_send_status=preference.last_send_status,
        last_send_error=preference.last_send_error,
    )


def filter_alert_datasets_for_workspace(
    user_id: str,
    workspace_id: str,
):
    return or_(
        Dataset.workspace_id == workspace_id,
        and_(
            Dataset.workspace_id.is_(None),
            Dataset.user_id == user_id,
        ),
    )


def normalize_metric_key(
    metric: str,
) -> str:
    return str(
        metric or ""
    ).strip().lower()


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


def build_digest_recommendations(
    preference: WeeklyReportPreferenceResponse,
    metrics: list[dict],
    unavailable_datasets: list[str],
) -> list[str]:
    recommendations = []

    if not preference.metric_focus:
        recommendations.append(
            "Select KPI metrics from your datasets before enabling weekly notifications."
        )

    if preference.enabled and not preference.recipient_emails:
        recommendations.append(
            "Add at least one recipient so the enabled KPI notification can be delivered."
        )

    if unavailable_datasets:
        recommendations.append(
            "Review unavailable datasets before sending the next KPI notification."
        )

    if not metrics:
        recommendations.append(
            "No matching dataset metrics are available yet. Upload or sync data with numeric KPI columns."
        )

    for metric in metrics[:3]:
        column = metric["column"]
        dataset_name = metric["dataset_name"]
        total = metric.get("total")
        average = metric.get("average")

        if total is not None:
            recommendations.append(
                f"Review total {column} from {dataset_name}: {total:,.2f}."
            )
        elif average is not None:
            recommendations.append(
                f"Review average {column} from {dataset_name}: {average:,.2f}."
            )

    return recommendations[:5]


def get_weekly_report_brand_name(
    db,
    workspace_id: str,
) -> str:
    organization = (
        db.query(Organization)
        .filter(
            Organization.owner_user_id ==
            workspace_id
        )
        .first()
    )

    if not organization:
        return default_weekly_report_brand_name

    return clean_weekly_report_brand_name(
        organization.report_display_name
        or organization.name
    )


def build_weekly_report_digest(
    preference: WeeklyReportPreferenceResponse,
    datasets,
    brand_name: str | None = None,
    learning_context: dict | None = None,
) -> WeeklyReportDigestResponse:
    clean_brand_name = clean_weekly_report_brand_name(
        brand_name,
    )
    focus_keys = {
        normalize_metric_key(metric)
        for metric in preference.metric_focus
        if normalize_metric_key(metric)
    }
    digest_metrics = []
    unavailable_datasets = []

    for dataset in datasets:
        dataset_name = (
            dataset.file_name
            or f"Dataset {dataset.id}"
        )

        try:
            dataframe = load_dataframe_from_dataset(
                dataset
            )
            dataset_metrics = generate_metrics(
                dataframe
            )
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

            if (
                focus_keys
                and normalize_metric_key(
                    column
                ) not in focus_keys
            ):
                continue

            digest_metrics.append({
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
            })

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
        f"{clean_brand_name} KPI digest — {generated_date}"
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
    preview_text = (
        f"{metric_count} dataset KPI metric"
        f"{'' if metric_count == 1 else 's'} ready for review."
    )
    fallback_recommendations = build_digest_recommendations(
        preference,
        digest_metrics,
        unavailable_datasets,
    )
    ai_facts = {
        "metrics": digest_metrics[:10],
        "unavailable_datasets": unavailable_datasets,
        "metric_focus": preference.metric_focus,
    }

    if learning_context:
        ai_facts["historical_decision_learning"] = learning_context

    ai_analysis = generate_structured_analysis(
        context="weekly KPI alert and report digest",
        facts=ai_facts,
        fallback_summary=preview_text,
        fallback_recommendations=fallback_recommendations,
        fallback_risks=(
            [
                f"Dataset unavailable: {dataset_name}."
                for dataset_name in unavailable_datasets[:5]
            ]
        ),
    )

    if not preference.include_recommendations:
        ai_analysis["recommendations"] = []

    return WeeklyReportDigestResponse(
        enabled=preference.enabled,
        cadence=preference.cadence,
        delivery_day=preference.delivery_day,
        recipient_emails=preference.recipient_emails,
        metric_focus=preference.metric_focus,
        sender_name=preference.sender_name,
        sender_email=preference.sender_email,
        reply_to_email=preference.reply_to_email,
        subject_prefix=subject_prefix,
        brand_name=clean_brand_name,
        subject=subject,
        preview_text=preview_text,
        ai_analysis=ai_analysis,
        dataset_count=len(datasets),
        metrics=digest_metrics,
        recommendations=ai_analysis["recommendations"],
        unavailable_datasets=unavailable_datasets,
    )


def get_alert_datasets(
    db,
    user_id: str,
    workspace_id: str,
):
    return (
        db.query(Dataset)
        .filter(
            filter_alert_datasets_for_workspace(
                user_id,
                workspace_id,
            )
        )
        .order_by(
            Dataset.created_at.desc(),
            Dataset.id.desc(),
        )
        .all()
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
) -> WeeklyReportDigestResponse:
    return build_weekly_report_digest(
        build_weekly_report_preference_response(
            preference
        ),
        get_alert_datasets(
            db,
            user_id,
            workspace_id,
        ),
        get_weekly_report_brand_name(
            db,
            workspace_id,
        ),
        build_workspace_decision_learning_context(
            db,
            user_id,
            workspace_id,
        ),
    )


async def build_weekly_report_digest_for_workspace_async(
    db,
    user_id: str,
    workspace_id: str,
    preference: WeeklyReportPreference | None,
) -> WeeklyReportDigestResponse:
    preference_response = build_weekly_report_preference_response(
        preference
    )
    datasets = get_alert_datasets(
        db,
        user_id,
        workspace_id,
    )
    brand_name = get_weekly_report_brand_name(
        db,
        workspace_id,
    )
    learning_context = (
        build_workspace_decision_learning_context(
            db,
            user_id,
            workspace_id,
        )
    )

    return await asyncio.to_thread(
        build_weekly_report_digest,
        preference_response,
        datasets,
        brand_name,
        learning_context,
    )


def validate_weekly_report_digest_for_delivery(
    digest: WeeklyReportDigestResponse,
):
    if not digest.enabled:
        raise HTTPException(
            status_code=400,
            detail="Weekly KPI email notifications are not enabled",
        )

    if not digest.recipient_emails:
        raise HTTPException(
            status_code=400,
            detail="Add at least one weekly KPI email recipient",
        )

    if not digest.metric_focus:
        raise HTTPException(
            status_code=400,
            detail="Select at least one dataset KPI metric",
        )

    if not digest.metrics:
        raise HTTPException(
            status_code=400,
            detail="No matching dataset KPI metrics are available to send",
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


def build_weekly_report_smtp_settings(
    preference: WeeklyReportPreference | None,
) -> dict:
    if not preference:
        return {}

    return {
        "smtp_host": preference.smtp_host or "",
        "smtp_port": preference.smtp_port,
        "smtp_username": preference.smtp_username or "",
        "smtp_password": preference.smtp_password or "",
        "smtp_use_tls": (
            True
            if preference.smtp_use_tls is None
            else bool(preference.smtp_use_tls)
        ),
        "smtp_use_ssl": bool(
            preference.smtp_use_ssl
        ),
    }


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


def build_weekly_report_test_digest(
    preference: WeeklyReportPreference | None,
    brand_name: str,
) -> WeeklyReportDigestResponse:
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
    subject = (
        f"{clean_brand_name} KPI email test — {generated_date}"
    )

    return WeeklyReportDigestResponse(
        enabled=True,
        cadence="weekly",
        delivery_day=preference_response.delivery_day,
        recipient_emails=preference_response.recipient_emails,
        metric_focus=[],
        sender_name=preference_response.sender_name,
        sender_email=preference_response.sender_email,
        reply_to_email=preference_response.reply_to_email,
        subject_prefix="",
        brand_name=clean_brand_name,
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
    if workspace_role == "client":
        raise HTTPException(
            status_code=403,
            detail="Client users cannot change weekly email report setup",
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
):
    auth_context = get_auth_context(
        request,
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
    db = SessionLocal()

    try:
        workspace_id = getattr(
            auth_context,
            "workspace_id",
            "",
        )
        preference = (
            get_weekly_report_preference_record(
                db,
                workspace_id,
            )
            if isinstance(
                workspace_id,
                str,
            )
            and workspace_id
            else None
        )
        sender_email = (
            preference.sender_email
            if preference
            else ""
        )
        smtp_host = (
            preference.smtp_host
            if preference
            else ""
        )
        ai_status = build_ai_status()

        return WeeklyReportDeliveryConfigResponse(
            email_delivery_configured=is_email_delivery_configured(
                sender_email,
                smtp_host,
            ),
            scheduler_configured=bool(
                get_alerts_scheduler_secret()
            ),
            required_email_environment_keys=[
                *(
                    []
                    if smtp_host
                    else ["SMTP_HOST"]
                ),
                *(
                    []
                    if sender_email
                    else ["SMTP_FROM_EMAIL"]
                ),
            ],
            optional_email_environment_keys=[
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


@router.post(
    "/weekly-report/send",
    response_model=WeeklyReportDeliveryResponse,
)
async def send_weekly_report_now(
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
        digest = await build_weekly_report_digest_for_workspace_async(
            db,
            auth_context.user_id,
            auth_context.workspace_id,
            preference,
        )

        try:
            validate_weekly_report_digest_for_delivery(
                digest
            )
            delivery_result = await asyncio.to_thread(
                send_weekly_report_email,
                digest,
                build_weekly_report_smtp_settings(
                    preference
                ),
            )
            sent_at = get_utc_now()
            update_weekly_report_delivery_status(
                preference,
                "sent",
                sent_at=sent_at,
            )
            db.commit()

            return build_weekly_report_delivery_response(
                auth_context.workspace_id,
                digest,
                delivery_result["delivered_count"],
                delivery_result["recipients"],
                sent_at,
            )
        except HTTPException as error:
            update_weekly_report_delivery_status(
                preference,
                "failed",
                str(error.detail),
            )
            db.commit()
            raise error

    finally:
        db.close()


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
        digest = build_weekly_report_test_digest(
            preference,
            get_weekly_report_brand_name(
                db,
                auth_context.workspace_id,
            ),
        )

        try:
            delivery_result = await asyncio.to_thread(
                send_weekly_report_email,
                digest,
                build_weekly_report_smtp_settings(
                    preference
                ),
            )
            sent_at = get_utc_now()
            update_weekly_report_delivery_status(
                preference,
                "test_sent",
            )
            db.commit()

            return build_weekly_report_delivery_response(
                auth_context.workspace_id,
                digest,
                delivery_result["delivered_count"],
                delivery_result["recipients"],
                sent_at,
            )
        except HTTPException as error:
            update_weekly_report_delivery_status(
                preference,
                "test_failed",
                str(error.detail),
            )
            db.commit()
            raise error

    finally:
        db.close()


@router.post(
    "/weekly-report/send-due",
    response_model=WeeklyReportSchedulerResponse,
)
async def send_due_weekly_reports(
    request: Request,
):
    require_alerts_scheduler_secret(
        request
    )

    current_time = get_utc_now()
    delivery_day = get_delivery_day_for_time(
        current_time
    )
    db = SessionLocal()

    try:
        preferences = (
            db.query(WeeklyReportPreference)
            .filter(
                WeeklyReportPreference.enabled == 1,
                WeeklyReportPreference.delivery_day == delivery_day,
            )
            .all()
        )
        results = []

        for preference in preferences:
            workspace_id = preference.workspace_id

            if was_weekly_report_sent_today(
                preference,
                current_time,
            ):
                results.append({
                    "workspace_id": workspace_id,
                    "status": "skipped",
                    "detail": "Already sent today",
                })
                continue

            try:
                digest = await build_weekly_report_digest_for_workspace_async(
                    db,
                    workspace_id,
                    workspace_id,
                    preference,
                )
                validate_weekly_report_digest_for_delivery(
                    digest
                )
                delivery_result = await asyncio.to_thread(
                    send_weekly_report_email,
                    digest,
                    build_weekly_report_smtp_settings(
                        preference
                    ),
                )
                sent_at = get_utc_now()
                update_weekly_report_delivery_status(
                    preference,
                    "sent",
                    sent_at=sent_at,
                )
                db.commit()
                results.append({
                    "workspace_id": workspace_id,
                    "status": "sent",
                    "delivered_count": delivery_result[
                        "delivered_count"
                    ],
                })
            except HTTPException as error:
                update_weekly_report_delivery_status(
                    preference,
                    "failed",
                    str(error.detail),
                )
                db.commit()
                results.append({
                    "workspace_id": workspace_id,
                    "status": "failed",
                    "detail": str(error.detail),
                })
            except Exception:
                logger.exception(
                    "Scheduled weekly report failed for workspace %s",
                    workspace_id,
                )
                db.rollback()
                failure_detail = (
                    "Weekly report could not be generated or sent."
                )
                update_weekly_report_delivery_status(
                    preference,
                    "failed",
                    failure_detail,
                )
                db.commit()
                results.append({
                    "workspace_id": workspace_id,
                    "status": "failed",
                    "detail": failure_detail,
                })

        sent_count = len([
            result
            for result in results
            if result["status"] == "sent"
        ])
        skipped_count = len([
            result
            for result in results
            if result["status"] == "skipped"
        ])
        failed_count = len([
            result
            for result in results
            if result["status"] == "failed"
        ])

        return WeeklyReportSchedulerResponse(
            status="processed",
            delivery_day=delivery_day,
            processed_count=len(results),
            sent_count=sent_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
            results=results,
        )

    finally:
        db.close()


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
    clean_sender_name = clean_optional_text(
        payload.sender_name,
        "Sender name",
    )
    clean_sender_email = clean_optional_email(
        payload.sender_email,
        "Sender email",
    )
    clean_reply_to_email = clean_optional_email(
        payload.reply_to_email,
        "Reply-to email",
    )
    clean_subject_prefix = clean_optional_text(
        payload.subject_prefix,
        "Subject prefix",
    )
    clean_smtp_host = clean_optional_text(
        payload.smtp_host,
        "SMTP host",
        255,
    )
    clean_smtp_port = clean_optional_port(
        payload.smtp_port
    )
    clean_smtp_username = clean_optional_text(
        payload.smtp_username,
        "SMTP username",
        255,
    )
    clean_smtp_password = clean_optional_text(
        payload.smtp_password,
        "SMTP password",
        2048,
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
        preference.include_recommendations = (
            1 if payload.include_recommendations else 0
        )
        preference.sender_name = clean_sender_name
        preference.sender_email = clean_sender_email
        preference.reply_to_email = clean_reply_to_email
        preference.subject_prefix = clean_subject_prefix
        preference.smtp_host = clean_smtp_host
        preference.smtp_port = clean_smtp_port
        preference.smtp_username = clean_smtp_username

        if payload.smtp_clear_password:
            preference.smtp_password = ""
        elif clean_smtp_password:
            preference.smtp_password = clean_smtp_password

        preference.smtp_use_tls = (
            1 if payload.smtp_use_tls else 0
        )
        preference.smtp_use_ssl = (
            1 if payload.smtp_use_ssl else 0
        )
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
