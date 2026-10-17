"""Exact, versioned emitted-column policies. Never use profiler name heuristics here."""

from __future__ import annotations

from dataclasses import dataclass, replace
import json
from pathlib import Path
from typing import NotRequired, TypedDict
from urllib.parse import urlparse


POLICY_VERSION = "2026-10-17.1"
CONNECTOR_SCHEMA_VERSION = "decisionate-v1"
SELECTION_PROVENANCE_KEY = "metric_selection_provenance"
SCHEMA_VERSION_KEY = "connector_schema_version"
CURATED_SELECTION_KEY = "curated_metric_selection"
FRAME_POLICY_KEY = "decisionate_metric_policy"
POLICY_SCHEMAS = json.loads(Path(__file__).with_name("metric_policy_schemas.json").read_text())


class MetricDescriptor(TypedDict):
    columnKey: str
    semanticKey: str
    classification: str
    aggregation: str
    unit: str
    reason: str
    evidenceUrl: str
    currency: NotRequired[str | None]
    multiplier: NotRequired[float]
    sign: NotRequired[int]
    family: NotRequired[str | None]
    entityKeys: NotRequired[list[str]]
    sourcePaths: NotRequired[list[str]]
    operation: NotRequired[str]
    components: NotRequired[list[str]]


@dataclass(frozen=True)
class MetricPolicy:
    semantic_key: str
    source_paths: tuple[str, ...]
    definition: str
    classification: str = "core"
    aggregation: str = "SUM"
    unit: str = "count"
    currency_paths: tuple[str, ...] = ()
    scale: str = "identity"
    conditions: tuple[str, ...] = ()
    entity_keys: tuple[str, ...] = ()
    family: str | None = None
    sign: int = 1
    weight_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class DerivedMetricPolicy:
    semantic_key: str
    column_key: str
    definition: str
    operation: str
    components: tuple[str, ...]
    default_selected: bool = True
    unit: str = "ratio"


@dataclass(frozen=True)
class DatasetMetricPolicy:
    connector_key: str
    dataset_key: str
    grain: str
    evidence_url: str
    fixture: str
    metrics: tuple[MetricPolicy, ...] = ()
    derived: tuple[DerivedMetricPolicy, ...] = ()
    connector_schema_version: str = CONNECTOR_SCHEMA_VERSION
    policy_version: str = POLICY_VERSION
    reviewed_at: str = "2026-10-14"
    review_status: str = "contract_fixture"


def measure(key, definition, *, paths=None, **kwargs):
    return MetricPolicy(key, tuple(paths or (key,)), definition, **kwargs)


def money(key, definition, *, paths=None, **kwargs):
    kwargs.setdefault("currency_paths", ("currency",))
    return measure(key, definition, paths=paths, unit="currency", **kwargs)


CTR = DerivedMetricPolicy("ctr", "ctr", "Clicks divided by impressions, recalculated after aggregation.", "ratio", ("clicks", "impressions"))
RECORDS = DerivedMetricPolicy("record_count", "__metric_record_count", "Number of distinct source records, not the sum of their identifiers.", "count_distinct", ("record_id",), unit="count")
LINE_QUANTITY = measure("quantity", "Units recorded on the source line item.")
LINE_TOTAL = money("line_total", "Authoritative line total; never added to the parent document total.", family="line_value")
UNIT_PRICE = money("unit_price", "Price per unit; an average, not additive revenue.", classification="optional", aggregation="AVG", family="unit_price")


POLICIES = [
    DatasetMetricPolicy("google_search_console", "search_analytics", "property_date",
        "https://developers.google.com/webmaster-tools/v1/searchanalytics/query", "tests.test_new_connectors", (
            measure("clicks", "Clicks on Google Search results."),
            measure("impressions", "Appearances in Google Search results."),
            measure("position", "Impression-weighted search position.", classification="optional", aggregation="AVG_WEIGHTED", unit="position", weight_paths=("impressions",)),
        ), (CTR, DerivedMetricPolicy("weighted_position", "weighted_position", "Search position weighted by impressions; raw report rows only.", "weighted_mean", ("position", "impressions"), unit="position"))),
    DatasetMetricPolicy("google_analytics", "report", "property_date",
        "https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema", "tests.test_google_analytics", tuple(
            measure(key, definition) for key, definition in (
                ("newUsers", "First-time users reported for each date."),
                ("sessions", "Sessions reported for each date."),
                ("engagedSessions", "Engaged sessions reported for each date."),
                ("eventCount", "Recorded events."),
                ("keyEvents", "Recorded key events."),
            )
        ) + tuple(measure(key, "Unique users in the provider reporting window; not additive across dates.", classification="optional", aggregation="LAST", conditions=("single_row",)) for key in ("activeUsers", "totalUsers")) + (
            money("totalRevenue", "Provider-reported total revenue.", classification="optional", currency_paths=("currencyCode",)),
        ), (DerivedMetricPolicy("engagement_rate", "engagementRate", "Engaged sessions divided by sessions.", "ratio", ("engagedSessions", "sessions")),)),
    DatasetMetricPolicy("google_ads", "campaign_performance", "campaign_date",
        "https://developers.google.com/google-ads/api/fields/v22/metrics", "tests.test_connectors", (
            measure("impressions", "Ad impressions."), measure("clicks", "Ad clicks."),
            money("cost", "Ad cost already converted from micros by this connector."),
            measure("conversions", "Primary conversion actions attributed by Google Ads."),
            money("conversions_value", "Value of primary conversions."),
        ), (CTR, DerivedMetricPolicy("cpc", "cpc", "Ad cost divided by clicks.", "ratio", ("cost", "clicks"), unit="currency"),
            DerivedMetricPolicy("cpa", "cpa", "Ad cost divided by conversions.", "ratio", ("cost", "conversions"), unit="currency"),
            DerivedMetricPolicy("roas", "roas", "Conversion value divided by ad cost.", "ratio", ("conversions_value", "cost")))),
    DatasetMetricPolicy("meta_ads", "campaign_insights", "campaign_date",
        "https://developers.facebook.com/docs/marketing-api/insights/", "tests.test_connectors", (
            measure("impressions", "Ad impressions."),
            measure("clicks", "All ad clicks, not a link-click count.", classification="optional"),
            money("spend", "Ad spend in the account currency."),
            measure("leads", "Normalized lead actions in the provider attribution window."),
            measure("purchases", "Normalized purchase actions in the provider attribution window."),
            measure("reach", "Unique audience reach; not additive across overlapping audiences.", classification="optional", aggregation="LAST", conditions=("single_row",)),
        )),
    DatasetMetricPolicy("stripe", "charges", "charge",
        "https://docs.stripe.com/api/charges/object", "tests.test_connectors", (
            money("amount", "Successful charge amount converted from the currency's minor units.", scale="stripe_minor", conditions=("successful_charge",), family="charge_value"),
            money("amount_refunded", "Refunded charge amount, shown as a negative reversal.", scale="stripe_minor", sign=-1, conditions=("successful_charge",), family="charge_refund"),
        )),
    DatasetMetricPolicy("shopify", "orders", "order_line",
        "https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem", "tests.test_new_connectors", (
            LINE_QUANTITY, LINE_TOTAL, UNIT_PRICE,
        )),
    DatasetMetricPolicy("woocommerce", "orders", "order_line",
        "https://developer.woocommerce.com/docs/apis/rest-api/", "tests.test_new_connectors", (
            LINE_QUANTITY, LINE_TOTAL, money("line_tax", "Tax on the source line item."), UNIT_PRICE,
        )),
    DatasetMetricPolicy("square", "orders", "order_line",
        "https://developer.squareup.com/reference/square/objects/Order", "tests.test_new_connectors", (
            LINE_QUANTITY,
            money("line_total", "Authoritative line total already in major units.", conditions=("completed_order", "two_decimal_currency"), family="line_value"),
            money("unit_price", "Unit price already converted by the connector; not additive revenue.", classification="optional", aggregation="AVG", conditions=("two_decimal_currency",)),
        )),
]


# Only datasets exercised by the emitted-schema inventory receive profiles.
# Unverified objects and restricted POS schemas deliberately have no profile.
for connector, resources, evidence, fixture in (
    ("quickbooks", ("invoices", "bills", "sales_receipts", "purchases", "estimates"), "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice", "tests.test_connectors"),
    ("freshbooks", ("invoices", "credit_notes"), "https://www.freshbooks.com/api/invoices", "tests.test_connectors"),
    ("sage", ("sales_invoices",), "https://developer.sage.com/accounting/reference/invoicing-purchases", "tests.test_sage_connector"),
    ("xero", ("invoices", "credit_notes", "purchase_orders", "quotes"), "https://developer.xero.com/documentation/api/accounting/invoices", "tests.test_xero_connector"),
    ("zoho_books", ("invoices",), "https://www.zoho.com/books/api/v3/invoices/", "tests.test_zoho_books_connector"),
):
    for resource in resources:
        line_metrics = (LINE_QUANTITY, LINE_TOTAL, UNIT_PRICE)
        if connector == "sage":
            # Its current fixture does not emit an authoritative line total.
            line_metrics = (LINE_QUANTITY, UNIT_PRICE)
        if resource == "credit_notes":
            line_metrics = (LINE_QUANTITY, money("line_total", "Credit line amount, shown as a negative reversal.", sign=-1, family="line_value"), UNIT_PRICE)
        POLICIES.append(DatasetMetricPolicy(connector, resource, "document_line", evidence, fixture, line_metrics))

for connector, resources, paths, evidence in (
    ("quickbooks", ("payments",), ("TotalAmt",), "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment"),
    ("freshbooks", ("payments", "expenses"), ("amount",), "https://www.freshbooks.com/api/payments"),
    ("zoho_books", ("customer_payments",), ("amount",), "https://www.zoho.com/books/api/v3/customer-payments/"),
):
    for resource in resources:
        POLICIES.append(DatasetMetricPolicy(connector, resource, "transaction", evidence, "tests.test_connectors" if connector != "zoho_books" else "tests.test_zoho_books_connector", (money("amount", "Transaction amount in its stated currency.", paths=paths),)))

for connector, resources, evidence, fixture in (
    ("hubspot", ("contacts", "companies", "deals", "tickets"), "https://developers.hubspot.com/docs/api-reference/crm-deals-v3/guide", "tests.test_connectors"),
    ("salesforce", ("accounts", "leads", "opportunities"), "https://developer.salesforce.com/docs/platform/api-rest/guide/resources-sobject-describe.html", "tests.test_connectors"),
    ("quickbooks", ("customers", "vendors", "products_services", "accounts"), "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer", "tests.test_connectors"),
    ("freshbooks", ("profile", "clients", "projects", "chart_of_accounts"), "https://www.freshbooks.com/api/clients", "tests.test_connectors"),
    ("sage", ("contacts",), "https://developer.sage.com/accounting/reference/contacts", "tests.test_sage_connector"),
    ("xero", ("contacts", "accounts", "items"), "https://developer.xero.com/documentation/api/accounting/contacts", "tests.test_xero_connector"),
):
    for resource in resources:
        POLICIES.append(DatasetMetricPolicy(connector, resource, "entity", evidence, fixture, derived=(RECORDS,)))


# Preserve the policy pinned to deliberate selections; automatic defaults use
# the newly reviewed receipt fields without silently rewriting manual choices.
_previous_policies = [replace(profile, policy_version="2026-10-14.1") for profile in POLICIES]
for index, profile in enumerate(POLICIES):
    if profile.connector_key == "sage" and profile.dataset_key == "sales_invoices":
        POLICIES[index] = replace(profile,
            evidence_url="https://us-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=210126214952167",
            reviewed_at="2026-10-16", metrics=(
                LINE_QUANTITY, replace(UNIT_PRICE, classification="core"),
                money("line_total", "Net line amount printed on the invoice, excluding tax.", paths=("line__net_amount",), family="line_value"),
                money("line_tax", "Tax amount on the invoice line.", paths=("line_tax", "line__tax_amount")),
                money("line_discount", "Monetary line discount, not its percentage.", paths=("line__discount_amount",)),
                money("net_amount", "Document net amount, recorded once per invoice.", family="document_value"),
                money("tax_amount", "Document tax amount, recorded once per invoice."),
                money("total_amount", "Document total including tax, recorded once per invoice.", family="document_value"),
            ))
    elif profile.connector_key == "zoho_books" and profile.dataset_key == "invoices":
        POLICIES[index] = replace(profile, reviewed_at="2026-10-16", metrics=(
            LINE_QUANTITY, LINE_TOTAL, replace(UNIT_PRICE, classification="core"),
            money("line_discount", "Fixed line discount amount, not the percentage/fixed input.", paths=("line__discount_amount",)),
            *(money(key, "Invoice amount in the document currency, recorded once per invoice.", family="document_value")
              for key in ("total", "sub_total", "tax_total", "shipping_charge", "adjustment", "balance", "payment_made", "credits_applied")),
        ))
POLICIES.append(DatasetMetricPolicy("lightspeed_x", "sales", "sale_line",
    "https://x-series-api.lightspeedhq.com/docs/sales_returns", "tests.test_new_connectors", (
        LINE_QUANTITY,
        money("unit_price", "Tax-exclusive customer unit price; never the inventory cost.", paths=("unit_price", "line__unit_price", "line__price", "line__pricing__price"), aggregation="AVG"),
        money("line_total", "Provider-reported line price total, without inventing price-times-quantity.", paths=("line_total", "line__price_total", "line__total_price"), family="line_value"),
        money("line_tax", "Provider-reported line tax total, not the per-unit tax.", paths=("line__tax_total", "line__total_tax")),
        money("line_discount", "Provider-reported line discount total.", paths=("line__discount_total", "line__total_discount")),
        money("total", "Sale price total, recorded once per sale; not a tax-inclusive grand total.", paths=("total", "total_price"), family="document_value"),
        money("total_tax", "Sale tax total, recorded once per sale."),
    ), reviewed_at="2026-10-16"))
_previous_receipt_policies = [replace(profile, policy_version="2026-10-16.1") for profile in POLICIES]
for index, profile in enumerate(POLICIES):
    if profile.connector_key == "lightspeed_x" and profile.dataset_key == "sales":
        receipt_paths = {
            "line_total": ("line_total", "line__price_total", "line__total_price", "line__pricing__total"),
            "line_tax": ("line__tax_total", "line__total_tax", "line__tax__total"),
            "line_discount": ("line__discount_total", "line__total_discount", "line__pricing__discount_total"),
            "total": ("total", "total_price", "totals__price"),
            "total_tax": ("total_tax", "totals__tax"),
        }
        POLICIES[index] = replace(profile, reviewed_at="2026-10-17",
            evidence_url="https://x-series-api.lightspeedhq.com/openapi/api-2026-07.yaml",
            metrics=tuple(replace(entry, source_paths=receipt_paths.get(entry.semantic_key, entry.source_paths))
                          for entry in profile.metrics) + (
                money("grand_total", "Tax-inclusive sale total, recorded once per sale; never added to line or tax-exclusive totals.",
                      paths=("grand_total", "totals__price_incl_tax"), family="document_value"),
            ))
POLICIES.extend(_previous_receipt_policies)
POLICIES.extend(_previous_policies)


def validate_policies(policies=POLICIES):
    keys = set()
    for profile in policies:
        key = (profile.connector_key, profile.dataset_key, profile.connector_schema_version, profile.policy_version)
        if key in keys or not all(key):
            raise ValueError(f"Duplicate or incomplete metric policy: {key}")
        keys.add(key)
        if not profile.grain or not profile.fixture or not profile.reviewed_at or urlparse(profile.evidence_url).scheme != "https":
            raise ValueError(f"Metric policy is missing review evidence: {key}")
        names = set()
        for entry in profile.metrics:
            if entry.semantic_key in names or not entry.source_paths or not entry.definition:
                raise ValueError(f"Invalid metric definition: {key}/{entry.semantic_key}")
            names.add(entry.semantic_key)
            if entry.classification not in {"core", "optional"} or entry.aggregation not in {"SUM", "AVG", "LAST", "AVG_WEIGHTED"}:
                raise ValueError("Unsupported classification or aggregation")
            if entry.unit in {"ratio", "price", "probability", "balance", "inventory"} and entry.aggregation == "SUM":
                raise ValueError("A non-additive metric cannot use SUM")
            if entry.unit == "currency" and not entry.currency_paths:
                raise ValueError("Money requires an explicit currency strategy")
            if entry.aggregation == "AVG_WEIGHTED" and not entry.weight_paths:
                raise ValueError("Weighted averages require an explicit weight")
            if entry.scale not in {"identity", "stripe_minor", "micros"} or entry.sign not in {-1, 1}:
                raise ValueError("Invalid amount conversion")
        for entry in profile.derived:
            if not entry.components or entry.operation not in {"ratio", "weighted_mean", "count_distinct"}:
                raise ValueError("Invalid derived metric")


validate_policies()
METRIC_POLICIES = {(p.connector_key, p.dataset_key, p.connector_schema_version): p for p in POLICIES if p.policy_version == POLICY_VERSION}
METRIC_POLICY_VERSIONS = {(p.connector_key, p.dataset_key, p.connector_schema_version, p.policy_version): p for p in POLICIES}
