"""Fail-closed recommendations and additive selection provenance."""

from __future__ import annotations

from datetime import UTC, datetime
import json
import logging
import os

import pandas as pd

from app.modules.datasets.services.metric_policy import (
    CONNECTOR_SCHEMA_VERSION, CURATED_SELECTION_KEY, METRIC_POLICIES,
    METRIC_POLICY_VERSIONS, POLICY_SCHEMAS, POLICY_VERSION, SCHEMA_VERSION_KEY, SELECTION_PROVENANCE_KEY,
    MetricDescriptor,
)
from app.modules.datasets.services.numeric import is_identifier_column
from app.modules.datasets.services.metric_objectives import matches_objective
from app.modules.datasets.services.metric_registry import get_metric_definition, normalize_metric_column_name
from app.modules.datasets.services.summary_query import is_summary_dataframe
from app.modules.datasets.services.receipt_metrics import receipt_metric_aliases, receipt_metric_columns, uses_receipt_defaults


logger = logging.getLogger(__name__)
REVIEWED_CURRENCY_EXPONENTS = {
    **dict.fromkeys("USD CAD EUR GBP AUD NZD CHF CNY HKD SGD INR BRL MXN ZAR SEK NOK DKK PLN CZK AED SAR ILS TRY THB MYR PHP IDR HUF TWD ISK UGX".split(), 2),
    **dict.fromkeys("BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF".split(), 0),
    **dict.fromkeys("BHD JOD KWD OMR TND".split(), 3),
}


def config_for(dataset):
    raw = getattr(dataset, "source_config", None)
    if isinstance(raw, dict):
        return dict(raw)
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def metric_default_flags(dataset):
    def enabled(suffix, default=False):
        value = os.getenv(f"CURATED_METRIC_DEFAULTS_{suffix}")
        return default if value is None else value.strip().lower() in {"true", "1", "yes", "on"}
    internal_users = {value.strip() for value in os.getenv("CURATED_METRIC_DEFAULTS_INTERNAL_USERS", "").split(",") if value.strip()}
    eligible = str(getattr(dataset, "user_id", "") or "") in internal_users
    eligible = eligible or os.getenv("CURATED_METRIC_DEFAULTS_ROLLOUT", "internal").strip().lower() == "all"
    backend = eligible and enabled("BACKEND")
    return {
        "backend": backend,
        "ui": backend and enabled("UI"),
        "new_datasets": backend and enabled("NEW_DATASETS"),
        "existing_prompt": backend and enabled("EXISTING_PROMPT"),
        "diagnostics": backend and enabled("DIAGNOSTICS", True),
    }


def uses_curated_selection(dataset):
    return metric_default_flags(dataset)["backend"] and config_for(dataset).get(CURATED_SELECTION_KEY) is True


def dataset_policy_key(dataset, config=None):
    config = config if config is not None else config_for(dataset)
    connector = str(getattr(dataset, "source_type", "") or "")
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type")
    if connector == "google_analytics" and config.get("dimensions") == ["date"]:
        resource = "report"
    return connector, str(resource or ""), str(config.get(SCHEMA_VERSION_KEY) or "")


def _numeric_values(series):
    if pd.api.types.is_bool_dtype(series):
        return None
    meaningful = series.notna() & series.astype("string").str.strip().ne("")
    values = pd.to_numeric(series, errors="coerce").replace([float("inf"), -float("inf")], float("nan"))
    if not meaningful.any() or not values.loc[meaningful].notna().all():
        return None
    return values


def _currency(dataframe, paths, value_column):
    relevant = dataframe[value_column].notna()
    for path in paths:
        if path not in dataframe:
            continue
        values = dataframe.loc[relevant, path].astype("string").str.strip().str.upper()
        if values.isna().any() or not values.isin(REVIEWED_CURRENCY_EXPONENTS).all():
            return None
        currencies = values.unique().tolist()
        return currencies[0] if len(currencies) == 1 else None
    return None


def resolve_metric_recommendations(dataset, dataframe, *, diagnostics=False, selection_policy=False, objective=None):
    config = config_for(dataset)
    objective = str(objective or config.get("business_objective") or "general_business").strip().lower()
    key = dataset_policy_key(dataset, config)
    policy = METRIC_POLICIES.get(key)
    automatic_receipt_selection = uses_receipt_defaults(key[0], config)
    if selection_policy and not automatic_receipt_selection:
        provenance = config.get(SELECTION_PROVENANCE_KEY)
        version = provenance.get("policy_version") if isinstance(provenance, dict) else None
        policy = METRIC_POLICY_VERSIONS.get((*key, version))
    saved_selection = config.get("selected_metric_columns")
    if uses_receipt_defaults(key[0], config):
        saved_selection = None
    result = {
        "policyVersion": policy.policy_version if policy else POLICY_VERSION,
        "connectorSchemaVersion": key[2] or None,
        "connectorKey": key[0], "datasetKey": key[1],
        "recommended": [], "optional": [], "derived": [], "skipped": [],
        "userHasExplicitSelection": isinstance(saved_selection, list),
        "savedSelection": saved_selection if isinstance(saved_selection, list) else None,
        "missingSelectedColumns": [],
        "uiEnabled": metric_default_flags(dataset)["ui"],
    }

    def skip(semantic, reason):
        result["skipped"].append({"semanticKey": semantic, "reasonCode": reason})
        if diagnostics:
            logger.info("Curated metric skipped", extra={"connector": key[0], "dataset_key": key[1], "schema_version": key[2], "semantic_key": semantic, "reason_code": reason})

    if not policy:
        skip("policy", "unknown_dataset_or_schema_version")
        return result
    schema = POLICY_SCHEMAS.get("/".join(key))
    if not schema:
        skip("policy", "schema_fixture_review_pending")
        return result
    if schema["api_versions"] and config.get("api_version") not in schema["api_versions"]:
        skip("policy", "unreviewed_provider_api_version")
        return result
    result.update(grain=policy.grain, evidenceUrl=policy.evidence_url, reviewStatus=policy.review_status)
    if key[0] == "google_analytics" and config.get("dimensions") != ["date"]:
        skip("policy", "unverified_report_grain")
        return result
    if not isinstance(dataframe, pd.DataFrame) or not dataframe.columns.is_unique:
        skip("policy", "invalid_emitted_schema")
        return result
    historical = is_summary_dataframe(dataframe)
    resolved = {}
    for entry in policy.metrics:
        paths = list(entry.source_paths)
        if automatic_receipt_selection:
            for path in entry.source_paths:
                paths.extend(alias for alias in receipt_metric_aliases(key[0], config, path) if alias not in paths)
        reviewed_paths = [path for path in paths if path in schema["columns"]]
        if not reviewed_paths:
            skip(entry.semantic_key, "field_fixture_review_pending")
            continue
        present_paths = [path for path in reviewed_paths if path in dataframe]
        column = next((path for path in present_paths if _numeric_values(dataframe[path]) is not None), next(iter(present_paths), None))
        if column is None:
            skip(entry.semantic_key, "missing_source_column")
            continue
        if is_identifier_column(column) or _numeric_values(dataframe[column]) is None:
            skip(entry.semantic_key, "incompatible_logical_type")
            continue
        if entry.aggregation == "AVG_WEIGHTED" and historical:
            skip(entry.semantic_key, "historical_weighted_state_unavailable")
            continue
        if historical and (entry.scale != "identity" or entry.sign < 0):
            skip(entry.semantic_key, "historical_signed_or_scaled_state_unavailable")
            continue
        if "single_row" in entry.conditions and len(dataframe) != 1:
            skip(entry.semantic_key, "provider_total_required")
            continue
        if "successful_charge" in entry.conditions and (
            "status" not in dataframe or "paid" not in dataframe
            or not dataframe["status"].eq("succeeded").all()
            or not dataframe["paid"].eq(True).all()
        ):
            skip(entry.semantic_key, "successful_charge_filter_required")
            continue
        if "completed_order" in entry.conditions and ("state" not in dataframe or not dataframe["state"].eq("COMPLETED").all()):
            skip(entry.semantic_key, "completed_order_filter_required")
            continue
        currency = None
        if entry.unit == "currency":
            currency = _currency(dataframe, entry.currency_paths, column)
            if not currency:
                skip(entry.semantic_key, "currency_unresolved_or_mixed")
                continue
            if "two_decimal_currency" in entry.conditions and REVIEWED_CURRENCY_EXPONENTS[currency] != 2:
                skip(entry.semantic_key, "unverified_connector_currency_conversion")
                continue
        multiplier = 10 ** -REVIEWED_CURRENCY_EXPONENTS[currency] if entry.scale == "stripe_minor" else 0.000001 if entry.scale == "micros" else 1
        descriptor: MetricDescriptor = {
            "columnKey": column, "semanticKey": entry.semantic_key,
            "classification": entry.classification,
            "aggregation": entry.aggregation, "unit": entry.unit,
            "currency": currency, "multiplier": multiplier, "sign": entry.sign,
            "reason": entry.definition, "evidenceUrl": policy.evidence_url,
            "family": entry.family, "entityKeys": list(entry.entity_keys),
            "sourcePaths": list(entry.source_paths),
        }
        if entry.aggregation == "AVG_WEIGHTED":
            weight = next((path for path in entry.weight_paths if path in dataframe and _numeric_values(dataframe[path]) is not None), None)
            if weight is None:
                skip(entry.semantic_key, "missing_or_unsafe_weight")
                continue
            descriptor.update(operation="weighted_mean", components=[column, weight])
        resolved[entry.semantic_key] = descriptor
        result["recommended" if entry.classification == "core" else "optional"].append(descriptor)
    for entry in policy.derived:
        if entry.operation == "count_distinct":
            if any(column not in schema["columns"] for column in entry.components):
                skip(entry.semantic_key, "field_fixture_review_pending")
                continue
            if historical or any(column not in dataframe or dataframe[column].isna().any() for column in entry.components):
                skip(entry.semantic_key, "distinct_source_records_unavailable")
                continue
            components = list(entry.components)
        else:
            if any(component not in resolved for component in entry.components):
                skip(entry.semantic_key, "missing_or_unsafe_components")
                continue
            if entry.operation == "weighted_mean" and historical:
                skip(entry.semantic_key, "historical_weighted_state_unavailable")
                continue
            components = [resolved[component]["columnKey"] for component in entry.components]
        currencies = {resolved[component]["currency"] for component in entry.components if component in resolved and resolved[component].get("currency")}
        if len(currencies) > 1 or (entry.unit == "currency" and len(currencies) != 1):
            skip(entry.semantic_key, "incompatible_component_currencies")
            continue
        result["derived"].append({
            "columnKey": entry.column_key, "semanticKey": entry.semantic_key,
            "classification": "derived", "aggregation": "COUNT_DISTINCT" if entry.operation == "count_distinct" else "AVG_WEIGHTED",
            "unit": entry.unit, "reason": entry.definition,
            "operation": entry.operation, "components": components,
            "componentDescriptors": [resolved[component] for component in entry.components if component in resolved],
            "formula": entry.operation + "(" + ", ".join(entry.components) + ")",
            "defaultSelected": entry.default_selected,
            "currency": next(iter(currencies), None) if entry.unit == "currency" else None,
            "evidenceUrl": policy.evidence_url,
        })
    known = set(dataframe.columns) | {entry["columnKey"] for entry in result["derived"]}
    result["missingSelectedColumns"] = [column for column in result["savedSelection"] or [] if column not in known]
    eligible = {entry["columnKey"] for group in ("recommended", "optional", "derived") for entry in result[group]}
    result["unavailableSelectedColumns"] = [column for column in result["savedSelection"] or [] if column not in eligible]
    if not selection_policy or automatic_receipt_selection:
        policy_columns = [entry["columnKey"] for group in ("recommended", "optional") for entry in result[group]]
        allowed = receipt_metric_columns(key[0], config, policy_columns)
        if allowed is not None:
            # Keep policy descriptors available for deliberate selections; only
            # change what is recommended for a new/reset automatic selection.
            result["optional"].extend(entry for entry in result["recommended"] if entry["columnKey"] not in allowed)
            result["recommended"] = [entry for entry in result["recommended"] if entry["columnKey"] in allowed]
            for entry in result["derived"]:
                entry["defaultSelected"] = entry["defaultSelected"] and entry["columnKey"] in allowed
    # Keep unrelated descriptors eligible for deliberate overrides, but never
    # let a fixed connector policy replace the objective-specific defaults.
    def relevant(entry):
        semantic = entry["semanticKey"]
        definition = get_metric_definition(semantic, key[0]) or get_metric_definition(entry["columnKey"], key[0])
        return matches_objective(normalize_metric_column_name(semantic), definition, objective)

    unrelated = [entry for entry in result["recommended"] if not relevant(entry)]
    result["recommended"] = [entry for entry in result["recommended"] if relevant(entry)]
    result["optional"].extend(unrelated)
    for entry in result["derived"]:
        entry["defaultSelected"] = entry["defaultSelected"] and relevant(entry)
    return result


def recommended_columns(recommendations):
    return [entry["columnKey"] for entry in recommendations["recommended"]] + [entry["columnKey"] for entry in recommendations["derived"] if entry["defaultSelected"]]


def selection_provenance(dataset, columns, recommendations, actor, source):
    descriptors = {entry["columnKey"]: entry for group in ("recommended", "optional", "derived") for entry in recommendations[group]}
    now = datetime.now(UTC).isoformat()
    if metric_default_flags(dataset)["diagnostics"]:
        logger.info("Curated metric selection saved", extra={
            "connector": recommendations["connectorKey"], "dataset_key": recommendations["datasetKey"],
            "policy_version": recommendations["policyVersion"], "selection_source": source,
            "selected_count": len(columns), "override_count": len(set(columns).symmetric_difference(recommended_columns(recommendations))),
        })
    return {
        "source": source, "policy_version": recommendations["policyVersion"],
        "connector_schema_version": recommendations["connectorSchemaVersion"],
        "selected_at": now, "selected_by": actor,
        "metrics": [{"selected_column_key": column, "semantic_key": descriptors.get(column, {}).get("semanticKey"), "aggregation": descriptors.get(column, {}).get("aggregation")} for column in columns],
    }


def initialize_curated_selection(dataset, dataframe):
    flags = metric_default_flags(dataset)
    if not flags["backend"]:
        return
    config = config_for(dataset)
    if "selected_metric_columns" in config:
        return
    config[SCHEMA_VERSION_KEY] = CONNECTOR_SCHEMA_VERSION
    config["metric_defaults_candidate"] = True
    dataset.source_config = json.dumps(config, sort_keys=True)
    if not flags["new_datasets"]:
        return
    result = resolve_metric_recommendations(dataset, dataframe, diagnostics=flags["diagnostics"])
    columns = recommended_columns(result)
    config["selected_metric_columns"] = columns
    config[CURATED_SELECTION_KEY] = True
    config[SELECTION_PROVENANCE_KEY] = selection_provenance(dataset, columns, result, getattr(dataset, "user_id", None), "recommended")
    dataset.source_config = json.dumps(config, sort_keys=True)


def curated_profile(dataset, dataframe, legacy_profile):
    flags = metric_default_flags(dataset)
    config = config_for(dataset)
    active = uses_curated_selection(dataset)
    show = flags["ui"] and (active or config.get("metric_defaults_candidate") or flags["existing_prompt"])
    if not active and not show and not flags["diagnostics"]:
        return legacy_profile
    objective = legacy_profile["objective"]
    result = resolve_metric_recommendations(dataset, dataframe, diagnostics=flags["diagnostics"], selection_policy=active, objective=objective)
    if show:
        display_result = resolve_metric_recommendations(dataset, dataframe, objective=objective) if active else result
        display_result["savedPolicyUnavailable"] = active and not result.get("grain")
        legacy_profile["curated_recommendations"] = display_result
    if not active:
        return legacy_profile
    fields = {field["column"]: {**field, "status": field["status"] if field["role"] in {"dimension", "time"} else "excluded"} for field in legacy_profile["fields"]}
    for group in ("recommended", "optional", "derived"):
        for entry in result[group]:
            column = entry["columnKey"]
            fields[column] = {
                **fields.get(column, {"column": column, "score": 1, "confidence": 1, "completeness": 1, "distinct_count": 0, "unique_ratio": 0}),
                "role": "derived_metric" if group == "derived" else "metric",
                "status": "recommended" if group == "recommended" or (group == "derived" and entry["defaultSelected"]) else "available",
                "reason": entry["reason"], "exclusion_reason": None,
                "policy": entry,
                "registry": {"canonical_name": entry["semanticKey"], "aggregation": entry["aggregation"].lower(), "unit": entry["unit"], "business_definition": entry["reason"], "target_or_driver": "both"},
            }
    legacy_profile.update(
        version=2, policy_version=result["policyVersion"],
        recommended_metric_columns=recommended_columns(result),
        ambiguous_metric_columns=[], advanced_metric_columns=[],
        available_metric_columns=[entry["columnKey"] for group in ("recommended", "optional", "derived") for entry in result[group]],
        fields=list(fields.values()),
        excluded_columns=[field["column"] for field in fields.values() if field["status"] == "excluded"],
    )
    return legacy_profile
