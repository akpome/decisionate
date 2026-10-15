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
selection and saved selections. They must keep passing with the feature off.

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
| Lightspeed R/X | Sales expanded into lines; X also products/customers | Restricted partner-schema verification outstanding; no monetary defaults guessed from other Lightspeed series. |
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
