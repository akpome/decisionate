from fastapi import HTTPException

from app.modules.datasets.repositories.dataset_repository import (
    get_dataset,
)
from app.modules.datasets.services.analytics_adapters import (
    AnalyticsAdapterUnavailable,
    load_dataset_dataframe,
)
from app.modules.datasets.services.metric_selection import (
    filter_dataframe_to_selected_metrics,
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
    apply_metric_selection: bool = True,
):
    try:
        dataframe = load_dataset_dataframe(
            dataset
        )
        if apply_metric_selection:
            return filter_dataframe_to_selected_metrics(
                dataset,
                dataframe,
            )
        return dataframe
    except AnalyticsAdapterUnavailable as error:
        raise HTTPException(
            status_code=503,
            detail=str(error),
        ) from error


def load_dataframe(
    db,
    dataset_id: int,
    apply_metric_selection: bool = True,
):
    dataset = load_dataset(
        db,
        dataset_id,
    )

    dataframe = (
        load_dataframe_from_dataset(
            dataset,
            apply_metric_selection=apply_metric_selection,
        )
    )

    return dataset, dataframe
