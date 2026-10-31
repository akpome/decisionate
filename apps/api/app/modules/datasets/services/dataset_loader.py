import logging
from functools import partial

from fastapi import HTTPException

from app.infrastructure.object_storage import (
    ObjectStorageUnavailable,
)
from app.modules.datasets.repositories.dataset_repository import (
    get_dataset,
)
from app.modules.datasets.services.analytics_adapters import (
    AnalyticsAdapterUnavailable,
    load_dataset_dataframe,
)
from app.modules.datasets.services.metric_selection import (
    filter_dataframe_to_selected_metrics,
    parse_dataset_source_config,
)
from app.modules.datasets.services.connectors import (
    normalize_connector_dataframe_dates,
    normalize_connector_row_schema,
)
from app.modules.datasets.services.sources import (
    IMPLEMENTED_CONNECTOR_TYPES,
)
from app.modules.datasets.services.receipt_metrics import receipt_metric_columns, receipt_projection


logger = logging.getLogger(__name__)


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
    config = parse_dataset_source_config(dataset)
    if apply_metric_selection and getattr(dataset, "source_type", None) == "entity_matching" and not config.get("entity_history"):
        from app.modules.datasets.services.entity_history import LEGACY_SUMMARY_MESSAGE
        raise HTTPException(status_code=422, detail=LEGACY_SUMMARY_MESSAGE)
    try:
        source_type = str(getattr(dataset, "source_type", "") or "").strip().lower()
        if apply_metric_selection and receipt_metric_columns(source_type, config, ()) is not None:
            dataframe = load_dataset_dataframe(
                dataset, column_selector=partial(receipt_projection, source_type, config),
            )
        else:
            dataframe = load_dataset_dataframe(dataset)
        if source_type in (
            IMPLEMENTED_CONNECTOR_TYPES
        ):
            dataframe = normalize_connector_row_schema(
                dataframe, source_type, config.get("resource") or config.get("resource_type"),
            )
            dataframe = normalize_connector_dataframe_dates(dataframe)
        if source_type == "entity_matching" and config.get("entity_history"):
            from copy import deepcopy
            from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
            dataframe.attrs[FRAME_POLICY_KEY] = deepcopy(config["entity_history"]["policy"])
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
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail="Dataset file not found",
        ) from error
    except ObjectStorageUnavailable as error:
        raise HTTPException(
            status_code=503,
            detail="Dataset storage is temporarily unavailable. Try again shortly.",
        ) from error
    except OSError as error:
        raise HTTPException(
            status_code=503,
            detail="Dataset storage is temporarily unavailable. Try again shortly.",
        ) from error
    except Exception as error:
        logger.exception(
            "Dataset dataframe loading failed",
            extra={
                "dataset_id": getattr(dataset, "id", None),
            },
        )
        raise HTTPException(
            status_code=503,
            detail="Dataset data is temporarily unavailable. Try again shortly.",
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
