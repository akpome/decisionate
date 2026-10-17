# Curated Metric Defaults

## Discovery

The supplied Default Metric Selection Workflow is the feature specification.
Its connector matrix is not an emitted schema. This inventory was established
before changing the selection implementation:

| Concern | Existing implementation |
| --- | --- |
| Connector catalog | `apps/api/app/modules/datasets/services/sources.py` |
| Provider response normalization | `datasets/services/connectors.py`, `google_analytics.py` |
| Field profiling and selection | `datasets/services/metric_selection.py` |
| Heuristic vocabulary, not an exact allowlist | `datasets/services/metric_registry.py` |
| Persistence | `Dataset.source_config.selected_metric_columns`; sync explicitly preserves it |
| Configuration API | `PATCH /datasets/{id}/metric-selection` |
| Configuration UI | `apps/web/app/dashboard/datasets/[id]/page.tsx` |
| Analytical loading | `datasets/services/dataset_loader.py` |
| Totals and chart aggregation | `datasets/services/metrics.py`, `forecasting/services.py` |
| Historical storage | Monthly summaries contain sum/count/min/max/mean, not arbitrary sufficient statistics |

The existing 16 metric-selection tests characterize legacy behavior, including
the <=15-row numeric blanket, explicit empty selections, manual dimension/ID
selection and saved selections. The receipt-only restriction below supersedes
the numeric blanket for financial connectors, independently of rollout flags.

## Mapping Boundaries

| Connector | Actual dataset/output | Policy boundary |
| --- | --- | --- |
| Google Analytics | Configurable `run_report`, emitted API metric names | Exact standard names; arbitrary custom metrics are not defaults. User counts are not additive over time. |
| Search Console | Date-only property report: clicks, impressions, ctr, position | Clicks and impressions; recompute CTR. Historical weighted position needs sufficient statistics. |
| Google Ads | `campaign_performance`: clicks, impressions, cost already converted from micros, conversions, conversions_value | Never convert `cost` twice; absent account currency blocks money. |
| Meta Ads | `campaign_insights`: impressions, clicks, spend, reach; normalized leads/purchases/actions | Existing clicks are all clicks, not verified link clicks. Reach cannot be summed across audiences. Missing currency blocks spend. |
| HubSpot | contacts, companies, deals, tickets; dynamic property names | Record counts; deal money needs property metadata and currency. No metadata is currently persisted. |
| Salesforce | accounts, leads, opportunities; dynamic Describe fields | Record counts; opportunity money needs Describe currency metadata. |
| QuickBooks | invoices, payments, sales_receipts, estimates, bills, purchases, vendors, customers, products_services, accounts | Invoice-like resources expand lines. Prefer verified line measures; balances are not additive snapshots. |
| FreshBooks | profile, invoices, expenses, payments, clients, chart_of_accounts, credit_notes, projects | Money object aliases are flattened; invoice/credit-note lines expand. |
| Sage | sales/purchase invoices and credits, contacts, ledger_accounts, products, services, bank_accounts, payments, other_payments, journals | Regional aliases can be ambiguous. Only exact verified source fields qualify; mixed directions cannot be assumed. |
| Xero | invoices, contacts, payments, credit_notes, quotes, purchase_orders, accounts, items | Line-expanded documents; payment currency is not currently resolved. |
| Zoho Books | invoices, contacts, expenses, customer_payments, credit_notes, estimates, sales_orders, projects, items | `total_amount` may fall back to base-currency or source-currency fields; prefer exact source fields with matching currency. |
| Stripe | charges only | Raw minor units; do not trust the legacy blanket `/100` amount_major alias for zero-decimal currencies. |
| Square | orders expanded into lines | Normalized money is already major units; require COMPLETED state and currency. |
| Shopify | GraphQL orders expanded into lines | Current query does not request current* order totals; use verified discounted line totals instead of claiming current-order semantics. |
| WooCommerce | v3 orders expanded into lines | Exact line totals/quantity; exclude canceled/refunded states from automatic money recommendations. |
| Lightspeed R/X | Sales expanded into lines; X also products/customers | Per-series references must be used; R Sale/SaleLine receipt fields were verified in the 2026-10-16 follow-up. Curated monetary policy certification remains separate. |
| Lightspeed K/O, Business Profile | Marked planned by source registry | No defaults enabled. |
| CSV, Excel, JSON, Parquet, SQL | User-defined schemas | No guessed defaults; explicit saved selections remain supported. |

`scripts/export_metric_schema_inventory.py` executes existing mocked connector
tests and exports actual returned column names/types and safe report metadata.
It does not contact providers or inspect customer databases. Its output is
contract-fixture evidence, **not** a claim of sanitized live or partner-certified
payloads. Restricted/missing metadata and unknown schemas remain fail-closed.

No existing source selection is migrated or rewritten by discovery, GET
requests, reconnect, token refresh, or policy upgrades.

## API and Persistence

The read-only endpoint follows the application's existing route layout:
`GET /datasets/{dataset_id}/metric-recommendations`. It verifies workspace
ownership before loading any schema and returns 404 when rollout is disabled.
The dataset details profile includes `curated_recommendations` when the UI is
enabled for a new candidate or the explicit existing-dataset prompt is enabled.

The existing PATCH endpoint accepts `use_curated_recommendations: true` and the
returned `policy_version`. `select_recommended_metric_columns: true` is an
explicit restore action. Otherwise the supplied list is authoritative, including
an empty list. Stale policies, missing fields and unsafe selections are rejected.

New selections add `curated_metric_selection`, `connector_schema_version` and
`metric_selection_provenance` to source_config. Provenance records the source
(recommended/user), policy/schema versions, actor, UTC time and each metric's
semantic key/aggregation. No table migration or historical backfill is needed.
Existing explicit selections are not assigned invented provenance.

The connector schema version describes Decisionate's emitted contract, not the
vendor API version. A reviewed incompatible emitter change must bump it and add
a corresponding exact policy. Unknown or absent versions get no recommendations.
Saved versions and provenance are copied unchanged by connector resync.
Analytical reads resolve the saved policy version, not the latest recommendation
version. Old policies must remain in the version registry; an unavailable saved
version fails closed until an explicit restore/save. New configurations use the
current reviewed version. Where the source reports an upstream API version, it
must also occur in the committed fixture inventory.

## Analytical Safety

Curated selections create an in-memory analytical view; ingestion and stored
source values remain unchanged. Source-column identity and exact aliases are
preserved. Monetary values require one reviewed currency across all relevant
rows. Mixed currencies and unresolved account currencies are skipped, not summed
or silently converted. The deliberately limited currency exponent table fails
closed for currencies that have not been reviewed. Stripe raw minor amounts are
converted once; Google Ads `cost` and Square normalized amounts are already major
units. Refund/credit line reversal signs are policy data, not UI logic.

Totals, calendar aggregation, forecasts, relationship analysis and multi-metric
analysis use the policy aggregation. CTR and other ratios are recomputed from
summed components. Zero denominators return null. Weighted position keeps its
weighted numerator and denominator across calendar aggregation. Distinct counts
retain member sets in memory across reaggregation. Chart payloads carry compact
policy and sufficient-state metadata under reserved keys, hidden from metric
and dimension pickers. Valid position weights are preserved separately from all
impressions when source positions are missing.

Legacy monthly storage cannot reconstruct impression-weighted positions,
distinct entity sets, arbitrary LAST snapshots or missing currencies. Those
recommendations are omitted for historical summaries. Physical joins reject
curated non-additive/derived metrics because the current persisted join format
cannot preserve their sufficient statistics; relationship/multi-metric analysis
remains available. No row-level rate is knowingly summed in these paths.
Historical scaled/reversal amounts are also omitted until sufficient signed,
currency-specific state is available. Square's existing normalized `/100` aliases
are restricted to reviewed two-decimal currencies; unsupported denominations
must not be guessed from the aliases.

Unlike the draft matrix, daily GA4 activeUsers/totalUsers and Meta reach are not
recommended as SUM: their unique populations can overlap across dates/audiences.
They are optional provider totals only for a single report row. The policy also
does not claim that the existing Meta clicks field means link clicks or that the
Shopify query emits current* order totals. Missing CRM property/Describe currency
metadata is not inferred from names.

## Rollout

All changing flags default off in `.env.example`; diagnostics default on only
inside the eligible backend cohort. Configure the same flags on API and worker.

| Environment variable | Initial value |
| --- | --- |
| CURATED_METRIC_DEFAULTS_BACKEND | false |
| CURATED_METRIC_DEFAULTS_UI | false |
| CURATED_METRIC_DEFAULTS_NEW_DATASETS | false |
| CURATED_METRIC_DEFAULTS_EXISTING_PROMPT | false |
| CURATED_METRIC_DEFAULTS_DIAGNOSTICS | true |
| CURATED_METRIC_DEFAULTS_INTERNAL_USERS | empty, comma-separated internal user IDs |
| CURATED_METRIC_DEFAULTS_ROLLOUT | internal |

Enable BACKEND and internal user IDs first for shadow diagnostics and the GET
endpoint. Enable UI for new internal candidates, then NEW_DATASETS for automatic
one-time selection. Existing rows are not stamped by a reconnect; the existing
prompt is separately gated, and an unversioned row still cannot guess a policy.
Only set ROLLOUT=all after connector-by-connector review. Disabling BACKEND/UI
restores the legacy picker and leaves saved selections/provenance in storage;
virtual formula selections become available again when the feature is restored.
An explicit legacy-picker save exits policy-managed analysis without deleting
the dataset or changing ingestion.

## Evidence and Remaining Review

The committed inventory contains 90 schema variants generated by 154 existing
mocked connector tests. Rebuild from `apps/api` with an isolated test database:

```bash
PYTHONDONTWRITEBYTECODE=1 APP_ENV=development DATABASE_URL=sqlite:////tmp/metric-inventory.db .venv/bin/python -B scripts/export_metric_schema_inventory.py > tests/fixtures/metric_schema_inventory.json
```

The `--compact` option generates the production
`app/modules/datasets/services/metric_policy_schemas.json` inventory. It contains
column names and API versions only. An allowlisted field that is not in that
reviewed emitted inventory stays pending even if a new provider response happens
to include it. CI checks the compact inventory against the full contract fixture.

Unit/API tests cover exact schemas, unknown versions, currency/signs, conversion
idempotency, weighted calculations, source preservation, explicit empty choices,
restore, provenance, stale policy rejection and cross-tenant denial. The existing
metric-selection tests continue to characterize flag-off behavior.

Production rollout still requires sanitized real/vendor-sanctioned golden
payloads per connector/API version, partner-only POS references, actual regional
accounting currency fields, and CRM property/Describe metadata fixtures. Missing
objects/fields do not become recommended merely because they appear in the
workflow matrix. The internal policy infrastructure is not evidence that all
providers have passed that external review.

## Receipt-Only Financial Defaults (2026-10-16)

Accounting, commerce and payment datasets now intersect automatic recommendations
with exact receipt/invoice field names in `services/receipt_metrics.py`. This is
a restriction on the existing profiler, not a new currency or aggregation policy.
It does not turn every field containing `amount`, `rate` or `total` into a metric.
The restriction also applies to small datasets and objective changes.

Changing a dataset's business objective replaces its checked metrics with the
new objective's recommendations, in both the legacy and curated pickers. The
server detects the objective change even if a client submits an old selection
without the reset flag. Curated recommendations use the shared objective rules
after schema, type, currency and receipt eligibility checks; unrelated verified
metrics remain optional, not checked. No matching metrics means an empty default
selection. Manual overrides and an explicit empty selection remain intact when
saving the same objective. The page updates the objective and checked metrics
together after an acknowledged save, so a failed request cannot mislabel the
old selection as belonging to the new objective.

The mappings prefer one emitted alias per measure. Depending on the connector,
eligible fields include line quantity, unit price, line amount, document total,
tax, discount, shipping and amount paid/due. Only fields actually present and
accepted by the existing profiler can be recommended. Normalized line aliases
are preferred to their raw copies; a raw copy cannot suppress the chosen alias
as a duplicate. Exchange rates, inventory levels, costs internal to the provider,
transport counters and IDs are not automatically selected. IDs and textual
dimensions may still be retained for grouping and joins.

Resource scope matters: contacts, customers, accounts, products and unrecognized
resources get no automatic financial metrics. Payment objects use their payment
amount, not an embedded invoice total or a bank-currency equivalent. Planned
Lightspeed K/O schemas get no guessed defaults. Business-app, advertising,
analytics, uploaded-file and SQL-query defaults are unchanged.

Research checked the following primary references against the local emitters:

| Provider | Field evidence |
| --- | --- |
| Shopify | [LineItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem) and [Order Printer fields](https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/shopify-order-printer/liquid-variables-and-filters-reference): quantity and original/discounted line prices. |
| QuickBooks | [Invoice](https://developer.intuit.com/docs/api/accounting/invoice): line Amount, Qty, UnitPrice, document TotalAmt and Balance. |
| FreshBooks | [Invoices](https://www.freshbooks.com/api/invoices): qty, unit_cost and line amount. |
| Xero | [Invoices](https://developer.xero.com/documentation/api/accounting/invoices) and [Payments](https://developer.xero.com/documentation/api/accounting/payments): Quantity, UnitAmount, LineAmount, tax and document amounts; payment Amount differs from BankAmount. |
| Zoho Books | [Invoices](https://www.zoho.com/books/api/v3/invoices/): quantity, rate and item/document amounts; bcy_rate is a different base-currency value. |
| WooCommerce | [v3 order fields](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/): quantity, price, line total/tax and order charges. |
| Square | [OrderLineItem](https://developer.squareup.com/reference/square/objects/orderlineitem): quantity and monetary fields. Only existing normalized major-unit aliases are allowed here, not duplicate raw minor-unit amounts. |
| Stripe | [Charge](https://docs.stripe.com/api/charges/object) and [receipts](https://docs.stripe.com/receipts): payment/refund amount; exclude application fees, risk scores and card metadata. Raw amount remains minor units outside curated conversion; the restriction does not certify the legacy amount_major alias. |
| Lightspeed X | [Sales 101](https://x-series-api.lightspeedhq.com/docs/sales_101): quantity and pricing; internal cost and loyalty fields are not receipt defaults. |
| Lightspeed R | [Sale](https://developers.lightspeedhq.com/retail/endpoints/Sale/) and [SaleLine](https://developers.lightspeedhq.com/retail/endpoints/Sale-SaleLine/): quantity, unit price, line total, sale total/subtotal, tax, discount and tip. Exclude calcAvgCost, calcFIFOCost, IDs, flags and duplicate calcTotal/total aliases. |
| Sage Accounting | [Create sales invoices](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191312200): customer invoice price/rate and totals. Keep local normalized line aliases; do not substitute Sage Active, Sage 50 or Sage Operations API schemas. |
| Lightspeed K (planned) | [Reservation order notification](https://api-docs.lsk.lightspeed.app/operation/operation-reservationordernotification): receipt/line fields exist, but are not certification of Decisionate's current Financial API emitter. No defaults are guessed from this different endpoint. |
| Lightspeed O (planned) | [Orders](https://apidoc.kounta.com/orders/) and [Lines](https://apidoc.kounta.com/lines/): reviewed the public references, but current rendered line-field evidence is incomplete. No unverified monetary defaults are enabled. |

Sage Accounting's detailed API reference still could not be read through the
research client (the direct reference request returned 403). Its customer invoice
guide was reviewed and the restriction remains limited to normalized aliases
backed by local connector tests. The Lightspeed R reference was accessible in the
follow-up review. No regional Sage field or cross-series Lightspeed total was
invented. Existing curated fixture/currency checks remain in force; public field
documentation is not a claim of sanitized live-provider payload certification.

The initial restriction did not correct old selected-column lists. The follow-up
uses receipt defaults for financial selections marked `recommended` and for
nonempty legacy lists without selection provenance. Older legacy saves recorded
automatic defaults and manual choices identically, so intent cannot be recovered
reliably from those lists. Their original configuration is left untouched; only
the effective analytical/UI selection is corrected. An empty unclassified list
remains an opt-out. Selections explicitly recorded as `user` remain manual.
All new saves record `user` or `recommended`, including the legacy picker, and
reset sends the explicit select-recommended request. The page prefers the API's
effective selection over raw curated savedSelection metadata. Users do not need
to reset each old dataset to remove obsolete defaults.

Automatic contact record counts in curated profiles remain available for manual
selection but are no longer selected by default. Stored aggregation policy
versions and source data are not rewritten on read. Payment resources are scoped
to payment amounts, not invoice line quantities, stock or embedded invoice totals.

For selected financial analytical reads, DuckDB and BigQuery inspect schema
metadata and project out unrelated typed numeric columns before creating the
pandas DataFrame. Selected fields, identifiers, nonnumeric dimensions and selected
summary state are retained. Legacy indexed/singleton transaction schemas bypass
projection so vertical-item repair still has the original row. Numeric text can
only be identified after reading and is removed by the analytical filter.
Ingestion, stored source data, full dataset previews, metric configuration and
legacy non-Parquet reads can still load the full data. This is not a claim of
zero ingestion memory or a measured production-wide memory reduction.
