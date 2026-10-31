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

    if not fields:
        return rows, [{"row_number": index} for index in range(len(dataframe))]

    # Read only identity columns and preserve their types (iterrows can turn
    # integer IDs into floats when another column contains decimal values).
    identity_rows = dataframe[[field["column"] for field in fields]].itertuples(index=False, name=None)
    for row_number, row in enumerate(identity_rows):
        values = []
        for field, raw_value in zip(fields, row):
            value = normalize_entity_value(raw_value)
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
    approved_match_keys: list[str] | None = None,
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

    strengths = [1.0] * len(records)

    def union(left: int, right: int, strength: float) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root
            strengths[left_root] = min(strengths[left_root], strengths[right_root], strength)

    by_key: defaultdict[str, list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        for key in record["keys"]:
            by_key[key].append(index)
    # Strong shared keys join first. A name bridge must not inherit the
    # confidence of an unrelated email or a source-local customer ID.
    def key_strength(key):
        kind = key.split(":", 1)[0]
        return 0.8 if kind == "identifier" else FIELD_WEIGHTS[kind][1]

    for key in sorted(by_key, key=lambda key: (-key_strength(key), key)):
        indexes = by_key[key]
        for index in indexes[1:]:
            local_identifier = key.startswith("identifier:") and records[indexes[0]]["dataset_id"] == records[index]["dataset_id"]
            union(indexes[0], index, 1.0 if local_identifier else key_strength(key))

    grouped: defaultdict[int, list[dict]] = defaultdict(list)
    record_indexes = {}
    for index, record in enumerate(records):
        grouped[find(index)].append(record)
        record_indexes[(record["dataset_id"], record["row_number"])] = index

    entities = []
    def identity_key(members):
        values = sorted({key for member in members for key in member["keys"]})
        values += sorted({f"source:{member['dataset_id']}" for member in members})
        return f"{entity_type}:" + hashlib.sha256("|".join(values).encode()).hexdigest()[:24]

    for members in sorted(
        grouped.values(),
        key=lambda group: (
            str(group[0]["display_name"]),
            int(group[0]["dataset_id"]),
            int(group[0]["row_number"]),
        ),
    ):
        keys = sorted({key for member in members for key in member["keys"]})
        signature = "|".join(keys + sorted(f"{m['dataset_id']}:{m['source_row_key']}" for m in members))
        digest = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:24]
        primary = max(
            members,
            key=lambda member: (
                FIELD_WEIGHTS[member["primary"]["kind"]][1],
                -int(member["dataset_id"]),
            ),
        )
        confidence = strengths[find(record_indexes[(members[0]["dataset_id"], members[0]["row_number"])])]
        entities.append({
            "canonical_key": identity_key(members),
            "review_key": digest,
            "display_name": primary["display_name"],
            "keys": keys,
            "confidence": confidence,
            "source_count": len({member["dataset_id"] for member in members}),
            "match_count": len(members),
            "records": members,
        })

    review_groups = [entity for entity in entities if entity["match_count"] > 1 and entity["confidence"] < 0.99]
    if approved_match_keys is not None:
        approved = set(approved_match_keys).intersection(entity["review_key"] for entity in review_groups[:100] if entity["match_count"] <= 20)
        review_keys = {entity["canonical_key"] for entity in review_groups}
        resolved = []
        for entity in entities:
            if entity["canonical_key"] not in review_keys or entity["review_key"] in approved:
                entity["confirmed"] = entity["review_key"] in approved
                resolved.append(entity)
                continue
            # Remove weak bridges, preserving independently verified links.
            indexes = [record_indexes[(member["dataset_id"], member["row_number"])] for member in entity["records"]]
            for index in indexes:
                parent[index], strengths[index] = index, 1.0
            safe_keys = {}
            for index in indexes:
                member = records[index]
                for key in member["keys"]:
                    kind = key.split(":", 1)[0]
                    scoped_key = f"{member['dataset_id']}:{key}" if kind == "identifier" else key
                    if kind not in {"email", "sku", "identifier"}:
                        continue
                    if scoped_key in safe_keys:
                        union(index, safe_keys[scoped_key], 1.0)
                    else:
                        safe_keys[scoped_key] = index
            safe_groups: defaultdict[int, list[dict]] = defaultdict(list)
            for member in entity["records"]:
                safe_groups[find(record_indexes[(member["dataset_id"], member["row_number"])])].append(member)
            for members in safe_groups.values():
                key = identity_key(members)
                if len(members) == 1:
                    key += f":row:{members[0]['row_number']}"
                resolved.append({**entity, "canonical_key": key, "confirmed": False,
                                 "keys": sorted({value for member in members for value in member["keys"]}),
                                 "display_name": members[0]["display_name"], "confidence": 1.0 if len(members) > 1 else 0.0,
                                 "records": members, "source_count": len({member["dataset_id"] for member in members}), "match_count": len(members)})
        entities = resolved

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
        "review_groups": [{"canonical_key": entity["canonical_key"], "review_key": entity["review_key"], "display_name": entity["display_name"],
                           "confidence": entity["confidence"], "match_count": entity["match_count"],
                           "sources": [{"dataset_id": member["dataset_id"], "file_name": member["file_name"],
                                        "row": member["row_number"] + 1, "keys": member["keys"]}
                                       for member in entity["records"][:20]]} for entity in review_groups[:100]],
        "review_group_count": len(review_groups),
    }


def confidence_bucket(value: float) -> str:
    if value >= 0.99:
        return "high"
    if value >= 0.9:
        return "medium"
    return "review"
