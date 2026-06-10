import os
import shutil
import uuid

import pandas as pd

from fastapi import APIRouter, HTTPException
from fastapi import File
from fastapi import UploadFile
from fastapi import Request

from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import Dataset

from app.modules.datasets.schemas import DatasetCreate

from app.modules.datasets.services.dataset_loader import (
    load_dataset,
    load_dataframe,
)

from app.modules.datasets.services.preview import (
    generate_preview,
)

from app.modules.datasets.services.metrics import (
    generate_metrics,
)

from app.modules.datasets.services.charts import (
    generate_chart_data,
)

from app.modules.datasets.services.insights import (
    generate_insights,
)

from app.modules.datasets.services.ownership import (
    verify_dataset_owner,
)

router = APIRouter()


@router.post("/")
async def create_dataset(
    request: Request,
    dataset: DatasetCreate,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db: Session = SessionLocal()

    try:
        dataset_record = Dataset(
            user_id=user_id,
            file_name=dataset.file_name,
            file_path="manual_upload",
            row_count=len(dataset.rows),
            column_count=(len(dataset.rows[0]) if dataset.rows else 0),
        )

        db.add(dataset_record)
        db.commit()
        db.refresh(dataset_record)

        return {
            "id": dataset_record.id,
            "user_id": dataset_record.user_id,
            "file_name": dataset_record.file_name,
            "rows": dataset_record.row_count,
            "message": "Dataset saved",
        }

    finally:
        db.close()


@router.post("/upload")
async def upload_dataset(request: Request, file: UploadFile = File(...)):
    os.makedirs("uploads", exist_ok=True)

    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    unique_filename = f"{uuid.uuid4()}-{file.filename}"

    file_path = os.path.join("uploads", unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    dataframe = pd.read_csv(file_path)

    from app.db.database import engine

    db = SessionLocal()

    try:
        dataset = Dataset(
            user_id=user_id,
            file_name=file.filename,
            file_path=file_path,
            row_count=len(dataframe),
            column_count=len(dataframe.columns),
        )

        db.add(dataset)
        db.commit()
        db.refresh(dataset)

        return {
            "id": dataset.id,
            "file_name": dataset.file_name,
            "file_path": dataset.file_path,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
        }

    finally:
        db.close()


@router.get("/")
async def get_datasets(
    request: Request,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        datasets = (
            db.query(Dataset)
            .filter(Dataset.user_id == user_id)
            .order_by(Dataset.created_at.desc())
            .all()
        )

        return [
            {
                "id": dataset.id,
                "user_id": dataset.user_id,
                "file_name": dataset.file_name,
                "row_count": dataset.row_count,
                "column_count": dataset.column_count,
                "created_at": dataset.created_at,
            }
            for dataset in datasets
        ]

    finally:
        db.close()


@router.get("/{dataset_id}")
async def get_dataset(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        return {
            "id": dataset.id,
            "user_id": dataset.user_id,
            "file_name": dataset.file_name,
            "file_path": dataset.file_path,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
            "created_at": dataset.created_at,
        }

    finally:
        db.close()


@router.get("/{dataset_id}/preview")
async def dataset_preview(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "preview": generate_preview(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/metrics")
async def dataset_metrics(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "metrics": generate_metrics(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/insights")
async def dataset_insights(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "insights": generate_insights(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/chart-data")
async def dataset_chart_data(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        return {
            "dataset_id": dataset.id,
            "file_name": dataset.file_name,
            "chart": generate_chart_data(dataframe),
        }

    finally:
        db.close()


@router.get("/{dataset_id}/details")
async def dataset_details(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset, dataframe = load_dataframe(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        return {
            "id": dataset.id,
            "file_name": dataset.file_name,
            "row_count": dataset.row_count,
            "column_count": dataset.column_count,
            "preview": generate_preview(dataframe),
            "metrics": generate_metrics(dataframe),
            "insights": generate_insights(dataframe),
            "chart": generate_chart_data(dataframe),
        }

    finally:
        db.close()


@router.delete("/{dataset_id}")
async def delete_dataset(
    request: Request,
    dataset_id: int,
):
    user_id = request.headers.get("X-User-Id")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user id",
        )

    db = SessionLocal()

    try:
        dataset = load_dataset(
            db,
            dataset_id,
        )

        verify_dataset_owner(
            dataset,
            user_id,
        )

        if dataset.file_path and os.path.exists(dataset.file_path):
            os.remove(dataset.file_path)

        db.delete(dataset)
        db.commit()

        return {"message": "Dataset deleted"}

    finally:
        db.close()



