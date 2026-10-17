"""Connector-aware metric semantics used by the deterministic profiler."""

from __future__ import annotations

import re
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import replace


@dataclass(frozen=True)
class MetricDefinition:
    canonical_name: str
    patterns: tuple[str, ...]
    business_definition: str
    unit: str
    aggregation: str
    direction: str
    time_grains: tuple[str, ...]
    business_functions: tuple[str, ...]
    target_or_driver: str
    derived: bool = False

    def matches(self, normalized_column: str) -> bool:
        return any(
            re.search(pattern, normalized_column) is not None
            for pattern in self.patterns
        )

    def as_dict(self) -> dict:
        return asdict(self)


def _definition(
    canonical_name: str,
    patterns: tuple[str, ...],
    business_definition: str,
    unit: str,
    aggregation: str,
    direction: str,
    business_functions: tuple[str, ...],
    target_or_driver: str,
    derived: bool = False,
) -> MetricDefinition:
    return MetricDefinition(
        canonical_name=canonical_name,
        patterns=patterns,
        business_definition=business_definition,
        unit=unit,
        aggregation=aggregation,
        direction=direction,
        time_grains=("daily", "weekly", "monthly", "quarterly"),
        business_functions=business_functions,
        target_or_driver=target_or_driver,
        derived=derived,
    )


_REVENUE = _definition(
    "revenue",
    (
        r"(^|_)(revenue|sales|sale_value|order_total|invoice_total)$",
        r"(^|_)(gross_sales|net_sales|conversion_value|total_amount)$",
        r"(^|_)(total|subtotal|sub_total|line_total|line_amount|amount_paid|paid_amount|total_paid)$",
    ),
    "Money earned from completed sales, orders, or invoices.",
    "currency",
    "sum",
    "positive",
    ("increase_revenue", "profitability", "marketing_return", "cash_flow"),
    "outcome",
)

_UNIT_PRICE = _definition(
    "unit_price",
    (
        r"(^|_)(unit_price|price_per_unit|item_price|selling_price|sale_price|retail_price)$",
    ),
    "Price charged for one unit or line item.",
    "currency",
    "avg",
    "positive",
    ("increase_revenue", "profitability", "marketing_return"),
    "driver",
)

_SPEND = _definition(
    "spend",
    (
        r"(^|_)(spend|cost|expense|expenses|amount_spent|cost_micros)(_|$)",
        r"(^|_)(ad_cost|advertising_cost|purchase_cost)$",
    ),
    "Money spent to acquire, operate, or purchase goods and services.",
    "currency",
    "sum",
    "negative",
    ("reduce_expenses", "profitability", "marketing_return", "cash_flow"),
    "driver",
)

_PROFIT = _definition(
    "profit",
    (r"(^|_)(profit|gross_profit|net_profit|earnings)(_|$)",),
    "Revenue remaining after the relevant costs.",
    "currency",
    "sum",
    "positive",
    ("profitability", "increase_revenue"),
    "outcome",
)

_QUANTITY = _definition(
    "quantity",
    (
        r"(^|_)(quantity|unitquantity|linequantity|qty|units|item_count|items_count|sold_count)(_|$)",
        r"(^|_)(clicks|impressions|visits|sessions|orders|transactions|leads|conversions)(_|$)",
    ),
    "Count of units, events, or business activities.",
    "count",
    "sum",
    "positive",
    (
        "increase_revenue",
        "qualified_leads",
        "marketing_return",
        "retention",
    ),
    "driver",
)

_TAX = _definition(
    "tax",
    (r"(^|_)(tax|taxes|tax_amount|tax_total)(_|$)",),
    "Tax charged or recorded on a transaction.",
    "currency",
    "sum",
    "contextual",
    ("cash_flow", "profitability"),
    "driver",
)

_BALANCE = _definition(
    "balance",
    (r"(^|_)(balance|outstanding|amount_due|receivable)(_|$)",),
    "Unsettled amount remaining on an account or document.",
    "currency",
    "last",
    "negative",
    ("cash_flow", "profitability"),
    "outcome",
)

_DERIVED_RETURN = _definition(
    "return_rate",
    (
        r"(^|_)(roas|roi|ctr|cpc|cpa|conversion_rate|margin|rate|percent|percentage)(_|$)",
    ),
    "A ratio, rate, margin, or return derived from other measures.",
    "ratio",
    "avg",
    "positive",
    ("profitability", "marketing_return", "qualified_leads"),
    "both",
    derived=True,
)

_CUSTOMER = _definition(
    "customer_count",
    (r"(^|_)(customers|customer_count|active_customers|retained_customers)(_|$)",),
    "Count of customers or active customer relationships.",
    "count",
    "sum",
    "positive",
    ("retention", "increase_revenue"),
    "outcome",
)

_OPPORTUNITY_AMOUNT = _definition(
    "opportunity_amount", (r"^(amount|opportunity_amount)$",),
    "Estimated opportunity sale amount, not necessarily won or booked revenue.",
    "currency", "sum", "positive",
    ("increase_revenue", "profitability", "cash_flow", "marketing_return"), "outcome",
)
_EXPECTED_REVENUE = _definition(
    "expected_revenue", (r"^(expectedrevenue|expected_revenue)$",),
    "Salesforce expected revenue based on opportunity amount and probability.",
    "currency", "sum", "positive",
    ("increase_revenue", "profitability", "cash_flow", "marketing_return"), "outcome",
)
_OPPORTUNITY_PROBABILITY = _definition(
    "opportunity_probability", (r"^(probability|opportunity_probability)$",),
    "Estimated likelihood of closing, in percent; not an observed win rate.",
    "probability", "avg", "positive",
    ("increase_revenue", "qualified_leads", "marketing_return"), "driver",
)
_OPPORTUNITY_COUNT = _definition(
    "record_count", (r"^record_count$",),
    "Number of distinct Salesforce records, not product quantity.",
    "count", "sum", "positive",
    ("increase_revenue", "qualified_leads", "retention", "marketing_return"), "driver",
)


# The source-specific registry takes precedence over the generic vocabulary.
# It is deliberately data, so connector additions do not require profiler code.
METRIC_REGISTRY: dict[str, tuple[MetricDefinition, ...]] = {
    "google_ads": (_SPEND, _QUANTITY, _REVENUE, _DERIVED_RETURN),
    "meta_ads": (_SPEND, _QUANTITY, _REVENUE, _DERIVED_RETURN),
    "google_analytics": (_QUANTITY, _REVENUE, _DERIVED_RETURN),
    "quickbooks": (_REVENUE, _SPEND, _TAX, _BALANCE, _QUANTITY),
    "freshbooks": (
        replace(_UNIT_PRICE, patterns=_UNIT_PRICE.patterns + (r"^line_unit_cost_amount$",)),
        _REVENUE, _SPEND, _TAX, _BALANCE, _QUANTITY,
    ),
    "sage": (replace(_REVENUE, patterns=_REVENUE.patterns + (r"(^|_)net_amount$",)), _SPEND, _TAX, _BALANCE, _QUANTITY),
    "xero": (_REVENUE, _SPEND, _TAX, _BALANCE, _QUANTITY),
    "zoho_books": (replace(_UNIT_PRICE, patterns=_UNIT_PRICE.patterns + (r"^line_rate$",)), _REVENUE, _SPEND, _TAX, _BALANCE, _QUANTITY),
    "shopify": (_REVENUE, _SPEND, _TAX, _QUANTITY),
    "square": (_REVENUE, _TAX, _QUANTITY),
    "lightspeed": (_REVENUE, _TAX, _QUANTITY),
    "lightspeed_x": (
        replace(_UNIT_PRICE, patterns=_UNIT_PRICE.patterns + (r"^line_(price|pricing_price)$",)),
        replace(_REVENUE, patterns=_REVENUE.patterns + (r"^(line_)?(price_total|total_price)$",)),
        _TAX, _QUANTITY,
    ),
    "lightspeed_k": (_REVENUE, _TAX, _QUANTITY),
    "lightspeed_o": (_REVENUE, _TAX, _QUANTITY),
    "stripe": (_REVENUE, _SPEND, _TAX, _QUANTITY),
    "salesforce": (
        _OPPORTUNITY_AMOUNT, _EXPECTED_REVENUE, _OPPORTUNITY_PROBABILITY, _OPPORTUNITY_COUNT,
        replace(_QUANTITY, patterns=(r"^(totalopportunityquantity|opportunity_quantity)$",) + _QUANTITY.patterns,
                business_definition="Salesforce opportunity-level Quantity, not a per-product breakdown or a count of deals."),
        _REVENUE,
    ),
    "hubspot": (_REVENUE, _QUANTITY, _DERIVED_RETURN),
}

GENERIC_METRIC_REGISTRY = (
    _REVENUE,
    _SPEND,
    _PROFIT,
    _QUANTITY,
    _UNIT_PRICE,
    _TAX,
    _BALANCE,
    _DERIVED_RETURN,
    _CUSTOMER,
)


def normalize_metric_column_name(column) -> str:
    value = str(column or "").strip().lower()
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    return re.sub(r"[^a-z0-9]+", "_", value).strip("_")


def get_metric_definition(
    column,
    source_type: str | None = None,
) -> MetricDefinition | None:
    normalized_column = normalize_metric_column_name(column)
    source_key = str(source_type or "").strip().lower()
    definitions = (
        METRIC_REGISTRY.get(source_key, ()) + GENERIC_METRIC_REGISTRY
    )
    for definition in definitions:
        if definition.matches(normalized_column):
            return definition
    return None
