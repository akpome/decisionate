import json
import os
import re

from app.modules.datasets.services.file_loader import (
    sanitize_upload_filename,
)
from app.modules.datasets.services.sources import (
    get_dataset_source,
    normalize_dataset_source_type,
    IMPLEMENTED_CONNECTOR_TYPES,
)


def build_connector_dataset_filename(
    source_type,
    report_config,
):
    """Build a stable connector object name without a sync-date suffix."""
    normalized_source = normalize_dataset_source_type(
        source_type
    )
    config = report_config if isinstance(report_config, dict) else {}
    raw_resource = (
        config.get("resource")
        or config.get("resource_type")
        or config.get("object_type")
    )
    resource = str(raw_resource or "").strip().lower()
    resource = re.sub(
        r"[^a-z0-9_-]+",
        "_",
        resource,
    ).strip("_")
    resource_suffix = f"-{resource}" if resource else ""
    return sanitize_upload_filename(
        f"{normalized_source}{resource_suffix}-dataset.csv"
    )


def connector_dataset_display_name(
    dataset,
):
    """Return the stable name shown for connector-backed datasets."""
    source_type = normalize_dataset_source_type(
        dataset.source_type
    )
    if source_type not in IMPLEMENTED_CONNECTOR_TYPES:
        return dataset.file_name

    raw_source_config = getattr(dataset, "source_config", None)
    if isinstance(raw_source_config, dict):
        source_config = raw_source_config
    else:
        try:
            source_config = json.loads(raw_source_config or "{}")
        except (TypeError, json.JSONDecodeError):
            source_config = {}
    if not isinstance(source_config, dict):
        source_config = {}

    return (
        os.path.splitext(
            build_connector_dataset_filename(
                source_type,
                source_config,
            )
        )[0]
        + ".parquet"
    )


def build_dataset_source_metadata(
    dataset,
):
    source_type = normalize_dataset_source_type(
        getattr(
            dataset,
            "source_type",
            None,
        )
    )
    source = get_dataset_source(
        source_type
    )

    return {
        "source_type": source_type,
        "source_label": (
            source["label"]
            if source
            else source_type
        ),
        "source_config": getattr(
            dataset,
            "source_config",
            None,
        ),
    }
