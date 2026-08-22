"""Persistence helpers for reproducible joined dashboard evidence."""

from __future__ import annotations

import hashlib
import json

from app.infrastructure.object_storage import (
    get_dataset_storage_reference,
    get_object_storage,
)
from app.modules.datasets.services.joins import (
    JOIN_RESULT_VERSION,
)


def build_join_definition(
    selections,
    start_date: str | None,
    period_filter: str,
    aggregation: str,
    aggregation_type: str,
):
    return {
        "join_version": JOIN_RESULT_VERSION,
        "selections": [
            {
                "dataset_id": int(selection["dataset_id"]),
                "date_column": selection.get("date_column"),
                "metric_column": selection.get("metric_column"),
            }
            for selection in sorted(
                selections,
                key=lambda item: int(item["dataset_id"]),
            )
        ],
        "start_date": start_date,
        "period_filter": period_filter,
        "aggregation": aggregation,
        "aggregation_type": aggregation_type,
    }


def build_dataset_source_fingerprint(datasets):
    sources = []

    for dataset in sorted(
        datasets,
        key=lambda item: int(item.id),
    ):
        source = {
            "id": int(dataset.id),
            "file_path": get_dataset_storage_reference(dataset),
            "source_type": str(dataset.source_type or ""),
            "row_count": int(dataset.row_count or 0),
            "column_count": int(dataset.column_count or 0),
        }

        source_metadata = get_object_storage().fingerprint(
            get_dataset_storage_reference(dataset)
        )
        if source_metadata:
            source.update(source_metadata)

        sources.append(source)

    payload = json.dumps(
        sources,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def build_join_cache_definition_json(definition):
    return json.dumps(
        definition,
        sort_keys=True,
        separators=(",", ":"),
    )


def build_join_cache_dataset_ids_json(dataset_ids):
    return json.dumps(
        sorted({int(dataset_id) for dataset_id in dataset_ids}),
        separators=(",", ":"),
    )
