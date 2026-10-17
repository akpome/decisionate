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

`scripts/export_metric_schema_inventory.py` executes mocked connector
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

The committed inventory contains schema variants generated by mocked connector
tests. Rebuild from `apps/api` with an isolated test database:

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

Research checked the following primary references against the local emitters.
The field-level follow-up audit below supersedes the earlier broad resource
groups. These are eligible automatic measures, not a claim that every field is
printed on every regional or customized invoice template.

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
| Sage Accounting | [Invoice display options](https://us-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=210126214952167): quantity, unit price, discount, tax and net line amount, plus the tax-inclusive document total. Use separate exact net/tax/gross paths; do not substitute Sage Active, Sage 50 or Sage Operations schemas. |
| Lightspeed K (planned) | [Financials](https://api-docs.lsk.lightspeed.app/operation/operation-financial-apigetfinancials) and [receipt](https://api-docs.lsk.lightspeed.app/operation/operation-financial-apigetreceiptbyexternalreference): quantity, tax and net amounts are documented in the actual Financial API. Defaults remain disabled until the connector's emitted schema is matched to these fields by reviewed fixtures. |
| Lightspeed O (planned) | [Orders](https://apidoc.kounta.com/orders/) and [Lines](https://apidoc.kounta.com/lines/): reviewed the public references, but current rendered line-field evidence is incomplete. No unverified monetary defaults are enabled. |

Sage Accounting's detailed API reference still returned no readable schema through
the research client. The follow-up below uses its explicit invoice-display guide
and a Sage developer-support example to separate net, tax and gross amounts.
The ambiguous legacy line-total alias remains excluded; the connector no longer
fills a document's gross total from net or generic amounts. Existing curated
fixture/currency checks remain in force; documentation is not live certification.

### Field-Level Follow-Up Audit (2026-10-16)

This audit distinguishes provider definitions from Decisionate aliases. A name
containing `amount`, `cost`, `total` or `tax` is not sufficient evidence. Fields
must be on the exact allowlist, contain usable numeric values, and meet the
business-objective and existing curated safety checks. Manual choices are
preserved, including technical columns deliberately selected by the customer.

| Connector/resource | Provider field to emitted column mapping | Evidence and limits |
| --- | --- | --- |
| Shopify orders | `quantity` -> `quantity`; `originalUnitPriceSet` -> `unit_price`; `discountedUnitPriceSet` -> `discounted_unit_price`; `discountedTotalSet` -> `line_total`; order money sets -> `subtotal_price`, `total_price`, `total_tax`, `total_discounts`. | [GraphQL line definitions](https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem) plus [Order Printer](https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/shopify-order-printer/liquid-variables-and-filters-reference). Transport counts and raw duplicate money representations are not defaults. |
| WooCommerce orders | `line_items[].quantity`, `price`, `total`, `total_tax` -> `quantity`, `unit_price`, `line_total`, `line_tax`; header `total`, `total_tax`, `discount_total`, `shipping_total` remain exact fields. | [Current v3 orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/). IDs, tax-class codes, metadata and collection counts are not measures. |
| Square orders | `line_items[].quantity`, `base_price_money`, `total_money` -> `quantity`, `unit_price`, `line_total`; order total money -> `total_amount`. | [OrderLineItem](https://developer.squareup.com/reference/square/objects/orderlineitem) and [receipt customization](https://squareup.com/help/us/en/article/5424-customize-digital-receipts-and-invoices). Keep existing unit/currency checks; raw minor-unit money copies are not additional defaults. |
| Stripe charges | `amount`, `amount_refunded` remain exact charge/refund measures. | [Charge](https://docs.stripe.com/api/charges/object) and [receipts](https://docs.stripe.com/receipts). A receipt reflects charge/refund state. Processing fees, risk scores, metadata and card details are excluded. This audit does not change the existing monetary conversion rules. |
| QuickBooks invoices/bills | `Line[].Qty`/`UnitPrice` inside item detail -> `quantity`/`unit_price`; `Line[].Amount` -> `line_total`; `TotalAmt` -> `total_amount`; `Balance` -> `balance`; `TxnTaxDetail.TotalTax` stays its flattened field. | [Invoice](https://developer.intuit.com/docs/api/accounting/invoice), [Bill](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/Bill.html), [item detail](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/ItemLineDetail.html). The static SDK is older schema evidence, cross-checked against current local emitters; it is not proof of every present-day regional variant. |
| QuickBooks sales receipts/purchases/estimates | Same normalized line fields and transaction total/tax; no invoice balance. Payments use `TotalAmt` -> `total_amount` only. | [SalesReceipt properties](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/c8f82f83-f9ff-b8c2-d5ba-f0967cb24587.htm), [Purchase](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/Purchase.html), [Payment](https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/Payment.html) and the shared local item normalizer. Estimates retain receipt-compatible line measures, not a claim of completed revenue. New documentation pages returned a JavaScript shell; no extra fields were inferred from them. |
| FreshBooks invoices/credit notes | `lines[].qty` -> `quantity`; `lines[].unit_cost.amount` -> numeric `line__unit_cost__amount` when the normalized `unit_price` is not numeric; line `amount.amount` -> `line_total`; header `amount.amount` -> `amount`. Invoice `outstanding.amount` -> `outstanding`. | [Invoices](https://www.freshbooks.com/api/invoices), [credits](https://www.freshbooks.com/api/credits) and [printable invoice](https://www.freshbooks.com/invoice-templates/itemized). Invoice `unit_cost` is the customer price, not inventory cost. Credits explicitly define `taxAmount1/2` as percentages; invoice field names alone do not establish money semantics. Neither receives guessed tax-amount defaults. |
| FreshBooks payments/expenses | Payment `amount.amount` -> `amount` only. Expenses use that amount plus `taxAmount1.amount` and `taxAmount2.amount`. | [Payments](https://www.freshbooks.com/api/payments) and [expenses](https://www.freshbooks.com/api/expenses) distinguish money objects from `taxPercent1/2` and markup. Do not reuse invoice tax semantics on expenses. |
| Xero invoices | `LineItems[].Quantity`, `UnitAmount`, `LineAmount`, `TaxAmount` -> `quantity`, `unit_price`, `line_total`, `line_tax`. Prefer normalized `total`, `subtotal`, `total_tax`, `amount_paid`, `amount_due` to raw aliases. | [Invoices](https://developer.xero.com/documentation/api/accounting/invoices) and [official OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml). One representation per measure is selected. |
| Xero credit notes/quotes/purchase orders/payments | Document line measures plus subtotal/tax/total; no invoice paid/due values on non-invoice documents. Payments select `Amount`, not `BankAmount`. | The official OpenAPI `CreditNote`, `Quote`, `PurchaseOrder`, `Payment` and `LineItem` schemas were parsed directly because some rendered references returned only a JavaScript shell. Currency rates and bank-currency payment equivalents are not extra receipt measures. |
| Zoho Books invoices/estimates/sales orders | `line_items[].quantity`, `rate`, `item_total` -> `quantity`, `unit_price`, `line_total` with exact raw numeric fallbacks; `line_items[].discount_amount` remains its raw money field. Header `total`, `sub_total`, `tax_total`, `shipping_charge`, `adjustment`; invoices also `balance`, `payment_made`, `credits_applied`. | [Invoices](https://www.zoho.com/books/api/v3/invoices/), [estimates](https://www.zoho.com/books/api/v3/estimates/), [sales orders](https://www.zoho.com/books/api/v3/sales-order/) and the [PDF total-section settings](https://www.zoho.com/ca/books/help/settings/templates.html). Fetch the individual document when the list returns only a summary. No guessed line totals are calculated. Base-currency amounts, exchange rates and ambiguous percentage/fixed `discount` inputs are not defaults. |
| Zoho Books credit notes/expenses/payments | Credits use line quantity/price/amount plus `total`; no unverified invoice footer fields. Expenses use `total`, `sub_total`, `tax_amount`, not a generic invoice line list. Customer payments use `amount` only. | [Credits](https://www.zoho.com/books/api/v3/credit-notes/), [expenses](https://www.zoho.com/books/api/v3/expenses/), [customer payments](https://www.zoho.com/books/api/v3/customer-payments/). `total` and `amount` are not assumed equivalent on expenses. |
| Sage Accounting invoice/credit resources | `quantity`, `unit_price`; exact `line__net_amount`, line tax (`line_tax` or `line__tax_amount`), `line__discount_amount`; document `net_amount`, `tax_amount`, `total_amount`. | [Sage Accounting invoice-display guide](https://us-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=210126214952167) explicitly lists quantity, price, discount, tax and net line amount, with the tax-inclusive total at document level. [Sage developer support's Canadian invoice example](https://developer-community.sage.com/profile/34-steel-mark/content/page/18/?type=forums_topic_post) shows separate line/header net, tax and total fields. The legacy `line_total` can be gross and is not selected automatically. Base-currency copies, percentage discounts and ambiguous generic amounts are excluded. No Sage Active/50/ERP schema is substituted. |
| Lightspeed R sales | `unitQuantity`/`unitPrice` -> `quantity`/`unit_price`; line `calcTotal` -> `line__calcTotal` or repaired `line_total`; sale `total`/`calcTotal`, `calcSubtotal`, `calcTax1/2`, `calcDiscount`, `calcTips`. | [Sale](https://developers.lightspeedhq.com/retail/endpoints/Sale/), [SaleLine](https://developers.lightspeedhq.com/retail/endpoints/Sale-SaleLine/), and the [provider-linked receipt template](https://raw.githubusercontent.com/merchantos/PrintTemplates/master/receipt/SaleReceipt.tpl). Tip uses documented `calcTips`, not a guessed `tip` alias. Average/FIFO costs remain excluded. |
| Lightspeed X sales | Line quantity and `unit_price`/`price`/`pricing.price`; authoritative `pricing.total` or flat `price_total`/`total_price` -> `line_total`; line `tax.total` and `pricing.discount_total`, with flat tax/discount alternatives. `totals.price` -> `total`, `totals.tax` -> `total_tax`, `totals.price_incl_tax` -> `grand_total`. | [Official 2026-07 OpenAPI](https://x-series-api.lightspeedhq.com/openapi/api-2026-07.yaml), [receipt settings](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534014632987-Setting-up-receipt-templates), and [Sales 101](https://x-series-api.lightspeedhq.com/docs/sales_101). Sale GET/list records are nested; the return-action example has a different flat shape. Currency comes from retailer metadata, not an invented sale field. Unit prices and tax-exclusive totals are not a tax-inclusive grand total. No cost, loyalty, recognized-quantity counters or invented price-times-quantity default is added. |
| Lightspeed K/O (planned) | No automatic metrics. | [K Financial API](https://api-docs.lsk.lightspeed.app/operation/operation-financial-apigetfinancials) documents receipt sales lines; [O line API](https://apidoc.kounta.com/lines/) documents exclusive/inclusive prices. Reviewed matching emitter fixtures and tax/unit semantics are still required before enabling defaults. These providers are not reported as live-certified. |

Preferred aliases are chosen from usable numeric fields, not merely from all
column names. Thus an empty, JSON-valued or malformed alias cannot shadow a
documented numeric alternative. Analytical projection retains the small set of
reviewed aliases until that check, then removes unselected numeric values.
Full source previews and ingestion are not receipt-only materializations.
Zoho document imports now retrieve missing line details rather
than persist summary-only invoice rows. The tests use mocked contracts and synthetic values,
not customer credentials or live-provider data.

### Missing Receipt Amounts Follow-Up (2026-10-16)

The first allowlists were incomplete, not evidence that receipts contain only
quantity or total. This correction adds documented X-Series amounts, retrieves
Zoho document details, and uses exact Sage net/tax/gross fields. Header amounts
remain stored only on the first item row; these reviewed fields are no longer
rejected for low completeness on invoices with many items. They are not repeated
on every line and are not added to line totals to manufacture revenue.

Curated policy `2026-10-16.1` included the matching fixture-backed paths and kept
currency/type/objective checks. The previous policy remains available for manual
selections pinned to it. Automatic receipt selections use the latest policy;
manual selections and opt-outs are not rewritten. Empty normalized aliases no
longer suppress a valid reviewed raw alias in the curated resolver.

Existing Zoho datasets containing only list summaries need a sync covering the
affected invoice dates to fetch missing details; a read cannot reconstruct absent
line items or prices. Complete incoming documents replace their previous item
rows, including old synthetic summary placeholders; unrelated documents remain.
New and re-synced transactions stay vertical. This change
does not access customer accounts or certify a live production sync.

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

### X-Series Currency and Nested Amounts (2026-10-17)

The preceding X-Series correction was incomplete: its mocked sale contained
`currency`, while the official 2026-07 `Sale` schema has no such field. The
curated resolver consequently skipped money as `currency_unresolved_or_mixed`.
Flat return-action fields also failed to cover nested GET/list sale responses.

The importer now fetches `GET /api/{version}/retailer` once per sales sync when
currency is absent, reads `data.currency.code`, and attaches it to item rows.
The [official OpenAPI](https://x-series-api.lightspeedhq.com/openapi/api-2026-07.yaml)
defines this as the retailer's three-letter currency code and requires
`retailer:read` and `payment_types:read`. OAuth authorization includes both read
scopes even when the existing configured scope list predates this lookup.
Previously authorized connections may need to reconnect to grant them. Failed
or malformed currency lookups stop the import with a retry/reconnect message;
they never assume CAD, USD, a currency symbol, country, or browser locale.

The sync report persists `retailer_currency` and
`currency_source=retailer.currency.code`. Only this explicit X-Series context
can supply missing currency on older stored rows. Invalid or mixed nonempty
row currencies still fail the curated money check. Amounts remain in provider
major units, including zero-decimal currencies; no conversion is invented.
An empty subsequent sync preserves the verified context only for the same
retailer domain; reconnecting to a different retailer cannot reuse it.

Policy `2026-10-17.1` includes the documented nested line tax/discount and
tax-exclusive/tax-inclusive sale totals. All parent representations occur only
on the first item row. The price, tax and grand total remain distinct metrics,
not values added together to manufacture revenue. Raw nested alternatives work
for existing vertical data; legacy indexed nested prices also repair correctly.
Repeated nested header totals in older vertical rows are suppressed after the
first identified item of each sale before analytical aggregation.
Automatic selections, including old quantity-only defaults, refresh from the
current policy. The 2026-10-16.1 and 2026-10-14.1 policies remain available for
deliberate manual selections, and manual opt-outs stay unchanged.

Existing datasets without currency metadata require a successful sales sync;
a read cannot recover retailer metadata that was never fetched. Tests exercise
import through effective selection using the official nested structure and
synthetic numeric values, including negative returns, zero discounts, missing
permissions, mixed currencies, old raw rows and pinned manual policies. These
are contract regression tests, not a claim of live-store verification.

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

### Shared Connector Contract (2026-10-17)

Receipt behavior is now shared across the financial connector catalog, not
limited to the three providers in the preceding fix. Accounting, commerce,
payments and restaurant entries are receipt-policy sources. Analytics, CRM,
advertising, files and database queries retain their own domain defaults.

`ReceiptConnectorPolicy` and `register_receipt_connector` in `receipt_metrics.py`
provide one reviewed contract for each provider: exact resource-specific alias
groups, the default resource, item resources, collection roots, document-level
amount columns and HTTPS evidence links. The built-in field audit above still
defines which amounts are legitimate; the contract is not a name-based guess.
Square's raw minor-unit money is not an alternative to its normalized major-unit
amounts, and no cross-provider tax, discount or currency conversions are invented.

All financial connectors share these safeguards:

- Select one usable numeric representation per reviewed measure. A null,
  malformed or JSON-valued preferred alias cannot hide a reviewed alternative.
  The curated path also requires the alias in its emitted-schema evidence and
  retains its currency/type/aggregation checks. Manual pinned policies remain.
- Preserve sparse receipt amounts on long invoices. Reviewed numeric fields
  bypass completeness and statistical uniqueness guesses, but actual identifiers
  and empty values are still excluded. Objective relevance remains in force.
- Keep transaction items vertical using the same contract's collection roots.
  Store declared document amounts on the first item row only, including future
  fields whose names do not match today's amount-name vocabulary.
- Replace previous rows only for complete incoming documents, regardless of the
  connector name. The adapter must set `complete_document_items=true`, provide a
  line-item key and declare its parent keys. The shared merge uses the entire
  composite parent identity and does not replace unrelated documents or rows
  with missing parent IDs. Partial/summary responses do not authorize deletion.
- Preserve explicit manual selections and opt-outs. New financial catalog entries
  without reviewed contracts have no automatic receipt metrics; they cannot
  silently fall back to selecting every numeric column.

Current item adapters report completeness only when their requested item
collection is present and structurally valid. Shopify already follows nested
[line-item pagination](https://shopify.dev/docs/api/usage/pagination-graphql);
Xero already uses [paged invoice requests](https://developer.xero.com/documentation/api/accounting/invoices),
QuickBooks queries complete documents, Sage requests all attributes, and Zoho
fetches the individual document when its list response is a summary. FreshBooks
invoice requests now explicitly use the documented
[`include[]=lines`](https://www.freshbooks.com/api/parameters).
Missing collections do not certify a complete document.

For a future financial connector, add its catalog entry, reviewed registration
and adapter tests together. Register explicit roots and document fields rather
than modifying shared profiler, projection or legacy-repair code. Retrieve all
item pages before declaring a document complete; keep provider-specific detail
requests in the adapter. `test_receipt_connector_contract.py` checks catalog
coverage, every existing field/alias, sparse totals, manual selections, composite
resync identities, and a synthetic future provider using that same path.
The synthetic provider demonstrates extensibility, not live support for an
unimplemented service. K/O remain planned with no unverified monetary defaults.
