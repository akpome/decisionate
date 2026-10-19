"""Bound decision metrics to a report selection or selected dataset fields."""

import json

from app.modules.datasets.services.metric_selection import get_dataset_selected_metric_columns, get_effective_dataset_metric_columns


def reference_key(item, column="metric_key"):
    if not isinstance(item, dict):
        return None
    identity, key = item.get("dataset_id"), item.get(column)
    if isinstance(identity, int) and not isinstance(identity, bool) and identity > 0 and isinstance(key, str) and key:
        return identity, key
    return None


def selected_report_metrics(snapshot):
    """The saved definition is authoritative, not a possibly over-wide metric cache."""
    definition = snapshot.get("definition")
    references = definition.get("metrics") if isinstance(definition, dict) else None
    if not isinstance(references, list):
        raise ValueError("The report has no saved metric selection")
    available = {reference_key(item): item for item in snapshot.get("metrics", []) if reference_key(item)}
    result, seen = [], set()
    for reference in references:
        key = reference_key(reference)
        if key is None or key not in available:
            raise ValueError("A selected report metric is unavailable")
        if key not in seen:
            result.append(available[key])
            seen.add(key)
    return result


def report_selection(context):
    try:
        value = json.loads(context or "{}")
    except (TypeError, ValueError):
        return None
    if not isinstance(value, dict) or value.get("evidence_kind") != "business_report":
        return None
    definition = value.get("definition")
    references = definition.get("metrics") if isinstance(definition, dict) else None
    # An absent or empty report selection must never mean all dataset columns.
    return {key for item in references if (key := reference_key(item))} if isinstance(references, list) else set()


def decision_metric_options(decision, get_dataset, load_frame):
    dataset_ids = {decision.dataset_id, *(decision.evidence_dataset_ids or [])}
    candidates = [item for item in decision.evidence_metrics
                  if reference_key(item, "metric_column") and item["dataset_id"] in dataset_ids
                  and item.get("column_type", "numeric") == "numeric"]
    scope = report_selection(decision.recommendation_context)
    if scope is not None:
        candidates = [item for item in candidates if reference_key(item, "metric_column") in scope]
    elif not candidates:
        if not decision.metric_column:
            return []
        dataset = get_dataset(decision.outcome_dataset_id or decision.dataset_id)
        return [{"dataset_id": dataset.id, "file_name": dataset.file_name,
                 "metric_column": decision.metric_column, "label": decision.metric_column, "column_type": "numeric"}]
    selected, result, seen = {}, [], set()
    for item in candidates:
        identity, column = reference_key(item, "metric_column")
        dataset = get_dataset(identity)
        if scope is None:
            if identity not in selected:
                saved = get_dataset_selected_metric_columns(dataset)
                if saved is None:
                    # Old all-column evidence is not proof of a deliberate selection.
                    selected[identity] = set()
                    if identity == (decision.outcome_dataset_id or decision.dataset_id) and decision.metric_column:
                        selected[identity].add(decision.metric_column)
                elif not saved:
                    selected[identity] = set()
                else:
                    frame = load_frame(dataset)
                    selected[identity] = set(get_effective_dataset_metric_columns(dataset, frame))
            if column not in selected[identity]:
                continue
        if (identity, column) not in seen:
            result.append(item)
            seen.add((identity, column))
    return result
