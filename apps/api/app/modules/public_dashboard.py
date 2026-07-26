import json
from collections import Counter
from datetime import UTC, datetime
from secrets import compare_digest

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Response
from sqlalchemy import and_
from sqlalchemy import or_
from app.db.database import SessionLocal
from app.db.models import DashboardShare
from app.db.models import Organization
from app.modules.decisions.models import Decision
from app.modules.datasets.services.charts import (
    generate_chart_data,
)
from app.modules.datasets.services.dataset_loader import (
    load_dataframe_from_dataset,
    load_dataset,
)
from app.modules.datasets.services.metrics import (
    generate_metrics,
)
from app.modules.datasets.services.source_metadata import (
    build_dataset_source_metadata,
)
from app.modules.organizations.router import (
    DEFAULT_SELECTED_DASHBOARD,
    VALID_SELECTED_DASHBOARDS,
    clean_dashboard_preferences,
    clean_metric_targets,
    find_user_preference,
)

router = APIRouter()


DEFAULT_PUBLIC_DASHBOARD_BRAND = {
    "name": "Decisionate",
    "logo_url": None,
    "primary_color": "#2563EB",
    "accent_color": "#14B8A6",
}


def parse_json_preference(value: str | None):
    if not value:
        return None

    if isinstance(
        value,
        (
            dict,
            list,
        ),
    ):
        return value

    if not isinstance(
        value,
        str,
    ):
        return None

    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def parse_json_object_preference(value: str | None):
    parsed_value = parse_json_preference(value)

    if isinstance(parsed_value, dict):
        return parsed_value

    return None


def get_dataset_preference_entry(
    preferences,
    dataset_id: int,
):
    if not preferences:
        return None

    dataset_key = str(dataset_id)
    dataset_preference = preferences.get(
        dataset_key
    )

    if isinstance(dataset_preference, dict):
        return {
            dataset_key: dataset_preference,
        }

    return None


def get_clean_dataset_preference_entry(
    preference_json: str | None,
    dataset_id: int,
    cleaner,
):
    cleaned_preferences = cleaner(
        parse_json_object_preference(
            preference_json
        )
    )

    return get_dataset_preference_entry(
        cleaned_preferences,
        dataset_id,
    )


def has_public_decision_text(value):
    return value is not None and str(value).strip() != ""


def build_public_decision_summary(
    db,
    dataset,
):
    query = db.query(Decision).filter(
        Decision.dataset_id == dataset.id,
    )

    if dataset.workspace_id:
        query = query.filter(
            or_(
                Decision.workspace_id == dataset.workspace_id,
                and_(
                    Decision.workspace_id.is_(None),
                    Decision.clerk_user_id == dataset.user_id,
                ),
            )
        )
    else:
        query = query.filter(
            Decision.workspace_id.is_(None),
            Decision.clerk_user_id == dataset.user_id,
        )

    decisions = query.order_by(
        Decision.created_at.asc(),
        Decision.id.asc(),
    ).all()
    active_decisions = [
        decision
        for decision in decisions
        if decision.status != "archived"
    ]
    active_ids = {
        decision.id
        for decision in active_decisions
    }
    archived_count = sum(
        decision.status == "archived"
        for decision in decisions
    )
    today_start = datetime.now(UTC).replace(
        tzinfo=None,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )

    def has_recorded_outcome(decision):
        return (
            has_public_decision_text(
                decision.outcome_status
            )
            or has_public_decision_text(
                decision.actual_outcome
            )
        )

    def has_pending_outcome(decision):
        return (
            decision.id in active_ids
            and has_public_decision_text(
                decision.expected_outcome
            )
            and not has_recorded_outcome(decision)
        )

    def has_pending_learning(decision):
        return (
            decision.id in active_ids
            and has_recorded_outcome(decision)
            and not has_public_decision_text(
                decision.lessons_learned
            )
        )

    overdue_reviews = {
        decision.id
        for decision in active_decisions
        if decision.review_date is not None
        and decision.review_date < today_start
    }
    pending_outcomes = {
        decision.id
        for decision in decisions
        if has_pending_outcome(decision)
    }
    pending_learning = {
        decision.id
        for decision in decisions
        if has_pending_learning(decision)
    }

    return {
        "total": len(decisions),
        "active": len(active_decisions),
        "archived": archived_count,
        "attention_required": len(
            pending_outcomes
            | pending_learning
            | overdue_reviews
        ),
        "learning_captured": sum(
            has_public_decision_text(
                decision.lessons_learned
            )
            for decision in decisions
        ),
        "learning_pending": len(pending_learning),
        "notes_added": sum(
            has_public_decision_text(decision.notes)
            for decision in decisions
        ),
        "notes_pending": sum(
            decision.id in active_ids
            and not has_public_decision_text(
                decision.notes
            )
            for decision in decisions
        ),
        "outcomes_planned": sum(
            has_public_decision_text(
                decision.expected_outcome
            )
            for decision in decisions
        ),
        "outcomes_pending": len(pending_outcomes),
        "outcomes_recorded": sum(
            has_recorded_outcome(decision)
            for decision in decisions
        ),
        "outcomes_evaluated": sum(
            has_public_decision_text(
                decision.outcome_status
            )
            for decision in decisions
        ),
        "reviews_overdue": len(overdue_reviews),
        "reviews_scheduled": sum(
            decision.review_date is not None
            for decision in active_decisions
        ),
        "reviews_upcoming": sum(
            decision.review_date is not None
            and decision.review_date >= today_start
            for decision in active_decisions
        ),
        "by_created_month": dict(
            Counter(
                decision.created_at.strftime("%Y-%m")
                for decision in decisions
                if decision.created_at is not None
            )
        ),
        "by_status": dict(
            Counter(
                decision.status
                for decision in decisions
                if has_public_decision_text(
                    decision.status
                )
            )
        ),
        "by_outcome_status": dict(
            Counter(
                decision.outcome_status
                for decision in decisions
                if has_public_decision_text(
                    decision.outcome_status
                )
            )
        ),
        "by_category": dict(
            Counter(
                decision.category
                for decision in decisions
                if has_public_decision_text(
                    decision.category
                )
            )
        ),
    }


def is_valid_share_token(
    saved_token: str | None,
    request_token: str | None,
):
    normalized_saved_token = normalize_share_token(
        saved_token
    )
    normalized_request_token = normalize_share_token(
        request_token
    )

    if not normalized_saved_token or not normalized_request_token:
        return False

    return compare_digest(
        normalized_saved_token,
        normalized_request_token,
    )


def normalize_share_token(
    token: str | None,
):
    if not isinstance(
        token,
        str,
    ):
        return None

    normalized_token = token.strip()

    return normalized_token or None


def clean_public_dashboard_key(
    dashboard: str | None,
):
    clean_value = str(
        dashboard or DEFAULT_SELECTED_DASHBOARD
    ).strip()

    if clean_value not in VALID_SELECTED_DASHBOARDS:
        raise_shared_dashboard_not_found()

    return clean_value


def find_dashboard_share(
    db,
    dataset_id: int,
    dashboard_key: str,
):
    return (
        db.query(DashboardShare)
        .filter(
            DashboardShare.dataset_id == dataset_id,
            DashboardShare.dashboard_key == dashboard_key,
        )
        .first()
    )


def raise_shared_dashboard_not_found():
    raise HTTPException(
        status_code=404,
        detail="Shared dashboard not found",
        headers={
            "Cache-Control": "no-store",
        },
    )


def get_dashboard_preference(
    db,
    dataset,
):
    return find_user_preference(
        db,
        dataset.user_id,
        dataset.workspace_id,
    )


def build_public_dashboard_dataset_response(
    dataset,
    dataframe,
):
    return {
        "file_name": dataset.file_name,
        "row_count": dataset.row_count,
        **build_dataset_source_metadata(
            dataset
        ),
        "preview": [],
        "metrics": generate_metrics(dataframe),
        "chart": generate_chart_data(dataframe),
    }


def build_public_dashboard_brand_response(
    organization,
):
    if not organization:
        return dict(
            DEFAULT_PUBLIC_DASHBOARD_BRAND,
        )

    return {
        "name": (
            organization.report_display_name
            or organization.name
            or DEFAULT_PUBLIC_DASHBOARD_BRAND["name"]
        ),
        "logo_url": organization.logo_url,
        "primary_color": (
            organization.primary_color
            or DEFAULT_PUBLIC_DASHBOARD_BRAND["primary_color"]
        ),
        "accent_color": (
            organization.accent_color
            or DEFAULT_PUBLIC_DASHBOARD_BRAND["accent_color"]
        ),
    }


def get_public_dashboard_brand(
    db,
    dataset,
):
    workspace_owner_id = str(
        dataset.workspace_id
        or dataset.user_id
        or ""
    ).strip()

    if not workspace_owner_id:
        return build_public_dashboard_brand_response(
            None,
        )

    organization = (
        db.query(Organization)
        .filter(
            Organization.owner_user_id == workspace_owner_id
        )
        .first()
    )

    return build_public_dashboard_brand_response(
        organization,
    )


@router.get("/dashboard/{dataset_id}")
async def get_public_shared_dashboard(
    dataset_id: int,
    response: Response,
    token: str | None = None,
    dashboard: str | None = None,
):
    response.headers["Cache-Control"] = "no-store"

    db = SessionLocal()

    try:
        try:
            dataset = load_dataset(
                db,
                dataset_id,
            )
        except HTTPException as error:
            if error.status_code == 404:
                raise_shared_dashboard_not_found()

            raise

        dashboard_key = clean_public_dashboard_key(
            dashboard
        )

        if dashboard is None:
            saved_share_token = dataset.share_token
        else:
            dashboard_share = find_dashboard_share(
                db,
                dataset.id,
                dashboard_key,
            )
            saved_share_token = (
                dashboard_share.share_token
                if dashboard_share
                else None
            )

        if not is_valid_share_token(
            saved_share_token,
            token,
        ):
            raise_shared_dashboard_not_found()

        try:
            dataframe = load_dataframe_from_dataset(
                dataset
            )
        except HTTPException as error:
            if error.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail="Shared dashboard not found",
                    headers={
                        "Cache-Control": "no-store",
                    },
                ) from error

            raise
        except (FileNotFoundError, OSError):
            raise_shared_dashboard_not_found()

        preference = get_dashboard_preference(
            db,
            dataset,
        )

        metric_targets = (
            get_clean_dataset_preference_entry(
                preference.metric_targets,
                dataset_id,
                clean_metric_targets,
            )
            if preference
            else None
        )
        dashboard_preferences = (
            get_clean_dataset_preference_entry(
                preference.dashboard_preferences,
                dataset_id,
                clean_dashboard_preferences,
            )
            if preference
            else None
        )
        decision_summary = (
            build_public_decision_summary(
                db,
                dataset,
            )
            if dashboard_key == "decision-performance"
            else None
        )

        return {
            "branding": get_public_dashboard_brand(
                db,
                dataset,
            ),
            "dataset": build_public_dashboard_dataset_response(
                dataset,
                dataframe,
            ),
            "preference": {
                "metric_targets": metric_targets,
                "dashboard_preferences": dashboard_preferences,
            },
            "decision_summary": decision_summary,
        }

    finally:
        db.close()
