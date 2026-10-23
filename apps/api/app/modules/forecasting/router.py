import asyncio
from typing import Literal

from fastapi import Body, HTTPException
from fastapi import Query
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
from app.modules.ai.learning import (
    build_dataset_decision_learning_filter,
    build_workspace_decision_learning_context,
)

from app.modules.forecasting.services import (
    generate_forecast,
)
from app.modules.datasets.services.dimension_filters import DimensionFilter, apply_dimension_filter
from app.modules.datasets.services.metric_selection import build_metric_selection_profile, filter_dataframe_to_selected_metrics

router = APIRouter()


# =========================
# Forecast Dataset Workspace Filter For Shared And Legacy Rows
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
    *, apply_metric_selection=True,
):
    try:
        return load_dataframe_from_dataset(
            dataset, apply_metric_selection=apply_metric_selection,
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
@router.post("/{dataset_id}")
async def get_forecast(
    dataset_id: int,
    request: Request,
    metric: str | None = None,
    start_date: str | None = Query(None),
    period_filter: Literal[
        "1m",
        "1q",
        "6m",
        "1y",
        "2y",
        "3y",
        "5y",
        "all",
    ] = Query("all"),
    aggregation: Literal[
        "daily",
        "weekly",
        "monthly",
        "quarterly",
    ] = Query("monthly"),
    aggregation_type: Literal[
        "sum",
        "count",
        "avg",
        "min",
        "max",
    ] = Query("sum"),
    seasonal_business: bool = Query(False),
    dimension_filter: DimensionFilter | None = Body(None),
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

        dataframe = (load_forecast_dataframe(dataset, apply_metric_selection=False)
                     if dimension_filter is not None else load_forecast_dataframe(dataset))
        if dimension_filter is not None:
            try:
                profile = await asyncio.to_thread(build_metric_selection_profile, dataset, dataframe)
                dataframe = await asyncio.to_thread(
                    apply_dimension_filter, dataset, dataframe, dimension_filter.model_dump(), metrics=[metric] if metric else (),
                )
                if dataframe.empty:
                    raise HTTPException(400, "No observations match the selected dimension values.")
                dataframe = await asyncio.to_thread(filter_dataframe_to_selected_metrics, dataset, dataframe, profile)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error

        learning_context = (
            build_workspace_decision_learning_context(
                db,
                user_id,
                workspace_id,
                base_filter=build_dataset_decision_learning_filter(
                    dataset.id,
                    metric,
                ),
                learning_scope=(
                    "metric"
                    if str(metric or "").strip()
                    else "dataset"
                ),
            )
        )
        forecast = await asyncio.to_thread(
            generate_forecast,
            dataframe,
            metric,
            learning_context,
            workspace_id,
            start_date,
            period_filter,
            aggregation,
            aggregation_type,
            user_id,
            seasonal_business,
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

        historical = forecast.pop(
            "historical",
            None,
        )

        if historical is None:
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
            "dimension_filter": dimension_filter.model_dump() if dimension_filter is not None else None,
            **build_forecast_dataset_metadata(
                dataset
            ),
            "historical": historical,
            "forecast": forecast,
        }

        return response

    finally:
        db.close()
