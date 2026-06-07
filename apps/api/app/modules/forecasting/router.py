import pandas as pd

from fastapi import HTTPException
from fastapi import Request, APIRouter

from app.db.database import SessionLocal
from app.db.models import Dataset

from app.modules.forecasting.services import (
    generate_forecast,
)

router = APIRouter()


@router.get("/test")
async def test_forecasting():
    return {"message": "Forecasting module working"}


@router.get("/{dataset_id}")
async def get_forecast(
    dataset_id: int,
    request: Request,
    metric: str | None = None,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset = (
            db.query(Dataset)
            .filter(
                Dataset.id == dataset_id,
                Dataset.user_id == user_id,
            )
            .first()
        )

        if not dataset:
            raise HTTPException(
                status_code=404,
                detail="Dataset not found",
            )

        dataframe = pd.read_csv(
            dataset.file_path
        )

        print(
            dataframe.head().to_dict(
                orient="records"
            )
        )

        forecast = generate_forecast(
            dataframe,
            metric
        )

        date_column = forecast[
            "date_column"
        ]

        value_column = forecast[
            "value_column"
        ]

        historical = (
            dataframe[
                [
                    date_column,
                    value_column,
                ]
            ]
            .tail(12)
            .to_dict(
                orient="records"
            )
        )

        response = {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "historical": historical,
            "forecast": forecast,
        }

        print(response)

        return response

    finally:
        db.close()
