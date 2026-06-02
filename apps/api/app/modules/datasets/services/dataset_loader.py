import pandas as pd

from fastapi import HTTPException

from app.modules.datasets.repositories.dataset_repository import (
    get_dataset,
)


def load_dataset(
    db,
    dataset_id: int,
):
    dataset = get_dataset(
        db,
        dataset_id,
    )

    if not dataset:
        raise HTTPException(
            status_code=404,
            detail="Dataset not found",
        )

    return dataset


def load_dataframe_from_dataset(
    dataset,
):
    return pd.read_csv(
        dataset.file_path
    )


def load_dataframe(
    db,
    dataset_id: int,
):
    dataset = load_dataset(
        db,
        dataset_id,
    )

    dataframe = (
        load_dataframe_from_dataset(
            dataset
        )
    )

    return dataset, dataframe