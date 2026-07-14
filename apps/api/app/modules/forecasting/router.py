from fastapi import HTTPException
from fastapi import Request, APIRouter

from sqlalchemy import and_, or_

from app.db.database import SessionLocal
from app.db.models import Dataset

from app.modules.datasets.services.auth import (
    get_user_id,
    get_workspace_id,
)
from app.modules.datasets.services.serialization import (
    dataframe_to_json_records,
)
from app.modules.datasets.services.dataset_loader import (
    load_dataframe_from_dataset,
)
from app.modules.datasets.services.source_metadata import (
    build_dataset_source_metadata,
)

from app.modules.forecasting.services import (
    generate_forecast,
)

router = APIRouter()


# =========================
# Forecast Dataset Workspace Filter For Shared Agency And Legacy Rows
# =========================

def filter_forecast_dataset_for_workspace(
    dataset_id: int,
    user_id: str,
    workspace_id: str,
):
    clean_user_id = str(
        user_id or ""
    ).strip()
    clean_workspace_id = str(
        workspace_id or ""
    ).strip()

    return and_(
        Dataset.id == dataset_id,
        or_(
            Dataset.workspace_id == clean_workspace_id,
            and_(
                Dataset.workspace_id.is_(None),
                Dataset.user_id == clean_user_id,
            ),
        ),
    )


def load_forecast_dataframe(
    dataset,
):
    try:
        return load_dataframe_from_dataset(
            dataset
        )
    except (FileNotFoundError, OSError) as error:
        raise HTTPException(
            status_code=404,
            detail="Dataset file not found",
        ) from error


def build_forecast_dataset_metadata(
    dataset,
):
    return {
        "dataset_id": dataset.id,
        "file_name": dataset.file_name,
        **build_dataset_source_metadata(
            dataset
        ),
    }


@router.get("/test")
async def test_forecasting():
    return {"message": "Forecasting module working"}


@router.get("/{dataset_id}")
async def get_forecast(
    dataset_id: int,
    request: Request,
    metric: str | None = None,
):
    user_id = get_user_id(request)
    workspace_id = get_workspace_id(
        request,
        user_id,
    )

    db = SessionLocal()

    try:
        dataset = (
            db.query(Dataset)
            .filter(
                filter_forecast_dataset_for_workspace(
                    dataset_id,
                    user_id,
                    workspace_id,
                )
            )
            .first()
        )

        if not dataset:
            raise HTTPException(
                status_code=404,
                detail="Dataset not found",
            )

        dataframe = load_forecast_dataframe(
            dataset
        )

        forecast = generate_forecast(
            dataframe,
            metric
        )

        if "error" in forecast:
            raise HTTPException(
                status_code=400,
                detail=forecast["error"],
            )

        date_column = forecast[
            "date_column"
        ]

        value_column = forecast[
            "value_column"
        ]

        historical = (
            dataframe_to_json_records(
                dataframe[
                    [
                        date_column,
                        value_column,
                    ]
                ]
                .tail(12)
            )
        )

        response = {
            **build_forecast_dataset_metadata(
                dataset
            ),
            "historical": historical,
            "forecast": forecast,
        }

        return response

    finally:
        db.close()
