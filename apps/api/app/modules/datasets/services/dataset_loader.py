from fastapi import HTTPException

from app.modules.datasets.repositories.dataset_repository import (
    get_dataset,
)
from app.modules.datasets.services.analytics_adapters import (
    AnalyticsAdapterUnavailable,
    load_dataset_dataframe,
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
    try:
        return load_dataset_dataframe(
            dataset
        )
    except AnalyticsAdapterUnavailable as error:
        raise HTTPException(
            status_code=503,
            detail=str(error),
        ) from error


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
