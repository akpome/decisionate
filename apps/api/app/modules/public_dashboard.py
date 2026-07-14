import json
from secrets import compare_digest

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Response
from app.db.database import SessionLocal
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
    clean_dashboard_preferences,
    clean_metric_targets,
    find_user_preference,
)

router = APIRouter()


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
        **build_dataset_source_metadata(
            dataset
        ),
        "preview": [],
        "metrics": generate_metrics(dataframe),
        "chart": generate_chart_data(dataframe),
    }


@router.get("/dashboard/{dataset_id}")
async def get_public_shared_dashboard(
    dataset_id: int,
    response: Response,
    token: str | None = None,
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

        if not is_valid_share_token(
            dataset.share_token,
            token,
        ):
            raise_shared_dashboard_not_found()

        try:
            dataframe = load_dataframe_from_dataset(
                dataset
            )
        except HTTPException as error:
            raise HTTPException(
                status_code=404,
                detail="Shared dashboard not found",
                headers={
                    "Cache-Control": "no-store",
                },
            ) from error
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

        return {
            "dataset": build_public_dashboard_dataset_response(
                dataset,
                dataframe,
            ),
            "preference": {
                "metric_targets": metric_targets,
                "dashboard_preferences": dashboard_preferences,
            },
        }

    finally:
        db.close()
