"""Exact-match customer and product resolution across workspace datasets."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import defaultdict

import pandas as pd

from app.modules.datasets.services.numeric import (
    coerce_numeric_series,
    get_numeric_columns,
    is_identifier_column,
)


ENTITY_FIELD_DEFINITIONS = {
    "customer": (
        ("customer_id", "identifier"),
        ("customerid", "identifier"),
        ("contact_id", "identifier"),
        ("contactid", "identifier"),
        ("account_id", "identifier"),
        ("accountid", "identifier"),
        ("external_customer_id", "identifier"),
        ("customer_email", "email"),
        ("email_address", "email"),
        ("email", "email"),
        ("phone", "phone"),
        ("customer_name", "name"),
        ("contact_name", "name"),
        ("account_name", "name"),
        ("company_name", "name"),
        ("name", "name"),
    ),
    "product": (
        ("product_id", "identifier"),
        ("productid", "identifier"),
        ("item_id", "identifier"),
        ("itemid", "identifier"),
        ("variant_id", "identifier"),
        ("external_product_id", "identifier"),
        ("sku", "sku"),
        ("product_sku", "sku"),
        ("item_sku", "sku"),
        ("product_name", "name"),
        ("item_name", "name"),
        ("name", "name"),
    ),
}

FIELD_WEIGHTS = {
    "identifier": ("exact_identifier", 1.0),
    "email": ("exact_email", 1.0),
    "sku": ("exact_sku", 1.0),
    "phone": ("exact_phone", 0.95),
    "name": ("exact_name", 0.75),
    "custom": ("explicit_column", 0.8),
}


def normalize_column_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")


def normalize_entity_value(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    normalized = unicodedata.normalize("NFKC", str(value)).strip().lower()
    normalized = re.sub(r"\s+", " ", normalized)
    return re.sub(r"[^a-z0-9@.+\- ]+", "", normalized).strip()


def infer_entity_columns(
    dataframe: pd.DataFrame,
    entity_type: str,
    requested_columns: list[str] | None = None,
) -> list[dict[str, str]]:
    definitions = dict(ENTITY_FIELD_DEFINITIONS[entity_type])
    normalized_columns = {
        normalize_column_name(column): str(column)
        for column in dataframe.columns
    }
    selected: list[dict[str, str]] = []

    candidates = requested_columns
    if candidates is not None:
        for requested in candidates:
            actual = str(requested)
            normalized = normalize_column_name(actual)
            actual = normalized_columns.get(normalized)
            kind = definitions.get(normalized, "custom")
            if actual:
                selected.append({"column": actual, "kind": kind})

    if requested_columns is None:
        for normalized, kind in definitions.items():
            actual = normalized_columns.get(normalized)
            if actual:
                selected.append({"column": actual, "kind": kind})

    return selected


def _row_candidates(
    dataframe: pd.DataFrame,
    entity_type: str,
    requested_columns: list[str] | None = None,
) -> tuple[list[dict], list[dict]]:
    fields = infer_entity_columns(dataframe, entity_type, requested_columns)
    rows: list[dict] = []
    unmatched: list[dict] = []

    for row_number, (_, row) in enumerate(dataframe.iterrows()):
        values = []
        for field in fields:
            value = normalize_entity_value(row.get(field["column"]))
            if not value:
                continue
            values.append({
                "kind": field["kind"],
                "column": field["column"],
                "value": value,
                "key": f"{field['kind']}:{value}",
            })

        if not values:
            unmatched.append({"row_number": row_number})
            continue

        values.sort(
            key=lambda item: (
                FIELD_WEIGHTS[item["kind"]][1],
                -len(item["value"]),
            ),
            reverse=True,
        )
        name_value = next(
            (item["value"] for item in values if item["kind"] == "name"),
            None,
        )
        rows.append({
            "row_number": row_number,
            "keys": [item["key"] for item in values],
            "primary": values[0],
            "display_name": name_value or values[0]["value"],
        })

    return rows, unmatched


def build_entity_resolution(
    dataset_frames: list[tuple[object, pd.DataFrame]],
    entity_type: str,
    key_columns: dict[str, list[str]] | None = None,
) -> dict:
    """Build deterministic exact-match groups without calling an LLM."""
    records = []
    dataset_summaries = []
    unmatched_count = 0

    for dataset, dataframe in dataset_frames:
        requested = None
        if key_columns is not None and str(dataset.id) in key_columns:
            requested = key_columns[str(dataset.id)]
        candidates, unmatched = _row_candidates(
            dataframe,
            entity_type,
            requested,
        )
        unmatched_count += len(unmatched)
        for candidate in candidates:
            records.append({
                **candidate,
                "dataset_id": int(dataset.id),
                "file_name": str(dataset.file_name),
                "source_type": str(dataset.source_type or "csv"),
                "source_row_key": str(candidate["row_number"]),
            })
        detected_fields = infer_entity_columns(
            dataframe,
            entity_type,
            requested,
        )
        dataset_summaries.append({
            "dataset_id": int(dataset.id),
            "file_name": str(dataset.file_name),
            "source_type": str(dataset.source_type or "csv"),
            "key_columns": [
                field["column"]
                for field in detected_fields
            ],
            "candidate_row_count": len(candidates),
            "unmatched_row_count": len(unmatched),
        })

    parent = list(range(len(records)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    first_by_key: dict[str, int] = {}
    for index, record in enumerate(records):
        for key in record["keys"]:
            previous = first_by_key.get(key)
            if previous is None:
                first_by_key[key] = index
            else:
                union(index, previous)

    grouped: defaultdict[int, list[dict]] = defaultdict(list)
    for index, record in enumerate(records):
        grouped[find(index)].append(record)

    entities = []
    for members in sorted(
        grouped.values(),
        key=lambda group: (
            str(group[0]["display_name"]),
            int(group[0]["dataset_id"]),
            int(group[0]["row_number"]),
        ),
    ):
        keys = sorted({key for member in members for key in member["keys"]})
        digest = hashlib.sha256("|".join(keys).encode("utf-8")).hexdigest()[:24]
        primary = max(
            members,
            key=lambda member: (
                FIELD_WEIGHTS[member["primary"]["kind"]][1],
                -int(member["dataset_id"]),
            ),
        )
        confidence = min(
            FIELD_WEIGHTS[member["primary"]["kind"]][1]
            for member in members
        )
        entities.append({
            "canonical_key": f"{entity_type}:{digest}",
            "display_name": primary["display_name"],
            "keys": keys,
            "confidence": confidence,
            "source_count": len({member["dataset_id"] for member in members}),
            "match_count": len(members),
            "records": members,
        })

    matched_row_count = sum(
        entity["match_count"]
        for entity in entities
        if entity["source_count"] > 1
    )
    total_candidate_rows = len(records) + unmatched_count

    return {
        "entity_type": entity_type,
        "datasets": dataset_summaries,
        "candidate_row_count": len(records),
        "matched_group_count": len(entities),
        "matched_row_count": matched_row_count,
        "unmatched_row_count": max(
            0,
            total_candidate_rows - matched_row_count,
        ),
        "entities": entities,
    }


def confidence_bucket(value: float) -> str:
    if value >= 0.99:
        return "high"
    if value >= 0.9:
        return "medium"
    return "review"


def build_unified_entity_dataframe(
    dataset_frames: list[tuple[object, pd.DataFrame]],
    resolution: dict,
    canonical_entity_ids: dict[str, int] | None = None,
    metric_columns_by_dataset: dict[str, list[str]] | None = None,
) -> pd.DataFrame:
    """Build one persistent analytical row for each resolved entity.

    Source rows are grouped by canonical identity. Numeric non-identifier
    fields are summed across sources, while descriptive fields retain the
    first available value. Source lineage remains available in the output and
    the full row-level mapping remains in ``EntityIdentity``.
    """
    frames_by_dataset_id = {
        int(dataset.id): (dataset, dataframe)
        for dataset, dataframe in dataset_frames
    }
    source_columns: list[str] = []
    numeric_series_by_dataset: dict[int, dict[str, pd.Series]] = {}
    selected_columns_by_dataset: dict[int, list[tuple[object, str]]] = {}

    for dataset, dataframe in dataset_frames:
        dataset_key = str(dataset.id)
        requested_columns = (
            metric_columns_by_dataset[dataset_key]
            if metric_columns_by_dataset is not None
            and dataset_key in metric_columns_by_dataset
            else None
        )
        column_lookup = {
            str(column): column
            for column in dataframe.columns
        }
        if requested_columns is None:
            selected_columns = [
                (column, str(column))
                for column, _series in get_numeric_columns(dataframe)
                if not is_identifier_column(column)
            ]
        else:
            selected_columns = []
            for requested in requested_columns:
                actual = column_lookup.get(str(requested))
                if actual is None:
                    continue
                if all(
                    str(actual) != selected_name
                    for _selected, selected_name in selected_columns
                ):
                    selected_columns.append((actual, str(actual)))

        selected_columns_by_dataset[int(dataset.id)] = selected_columns
        for _column, column_name in selected_columns:
            if column_name not in source_columns:
                source_columns.append(column_name)

        numeric_series: dict[str, pd.Series] = {}
        numeric_columns = {
            str(column): series
            for column, series in get_numeric_columns(dataframe)
        }
        for _column, column_name in selected_columns:
            series = numeric_columns.get(column_name)
            if series is None:
                continue
            if is_identifier_column(column_name):
                continue
            numeric_series[column_name] = coerce_numeric_series(series)
        numeric_series_by_dataset[int(dataset.id)] = numeric_series

    metadata_columns = {
        "canonical_entity_id",
        "canonical_entity_key",
        "entity_type",
        "canonical_name",
        "match_confidence",
        "source_count",
        "source_record_count",
        "source_dataset_ids",
        "source_datasets",
        "source_types",
        "source_records",
    }
    source_column_aliases = {
        column: (
            f"source_{column}"
            if column in metadata_columns
            else column
        )
        for column in source_columns
    }

    rows: list[dict] = []
    id_lookup = canonical_entity_ids or {}
    for entity in resolution.get("entities", []):
        members = entity.get("records") or []
        source_dataset_ids = sorted({
            int(member["dataset_id"])
            for member in members
            if member.get("dataset_id") is not None
        })
        source_datasets = []
        source_types = []
        source_records = []
        first_values: dict[str, object] = {}
        numeric_totals: dict[str, float] = {}

        for member in members:
            dataset_id = int(member["dataset_id"])
            dataset_entry = frames_by_dataset_id.get(dataset_id)
            if not dataset_entry:
                continue
            dataset, dataframe = dataset_entry
            row_number = int(member["row_number"])
            if row_number < 0 or row_number >= len(dataframe):
                continue

            source_type = str(dataset.source_type or "csv")
            source_datasets.append(str(dataset.file_name))
            source_types.append(source_type)
            if len(source_records) < 100:
                source_records.append({
                    "dataset_id": dataset_id,
                    "file_name": str(dataset.file_name),
                    "source_type": source_type,
                    "row": row_number + 1,
                    "source_row_key": str(member.get("source_row_key") or row_number),
                })

            row = dataframe.iloc[row_number]
            numeric_series = numeric_series_by_dataset.get(dataset_id, {})
            for column, column_name in selected_columns_by_dataset.get(
                dataset_id,
                [],
            ):
                output_column = source_column_aliases[column_name]
                if column_name in numeric_series:
                    value = numeric_series[column_name].iloc[row_number]
                    if pd.notna(value):
                        numeric_totals[output_column] = (
                            numeric_totals.get(output_column, 0.0)
                            + float(value)
                        )
                    continue
                if output_column in first_values:
                    continue
                value = row.get(column)
                if value is None or pd.isna(value):
                    continue
                if not str(value).strip():
                    continue
                first_values[output_column] = value

        row = {
            "canonical_entity_id": id_lookup.get(entity["canonical_key"]),
            "canonical_entity_key": entity["canonical_key"],
            "entity_type": resolution.get("entity_type"),
            "canonical_name": entity.get("display_name"),
            "match_confidence": entity.get("confidence"),
            "source_count": len(source_dataset_ids),
            "source_record_count": len(members),
            "source_dataset_ids": json.dumps(source_dataset_ids),
            "source_datasets": ", ".join(sorted(set(source_datasets))),
            "source_types": ", ".join(sorted(set(source_types))),
            "source_records": json.dumps(source_records, sort_keys=True),
        }
        row.update(first_values)
        row.update(numeric_totals)
        rows.append(row)

    return pd.DataFrame(rows)
