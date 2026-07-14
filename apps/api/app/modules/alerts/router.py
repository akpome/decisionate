import json
import re

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from app.db.database import SessionLocal
from app.db.models import WeeklyReportPreference
from app.modules.alerts.schemas import (
    WeeklyReportPreferenceResponse,
    WeeklyReportPreferenceUpdate,
)
from app.modules.auth_context import (
    get_auth_context,
)

router = APIRouter()

allowed_delivery_days = {
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
}

allowed_metric_focus = {
    "revenue",
    "customers",
    "profit",
    "expenses",
}


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

    for metric in metric_focus or []:
        if not isinstance(
            metric,
            str,
        ):
            continue

        clean_metric = metric.strip().lower()

        if (
            clean_metric in allowed_metric_focus
            and clean_metric not in clean_values
        ):
            clean_values.append(clean_metric)

    return clean_values or [
        "revenue",
        "customers",
    ]


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
            metric_focus=[
                "revenue",
                "customers",
            ],
            include_recommendations=True,
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
        preference = (
            db.query(WeeklyReportPreference)
            .filter(
                WeeklyReportPreference.workspace_id ==
                auth_context.workspace_id
            )
            .first()
        )

        return build_weekly_report_preference_response(
            preference
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

    db = SessionLocal()

    try:
        preference = (
            db.query(WeeklyReportPreference)
            .filter(
                WeeklyReportPreference.workspace_id ==
                auth_context.workspace_id
            )
            .first()
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

        db.commit()
        db.refresh(preference)

        return build_weekly_report_preference_response(
            preference
        )

    finally:
        db.close()
