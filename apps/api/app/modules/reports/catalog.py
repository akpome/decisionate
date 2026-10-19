"""Report-local metric defaults; never change a dataset's saved selection."""

import json
from types import SimpleNamespace

from app.modules.correlation.catalog import metric_catalog
from app.modules.datasets.services.connector_schema import COLUMN_MAPPING_ATTR
from app.modules.datasets.services.curated_metric_analytics import frame_policy, prepare_curated_dataframe
from app.modules.datasets.services.metric_policy import CONNECTOR_SCHEMA_VERSION, CURATED_SELECTION_KEY, SCHEMA_VERSION_KEY
from app.modules.datasets.services.metric_recommendations import config_for, recommended_columns, resolve_metric_recommendations
from app.modules.datasets.services.metric_selection import build_metric_selection_profile, get_dataset_selected_metric_columns, get_effective_dataset_metric_columns
from app.modules.datasets.services.receipt_metrics import RECEIPT_CONNECTOR_POLICIES, receipt_document_columns, receipt_metric_aliases, uses_receipt_defaults
from app.modules.datasets.services.salesforce_metrics import uses_salesforce_defaults
from app.modules.datasets.services.sources import IMPLEMENTED_CONNECTOR_TYPES


def _view(dataset, config):
    return SimpleNamespace(
        id=dataset.id, file_name=dataset.file_name, source_type=dataset.source_type,
        user_id=getattr(dataset, "user_id", None), source_config=json.dumps(config),
        report_metric_issues=getattr(dataset, "report_metric_issues", []),
    )


def _safe_document_descriptors(source, config, frame, recommendations):
    contract = RECEIPT_CONNECTOR_POLICIES.get(source)
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type")
    if not contract or resource not in contract.item_resources:
        return recommendations
    headers = set(receipt_document_columns(source, config))
    parent = next((key for key in ("record_id", "invoice_id", "order_id", "sale_id") if key in frame), None)
    unsafe = set()
    for column in headers.intersection(frame.columns):
        present = frame[column].notna()
        if not present.any():
            continue
        identities = frame.loc[present, parent].astype("string").str.strip() if parent else None
        if identities is None or identities.isna().any() or identities.eq("").any() or identities.duplicated().any():
            unsafe.add(column)
    if not unsafe:
        return recommendations
    # Repeated header amounts are not certified line measures. Leave their
    # source values alone and omit them rather than double-counting invoices.
    result = {**recommendations}
    for group in ("recommended", "optional", "derived"):
        result[group] = [entry for entry in recommendations[group]
                         if entry["columnKey"] not in unsafe and not unsafe.intersection(entry.get("components", []))]
    return result


def prepare_report_source(dataset, frame):
    config = config_for(dataset)
    saved = get_dataset_selected_metric_columns(dataset)
    source = str(dataset.source_type or "").strip().lower()
    automatic = saved is None or uses_receipt_defaults(source, config) or uses_salesforce_defaults(source, config)
    existing_policy = frame_policy(frame)
    if existing_policy:
        if automatic:
            config["selected_metric_columns"] = list(existing_policy["selected"])
            return _view(dataset, config), frame
        return dataset, frame
    if source not in IMPLEMENTED_CONNECTOR_TYPES:
        if saved is None:
            config["selected_metric_columns"] = build_metric_selection_profile(dataset, frame)["recommended_metric_columns"]
            return _view(dataset, config), frame
        return dataset, frame
    if saved == []:
        return dataset, frame

    # The loader has normalized these adapter rows. A missing legacy schema
    # marker may use today's reviewed emitted schema; explicit versions stay pinned.
    config.setdefault(SCHEMA_VERSION_KEY, CONNECTOR_SCHEMA_VERSION)
    contract = RECEIPT_CONNECTOR_POLICIES.get(source)
    if not any(config.get(key) for key in ("resource_type", "resource", "object_type")) and contract:
        config["resource_type"] = contract.default_resource
    view = _view(dataset, config)
    recommendations = resolve_metric_recommendations(view, frame, selection_policy=config.get(CURATED_SELECTION_KEY) is True)
    if not recommendations.get("grain"):
        return dataset, frame
    recommendations = _safe_document_descriptors(source, config, frame, recommendations)
    mapping = frame.attrs.get(COLUMN_MAPPING_ATTR, {})
    if automatic:
        requested = get_effective_dataset_metric_columns(dataset, frame) if uses_receipt_defaults(source, config) else recommended_columns(recommendations)
    else:
        aliases = {alias: entry["columnKey"] for group in ("recommended", "optional", "derived") for entry in recommendations[group]
                   for alias in receipt_metric_aliases(source, config, entry["columnKey"])}
        requested = list(dict.fromkeys(aliases.get(mapping.get(key, key), mapping.get(key, key)) for key in saved))
    eligible = {entry["columnKey"] for group in ("recommended", "optional", "derived") for entry in recommendations[group]}
    selected = [key for key in requested if key in eligible]
    config["selected_metric_columns"] = selected
    prepared = prepare_curated_dataframe(frame, recommendations, selected)
    view = _view(dataset, config)
    # Omit unsupported choices from the report's approved selection, not from
    # the physical frame: a saved dimension may still be its required date field.
    view.report_metric_issues = [{"metric_key": key, "code": "aggregation_unconfirmed" if key in frame else "column_unavailable"}
                                for key in requested if key not in eligible]
    return view, prepared


def report_metric_catalog(dataset, frame):
    view, prepared = prepare_report_source(dataset, frame)
    result = metric_catalog(view, prepared)
    result["metric_issues"].extend(getattr(view, "report_metric_issues", []))
    if get_dataset_selected_metric_columns(dataset) is None:
        result["metric_issues"] = [issue for issue in result["metric_issues"] if issue["code"] not in {"selection_not_saved", "no_metrics_selected"}]
        if not result["metrics"]:
            result["metric_issues"].append({"code": "no_eligible_defaults"})
    return result
