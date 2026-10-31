"""Dated, source-separated records for resolved customers and products."""

from copy import deepcopy
import json
from types import SimpleNamespace

import pandas as pd

from app.modules.datasets.services.curated_metric_analytics import aggregate_metric, frame_policy
from app.modules.datasets.services.joins import _infer_explicit_year, _parse_dates
from app.modules.datasets.services.metric_policy import FRAME_POLICY_KEY
from app.modules.datasets.services.summary_query import is_summary_dataframe

LEGACY_SUMMARY_MESSAGE = (
    "This is an older entity summary, not dated source history. "
    "Rebuild it from the original datasets in Entity Matching before using it for analysis."
)


def build_linked_entity_history(frames, resolution, canonical_ids, metric_columns, date_columns):
    # Import here: report catalogs use the shared metric profiler, which also
    # reads this output's persisted field definitions.
    from app.modules.datasets.services.metric_selection import build_metric_selection_profile, parse_dataset_source_config
    from app.modules.reports.catalog import prepare_report_source, report_metric_catalog

    member_lookup = {(int(member["dataset_id"]), int(member["row_number"])): entity
                     for entity in resolution["entities"] for member in entity["records"]}
    blocks, fields, descriptors, selected, warnings = [], [], {}, [], []
    resolved_dates = {}
    for dataset, original in frames:
        if is_summary_dataframe(original):
            raise ValueError(f"{dataset.file_name} contains aggregated history. Use source-level records for entity matching.")
        dataset_key = str(dataset.id)
        raw_alias = {str(column): f"source_{dataset.id}__{column}" for column in original}
        block = original.reset_index(drop=True).rename(columns=raw_alias).copy()
        block.attrs = {}
        config = parse_dataset_source_config(dataset)
        config["selected_metric_columns"] = metric_columns.get(dataset_key, [])
        view = SimpleNamespace(id=dataset.id, source_type=dataset.source_type,
                               file_name=dataset.file_name, source_config=json.dumps(config))
        view, prepared = prepare_report_source(view, original)
        catalog = report_metric_catalog(view, prepared)
        profile = build_metric_selection_profile(view, original)
        available_dates = catalog["date_columns"]
        date_column = date_columns.get(dataset_key) or next(iter(available_dates), None)
        if date_column and date_column not in available_dates:
            raise ValueError(f"Choose a valid date column for {dataset.file_name}.")
        resolved_dates[dataset_key] = date_column
        block["record_date"] = (_parse_dates(original[date_column], reference_year=_infer_explicit_year(original[date_column]))
                                .reset_index(drop=True) if date_column else pd.NaT)
        if not date_column:
            warnings.append(f"{dataset.file_name}: no date column; these records cannot be used in time-based analysis.")
        for field in profile["fields"]:
            fields.append({**field, "column": raw_alias[field["column"]],
                           "role": "dimension" if field["role"] == "time" else ("technical" if field["role"] in {"metric", "derived_metric"} else field["role"]),
                           "status": "excluded" if field["role"] in {"metric", "derived_metric"} else field["status"]})

        policy = frame_policy(prepared)
        metric_alias = {str(column): f"metric_{dataset.id}__{column}" for column in prepared}
        source_descriptors = deepcopy(policy["descriptors"]) if policy else {}
        for metric in catalog["metrics"]:
            key = metric["metric_key"]
            if key not in source_descriptors:
                source_descriptors[key] = {"columnKey": key, "aggregation": metric["aggregation"].upper(),
                                           "unit": metric["unit"], "currency": metric["currency"],
                                           "reason": metric["definition"], "components": []}
            selected.append(metric_alias[key])
        needed = {metric["metric_key"] for metric in catalog["metrics"]}
        for key in list(needed):
            needed.update(source_descriptors[key].get("components", []))
        for key in sorted(needed):
            if key not in prepared:
                continue
            alias = metric_alias[key]
            block[alias] = prepared[key].reset_index(drop=True)
            if key in source_descriptors:
                entry = source_descriptors[key]
                descriptors[alias] = {**entry, "columnKey": alias,
                                      "components": [metric_alias[c] for c in entry.get("components", [])],
                                      "source_dataset_id": dataset_key,
                                      "label": f"{dataset.file_name} (#{dataset.id}) / {key.replace('_', ' ')}"}
            fields.append({"column": alias, "role": "metric" if alias in selected else "technical",
                           "status": "recommended" if alias in selected else "excluded", "registry": None,
                           "reason": f"{dataset.file_name}: {key}", "score": 1, "confidence": 1})
        for issue in catalog["metric_issues"]:
            if issue.get("metric_key"):
                warnings.append(f"{dataset.file_name} / {issue['metric_key']}: {issue['code']}. Original values are retained.")
        block["source_dataset_id"] = dataset_key
        block["source_dataset"] = str(dataset.file_name)
        block["source_type"] = str(dataset.source_type or "csv")
        block["source_row"] = [str(index + 1) for index in range(len(original))]
        entities = [member_lookup.get((int(dataset.id), index)) for index in range(len(original))]
        block["canonical_entity_id"] = [str(canonical_ids[entity["canonical_key"]]) if entity else None for entity in entities]
        block["canonical_entity_key"] = [entity["canonical_key"] if entity else None for entity in entities]
        block["canonical_name"] = [entity["display_name"] if entity else None for entity in entities]
        block["match_status"] = ["Linked" if entity and entity["source_count"] > 1 else "Unlinked" for entity in entities]
        blocks.append(block)
    history = pd.concat(blocks, ignore_index=True)
    metadata = [{"column": column, "role": "time" if column == "record_date" else "dimension",
                 "status": "available", "registry": None, "reason": "Source record lineage"}
                for column in ("record_date", "source_dataset_id", "source_dataset", "source_type", "source_row",
                               "canonical_entity_id", "canonical_entity_key", "canonical_name", "match_status")]
    contract = {"version": 1, "fields": metadata + fields, "date_columns": resolved_dates,
                "policy": {"descriptors": descriptors, "selected": selected, "policy_version": 1}}
    metadata_columns = [field["column"] for field in metadata]
    history = history.loc[:, metadata_columns + [column for column in history if column not in metadata_columns]]
    history.attrs[FRAME_POLICY_KEY] = contract["policy"]
    return history, contract, list(dict.fromkeys(warnings))


def entity_history_profile(dataframe, contract):
    fields = [deepcopy(field) for field in contract["fields"] if field["column"] in dataframe]
    for field in fields:
        series = dataframe[field["column"]]
        field.setdefault("completeness", float(series.notna().mean()) if len(series) else 0)
        field.setdefault("distinct_count", 0)
        field.setdefault("unique_ratio", 0)
        field.setdefault("score", 0)
        field.setdefault("confidence", 0)
        field.setdefault("exclusion_reason", None)
    selected = [key for key in contract["policy"]["selected"] if key in dataframe]
    return {"version": 1, "source_type": "entity_matching", "objective": "general_business",
            "fields": fields, "recommended_metric_columns": selected, "available_metric_columns": selected,
            "ambiguous_metric_columns": [], "advanced_metric_columns": []}


def summarize_linked_entities(history, limit=100):
    """Optional entity summary, calculated from history without replacing it."""
    policy = frame_policy(history)
    results = []
    for key, rows in history.groupby("canonical_entity_key", sort=False):
        if len(results) >= limit:
            break
        values = []
        for metric in policy["selected"]:
            entry = policy["descriptors"][metric]
            value = aggregate_metric(rows.sort_values("record_date"), entry)
            if value is not None:
                values.append({"label": entry["label"], "value": value, "aggregation": entry["aggregation"],
                               "unit": entry["unit"], "currency": entry.get("currency")})
        results.append({"canonical_key": key, "name": rows["canonical_name"].iloc[0], "metrics": values})
    return results
