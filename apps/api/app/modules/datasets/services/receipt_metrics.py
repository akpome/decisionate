"""Exact receipt/invoice default fields, not a financial-name heuristic."""

from __future__ import annotations

from app.modules.datasets.services.numeric import is_identifier_column


# Alternatives are ordered: select one emitted representation per measure.
# Provider references and the deliberately unsupported schemas are documented in
# docs/CURATED_METRIC_DEFAULTS.md. These rules do not convert monetary units.
_LINE_FIELDS = (("quantity",), ("unit_price",), ("line_total",))
_RULES = {
    "shopify": ({"orders"}, _LINE_FIELDS + (
        ("discounted_unit_price",), ("subtotal_price",), ("total_price",),
        ("total_tax",), ("total_discounts",),
    )),
    "woocommerce": ({"orders"}, _LINE_FIELDS + (
        ("line_tax", "line__total_tax"), ("total",), ("total_tax",),
        ("discount_total",), ("shipping_total",),
    )),
    "square": ({"orders"}, _LINE_FIELDS + (("total_amount",),)),
    "stripe": ({"charges"}, (("amount",), ("amount_refunded",))),
    "quickbooks": ({"invoices", "bills", "sales_receipts", "purchases", "estimates", "payments"},
        _LINE_FIELDS + (("total_amount", "TotalAmt"), ("balance", "Balance"), ("TxnTaxDetail__TotalTax",))),
    "freshbooks": ({"invoices", "credit_notes", "payments", "expenses"},
        _LINE_FIELDS + (("amount", "amount__amount"),)),
    "sage": ({"sales_invoices", "purchase_invoices", "sales_credit_notes", "purchase_credit_notes"},
        _LINE_FIELDS + (("total_amount",),)),
    "xero": ({"invoices", "credit_notes", "purchase_orders", "quotes", "payments"},
        _LINE_FIELDS + (("total", "Total"), ("SubTotal",), ("TotalTax",), ("AmountPaid",), ("AmountDue",))),
    "zoho_books": ({"invoices", "expenses", "customer_payments", "credit_notes", "estimates", "sales_orders"},
        _LINE_FIELDS + (("total", "amount"), ("sub_total",), ("tax_total",),
                        ("discount_amount",), ("shipping_charge",))),
    # Only the stable quantity/price aliases have local contract evidence here.
    # Do not infer monetary defaults from another Lightspeed series.
    "lightspeed": ({"sales"}, (("quantity",), ("unit_price",))),
    "lightspeed_x": ({"sales"}, _LINE_FIELDS),
    "lightspeed_k": (set(), ()),
    "lightspeed_o": (set(), ()),
}
_DEFAULT_RESOURCES = {
    "stripe": "charges", "shopify": "orders", "square": "orders", "woocommerce": "orders",
    "lightspeed": "sales", "lightspeed_x": "sales", "quickbooks": "invoices",
    "freshbooks": "invoices", "sage": "sales_invoices", "xero": "invoices", "zoho_books": "invoices",
}
_STATISTICS = ("sum", "count", "min", "max", "mean")
_GENERATED = {"__decisionate_summary__", "__decisionate_summary_month__"}
_NUMERIC_TYPES = {
    "TINYINT", "SMALLINT", "INTEGER", "INT", "BIGINT", "HUGEINT",
    "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT",
    "INT32", "INT64", "FLOAT", "FLOAT32", "FLOAT64", "DOUBLE", "DOUBLE PRECISION",
    "REAL", "DECIMAL", "NUMERIC", "BIGNUMERIC",
}


def receipt_metric_columns(source_type, config, columns):
    """Return exact defaults, or None when this restriction does not apply."""
    source_type = str(source_type or "").strip().lower()
    rule = _RULES.get(source_type)
    if rule is None:
        return None
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type")
    resource = str(resource or _DEFAULT_RESOURCES.get(source_type, "")).strip().lower()
    if resource not in rule[0]:
        return []
    available = set(columns)
    if source_type == "xero" and resource == "payments":
        return ["Amount"] if "Amount" in available else []
    return [next(column for column in alternatives if column in available)
            for alternatives in rule[1] if any(column in available for column in alternatives)]


def restrict_receipt_profile(source_type, config, profile):
    columns = (profile["available_metric_columns"] if "policy_version" in profile
               else [field["column"] for field in profile["fields"]])
    allowed = receipt_metric_columns(source_type, config, columns)
    if allowed is None:
        return profile
    allowed = set(allowed)
    removed = {field["column"] for field in profile["fields"] if field["status"] == "recommended" and field["column"] not in allowed}
    for field in profile["fields"]:
        if field["column"] in removed:
            field.update(status="advanced", reason="Not a default receipt or invoice measure; available for manual selection.", exclusion_reason=None)
    profile["recommended_metric_columns"] = [column for column in profile["recommended_metric_columns"] if column in allowed]
    profile["advanced_metric_columns"] = list(dict.fromkeys([*profile["advanced_metric_columns"], *sorted(removed)]))
    return profile


def receipt_projection(source_type, config, schema):
    """Prune typed numeric columns before materialization; keep dimensions intact."""
    defaults = receipt_metric_columns(source_type, config, schema)
    if defaults is None:
        return None
    from app.modules.datasets.services.connector_schema import connector_schema_needs_repair

    # Legacy item repair and saved indexed-field remapping need the original row.
    if connector_schema_needs_repair(schema, source_type):
        return None
    selected = config.get("selected_metric_columns")
    required = set(selected if isinstance(selected, list) else defaults)
    required.update(_GENERATED)
    # Policy-managed analytics may need unselected components and currency/status
    # conditions; the curated filter will discard unused values after resolution.
    if config.get("curated_metric_selection") is True:
        required.update(defaults)
    for column in tuple(required):
        required.update(f"{column}__{statistic}" for statistic in _STATISTICS)
    return [column for column, dtype in schema.items()
            if column in required or is_identifier_column(column)
            or str(dtype).endswith("[]")
            or str(dtype).upper().split("(", 1)[0].strip() not in _NUMERIC_TYPES]
