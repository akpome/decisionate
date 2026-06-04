from fastapi import HTTPException

from app.db.models import Dataset


def verify_dataset_owner(
    dataset: Dataset,
    user_id: str,
):
    if dataset.user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Access denied",
        )
