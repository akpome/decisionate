"""Exact receipt/invoice default fields, not a financial-name heuristic."""

from __future__ import annotations

from app.modules.datasets.services.numeric import is_identifier_column


# Alternatives are ordered: select one emitted representation per measure.
# Field definitions, emitter mappings and evidence gaps are recorded in
# docs/CURATED_METRIC_DEFAULTS.md. These rules do not convert monetary units.
_LINE_FIELDS = (("quantity",), ("unit_price",), ("line_total",))
_QUICKBOOKS_DOCUMENT_FIELDS = _LINE_FIELDS + (
    ("total_amount", "TotalAmt"), ("TxnTaxDetail__TotalTax",),
)
_FRESHBOOKS_LINE_FIELDS = (
    ("quantity",), ("unit_price", "line__unit_cost__amount"), ("line_total",),
)
_XERO_DOCUMENT_FIELDS = _LINE_FIELDS + (
    ("line_tax", "line__TaxAmount"), ("total", "Total"),
    ("subtotal", "SubTotal"), ("total_tax", "TotalTax"),
)
_ZOHO_LINE_FIELDS = (
    ("quantity", "line__quantity"), ("unit_price", "line__rate"),
    ("line_total", "line__item_total"), ("line__discount_amount",),
)
_ZOHO_DOCUMENT_FIELDS = _ZOHO_LINE_FIELDS + (
    ("total",), ("sub_total",), ("tax_total",), ("shipping_charge",),
    ("adjustment",),
)
_SAGE_DOCUMENT_FIELDS = (
    ("quantity", "line__quantity"), ("unit_price", "line__unit_price"),
    # The printed line amount is net; the legacy line_total alias mixes net/gross.
    ("line__net_amount",), ("line_tax", "line__tax_amount"),
    ("line__discount_amount",), ("net_amount",), ("tax_amount",), ("total_amount",),
)
_RULES = {
    "shopify": {"orders": _LINE_FIELDS + (
        ("discounted_unit_price",), ("subtotal_price",), ("total_price",),
        ("total_tax",), ("total_discounts",),
    )},
    "woocommerce": {"orders": _LINE_FIELDS + (
        ("line_tax", "line__total_tax"), ("total",), ("total_tax",),
        ("discount_total",), ("shipping_total",),
    )},
    "square": {"orders": _LINE_FIELDS + (("total_amount",),)},
    "stripe": {"charges": (("amount",), ("amount_refunded",))},
    "quickbooks": {
        "invoices": _QUICKBOOKS_DOCUMENT_FIELDS + (("balance", "Balance"),),
        "bills": _QUICKBOOKS_DOCUMENT_FIELDS + (("balance", "Balance"),),
        "sales_receipts": _QUICKBOOKS_DOCUMENT_FIELDS,
        "purchases": _QUICKBOOKS_DOCUMENT_FIELDS,
        "estimates": _QUICKBOOKS_DOCUMENT_FIELDS,
        "payments": (("total_amount", "TotalAmt"),),
    },
    "freshbooks": {
        "invoices": _FRESHBOOKS_LINE_FIELDS + (("amount", "amount__amount"), ("outstanding", "outstanding__amount")),
        "credit_notes": _FRESHBOOKS_LINE_FIELDS + (("amount", "amount__amount"),),
        "payments": (("amount", "amount__amount"),),
        "expenses": (("amount", "amount__amount"), ("taxAmount1__amount",), ("taxAmount2__amount",)),
    },
    "sage": {resource: _SAGE_DOCUMENT_FIELDS for resource in (
        "sales_invoices", "purchase_invoices", "sales_credit_notes", "purchase_credit_notes",
    )},
    "xero": {
        "invoices": _XERO_DOCUMENT_FIELDS + (("amount_paid", "AmountPaid"), ("amount_due", "AmountDue")),
        "credit_notes": _XERO_DOCUMENT_FIELDS,
        "purchase_orders": _XERO_DOCUMENT_FIELDS,
        "quotes": _XERO_DOCUMENT_FIELDS,
        "payments": (("Amount",),),
    },
    "zoho_books": {
        "invoices": _ZOHO_DOCUMENT_FIELDS + (("balance",), ("payment_made",), ("credits_applied",)),
        "credit_notes": _ZOHO_LINE_FIELDS + (("total",),),
        "estimates": _ZOHO_DOCUMENT_FIELDS,
        "sales_orders": _ZOHO_DOCUMENT_FIELDS,
        "expenses": (("total",), ("sub_total",), ("tax_amount",)),
        "customer_payments": (("amount",),),
    },
    "lightspeed": {"sales": (("quantity",), ("unit_price",),
        ("line_total", "line__calcTotal"), ("total", "calcTotal"), ("calcSubtotal",),
        ("calcTax1",), ("calcTax2",), ("calcDiscount",), ("calcTips",))},
    "lightspeed_x": {"sales": (
        ("quantity", "line__quantity"),
        ("unit_price", "line__unit_price", "line__price", "line__pricing__price"),
        ("line_total", "line__price_total", "line__total_price"),
        ("line__tax_total", "line__total_tax"),
        ("line__discount_total", "line__total_discount"),
        ("total", "total_price"), ("total_tax",),
    )},
    "lightspeed_k": {},
    "lightspeed_o": {},
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


def receipt_metric_columns(source_type, config, columns, *, include_aliases=False):
    """Return exact defaults, or None when this restriction does not apply."""
    source_type = str(source_type or "").strip().lower()
    rule = _RULES.get(source_type)
    if rule is None:
        return None
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type")
    resource = str(resource or _DEFAULT_RESOURCES.get(source_type, "")).strip().lower()
    available = set(columns)
    alternatives = rule.get(resource, ())
    if include_aliases:
        return [column for group in alternatives for column in group if column in available]
    return [next(column for column in group if column in available)
            for group in alternatives if any(column in available for column in group)]


def uses_receipt_defaults(source_type, config):
    """Treat unclassified legacy lists as defaults, not proof of manual intent."""
    if str(source_type or "").strip().lower() not in _RULES:
        return False
    provenance = config.get("metric_selection_provenance")
    source = provenance.get("source") if isinstance(provenance, dict) else None
    if source == "user":
        return False
    if source == "recommended":
        return True
    # An empty legacy selection is a deliberate opt-out. Broad old lists were
    # saved by the automatic picker too, without recording how they were chosen.
    return config.get("selected_metric_columns") != []


def restrict_receipt_profile(source_type, config, profile):
    allowed = receipt_metric_columns(source_type, config, profile["available_metric_columns"])
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
    # Type/value checks happen after materialization. Keep reviewed alternative
    # aliases so an empty or nonnumeric preferred alias cannot hide a valid one.
    defaults = receipt_metric_columns(source_type, config, schema, include_aliases=True)
    if defaults is None:
        return None
    from app.modules.datasets.services.connector_schema import connector_schema_needs_repair

    # Legacy item repair and saved indexed-field remapping need the original row.
    if connector_schema_needs_repair(schema, source_type):
        return None
    selected = None if uses_receipt_defaults(source_type, config) else config.get("selected_metric_columns")
    required = set(selected if isinstance(selected, list) else defaults)
    required.update(_GENERATED)
    # Policy-managed analytics may need unselected components and currency/status
    # conditions; the curated filter will discard unused values after resolution.
    if config.get("curated_metric_selection") is True:
        required.update(receipt_metric_columns(source_type, config, schema, include_aliases=True))
    for column in tuple(required):
        required.update(f"{column}__{statistic}" for statistic in _STATISTICS)
    return [column for column, dtype in schema.items()
            if column in required or is_identifier_column(column)
            or str(dtype).endswith("[]")
            or str(dtype).upper().split("(", 1)[0].strip() not in _NUMERIC_TYPES]
