# Decisionate Deep Implementation Reference

Snapshot: 2026-10-18, America/Halifax.
Repository: /home/akpome/decisionate.
Branch: main.
Code commit: 21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4.
Audience: ChatGPT and the next engineer continuing work with Akpome.

Read [Start Here](CHATGPT_HANDOFF_START_HERE.md) for the complete handoff set. This reference adds source-level contracts, state distinctions, coverage gaps, and operational failure modes to the [main handoff](CHATGPT_PROJECT_HANDOFF.md), [addendum](CHATGPT_PROJECT_HANDOFF_ADDENDUM.md), and [continuation playbook](CHATGPT_PROJECT_CONTINUATION_PLAYBOOK.md). It does not replace their product history, API examples, database inventory, or commit index.

The current product priority is cross-dataset business analysis, meaningful cross-dataset weekly reports, and decision creation in the central Decisions workspace. Any proposed technical change must support that direction without weakening tenant permissions, client data ownership, consent, or metric correctness.

## 1. Important Additional Corrections

| Subject | Precise current behavior | Consequence for continuation |
| --- | --- | --- |
| Client connector authorization | Shared data-management guards accept explicit client roles, but OAuth start, cancellation, and Sage-business refresh require workspace_role equal to owner. | Do not claim the intended client-managed connection journey is fully consistent. Test these routes with actual client roles before proposing a scoped fix. |
| Financial legacy saved choices | Unclassified nonempty legacy financial lists are treated as automatic defaults; explicit user provenance and unclassified empty lists are preserved. | Preservation of every old manual choice cannot be inferred from a nonempty saved list alone. |
| Salesforce legacy saved choices | An existing unclassified saved list is preserved. Recommended provenance or an unconfigured dataset uses automatic Opportunity defaults. | Do not apply the financial migration rule indiscriminately to Salesforce. |
| Connector sync cadence | Supported interval values are 24 and 168 hours, with local-clock scheduling when the schedule has an anchor and timezone. | Earlier handoff wording saying hourly/daily was too broad. This is daily/weekly support. |
| Weekly email scheduling | The scheduler selects the UTC weekday and deduplicates by the last successful UTC date. | A connection timezone or reporting timezone is not a weekly delivery timezone. |
| Weekly email delivery count | This path counts transport-accepted submissions, not inbox receipts established by a delivery webhook. | Do not equate weekly delivered_count with marketing-ledger delivered. |
| Policy coverage | There are 45 current profiles and 51 fixture schemas, but neither set contains the other. | Policy presence, fixture presence, and usable metric eligibility are separate checks. |

These are implementation observations at the snapshot commit. They are not claims about which incident is occurring in production today. No application fix or production configuration change was performed during this documentation pass.

## 2. Sources and Responsibilities

| Source | Responsibility |
| --- | --- |
| [metric_policy.py](../apps/api/app/modules/datasets/services/metric_policy.py) | Versioned semantic metric profiles, current registry, historical registry, validation. |
| [metric_policy_schemas.json](../apps/api/app/modules/datasets/services/metric_policy_schemas.json) | Reviewed emitted-column vocabularies and fixture-declared API versions. |
| [metric_recommendations.py](../apps/api/app/modules/datasets/services/metric_recommendations.py) | Cohort gates, field eligibility, currencies, recommendation descriptors, selection provenance. |
| [receipt_metrics.py](../apps/api/app/modules/datasets/services/receipt_metrics.py) | Financial receipt/invoice alias groups, resource restrictions, projection, legacy intent inference. |
| [salesforce_metrics.py](../apps/api/app/modules/datasets/services/salesforce_metrics.py) | Opportunity-specific defaults and distinct legacy intent inference. |
| [metric_objectives.py](../apps/api/app/modules/datasets/services/metric_objectives.py) | Shared business-objective relevance. |
| [curated_metric_analytics.py](../apps/api/app/modules/datasets/services/curated_metric_analytics.py) | Currency scaling, signs, ratios, weighted aggregation, distinct membership, sufficient statistics. |
| [connector_schema.py](../apps/api/app/modules/datasets/services/connector_schema.py) | Stable vertical item rows, legacy shape repair, saved-column remapping. |
| [dataset_loader.py](../apps/api/app/modules/datasets/services/dataset_loader.py) | Adapter loading, numeric projection, connector normalization, selection application, safe errors. |
| [sources.py](../apps/api/app/modules/datasets/services/sources.py) | Source catalog and dynamic availability/configuration checks. |
| [oauth/router.py](../apps/api/app/modules/oauth/router.py) | Authorization state lifecycle, role guards, callback processing, account selection. |
| [oauth/service.py](../apps/api/app/modules/oauth/service.py) | Provider declarations, scope requirements, exchange/refresh helpers, token encryption. |
| [scheduling.py](../apps/api/app/modules/datasets/services/scheduling.py) | Per-connection daily/weekly schedule normalization and due-slot calculation. |
| [alerts/router.py](../apps/api/app/modules/alerts/router.py) | Weekly preferences, digest building, validation, manual/test/due sends and operational logging. |
| [alerts/email_delivery.py](../apps/api/app/modules/alerts/email_delivery.py) | Platform transport settings, Resend/SMTP, plain text and HTML rendering, partial recipient failures. |
| [marketing/config.py](../apps/api/app/modules/marketing/config.py) | Marketing sender precedence, consent text/version, segment map, test recipients, feature gates. |

The [connector contract catalog](CHATGPT_CONNECTOR_METRIC_CONTRACTS.json) contains exact extracted field lists and source hashes. The [technical inventory](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json) is the broader route/table/environment-name index. Neither contains live provider credentials.

## 3. The Distinct Metric States

Do not use selected, recommended, numeric, available, and reportable as synonyms.

1. A provider has a documented field.
2. Decisionate requests that field from a specific provider resource.
3. The connector emits a normalized physical column or an alias.
4. The stored dataset actually contains the column.
5. The reviewed schema fixture recognizes the emitted column.
6. The values satisfy numeric, currency, grain, and provider-condition checks.
7. The current policy classifies it as core, optional, or derived.
8. The chosen objective determines whether it remains automatically recommended.
9. Saved provenance determines whether automatic or deliberate selection governs.
10. The loaded frame carries the required semantic policy and formula components.
11. The report catalog accepts the measure for the requested analysis.
12. The requested time window contains usable observations.

A column can pass the first seven checks but have no values in the current week. A deliberately selected physical column can remain available for dataset inspection without becoming an eligible v2 cross-source metric. A checkbox is not proof of a useful measure.

### Display columns are not analytical measures

Identifiers, product names, channels, statuses, dates, and dimensions can be necessary for filtering, joining, grouping, or identifying a row without being summed as metrics. Restricting default measures must not strip these columns indiscriminately.

The customer's question about channel-mix analysis was valid: non-metric dimensions are still meaningful. Support for a particular channel breakdown must be traced through the actual emitted column, report/grouping interface, and analytical contract. Do not promise a dimension picker merely because a string column exists.

## 4. Persisted Selection and Version Keys

The relevant source_config fields are:

| Key | Meaning |
| --- | --- |
| selected_metric_columns | Saved physical or supported derived column keys. An explicit empty list can be an intentional opt-out. |
| business_objective | Current objective used by both profiled and curated recommendation paths. |
| metric_selection_provenance | Selection source, actor, time, policy version, schema version, and selected metric descriptors. |
| connector_schema_version | Schema contract identity; current common value is decisionate-v1. |
| curated_metric_selection | Whether this dataset has activated the curated selection path, subject to backend cohort eligibility. |
| metric_defaults_candidate | Marks a dataset for curated-default consideration; it does not itself establish selected values. |

The in-memory DataFrame attribute decisionate_metric_policy is not a provider column and is not a substitute for persisted provenance.

Current policy version: 2026-10-17.4.
Current common connector schema version: decisionate-v1.

Policy lookup uses connector key, resource key, and connector schema version. Pinned lookup additionally uses policy version. Renaming an internal connector/resource key can therefore invalidate resolution even when the provider name shown to the user looks unchanged.

### Cohort Gates and Initialization

Curated backend eligibility is checked against the dataset's internal user_id in CURATED_METRIC_DEFAULTS_INTERNAL_USERS, or rollout equal to all. Do not assume this list is evaluated against the current browser viewer's external Clerk ID.

CURATED_METRIC_DEFAULTS_BACKEND must be enabled for that eligible dataset. UI, new-dataset initialization, existing-dataset prompting, and diagnostics are dependent gates. Diagnostics defaults true within the eligible backend path; it is not globally active for every dataset merely because the example setting says true.

uses_curated_selection additionally requires curated_metric_selection to be the boolean true. A checked source column alone does not establish this state.

initialize_curated_selection returns immediately when the selected_metric_columns key already exists, including an empty list. It does not automatically stamp every old configured dataset with new provenance. For an eligible unconfigured dataset, it stamps the schema version and candidate marker; only when new-dataset initialization is enabled does it also save recommended columns, activate curated selection, and record recommended provenance.

Selection provenance records source, policy/schema versions, actor, timestamp, and per-column semantic/aggregation descriptors. Safe diagnostics record counts and reason codes rather than copying metric values into logs.

## 5. Automatic Defaults Versus Manual Intent

### Financial automatic-default decision

For a receipt-policy source, uses_receipt_defaults behaves as follows:

| Saved state | Automatic receipt defaults |
| --- | --- |
| Provenance source is user, including a deliberately empty list | No. |
| Provenance source is recommended | Yes, including when that saved recommended list is empty. |
| No recognized provenance and selected_metric_columns equals an empty list | No. |
| No recognized provenance and selected_metric_columns is a nonempty list | Yes. |
| No recognized provenance and no selected list | Yes. |

The implementation deliberately treats broad, unclassified legacy financial lists as potentially old automatic picker output. It cannot reconstruct whether every historical checkbox change was manual.

### Salesforce automatic-default decision

For Salesforce Opportunities:

| Saved state | Automatic Opportunity defaults |
| --- | --- |
| Provenance source is user | No. |
| Provenance source is recommended | Yes. |
| No recognized provenance and any saved list, empty or nonempty | No. |
| No recognized provenance and no list | Yes. |

This asymmetry is real and should remain visible in the handoff. If asked to change it, discuss a safe provenance migration rather than silently reinterpreting every existing customer's configuration.

### Objective changes are a separate user action

An explicit objective change asks for that objective's automatic recommendations. Same-objective manual edits and background recommendation refreshes are not equivalent to changing the objective. Preserve the intended distinction and test both paths.

The prior bugs included unrelated metrics remaining checked after an objective switch. The regression should verify that the effective selected list changes, not merely that descriptive recommendation labels change.

## 6. Policy Versions and Compatibility

The current registry contains 45 profiles across 16 connector keys. The historical registry contains 269 connector/resource/schema/version identities.

Version history represented in code includes:

| Version | Notable reason it exists |
| --- | --- |
| 2026-10-14.1 | Initial reviewed profile definitions. |
| 2026-10-16.1 | Receipt/invoice amount policy expansion. |
| 2026-10-17.1 | Lightspeed X-Series price/tax/total aliases and currency context. |
| 2026-10-17.2 | Salesforce sales-performance fields. |
| 2026-10-17.3 | Historical Opportunity quantity optional classification. |
| 2026-10-17.4 | Opportunity quantity restored to core automatic defaults. |

A current profile is not proof that every older version had identical fields. Historical profile bodies remain in metric_policy.py; the JSON catalog indexes historical identities rather than duplicating every old body.

For selection-policy resolution, deliberate nonautomatic configurations can select a pinned policy version from their provenance. Automatic receipt/Salesforce recommendations can use current definitions. Removing an old registry entry can therefore break an existing pinned selection even if new imports look correct.

validate_policies checks identity uniqueness, required metadata, HTTPS evidence links, fixture references, classifications, aggregations, monetary strategies, supported operations, weights, and component relationships. Passing it verifies registry consistency, not successful integration with a real vendor account.

## 7. Actual Coverage and Known Gaps

### Source catalog and analytical profiles are different inventories

There are 27 static source definitions, including upload formats, SQL sources, operational connectors, and planned connectors. There are 18 OAuth provider declarations. Implemented connector registration is not the same thing as production setup or reviewed analytical coverage.

Current policy connector keys:

freshbooks, google_ads, google_analytics, google_search_console, hubspot, lightspeed_x, meta_ads, quickbooks, sage, salesforce, shopify, square, stripe, woocommerce, xero, zoho_books.

Implemented-source keys without any current curated profile:

google_business_profile, lightspeed, lightspeed_k, lightspeed_o, mysql, postgresql, sql_server.

That list does not mean every listed source is broken or unavailable for import. It means the current curated metric registry does not define a profile for it. Other code paths and explicit planned-state checks still matter.

### Profiles without reviewed schema entries

These five current profile keys have no matching emitted-schema entry:

- hubspot/companies/decisionate-v1
- hubspot/contacts/decisionate-v1
- hubspot/tickets/decisionate-v1
- salesforce/accounts/decisionate-v1
- salesforce/leads/decisionate-v1

Resolution fails closed with schema_fixture_review_pending. A count-distinct policy existing in the registry does not bypass that fixture requirement.

### Fixtures without current profiles

These eleven schema entries have no current metric-policy profile:

- google_business_profile/location_performance/decisionate-v1
- lightspeed/sales/decisionate-v1
- lightspeed_k/sales/decisionate-v1
- lightspeed_o/sales/decisionate-v1
- mysql/report/decisionate-v1
- postgresql/report/decisionate-v1
- sql_server/report/decisionate-v1
- xero/payments/decisionate-v1
- zoho_books/credit_notes/decisionate-v1
- zoho_books/estimates/decisionate-v1
- zoho_books/sales_orders/decisionate-v1

A fixture alone does not create recommendations. Receipt registry coverage is also broader than curated profile coverage in some resources. Do not advertise all resources of a connector as analytically equivalent.

The earlier continuation playbook explains the additional v2 catalog restriction: implemented connector frames without the required semantic policy can have no eligible metric entries, including SQL connector frames.

## 8. Exact Recommendation Resolution Order

resolve_metric_recommendations performs these conceptual stages:

1. Parse source_config safely and normalize the objective.
2. Construct the connector/resource/schema identity.
3. Determine automatic receipt/Salesforce behavior.
4. Choose current or pinned policy when selection_policy is requested.
5. Return a structured result even when no policy is available.
6. Require a reviewed schema and compatible declared provider API version where restricted.
7. Verify required report grain and unique DataFrame column names.
8. Resolve reviewed physical aliases against columns actually present and numerically valid.
9. Apply historical-data restrictions, provider-specific state conditions, and currency checks.
10. Resolve weighted measures and derived components.
11. Record missing saved fields and saved fields that are present but analytically unavailable.
12. Apply receipt-default restrictions without removing deliberate-choice descriptors.
13. Apply the current business objective, moving unrelated core fields to optional.
14. Return descriptors and reason-coded exclusions.

The result distinguishes recommended, optional, derived, skipped, savedSelection, userHasExplicitSelection, missingSelectedColumns, and unavailableSelectedColumns. A frontend that only displays the recommended array can hide why a formerly selected field disappeared.

Alias resolution searches for a reviewed, present, numerically valid representation. A malformed preferred alias must not hide a valid reviewed alternative. It must also not accept an arbitrary new provider field just because its name contains total.

## 9. Why a Numeric Looking Field Is Rejected

The curated numeric check is strict:

- Boolean dtype is not a metric.
- Null and whitespace-only entries do not count as meaningful observations.
- At least one meaningful observation must exist.
- Every meaningful observation must convert to a finite number.
- Infinity is rejected.
- A single nonempty malformed value can reject the field.

For example, values 12, blank, null, and 7 can qualify. Values 12 and unavailable do not qualify. An all-null TotalOpportunityQuantity is not invented or silently replaced by zero.

This is not a universal statement about every legacy profiler or every imported file type. It describes the reviewed curated eligibility helper at this snapshot.

### Reasons returned by the resolver

| Reason code | Interpretation |
| --- | --- |
| unknown_dataset_or_schema_version | No policy for the actual connector/resource/schema identity. |
| schema_fixture_review_pending | Profile exists but no matching reviewed emitted-schema entry. |
| unreviewed_provider_api_version | Configured provider version is outside the fixture's declared version set. |
| unverified_report_grain | Requested/report dimensions do not match the reviewed grain. |
| invalid_emitted_schema | Input is not a usable DataFrame or has duplicate column labels. |
| field_fixture_review_pending | Policy path or required derived field is not in the reviewed fixture vocabulary. |
| missing_source_column | Reviewed field is not present in the loaded dataset. |
| incompatible_logical_type | Field is identifier-like or does not pass strict numeric validation. |
| historical_weighted_state_unavailable | Required weighted semantics are not available in that historical representation. |
| historical_signed_or_scaled_state_unavailable | Historical representation cannot safely apply the signed/scaled policy. |
| provider_total_required | A provider unique-total measure is unsafe across the available rows. |
| successful_charge_filter_required | Stripe charge-state requirements are not established for all rows. |
| completed_order_filter_required | Required Square completed-order state is not established for all rows. |
| currency_unresolved_or_mixed | A single reviewed currency cannot be established for relevant values. |
| unverified_connector_currency_conversion | Existing normalized conversion is not reviewed for that currency. |
| missing_or_unsafe_weight | A weighted measure lacks a reviewed usable weight field. |
| distinct_source_records_unavailable | Required distinct identifiers are unavailable, incomplete, or only summarized. |
| missing_or_unsafe_components | A derived measure lacks eligible underlying components. |
| incompatible_component_currencies | Derived monetary components do not share the required currency context. |

These are diagnostics, not language to expose verbatim in a crowded customer interface. Use understandable explanations while preserving the reason code for support and tests.

## 10. Currency and Money

A receipt label does not establish a currency or scale. The reviewed policy must distinguish source minor units, micros, and already-normalized major units.

Current strategies include:

- identity: preserve already-normalized values.
- stripe_minor: divide by the reviewed currency exponent.
- micros: multiply by 0.000001.

The reviewed exponent dictionary is an implementation table, not a claim that every provider/currency combination has been externally certified.

The currency helper evaluates rows carrying a non-null amount. It requires a uniform recognized code on those relevant rows, or an explicitly reviewed connector context fallback. It rejects a mixed CAD/USD measure rather than combining it into one revenue total.

Reviewed context fallbacks include:

- Lightspeed X-Series retailer_currency only when currency_source equals retailer.currency.code.
- Salesforce organization_currency only when currency_source equals getUserInfo.orgDefaultCurrencyIsoCode.

Do not fill a missing code from a user's locale, browser language, company mailing address, or a guessed USD default.

Square's reviewed conditions include its existing connector conversion's two-decimal-currency assumption. Supporting another exponent requires a reviewed emitter/policy change, not merely adding another checkbox.

Provider-reported Google Ads conversion value/spend can support that provider's reviewed ROAS formula. Combining unrelated Shopify sales and Meta spend does not automatically create attributable cross-channel ROAS.

## 11. Aggregation Is Part of the Metric

| Metric family | Correct operation |
| --- | --- |
| Additive amount or quantity | Sum valid observations, respecting line/document grain and signs. |
| Unit price or probability | Use the reviewed average semantics, not sum. |
| Click-through rate | Sum clicks divided by sum impressions. |
| Cost per click or acquisition | Sum eligible cost divided by sum eligible outcome counts. |
| Weighted search position | Preserve weighted numerator and denominator. |
| Distinct record count | Union source-record membership, then count; do not sum overlapping bucket counts. |
| Provider unique users/reach | Require the reviewed provider-total condition; do not sum overlapping unique counts. |
| LAST measure | Use the last value in a correctly ordered series; do not assume arbitrary row order is chronological. |

If two periods have click-through rates of 10/100 and 5/10, the combined result is 15/110, about 13.64 percent. Averaging the displayed 10 percent and 50 percent would incorrectly produce 30 percent.

The curated layer copies and scales a frame once, marks its semantic attributes, and prevents repeat conversion on already marked frames. Negative-reversal policies use negative absolute values. The source file is not rewritten by adding an in-memory attribute.

### Sufficient state and reserved columns

The aggregation path can carry:

- column__sum, column__count, column__min, column__max.
- __curated_members__COLUMN.
- __curated_weighted_sum__COLUMN.
- __curated_weight__COLUMN.
- Existing summary markers and month metadata.

Formula components can be retained even when not selected for display. Removing them as unnecessary numeric columns can silently corrupt ratios or weighted results.

Calendar buckets are normalized dates for daily periods, Monday-start weeks through W-SUN period boundaries, calendar quarters for quarterly grouping, and calendar months for the usual monthly fallback. Do not substitute rolling seven-day windows for those calendar semantics without a product decision.

## 12. Receipt Defaults Are Narrower Than All Numeric Data

The receipt registry contains 13 registered connector contracts. Some are intentionally empty/planned. Registration checks reviewed HTTPS evidence, unambiguous alias groups, valid default resources, and explicit line roots for item resources.

Each alias group represents alternatives for one measure, not independent metrics to select together. For example, a normalized quantity and line__quantity should not both inflate a dashboard.

The registry can identify quantity, unit price, line amount, line tax, discount, subtotal, total, balances due, paid amounts, shipping, and adjustments only for reviewed source/resource combinations. Presence on some provider invoice does not imply every connector dataset returns that field.

Important distinctions:

- A receipt-policy alias list is not a guarantee that the curated profile makes every alias core.
- An existing field may remain manually selectable while not automatically selected.
- Inventory, internal costs, exchange rates, identifiers, collection counts, and operational metadata must not become defaults solely because they are numeric.
- A new financial connector without a reviewed resource contract must not fall back to selecting every numeric field.
- Empty Lightspeed K/O receipt registrations are not an implementation certificate for those planned connectors.

The phrase future connectors means shared fail-closed registration and tests. It does not mean unreviewed vendors automatically acquire correct receipt semantics.

## 13. Provider Corrections That Must Survive

### Lightspeed X Series

Current sales policy includes quantity, unit price, line total, line tax, line discount, subtotal-like total, total tax, and grand total, subject to actual values, schema, currency, and objective.

Reviewed unit-price alternatives:
unit_price, line__unit_price, line__price, line__pricing__price.

Reviewed line-total alternatives:
line_total, line__price_total, line__total_price, line__pricing__total.

Reviewed line-tax alternatives:
line__tax_total, line__total_tax, line__tax__total.

Reviewed line-discount alternatives:
line__discount_total, line__total_discount, line__pricing__discount_total.

Reviewed document totals:
total or total_price or totals__price; total_tax or totals__tax; grand_total or totals__price_incl_tax.

The current emitted fixture declares API version 2026-07. That is the repository compatibility entry, not a fresh statement about the vendor's current API lifecycle.

Repeated quantity-only incidents had multiple possible layers: old stored data, missing new successful Sales sync, absent monetary values/currency, alias resolution, policy gating, or manual/pinned state. Do not diagnose only by looking at a policy's field names.

### Zoho Books

The expanded current curated profile is specifically invoices, not every Zoho resource. It includes line quantity/price/total, line discount, total, subtotal, tax total, shipping charge, adjustment, balance, payment made, and credits applied when eligible.

The broader receipt registry also covers other resources. Several of those have fixtures but no current curated profile. That difference explains why connector-level claims can be misleading.

### Sage Cloud Accounting

The reviewed sales-invoice profile uses line__net_amount for line value. The ambiguous legacy line_total must not automatically be treated as a certified net amount. It also distinguishes line tax/discount and document net_amount, tax_amount, total_amount.

The broader receipt rules cover additional invoice/credit-note resources, but the current curated monetary profile is sales_invoices.

### Salesforce

The reviewed Opportunity field is TotalOpportunityQuantity, not ProductQuantity. Its default is restored to core at 2026-10-17.4. Amount and ExpectedRevenue are additive currency measures; Probability is an average, not a total. Distinct Opportunity count is derived from source record identity.

Empty quantity is not evidence of a missing checkbox bug by itself. Check actual source values and the schema/provenance/rollout chain before changing policy.

Accounts and Leads have current distinct-count profiles but lack matching fixtures at this snapshot. Their availability must not be inferred from the Opportunity correction.

## 14. Vertical Transactions and Legacy Repair

The stable shape is one transaction item per row, with identifiers tying rows back to the parent document. Additional items should increase row count, not create line_0, line_1, line_2 column families.

Normalization handles reviewed collection roots, relation wrappers, numbered legacy fields, singleton wrappers, and some serialized collections. It does not recursively explode every array in an arbitrary JSON object.

Document totals must not be repeated on every line and then summed. Header values are retained once per document under the relevant normalization rules. Item quantities/prices/taxes stay at line grain.

Already vertical rows must not be expanded again. Historical summary rows must not be turned into invented transactions. When legacy repair needs the original shape, projection can deliberately defer pruning.

The normalized frame can carry decisionate_connector_column_mapping. Saved selection and metric_decisions remapping must preserve user override precedence rather than simply replacing the configuration with current defaults.

A successful deployment cannot put missing values into an old stored provider file. A newly corrected emitter may require a successful bounded sync. Existing-data repair and new ingestion must both be tested.

## 15. Memory Projection and Load Errors

When receipt restrictions apply and apply_metric_selection is true, dataset_loader asks the analytics adapter to apply receipt_projection during loading.

The projection preserves:

- Reviewed receipt alternatives needed for safe fallback.
- Deliberate manually selected fields.
- Curated formula components.
- Summary sufficient statistics.
- Identifiers and necessary nonnumeric/list-valued context.
- Original legacy columns when shape repair must happen first.

It prunes other typed numeric fields where the adapter supports early projection. This is not proof that every file backend streams every format without materializing it. It is also not deletion of source data.

apply_metric_selection=false intentionally bypasses this projection/selection path for relevant inspection or measurement workflows. That option is not an authorization mechanism; callers still have to authorize the dataset before loading it.

Loader errors distinguish a missing file, adapter unavailability, and storage failures. Unexpected errors should be logged with safe context and returned as bounded customer messages. A generic 503 can conceal a coding defect, as the tax_calculation_method KeyError incident demonstrated. Inspect the traceback before calling it a transient network problem.

## 16. OAuth State and Trust Boundaries

OAuth setup is not simply pasting a key into every service. Different providers use OAuth authorization code flow, API keys, WooCommerce authorization callbacks, or database credentials.

For the main authorization-code journey:

1. Authenticate and authorize access to the requested connection.
2. Validate required source configuration.
3. Save relevant connection options before leaving the application.
4. Clear stale authorization state as appropriate.
5. Generate a random state token and PKCE verifier when the provider requires it.
6. Encrypt stored verifier material and set a ten-minute state expiry.
7. Return the authorization URL.
8. Validate returned state, expiry, code, and provider-specific callback requirements.
9. Exchange the code through the provider-specific token strategy.
10. Discover/validate the actual business/account/tenant where required.
11. Encrypt credentials, store expiry, consume state, and commit.
12. Queue the initial import separately.

Stored credentials and queued import are two milestones, not proof that data ingestion succeeded. A connection shown as authorized can still fail resource selection, queue readiness, retrieval, normalization, storage, or metric resolution.

Callback state may authorize a return journey without relying on the browser currently resending the original session token. Do not remove state validation or broaden account selection merely to bypass a sign-in return problem.

### Cancellation is not account deletion

The local cancellation route clears relevant credential material, pending authorization state, and managed account selection and returns the connection toward draft state. Do not describe that as guaranteed remote vendor revocation or deletion of existing datasets. Trace remote revocation and data-deletion operations separately.

## 17. Provider Specific OAuth Account Selection

| Provider | Current account-context responsibility |
| --- | --- |
| Meta Ads | Validate token/grants, discover ad accounts, persist selected ad_account_id; multiple accounts require a valid selection. |
| QuickBooks | Require callback realmId and persist company context. |
| FreshBooks | Discover active businesses and associated account/business identifiers. |
| Xero | Discover connections and persist tenant_id. |
| Sage | Use the configured supported region and verified businesses API; require valid business selection rather than guessing a legacy identifier. |
| Zoho Books | Normalize the allowed accounts-server/API-domain context and discover active organizations. |
| Salesforce | Validate the returned instance URL before using it for subsequent API requests. |
| HubSpot | Persist discovered portal context. |
| Shopify | Normalize myshopify domain and verify callback HMAC/domain binding and granted scopes. |
| Lightspeed X-Series | Normalize the domain prefix and retain the correct domain-specific endpoint context. |

Where one discovered account is eligible, it can be selected automatically. Where there are multiple accounts, preserve a still-valid previous choice or require a new selection. Do not attach the first arbitrary account to every workspace.

Sage country codes represented in the source are CA, US, DE, ES, FR, GB, IE. These refer to the implemented Sage Cloud Accounting integration, not all products sold under the Sage brand.

Shopify follows the shared initial 90-day import and chunked three-year history policy. Orders older than 60 days require provider-approved and granted read_all_orders access, including the 90-day initial import; read_orders alone must not be presented as unrestricted historical access.

Zoho duplicate/previously consumed code recovery checks existing connected credentials before returning success. It is not permission to accept every failed exchange as a valid connection.

On classified reauthorization failure, the connection state and workspace-owner notification are distinct from a general scheduler crash. A batch scheduler should continue processing other sources safely.

## 18. Client Authorization Inconsistency to Review

The product requirement remains: the agency creates the client workspace; the client connects and manages its data. Agency access requires the client's approval.

Current evidence:

- auth_context.py preserves explicit client_owner/client_user membership roles and distinguishes managed_client.
- Dataset management guards recognize client workspace roles.
- use-workspace-access.ts includes explicit client roles in the UI model.
- OAuth start requires exactly owner.
- Sage-business refresh requires exactly owner.
- OAuth cancellation requires exactly owner.

The three OAuth guards run before SessionLocal is opened. This is not just a missing frontend control: supplying a valid client-role session to those route guards is rejected by the current source.

This documentation does not change the guards. A future fix needs an explicit operation matrix for owner, client_owner, client_user, member, managed_client, and unauthorized users, including cross-workspace denial. Do not replace owner checks with a blanket allow-all.

Managed agency access should be reviewed independently: permission to inspect approved client analysis is not automatically permission to authorize or revoke the client's external provider credentials.

## 19. Three Different Scheduling Clocks

| Clock | Current source | What it controls |
| --- | --- | --- |
| Connector local-clock schedule | _sync_timezone plus _sync_time_of_day and an anchor in source_config. | When a particular source connection is due for daily/weekly sync. |
| Analytical reporting timezone | CORRELATION_REPORTING_TIMEZONE through reporting helpers. | Report period boundaries and complete-week interpretation. |
| Weekly email send clock | get_utc_now in alerts/router.py. | Selected send weekday and successful-send date dedupe. |

Do not tell a customer that changing the connector timezone changes weekly email delivery day. There is no weekly preference hour or per-preference timezone in the current request schema.

The platform cron cadence is a fourth operational input: a due job only runs when the scheduler process calls the endpoint. A supported schedule setting does not independently create a Railway cron.

## 20. Exact Connector Scheduling Contract

Relevant configuration keys:

_sync_enabled, _sync_interval_hours, _sync_time_of_day, _sync_timezone, _sync_anchor_date, _sync_day_of_week.

Defaults are enabled, 24 hours, 00:00, UTC, and day zero. Supported intervals are 24 and 168 hours.

Day numbering is Sunday=0, Monday=1, through Saturday=6. The code converts to Python weekday numbering internally.

Read behavior normalizes malformed/unsupported stored intervals to 24 hours. Write behavior rejects an unsupported interval rather than accepting an hourly value. Invalid timezone/time/day values are normalized by their respective helpers.

When a schedule is newly enabled or its interval/local clock/timezone/day changes, the anchor is reset to the current local date. Disabling removes the anchor. Resaving also removes the obsolete customer-configurable _connector_retention_months field; retention is now an application policy.

For anchored schedules, due calculation finds the most recent daily or selected-weekday local slot, rejects slots before the anchor, and compares last_synced_at to that slot in UTC. A naive timestamp is treated as UTC in this path.

For legacy schedules without the required clock/anchor context, the helper can use an elapsed-hours comparison. Keep timestamps consistent when testing that fallback.

Missed periods are not automatically replayed as one job per missed day/week by this helper. It establishes whether the latest due slot still needs a sync.

## 21. Weekly Preferences and User Operations

The preference request includes enabled, weekly cadence, delivery_day, recipient_emails, metric_focus, metric_targets, relationship_focus, include_recommendations, and subject_prefix. Linked business report/template state is also relevant to the updated workflow.

Important cleaner behavior:

- New delivery_day updates allow Monday through Friday.
- Metric focus values are trimmed and deduplicated case-insensitively.
- A metric focus entry is limited to 120 characters.
- Numeric targets must be finite and correspond to a currently selected focus metric.
- Relationship IDs are positive and deduplicated.
- Recipient addresses are trimmed, lowercased, deduplicated, and syntactically validated.

Existing historical Saturday delivery output is not proof that the current preference-update cleaner accepts weekend choices.

The manager guard accepts owner, managed_client, and explicit client workspace roles; a general member is not granted preference-edit/send rights by this guard.

Changing focus independently of a linked business report can detach the stored report link when the selections differ. Keep the template/selection relationship coherent.

### Preview, test, manual send, and due send differ

| Operation | Uses real latest-window analysis | Updates last_sent_at on success |
| --- | --- | --- |
| Digest preview | Yes, for the configured analysis. | No. |
| Transport/branding test email | Builds the test digest. | No; records test_sent status/log instead. |
| Manual real send | Builds and validates the real digest. | Yes. |
| Scheduled due send | Builds and validates the real digest. | Yes. |

A transport test succeeding is not proof that a two-dataset weekly report is ready. A successful manual send can cause the scheduled call later that same UTC date to skip as already sent.

The digest schema still contains some legacy decision-template data. That does not authorize reintroducing Create decision buttons outside the centralized Decisions workflow.

## 22. Weekly Readiness and Scheduler Semantics

The real delivery validator checks:

1. Weekly notification preference enabled.
2. If cross_dataset_report is present, its status must be ready.
3. At least one recipient.
4. At least one metric or relationship selected.
5. At least one matching available metric or relationship to send.

The cross-dataset ready requirement means usable metrics from at least two datasets in the latest complete week. It is not sufficient that both datasets once contained data.

The validator's conditional cross_dataset_report check also means legacy/test digest paths must be evaluated separately. Do not claim every possible test digest is a real two-source report.

The due endpoint:

- Requires X-Alerts-Scheduler-Secret matching ALERTS_SCHEDULER_SECRET.
- Uses the current UTC weekday.
- Loads enabled preferences for that weekday.
- Skips a preference already successfully sent on that UTC date.
- Builds and validates the digest for each workspace independently.
- Records success, skipped, and failed outcomes without abandoning all other workspaces.

HTTP 200 for a batch does not establish that every workspace email succeeded. Inspect processed/sent/skipped/failed results and counts.

The date-based skip is not proof of exactly-once delivery under concurrent scheduler calls. The reviewed path does not show a per-preference atomic send claim equivalent to a durable outbound message ledger. Treat concurrency/idempotency as a follow-up to verify, not an already certified guarantee.

## 23. Transport Acceptance and Partial Delivery

The weekly Resend transport sends one recipient per submission with plain text and optional HTML/reply-to. It uses the configured verified sender address; a message-specific display name can be honored when the requested email address matches that platform address.

This supports agency naming without allowing an arbitrary unverified From domain. Agency logo/name selection and the underlying email transport identity are separate concerns.

The reviewed send helper checks HTTP acceptance/failure but does not reconcile a returned provider message identifier into the weekly report log. Its delivered_count increments after a recipient's transport submission succeeds.

If some recipients are accepted and another fails, the failure object retains accepted and failed recipient details. The overall failure does not mean nobody received a message.

Retrying a partially successful real weekly send can resend to previously accepted recipients if there is no per-recipient durable dedupe. Review this before offering a retry-all control or claiming exactly-once notification behavior.

Marketing's signed webhook ledger has a different lifecycle, including provider-confirmed delivered/bounced/complained events. Keep its status vocabulary distinct from weekly transport counters.

## 24. Email Categories and Branding Boundaries

| Email category | Customer consent/setting | Brand rule |
| --- | --- | --- |
| Essential account/billing/trial service notices | Service-appropriate lifecycle handling, not the marketing opt-in switch. | Decisionate for the business/agency owner; preserve recipient-context rules. |
| Customer-enabled weekly reports and alerts | Workspace recipient/schedule controls. | Agency identity/logo for agency-client communications; Decisionate for business and agency owners. |
| Product tips, offers, marketing lifecycle messages | Explicit marketing preference and safety gates. | Configured Decisionate marketing sender identity/footer. |
| Clerk, Stripe, or manually authored Resend Broadcast mail | Provider-specific configuration and workflow. | Application rendering does not automatically restyle provider-owned templates. |

Do not silently pre-check marketing consent to imitate another vendor's onboarding. The user raised that possibility, but the implementation history retained explicit consent safeguards.

The earlier logo requirement was not replace every logo with Decisionate. It explicitly preserved agency branding for agency clients.

Sender legal identity, display name, physical mailing address, verified sender email, and monitored reply-to are distinct settings. An email address is not a postal mailing address. Real configured addresses are intentionally not reproduced in these handoff artifacts.

## 25. Marketing Configuration and Consent Versioning

Marketing sender fields use persisted platform settings with environment fallback as implemented in marketing/config.py. They are not managed by copying SMTP configuration into each customer workspace.

Consent text is tied to sender details. The English version identifier uses a v1 prefix and a shortened SHA256-derived value from the exact text and relevant identity/address/reply-to inputs. French consent has its own localized version.

Consequences:

- Changing sender details can change the recorded consent-text version.
- consent_available means the required identity/address/reply-to fields exist, not that a real delivery attempt succeeded.
- Saved sender settings and live API key/provider availability are different checks.
- Marketing contact synchronization and automated sending are independent gates.

Segment mapping accepts only recognized lifecycle keys and nonempty configured segment identifiers. Malformed/non-object JSON is not treated as a valid full configuration. The reserved keys support later expansion without paying for or creating every segment now.

Historical configured segments included trial_data_ready and trial_expired. Their IDs and the controlled pilot recipients are documented in the main handoff as historical setup, not verified present-day provider state.

Test recipients are normalized by trimming, lowercasing, and deduplication. The activation cutoff and disabled lifecycle families are rollout safety boundaries. Do not remove them merely because one test email arrived.

Absolute marketing URLs have security validation, including no embedded credentials and production HTTPS requirements. Avoid putting unsubscribe secrets or full recipient URLs into logs or screenshots.

## 26. Review a Cross Dataset Result as Evidence

The product flow has several different objects:

- Connection: external authorization and sync configuration.
- Dataset: stored rows and selected measures.
- Semantic metric: reviewed analytical meaning and aggregation.
- Report definition: selected datasets/metrics, period, comparison, relationship settings.
- Report snapshot: saved analytical result calculated for that definition.
- Decision: central action record that can cite report evidence.
- Outcome: later follow-up measurement and classification.
- Weekly digest: scheduled latest-window analysis and follow-up, not simply resending an old snapshot forever.

Two different datasets are required for the main cross-dataset report workflow. That does not necessarily mean two independent providers; two resources from one provider can be different datasets. Claims of cross-channel attribution need more than different dataset IDs.

The report status ready has the limited meaning explained in the continuation playbook: at least two dataset IDs have usable current metric values. It does not certify complete data coverage, matched currency, causal interpretation, or statistically meaningful relationships in every result.

A saved report's analytical payload is frozen, but live decision follow-up can appear alongside it. Saving recalculates rather than storing the exact unaltered preview response. Do not describe either behavior incorrectly when debugging a preview/save mismatch.

The centralized Decisions form remains the place to create decisions. A weekly email, insight tile, chart, report, and relationship result can show evidence or navigation without each becoming another creation surface.

## 27. Incident History as a Diagnostic Map

| Historical symptom | What the evidence established | What not to assume next time |
| --- | --- | --- |
| Scheduler reported queue-capacity 429 | Connector import queue was full while other scheduled jobs could succeed. | Every scheduler subsystem or Resend is broken. |
| Worker repeated queue-owner exception | Singleton ownership conflicted during deployment/process overlap. | Increasing replicas solves it. |
| Marketing preferences could not resolve email | Verified Clerk email lookup/configuration path required repair. | Invent an address from an unsigned field. |
| Contact showed Pending | Contact sync/enqueue/provider processing had not completed. | Email was already submitted to the provider. |
| Test mail appeared for one controlled recipient | Per-contact eligibility/sync/frequency-cap and mail status needed inspection. | All mail shares one global success state. |
| Metric PATCH repeatedly returned 503 | Later traceback showed KeyError on tax_calculation_method in metric profiling. | All 503s are storage outages or CORS. |
| Browser showed only preflight entries | The chosen Network filter/request selection hid the actual failed request. | Preflight 200 proves the PATCH succeeded. |
| Lightspeed selected only quantity | Stored schema/currency/policy/sync state needed verification; emitter changes alone were insufficient. | Every live account has the same receipt payload. |
| Android Chrome full pages disappeared | Runtime/browser reliability investigation and cleanup were performed. | Current physical-device reproduction is proven by desktop responsive testing. |
| Hero buttons repeatedly misaligned | Several alignment requirements were later superseded by a new landing workflow. | Restore an old screenshot layout as the latest spec. |

The full commit history and source changes, not this table alone, are needed to identify which historical fix is relevant to a new incident.

## 28. Tests to Run for Specific Changes

| Change area | Existing targeted tests to inspect |
| --- | --- |
| Receipt policy/provenance | test_receipt_metric_defaults.py, test_receipt_connector_contract.py |
| Curated policies/aggregation | test_curated_metric_defaults.py |
| Lightspeed X-Series monetary defaults | test_lightspeed_x_receipt_defaults.py |
| Salesforce defaults/empty quantity | test_salesforce_metric_defaults.py |
| Objective changes and saved choices | test_metric_selection.py |
| Vertical rows and resync identity | test_connector_row_schema.py, test_connector_dataset_identity.py |
| Connector scheduling | test_connector_scheduler_api.py, test_connector_scheduler_runner.py |
| Provider OAuth exchange/scope behavior | test_oauth_service.py and provider-specific connector tests |
| Weekly real/test delivery and preferences | test_weekly_report_preferences.py |
| Business reports and permissions | test_business_reports.py |
| Legacy/advanced correlation compatibility | test_correlation_characterization.py, test_multi_metric_correlation.py |
| Marketing lifecycle/PostgreSQL behavior | test_marketing.py, test_marketing_postgres.py |
| Storage and historical compatibility | test_connector_storage.py, test_connector_retention.py, test_object_storage.py |

Tests live under apps/api/tests unless noted in the broader handoff. The synthetic correlation generator/test files listed as untracked are not automatically part of a pushed release.

Before importing endpoint modules, establish an isolated database configuration and disable bytecode writes. Importing the application bootstrap is not a harmless documentation-inspection step.

A future permission fix should add explicit client-owner/client-user/managed-client cases to the OAuth route tests, including cancellation and cross-workspace rejection. Existing provider token tests alone do not establish this role matrix.

## 29. Validation for This Documentation Pass

Thirty-six focused checks passed using pure helpers and source AST, with bytecode writing disabled and an in-memory database URL in the environment.

Covered behavior:

- Financial legacy nonempty/empty/user-provenance cases for Shopify, Lightspeed X-Series, Zoho Books, and Sage.
- Salesforce unknown saved list, empty list, recommended provenance, and unconfigured state.
- Sparse numeric acceptance and malformed/empty/boolean/infinite rejection.
- Mixed-currency rejection.
- Known and unmapped objective relevance behavior.
- Daily/weekly supported intervals, invalid stored/read behavior, invalid writes, obsolete retention-key cleanup.
- Sunday weekday mapping and schedule-anchor behavior.
- Registry validation.
- Fail-closed Salesforce Accounts/Leads schema-fixture gaps.
- All three owner-only OAuth guards preceding database access.

These checks are not a full regression suite, live endpoint test, email send, provider API verification, production database inspection, or deployment certification.

Historical larger test results are recorded in the main handoff with their original scope. Do not add 36 to them and present the sum as a freshly rerun suite.

## 30. Unresolved Work and Safe Priority Order

The following are identified review items, not silently implemented changes:

1. Verify and scope the client-role OAuth operation matrix against the agency-client ownership requirement.
2. Review v2 billing/request-budget middleware parity without assuming route-local auth covers subscription policy.
3. Prioritize missing analytical policy/fixture coverage by real customer resources rather than claiming all connectors are covered.
4. Decide whether legacy financial provenance needs a user-confirmed migration path to better preserve historically ambiguous manual intent.
5. Review weekly scheduler concurrency, partial-recipient retry behavior, and provider-accepted versus delivered status wording.
6. Verify deployed version, migrations/bootstrap on PostgreSQL, required flags, worker liveness, and object storage before release claims.
7. Validate actual provider syncs and physical Android Chrome behavior when those are the reported problem.
8. Preserve explicit marketing consent, test recipients, activation cutoff, and disabled lifecycle families until rollout is authorized.

No production deletion, token revocation, queue reset, migration, sender change, or email send is authorized merely by this handoff.

## 31. Current Metric Policy Matrix

This table is generated from the current registry. Physical entries show semantic keys and aggregations; they do not assert that a particular customer's rows contain usable values. Full ordered source paths, conditions, currencies, evidence URLs, fixtures, and derived components are in the JSON contract catalog.

SUM denotes an additive policy; AVG denotes a nonadditive average; LAST and AVG_WEIGHTED retain the specific restrictions described above. The fixture column only records whether a matching schema entry exists.

| Connector | Resource | Physical semantic measures | Derived columns | Matching schema fixture |
| --- | --- | --- | --- | --- |
| freshbooks | chart_of_accounts | None | __metric_record_count (count_distinct) | Yes |
| freshbooks | clients | None | __metric_record_count (count_distinct) | Yes |
| freshbooks | credit_notes | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| freshbooks | expenses | amount (SUM) | None | Yes |
| freshbooks | invoices | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| freshbooks | payments | amount (SUM) | None | Yes |
| freshbooks | profile | None | __metric_record_count (count_distinct) | Yes |
| freshbooks | projects | None | __metric_record_count (count_distinct) | Yes |
| google_ads | campaign_performance | impressions (SUM); clicks (SUM); cost (SUM); conversions (SUM); conversions_value (SUM) | ctr (ratio); cpc (ratio); cpa (ratio); roas (ratio) | Yes |
| google_analytics | report | newUsers (SUM); sessions (SUM); engagedSessions (SUM); eventCount (SUM); keyEvents (SUM); activeUsers (LAST, optional); totalUsers (LAST, optional); totalRevenue (SUM, optional) | engagementRate (ratio) | Yes |
| google_search_console | search_analytics | clicks (SUM); impressions (SUM); position (AVG_WEIGHTED, optional) | ctr (ratio); weighted_position (weighted_mean) | Yes |
| hubspot | companies | None | __metric_record_count (count_distinct) | No |
| hubspot | contacts | None | __metric_record_count (count_distinct) | No |
| hubspot | deals | None | __metric_record_count (count_distinct) | Yes |
| hubspot | tickets | None | __metric_record_count (count_distinct) | No |
| lightspeed_x | sales | quantity (SUM); unit_price (AVG); line_total (SUM); line_tax (SUM); line_discount (SUM); total (SUM); total_tax (SUM); grand_total (SUM) | None | Yes |
| meta_ads | campaign_insights | impressions (SUM); clicks (SUM, optional); spend (SUM); leads (SUM); purchases (SUM); reach (LAST, optional) | None | Yes |
| quickbooks | accounts | None | __metric_record_count (count_distinct) | Yes |
| quickbooks | bills | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| quickbooks | customers | None | __metric_record_count (count_distinct) | Yes |
| quickbooks | estimates | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| quickbooks | invoices | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| quickbooks | payments | amount (SUM) | None | Yes |
| quickbooks | products_services | None | __metric_record_count (count_distinct) | Yes |
| quickbooks | purchases | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| quickbooks | sales_receipts | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| quickbooks | vendors | None | __metric_record_count (count_distinct) | Yes |
| sage | contacts | None | __metric_record_count (count_distinct) | Yes |
| sage | sales_invoices | quantity (SUM); unit_price (AVG); line_total (SUM); line_tax (SUM); line_discount (SUM); net_amount (SUM); tax_amount (SUM); total_amount (SUM) | None | Yes |
| salesforce | accounts | None | __metric_record_count (count_distinct) | No |
| salesforce | leads | None | __metric_record_count (count_distinct) | No |
| salesforce | opportunities | opportunity_amount (SUM); expected_revenue (SUM); opportunity_probability (AVG); opportunity_quantity (SUM) | __metric_record_count (count_distinct) | Yes |
| shopify | orders | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| square | orders | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| stripe | charges | amount (SUM); amount_refunded (SUM) | None | Yes |
| woocommerce | orders | quantity (SUM); line_total (SUM); line_tax (SUM); unit_price (AVG, optional) | None | Yes |
| xero | accounts | None | __metric_record_count (count_distinct) | Yes |
| xero | contacts | None | __metric_record_count (count_distinct) | Yes |
| xero | credit_notes | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| xero | invoices | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| xero | items | None | __metric_record_count (count_distinct) | Yes |
| xero | purchase_orders | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| xero | quotes | quantity (SUM); line_total (SUM); unit_price (AVG, optional) | None | Yes |
| zoho_books | customer_payments | amount (SUM) | None | Yes |
| zoho_books | invoices | quantity (SUM); line_total (SUM); unit_price (AVG); line_discount (SUM); total (SUM); sub_total (SUM); tax_total (SUM); shipping_charge (SUM); adjustment (SUM); balance (SUM); payment_made (SUM); credits_applied (SUM) | None | Yes |

## 32. Using the Machine Readable Contract Catalog

[CHATGPT_CONNECTOR_METRIC_CONTRACTS.json](CHATGPT_CONNECTOR_METRIC_CONTRACTS.json) contains:

- Snapshot commit and source SHA256 hashes.
- All 27 static source definitions.
- Implemented and forced-planned connector-key sets.
- Credential/runtime environment-variable names, without their live values.
- OAuth provider declarations, required scopes/groups, and PKCE/token-auth options.
- Sage supported country definitions.
- All 45 current metric-profile bodies.
- All 269 registered historical policy identities.
- All 51 reviewed emitted schemas and their fixture-declared API versions.
- All 13 receipt connector contracts, resource aliases, document fields, and normalized line roots.
- Objective aliases and 19 literal resolver skip-reason codes.
- Computed coverage gaps between those inventories.

A source_expression object explicitly marks source syntax that was not executed. In this extraction it appears in the Sage country-option comprehension; the separate supported-country list supplies the literal country values.

The fixture column vocabulary is not the complete response schema of Lightspeed, Salesforce, or any other provider. It is the reviewed normalized schema vocabulary in this repository. Reopen the actual emitter and provider's primary documentation before changing it.

To check whether source code drifted after this handoff, compare current source hashes and commit. Regenerate the catalog after a policy/emitter change rather than hand-editing thousands of generated JSON lines.

## 33. Continuation Prompts

### General continuation

Read CHATGPT_HANDOFF_START_HERE.md, then the main handoff, corrections, continuation contracts, and deep implementation reference. Decisionate's core value is cross-dataset analysis and weekly business review. Preserve central decision creation, client-owned data connections, agency-client email identity, reviewed financial defaults, deliberate selection provenance, tenant authorization, and explicit marketing consent. Inspect current code and deployment before claiming that this snapshot is still current.

### Metric issue

Trace provider field, emitted alias, stored column, schema fixture, numeric/currency/state eligibility, objective, saved provenance, frame semantic policy, report catalog, and reporting-window values. Show the first failing layer. Do not invent a provider field or make all numeric metadata a default.

### Permission issue

Compare backend guards, verified workspace role, tenant scope, and frontend capabilities. In particular, do not assume the owner-only OAuth start/cancel/Sage-refresh guards already support client_owner/client_user or managed_client. Implement only the authorized operation matrix and test cross-workspace denial.

### Email issue

Identify the category first: service notice, customer-enabled weekly report, marketing lifecycle, or provider-owned template. Then inspect that path's settings, eligibility, sender branding, queue, transport status, and webhook/delivery evidence. Do not treat one delivered test message as proof of all paths or remove consent/rollout gates.

### Release issue

Confirm working tree, target commit, origin tracking, intended file set, isolated tests, worker and scheduler state, database/storage configuration, and deployed versions. Keep local databases, WAL/SHM files, bytecode, private credentials, and unrelated user changes out of commits.

## 34. Documentation and Repository Status

This pass adds documentation and generated metadata only. It does not change application behavior, migrate stored datasets, alter live permissions, or activate email sending.

The existing modified local databases and tracked bytecode were left untouched. The synthetic dataset generator, its test, sample files, and all handoff documents were untracked local artifacts when this reference was prepared. Do not claim they were committed or pushed with the last feature release.

The last observed application commit remains 21fce690, with b2bcf41c immediately preceding the decision-centralization change as the cross-dataset report milestone. Recheck Git and the deployed services in the next session.

The handoff set records the available conversation, reachable commit index, inspected implementation, and explicitly scoped validation. It is extensive continuity material, not a substitute for future source inspection, provider research, or production verification.
