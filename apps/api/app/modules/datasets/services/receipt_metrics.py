"""Exact receipt/invoice default fields, not a financial-name heuristic."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping
from urllib.parse import urlparse

from app.modules.datasets.services.numeric import is_identifier_column


# Alternatives are ordered: select one emitted representation per measure.
# Field definitions, emitter mappings and evidence gaps are recorded in
# docs/CURATED_METRIC_DEFAULTS.md. These rules do not convert monetary units.
_QUICKBOOKS_LINE_FIELDS = (
    ("quantity", "line__SalesItemLineDetail__Qty", "line__ItemBasedExpenseLineDetail__Qty"),
    ("unit_price", "line__SalesItemLineDetail__UnitPrice", "line__ItemBasedExpenseLineDetail__UnitPrice"),
    ("line_total", "line__Amount"),
)
_QUICKBOOKS_DOCUMENT_FIELDS = _QUICKBOOKS_LINE_FIELDS + (
    ("total_amount", "TotalAmt"), ("TxnTaxDetail__TotalTax",),
)
_FRESHBOOKS_LINE_FIELDS = (
    ("quantity", "line__qty", "line__quantity"),
    ("unit_price", "line__unit_cost__amount"), ("line_total", "line__amount__amount"),
)
_XERO_DOCUMENT_FIELDS = (
    ("quantity", "line__Quantity"), ("unit_price", "line__UnitAmount"),
    ("line_total", "line__LineAmount"),
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
    "shopify": {"orders": (
        ("quantity", "line__quantity"),
        ("unit_price", "line__originalUnitPriceSet__shopMoney__amount"),
        ("line_total", "line__discountedTotalSet__shopMoney__amount"),
        ("discounted_unit_price", "line__discountedUnitPriceSet__shopMoney__amount"),
        ("subtotal_price",), ("total_price",),
        ("total_tax",), ("total_discounts",),
    )},
    "woocommerce": {"orders": (
        ("quantity", "line__quantity"), ("unit_price", "line__price"),
        ("line_total", "line__total"),
        ("line_tax", "line__total_tax"), ("total",), ("total_tax",),
        ("discount_total",), ("shipping_total",),
    )},
    # Square's raw money amounts are minor units, unlike the normalized aliases.
    "square": {"orders": (("quantity", "line__quantity"), ("unit_price",), ("line_total",), ("total_amount",))},
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
    "lightspeed": {"sales": (("quantity", "line__unitQuantity"), ("unit_price", "line__unitPrice"),
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


@dataclass(frozen=True)
class ReceiptConnectorPolicy:
    resources: Mapping[str, tuple[tuple[str, ...], ...]]
    default_resource: str | None
    item_resources: tuple[str, ...]
    line_roots: tuple[str, ...]
    document_fields: Mapping[str, tuple[str, ...]]
    evidence_urls: tuple[str, ...]


RECEIPT_CONNECTOR_POLICIES: dict[str, ReceiptConnectorPolicy] = {}
RECEIPT_SOURCE_CATEGORIES = frozenset({"accounting", "commerce", "payments", "restaurant"})


def register_receipt_connector(source_type, *, resources, default_resource=None,
                               item_resources=(), line_roots=(), document_fields=None,
                               evidence_urls):
    """Register reviewed adapter code, never customer-supplied configuration."""
    source_type = str(source_type).strip().lower()
    if not source_type or source_type in RECEIPT_CONNECTOR_POLICIES:
        raise ValueError("A receipt connector must have a unique source type")
    if not evidence_urls or any(urlparse(url).scheme != "https" or not urlparse(url).netloc for url in evidence_urls):
        raise ValueError("Receipt defaults require HTTPS field evidence")
    fields = {resource: tuple(tuple(group) for group in groups) for resource, groups in resources.items()}
    headers = {resource: tuple(columns) for resource, columns in (document_fields or {}).items()}
    if default_resource is not None and default_resource not in fields:
        raise ValueError("The default receipt resource must be reviewed")
    if item_resources and not line_roots:
        raise ValueError("Item resources require explicit collection roots")
    for resource, groups in fields.items():
        aliases = [column for group in groups for column in group]
        if not resource or any(not group for group in groups) or any(not isinstance(column, str) or not column for column in aliases) or len(aliases) != len(set(aliases)):
            raise ValueError("Receipt measures require nonempty, unambiguous aliases")
    if any(resource not in fields or not set(columns) <= {column for group in fields[resource] for column in group} for resource, columns in headers.items()):
        raise ValueError("Document amounts must belong to a reviewed resource")
    RECEIPT_CONNECTOR_POLICIES[source_type] = ReceiptConnectorPolicy(
        MappingProxyType(fields), default_resource, tuple(item_resources),
        tuple(root.replace("_", "").lower() for root in line_roots),
        MappingProxyType(headers), tuple(evidence_urls),
    )


_ITEM_ROOTS = {
    "shopify": ("lineItems",), "square": ("line_items",), "woocommerce": ("line_items",),
    "lightspeed": ("SaleLines", "SaleLine"), "lightspeed_x": ("line_items", "sale_lines", "items"),
    "lightspeed_k": ("line_items", "salesLines", "items"), "lightspeed_o": ("line_items", "salesLines", "items", "products"),
    "quickbooks": ("Line",), "freshbooks": ("lines", "line_items", "invoice_lines", "items"),
    "sage": ("invoice_lines", "credit_note_lines", "lines", "line_items"),
    "xero": ("LineItems",), "zoho_books": ("line_items",),
}
_ITEM_RESOURCES = {
    "shopify": ("orders",), "square": ("orders",), "woocommerce": ("orders",),
    "lightspeed": ("sales",), "lightspeed_x": ("sales",), "lightspeed_k": ("sales",), "lightspeed_o": ("sales",),
    "quickbooks": ("invoices", "bills", "sales_receipts", "purchases", "estimates"),
    "freshbooks": ("invoices", "credit_notes"),
    "sage": ("sales_invoices", "purchase_invoices", "sales_credit_notes", "purchase_credit_notes"),
    "xero": ("invoices", "credit_notes", "purchase_orders", "quotes"),
    "zoho_books": ("invoices", "expenses", "credit_notes", "estimates", "sales_orders"),
}
_EVIDENCE = {
    "shopify": "https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem",
    "square": "https://developer.squareup.com/reference/square/objects/OrderLineItem",
    "woocommerce": "https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/",
    "stripe": "https://docs.stripe.com/api/charges/object",
    "quickbooks": "https://developer.intuit.com/docs/api/accounting/invoice",
    "freshbooks": "https://www.freshbooks.com/api/invoices",
    "sage": "https://us-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=210126214952167",
    "xero": "https://developer.xero.com/documentation/api/accounting/invoices",
    "zoho_books": "https://www.zoho.com/books/api/v3/invoices/",
    "lightspeed": "https://developers.lightspeedhq.com/retail/endpoints/Sale/",
    "lightspeed_x": "https://x-series-api.lightspeedhq.com/docs/sales_returns",
    "lightspeed_k": "https://api-docs.lsk.lightspeed.app/operation/operation-financial-apigetfinancials",
    "lightspeed_o": "https://apidoc.kounta.com/lines/",
}
_LINE_ALIASES = {"quantity", "unit_price", "line_total", "line_tax", "discounted_unit_price"}
for _source, _resources in _RULES.items():
    register_receipt_connector(
        _source, resources=_resources, default_resource=_DEFAULT_RESOURCES.get(_source),
        item_resources=_ITEM_RESOURCES.get(_source, ()), line_roots=_ITEM_ROOTS.get(_source, ()),
        document_fields={resource: tuple(column for group in groups
            if group[0] not in _LINE_ALIASES and not group[0].startswith("line__") for column in group)
            for resource, groups in _resources.items()}, evidence_urls=(_EVIDENCE[_source],),
    )


def uses_receipt_policy(source_type):
    source_type = str(source_type or "").strip().lower()
    if source_type in RECEIPT_CONNECTOR_POLICIES:
        return True
    from app.modules.datasets.services.sources import DATASET_SOURCES
    return any(source["type"] == source_type and source["category"] in RECEIPT_SOURCE_CATEGORIES for source in DATASET_SOURCES)


def receipt_document_columns(source_type, config):
    policy = RECEIPT_CONNECTOR_POLICIES.get(source_type)
    if policy is None:
        return ()
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type") or policy.default_resource
    return policy.document_fields.get(str(resource or "").strip().lower(), ())


def receipt_metric_aliases(source_type, config, column):
    policy = RECEIPT_CONNECTOR_POLICIES.get(source_type)
    if policy is None:
        return ()
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type") or policy.default_resource
    return next((group for group in policy.resources.get(str(resource or "").strip().lower(), ()) if column in group), ())
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
    policy = RECEIPT_CONNECTOR_POLICIES.get(source_type)
    if policy is None:
        # New financial catalog entries cannot silently select arbitrary numbers.
        if uses_receipt_policy(source_type):
            return []
        return None
    resource = config.get("resource_type") or config.get("resource") or config.get("object_type")
    resource = str(resource or policy.default_resource or "").strip().lower()
    available = set(columns)
    alternatives = policy.resources.get(resource, ())
    if include_aliases:
        return [column for group in alternatives for column in group if column in available]
    return [next(column for column in group if column in available)
            for group in alternatives if any(column in available for column in group)]


def uses_receipt_defaults(source_type, config):
    """Treat unclassified legacy lists as defaults, not proof of manual intent."""
    if not uses_receipt_policy(source_type):
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
