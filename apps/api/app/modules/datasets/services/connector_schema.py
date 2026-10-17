"""Compatibility for connector collections stored as numbered columns."""

from __future__ import annotations

import json
import re

import pandas as pd


COLUMN_MAPPING_ATTR = "decisionate_connector_column_mapping"
_INDEXED_COLUMN = re.compile(r"^(.*?)__(\d+)(?:__(.*))?$")
_LINE_ROOTS = {
    "shopify": {"lineitems"},
    "square": {"lineitems"},
    "woocommerce": {"lineitems"},
    "lightspeed": {"salelines", "saleline"},
    "lightspeed_x": {"lineitems", "salelines", "items"},
    "lightspeed_k": {"lineitems", "saleslines", "items"},
    "lightspeed_o": {"lineitems", "saleslines", "items", "products"},
    "quickbooks": {"line"},
    "freshbooks": {"lines", "lineitems", "invoicelines", "items"},
    "sage": {"invoicelines", "creditnotelines", "lines", "lineitems"},
    "xero": {"lineitems"},
    "zoho_books": {"lineitems"},
}
_RELATION_WRAPPERS = {"nodes", "edges", "data", "items", "lines", "saleline", "salelines", "lineitems"}


def _present(value):
    if isinstance(value, (dict, list)):
        return True
    return value is not None and not bool(pd.isna(value))


def _identified(value):
    return _present(value) and not isinstance(value, (dict, list)) and str(value).strip() not in {"", "<NA>", "nan"}


def _line_root(root, source_type):
    parts = [part.replace("_", "").lower() for part in root.split("__")]
    return parts[0] in _LINE_ROOTS.get(source_type, ()) and all(
        part in _RELATION_WRAPPERS for part in parts[1:]
    )


def connector_schema_needs_repair(columns, source_type):
    """Whether projection could discard fields needed to reconstruct old rows."""
    for column in columns:
        name = str(column)
        if _INDEXED_COLUMN.match(name):
            return True
        parts = name.split("__")
        if any(_line_root("__".join(parts[:length]), source_type) for length in range(1, len(parts) + 1)):
            return True
    return False


def _restore_collections(value):
    if not isinstance(value, dict):
        return value
    result = {key: _restore_collections(child) for key, child in value.items()}
    indices = [key for key in result if str(key).isdigit()]
    if indices and set(result).difference(indices) <= {"count"}:
        return [result[key] for key in sorted(indices, key=int)]
    return result


def _set_nested_value(target, path, value):
    for part in path[:-1]:
        target = target.setdefault(part, {})
    target[path[-1]] = value


def _line_aliases(line, source_type, parent_id, index):
    # Reuse the connector's identifier and money rules; do not make API calls.
    from app.modules.datasets.services.connectors import (
        _shopify_money_amount, connector_first_value, connector_line_item_description,
        connector_line_item_id, connector_line_item_reference, square_money_amount,
    )

    detail = next((line[key] for key in (
        "SalesItemLineDetail", "ItemBasedExpenseLineDetail", "AccountBasedExpenseLineDetail", "pricing",
    ) if isinstance(line.get(key), dict)), {})
    values = {**detail, **line}
    line_id = connector_first_value(line, "saleLineID", "sale_line_id", "invoice_line_id")
    if line_id is None:
        line_id = connector_line_item_id(line, parent_id, index)
    if parent_id is None and line_id == f"None:line:{index}":
        line_id = None
    item_ref = detail.get("ItemRef")
    item_ref = item_ref if isinstance(item_ref, dict) else {}
    result = {
        "line_item_id": str(line_id) if line_id is not None else None, "line_index": index,
        "item_id": connector_line_item_reference(line) or connector_line_item_reference(detail),
        "item_description": connector_line_item_description(line) or item_ref.get("name"),
        "quantity": connector_first_value(values, "quantity", "unitQuantity", "unit_quantity", "qty", "Qty", "Quantity"),
        "unit_price": connector_first_value(values, "unit_price", "unitPrice", "UnitPrice", "unit_cost", "rate", "price"),
        "line_total": connector_first_value(values, "line_total", "Amount", "LineAmount", "line_amount", "total_price", "total", "amount"),
    }
    for key in ("unit_price", "line_total"):
        if isinstance(result[key], dict):
            result[key] = result[key].get("amount")
    if source_type == "square":
        for key, field in (("unit_price", "base_price_money"), ("line_total", "total_money")):
            if isinstance(line.get(field), dict):
                result[key] = square_money_amount(line[field])
    elif source_type == "lightspeed_x":
        result["line_total"] = connector_first_value(line, "line_total", "price_total", "total_price", "total")
    elif source_type == "zoho_books":
        result["line_total"] = connector_first_value(line, "item_total", "amount", "total")
    elif source_type == "shopify":
        for key, field in (("unit_price", "originalUnitPriceSet"), ("line_total", "discountedTotalSet")):
            value = _shopify_money_amount(line, field)
            if value is not None:
                result[key] = value
    if source_type.startswith("lightspeed") and line_id is not None:
        result["sale_line_id"] = str(line_id)
    if source_type in {"sage", "xero", "zoho_books"} and line_id is not None:
        result["invoice_line_id"] = str(line_id)
    return result


def normalize_connector_row_schema(dataframe, source_type, resource=None):
    """Repair raw legacy rows without changing uploads or database query schemas."""
    from app.modules.datasets.services.sources import IMPLEMENTED_CONNECTOR_TYPES
    from app.modules.datasets.services.connectors import (
        _parent_values_for_item_row, build_dynamic_connector_row, connector_first_value,
        FRESHBOOKS_LINE_ITEM_RESOURCES, QUICKBOOKS_LINE_ITEM_RESOURCES,
        SAGE_LINE_ITEM_RESOURCES, XERO_LINE_ITEM_RESOURCES, ZOHO_BOOKS_LINE_ITEM_RESOURCES,
    )

    if not isinstance(dataframe, pd.DataFrame) or source_type not in IMPLEMENTED_CONNECTOR_TYPES - {"postgresql", "mysql", "sql_server"}:
        return dataframe
    resource_types = {
        "shopify": {"orders"}, "square": {"orders"}, "woocommerce": {"orders"},
        "lightspeed": {"sales"}, "lightspeed_x": {"sales"}, "lightspeed_k": {"sales"}, "lightspeed_o": {"sales"},
        "quickbooks": QUICKBOOKS_LINE_ITEM_RESOURCES, "freshbooks": FRESHBOOKS_LINE_ITEM_RESOURCES,
        "sage": SAGE_LINE_ITEM_RESOURCES, "xero": XERO_LINE_ITEM_RESOURCES,
        "zoho_books": ZOHO_BOOKS_LINE_ITEM_RESOURCES,
    }
    expand_items = not resource or str(resource).strip().lower() in resource_types.get(source_type, ())
    indexed, singleton = {}, {}
    json_roots = [column for column in dataframe.columns if expand_items and _line_root(str(column), source_type)]
    for column in dataframe.columns:
        match = _INDEXED_COLUMN.match(str(column))
        if match:
            indexed[column] = (match[1], match[2], match[3])
        else:
            if str(column).endswith("__count"):
                continue
            parts = str(column).split("__")
            for length in range(len(parts) - 1, 0, -1):
                root, suffix = "__".join(parts[:length]), "__".join(parts[length:])
                if expand_items and suffix != "count" and _line_root(root, source_type):
                    singleton[column] = (root, "0", suffix)
                    break
    if not indexed and not singleton and not json_roots:
        return dataframe
    identity_keys = ("line_item_id", "sale_line_id", "invoice_line_id", "line_index")
    if not indexed and any(key in dataframe and dataframe[key].map(_identified).all() for key in identity_keys):
        return dataframe

    rows, column_mapping = [], {}
    for original in dataframe.to_dict("records"):
        # Aggregates cannot be reconstructed into individual transactions.
        if original.get("__decisionate_summary__") is True:
            rows.append(original)
            continue
        already_vertical = any(_identified(original.get(key)) for key in identity_keys)
        repaired_fields = indexed if already_vertical else {**singleton, **indexed}
        parent = {key: value for key, value in original.items() if key not in repaired_fields}
        collections = {}
        for column, (root, index, suffix) in repaired_fields.items():
            value = original[column]
            if not _present(value):
                continue
            items = collections.setdefault(root, {})
            if suffix:
                _set_nested_value(items.setdefault(index, {}), suffix.split("__"), value)
            else:
                items[index] = value
        for root in json_roots:
            value = parent.get(root)
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except (TypeError, ValueError):
                    continue
            if isinstance(value, dict):
                nested = next((child for key, child in value.items() if key.lower() in _RELATION_WRAPPERS and isinstance(child, (dict, list))), None)
                value = nested if nested is not None else value
                if isinstance(value, dict):
                    value = [value]
            if isinstance(value, list) and value:
                collections.setdefault(root, {str(index): line for index, line in enumerate(value)})
        for root, items in collections.items():
            collection = _restore_collections(items)
            if not _present(parent.get(root)):
                parent[root] = json.dumps(collection, sort_keys=True, default=str)
        primary_root = next((root for root in collections if expand_items and _line_root(root, source_type)), None)
        if primary_root is None or already_vertical:
            rows.append(parent)
            continue
        ordered_items = [(index, _restore_collections(line)) for index, line in
                         sorted(collections[primary_root].items(), key=lambda item: int(item[0]))]
        if not all(isinstance(line, dict) for _, line in ordered_items):
            rows.append(parent)
            continue
        parent.pop(primary_root, None)
        parent_id = connector_first_value(parent, "record_id", "order_id", "sale_id", "invoice_id", "saleID", "Id", "id")
        for position, (index, line) in enumerate(ordered_items):
            if isinstance(line.get("node"), dict):
                line = line["node"]
            rows.append({
                **_parent_values_for_item_row(parent, position),
                **build_dynamic_connector_row(line, _line_aliases(line, source_type, parent_id, int(index)), prefix="line"),
            })
        for column, (root, _, suffix) in repaired_fields.items():
            if root == primary_root and suffix and not _INDEXED_COLUMN.search(suffix):
                column_mapping[column] = f"line__{suffix}"

    normalized = pd.DataFrame(rows, columns=None if rows else [column for column in dataframe.columns if column not in indexed])
    obsolete = [column for column in singleton if column in normalized
                and column_mapping.get(column, column) != column and normalized[column].isna().all()]
    normalized = normalized.drop(columns=obsolete)
    normalized.attrs = {**dataframe.attrs, COLUMN_MAPPING_ATTR: column_mapping}
    return normalized


def remap_connector_metric_config(config, mapping):
    """Keep explicitly saved choices attached to the repaired item fields."""
    config = dict(config)
    selection = config.get("selected_metric_columns")
    if isinstance(selection, list):
        config["selected_metric_columns"] = list(dict.fromkeys(mapping.get(column, column) for column in selection))
    decisions = config.get("metric_decisions")
    if isinstance(decisions, dict):
        remapped = {}
        for column, value in decisions.items():
            column = mapping.get(column, column)
            if remapped.get(column) != "metric":
                remapped[column] = value
        config["metric_decisions"] = remapped
    return config
