"""Exact-match customer and product resolution across workspace datasets."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict

import pandas as pd


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

    candidates = requested_columns or []
    if candidates:
        for requested in candidates:
            actual = str(requested)
            normalized = normalize_column_name(actual)
            actual = normalized_columns.get(normalized)
            kind = definitions.get(normalized)
            if actual and kind:
                selected.append({"column": actual, "kind": kind})

    if not selected:
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
        requested = (key_columns or {}).get(str(dataset.id))
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
