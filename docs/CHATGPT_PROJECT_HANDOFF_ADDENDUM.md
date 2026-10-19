# Decisionate Additional Handoff Context and Corrections

Repository snapshot: 21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4.
Audit date: 2026-10-18, America/Halifax.
Read with [the main handoff](CHATGPT_PROJECT_HANDOFF.md).
Machine-readable reference: [Technical Inventory](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json).

Additional practical detail: [Contracts and Recovery Playbook](CHATGPT_PROJECT_CONTINUATION_PLAYBOOK.md). It includes a further correction: native SQL sources are included in the v2 catalog's no-policy exclusion, despite broader file/database wording in earlier documentation.

Further source-level detail: [Deep Implementation Reference](CHATGPT_PROJECT_DEEP_IMPLEMENTATION_REFERENCE.md) and [Connector and Metric Contracts](CHATGPT_CONNECTOR_METRIC_CONTRACTS.json). These qualify client OAuth permissions, ambiguous legacy financial selections, policy/fixture coverage, scheduling clocks, and email delivery status. The complete read order is in [Start Here](CHATGPT_HANDOFF_START_HERE.md).

The first handoff covered recent product changes in depth but compressed several older systems and carried forward two superseded descriptions. This supplement corrects those descriptions and records the operational and analytical details a new ChatGPT session would otherwise miss.

This is documentation, not a new feature implementation, a production configuration change, or a full security certification. No live credentials were read and no production emails, migrations, provider requests, or database writes were performed for this audit.

## 1. Corrections to the First Handoff

| Earlier description or gap | Correct current interpretation |
| --- | --- |
| The standalone Decisionate hero heading and chapter-edge CTA alignment were presented as final instructions. | They were historical. The later landing workflow and 94e070e5 replaced the H1 with "Turn your business data into better decisions." and normal-flow CTA spacing. |
| Platform administration was described too much like an environment-only Clerk ID allowlist. | Current code supports persisted PlatformAdminRole grants, scoped permissions, environment reference IDs, and configured admin emails. Backend /admin/access and operation-specific checks are authoritative. |
| Portable storage adapters could be read as all being production-deployable immediately. | GCS and Azure adapters exist, but the current production startup guard accepts only r2 or s3. A migration needs that guard reviewed and tested too. |
| Outcome tracking was listed without its calculation limits. | The automatic calculator compares small samples of one chosen metric before/after decision creation. It is not a causal or multivariate evaluation of the whole report. |
| Forecasting was summarized around linear regression. | With enough training data, the current implementation compares linear_regression, last_value, and moving_average using a small chronological holdout. |
| The commit index implied broad coverage but did not map concrete APIs or database fields. | The companion inventory indexes 185 route declarations, 52 model/table declarations, 576 column attributes, and example environment-variable names. |
| The newer /api/v2 surfaces were described without middleware coverage differences. | They perform their own auth/source authorization. The legacy product-prefix middleware does not automatically apply its billing/request-budget branch to /api/v2; see Section 11. |

The main handoff has been amended to point here and correct its hero, administrator, and storage descriptions. Do not treat historical screenshots or reverted commit titles as the current specification.

## 2. Current Landing Implementation and Requirement Order

The authoritative component files are:

- apps/web/components/landing/hero.tsx
- apps/web/components/landing/landing-product-demo.tsx
- apps/web/components/landing/landing-sections.tsx
- apps/web/components/landing/navbar.tsx
- apps/web/components/landing/landing-content.ts
- apps/web/components/landing/landing.css
- apps/web/lib/landing-translations.ts
- apps/web/app/page.tsx

app/page.tsx composes the sections; it is not where all visible copy is defined.

### Current opening

- H1: "Turn your business data into better decisions."
- First paragraph describes accounting/sales/marketing tools or spreadsheet uploads, AI-assisted attention, actions, and tracked results.
- Second paragraph says: "Daily syncing keeps your connected data current. Enable weekly performance reports and KPI alerts by email."
- The word Enable matters: weekly mail is configured, not unconditionally active for every account.
- Primary CTA: "Start your 30-day trial", linking to /sign-up.
- Secondary CTA: "Explore live demo", linking to /demo.
- Reassurance below the buttons: "No credit card required."
- Media heading: "See Decisionate in action".
- Media introduction describes connecting, deciding, and reviewing outcomes.
- The public brand remains in the header with "Decisions from Data."

### Current layout

Current CSS uses:

- A constrained 1200px container.
- A top-aligned grid.
- Two hero columns from 1024px, using 0.85fr / 1.15fr and a 40px gap.
- Desktop navigation/auth presentation at its separate 1280px breakpoint.
- CTA margin-top of 28px and reassurance margin-top of 8px.
- Intro/message paragraphs in normal flow.
- CTA stacking below 480px.
- Desktop H1 48px and mobile H1 36px through fixed responsive rules, not viewport-scaled type.
- Explicit video aspect ratio and four chapter columns with compact container-based handling.
- Reduced-motion rules and visible focus treatment.
- White public backgrounds remain white when a signed-in workspace is dark.

The current code does not enforce the former bottom-of-button alignment by pushing CTAs to a shared video/chapter edge. The October 12 workflow explicitly requested removing unnecessary fixed heights, spacers, and bottom-pushing rules. Reinstating the older alignment would be a new design change, not merely preserving the final current implementation.

### Agency and business sections

Current source contains separate sections for businesses and agencies. Agency messaging includes:

- Branded client workspaces.
- Client-approved agency access.
- Client responsibility for data and connections.
- An agency workspace plus up to ten included client workspaces.
- Professional features and a shared AI allowance.
- Paid additional workspaces.
- One client owner and one client user per client workspace.

The client role limit is not just marketing copy: organization role-capacity validation enforces it.

The later user instruction moved "Keep the evidence close to the action" below the agency section. That later request superseded the original workflow's suggested agency-after-product ordering.

### Landing copy is not the billing authority

Some visible pricing/add-on descriptions are literal frontend text. Actual plan/pricing/credit settings can be overridden by platform configuration. Before changing an offer, compare the current public copy, billing API, platform settings, Stripe price configuration, and checkout behavior.

Do not change billing to make a screenshot or translation match. Do not assume stored translations containing older phrases mean those phrases are currently rendered.

The newer cross-dataset product direction may merit a future full marketing-copy review. The reports implementation did not establish that every public paragraph and provider-specific dashboard description has already been rewritten around it.

## 3. Identity, Workspace IDs, and Client Capacity

### Internal and external identity are different

app_users is the internal account record. auth_identities maps external provider subjects to that internal user.

Important consequences:

- A Clerk user ID is not necessarily the internal user ID stored on product records.
- AuthContext retains internal user_id, workspace_id, workspace_role, external_user_id, auth provider, email, and verified-email state.
- With verified JWT auth configured, an X-User-Id header that conflicts with the token subject is rejected.
- Browser-supplied headers do not grant membership or verified email.
- Email-based identity linking and invitation claiming require the verified-email contract.
- A missing email claim does not necessarily mean the user cannot authenticate by subject.
- The special Clerk primary-email lookup added for marketing preferences does not globally relax identity linking or invitation claiming.

Inspect app/modules/auth_context.py and app/modules/identity/service.py before migrating identities or debugging duplicate accounts.

### Workspace references

Agency/client workspace identifiers can contain the :client: marker. Billing resolves those client spaces back to the agency billing workspace where appropriate.

Do not use a string-format guess as authorization. The server still resolves workspace references and verifies membership/managed access.

### One client owner and one client user

organizations/router.py implements validate_client_workspace_role_capacity.

It counts both existing memberships and pending invitations. Therefore, an outstanding invite can occupy a role slot even if the invited person has not signed in.

Legacy role normalization inside client spaces maps:

- client to client_owner.
- member to client_user.

Capacity checks exclude the record being edited where appropriate. A duplicate role slot returns 409 rather than silently adding more owners/users.

This is distinct from the number of client workspaces included in an agency plan.

### Client-approved agency access

PATCH /organizations/agency-owner-access is a separate operation. A managed-client relationship does not give every agency member unrestricted connector credentials or all owner settings.

The capability helpers and route-specific permissions remain necessary. Reusing a broad "client can only view" or "agency can do everything" label would regress the intended model.

## 4. Platform Admin Grants and Identity Relinking

### Authorization sources

Current platform_admin.py evaluates:

- DECISIONATE_PLATFORM_ADMIN_USER_IDS bootstrap/reference entries.
- Internal identity resolution for those entries.
- Persisted platform_admin_roles records.
- DECISIONATE_PLATFORM_ADMIN_EMAILS where configured.
- Per-role permissions.

A legacy role with a blank permissions field remains full access for compatibility. An explicit JSON permissions document is interpreted as scoped access. Invalid JSON is not treated as a grant of all permissions.

The frontend allowlist is not sufficient to authorize API access. GET /admin/access returns allowed, full_access, effective permissions, and available permission definitions.

### Current permission keys

- overview
- workspaces
- users
- audit
- alerts
- analytics
- email_settings
- credit_settings
- maintenance

Administrator grant management and full-access-only operations have additional server checks. Marketing support/configuration uses full platform-admin authorization, not ordinary agency or workspace-owner access.

Do not assume a user allowed to view one admin card can view the complete customer/marketing directory.

### Account identity relinking

POST /admin/identity-links can link the current authenticated external identity to an existing internal user.

This changes the sign-in alias; it does not migrate datasets, decisions, or workspace ownership into a newly invented account. Current code carries applicable admin-grant permissions when the identity is moved and records an audit event.

Relinking is an operator action with security and access consequences. It is not an account-merge tool to run automatically when an email lookup fails.

### Other admin capabilities omitted from the first summary

- Create an organization for an existing/resolved internal account.
- Update a workspace's plan/expiry/entitlement fields.
- Inspect and manage members/invitations.
- Grant scoped administrator access.
- Inspect audit events, delivery logs, and usage activity.
- Configure email delivery.
- Configure AI-credit allocations and price IDs/settings.
- Publish and complete maintenance notices.
- Delete eligible workspace/account records with protection and confirmation rules.

Workspace deletion can include agency-managed client workspaces and derived analytics. It must not run while relevant ingestion is active. Do not infer the full deletion graph from one table's foreign keys.

## 5. Decision Records, Filters, and Outcome Measurement

### Concrete decision fields

The Decision model separates:

- Creator: clerk_user_id, despite its historical name.
- Assignee: assigned_user_id.
- Workspace: workspace_id.
- Original/primary dataset: dataset_id.
- Outcome dataset: outcome_dataset_id.
- Selected outcome metric: metric_column.
- Evidence sources: evidence_dataset_ids and evidence_metrics JSON-backed properties.
- Recommendation text, source, and structured context.
- Title, action, description, notes.
- Expected and actual outcome text.
- Baseline/measured values, percentage delta, and measurement timestamp.
- Outcome status, lesson, review date.
- Priority, category, status, confidence.
- Created and updated timestamps.

owner_user_id on this model returns the assignee when present, otherwise the creator. It is not automatically the organization owner.

A cross-dataset report can preserve multiple evidence metrics while selecting one measurable outcome metric. That is an intentional distinction, not a collapse of the entire report into one source.

### States and categories

Current literal contracts include:

- Status: planned, in_progress, completed, cancelled, archived.
- Priority/confidence: high, medium, low.
- Category: general, marketing, sales, operations, finance, hiring, product.
- Evaluated outcome: successful, partially_successful, unsuccessful.

List/query workflows separately classify:

- Active versus archived.
- Attention required.
- Outcome planned/pending/recorded/evaluated.
- Learning captured/pending.
- Notes added/pending.
- Review scheduled/overdue/upcoming.
- Created/updated/review-date sorting.

Outcome workflow state is not the same field as evaluated outcome success. Do not collapse pending and unsuccessful into the same status.

### Existing lifecycle APIs

The API supports create/list/export/summary/activity, detail/overview edits, archive/restore/delete, lifecycle access, assignee, notes, outcome, measurement, lesson, review date, priority, category, and confidence.

Centralizing creation removed distributed UI creation handlers. It did not remove all of these update APIs, existing recommendation context, or support for applying a recommendation to an existing decision.

Action assignment is represented on decisions. The current model inventory does not establish a full separate task/project-management subsystem.

### Exact automatic outcome algorithm

Source: app/modules/decisions/outcome_measurement.py.

1. Require a selected numeric metric and an available date column.
2. Coerce date/metric values and remove unusable pairs.
3. Sort observations by date.
4. Baseline candidates are strictly before decision.created_at.
5. Outcome candidates are strictly after decision.created_at.
6. If a review date exists and at least one later observation is on/after it, use that review-date subset.
7. Baseline sample is up to the final three rows before creation.
8. Measured sample is up to the first three rows in the chosen outcome subset.
9. Each sample's arithmetic mean supplies its value.
10. Percentage delta is (measured - baseline) / abs(baseline) * 100.
11. A zero baseline produces no percentage delta.

The sample is three rows, not necessarily three days, three months, or two equal-length business windows. The implementation's strict timestamp comparisons matter even though one error message says "on or before."

The route requires expected-outcome text, confirms editability and dataset access, and uses outcome_dataset_id when present. It loads with apply_metric_selection=False before checking/using the named outcome column.

### What this does not prove

- No multivariate adjustment for other report metrics.
- No randomized experiment or counterfactual.
- No causal attribution of a metric movement to the decision.
- No automatic finding that an increase is desirable.
- No demonstration that a three-row mean is appropriate for every receipt-level, sparse, ratio, or policy-managed metric.

The newer Reports commit did not replace this outcome calculation with the report's current/prior-window logic. Extending outcome measurement to honor broader policy/window semantics is a review area, not a completed feature.

If a user creates a decision in October 2026 against the 2025 synthetic demo, the dataset contains no observations after that creation date. Automatic outcome measurement cannot honestly produce a post-decision result from those files alone.

## 6. Forecasting Is a Small Model Comparison

Source: app/modules/forecasting/services.py.

With sufficient data, the model evaluation compares:

- linear_regression
- last_value
- moving_average

It holds out up to the final three chronological observations, with the holdout size derived from the series length. Models are ranked by mean absolute error, using the fixed method order for ties.

Returned quality includes:

- Selected method.
- Candidate count.
- Number of validation periods.
- MAE.
- MAPE, calculated only where actual values are nonzero.
- Reliability label.

Current reliability mapping:

- Fewer than two validation periods: limited.
- MAPE at least 50: low.
- MAPE at least 25: moderate.
- Otherwise: good.

These are implementation heuristics, not externally certified forecasting accuracy. A three-observation holdout is small, and a good label is not a prediction interval or business guarantee.

Forecasting honors the supported selection/window/grouping preparation and caps recommendation/AI confidence for limited/weak model quality. It is not a newly implemented cross-source causal forecasting model. The UI no longer needs its own Create decision button.

## 7. Entity Matching and Period Joins

### Entity matching

Source: datasets/services/entity_resolution.py.

This is deterministic exact-match customer/product resolution, not an LLM identity guess.

Candidate keys include IDs, customer email/phone/name, product SKU/name, and explicitly selected columns. Normalization includes Unicode normalization, case/whitespace handling, and character normalization.

The implementation groups linked records and produces canonical entities plus source identities. Persisted tables are canonical_entities and entity_identities.

Weights distinguish evidence types:

- Exact identifier/email/SKU: 1.0.
- Exact phone: 0.95.
- Exact name: 0.75.
- Explicit custom column: 0.8.

These are matching weights, not measured probabilities of identity. Exact same-name matching can still join different real people; equal provider-specific IDs across systems are not universally unique identities. User review and appropriate key selection remain important.

Available endpoints:

- GET /datasets/entity-matching/metadata
- POST /datasets/entity-matching/preview
- POST /datasets/entity-matching/run
- GET /datasets/entities

A preview is not the same thing as persisting a run. This feature is separate from correlation, which can align aggregate periods without proving entity identity.

### Existing period joins

Source: datasets/services/joins.py.

The existing join flow:

- Chooses source/date/metric mappings.
- Normalizes time buckets.
- Supports daily, weekly, monthly, and quarterly grouping.
- Aggregates per source before combining on shared periods.
- Uses an inner join on normalized dates/periods.
- Persists versioned results in dataset_join_caches.
- Exposes matched-period/coverage information.

This is not automatically a row-level customer/product relational join or proof that individual ad impressions produced particular orders.

Curated derived/non-additive metrics are rejected where the persisted join representation cannot preserve their required sufficient statistics. Do not bypass that check by relabeling an average/ratio as SUM.

Source IDs/metric labels and outcome focus must remain explicit when joined evidence is attached to a central decision.

## 8. Existing Dashboards, Public Sharing, and Demo

### Fourteen dashboard definitions

Current dashboard-definitions.ts includes:

1. General Business Overview.
2. Marketing Performance.
3. Sales Performance.
4. Decision Performance.
5. Retail Performance.
6. Restaurant Performance.
7. Hotels & Hospitality Performance.
8. Professional Services.
9. Healthcare Practice.
10. Real Estate.
11. Nonprofit Performance.
12. Construction Performance.
13. Law Firm Performance.
14. Auto Repair Shop Performance.

These are dashboard definitions/mappings, not fourteen certified provider-native analytics products. A specialized dashboard can only display measures supported by the selected dataset/mapping.

Decision Performance is based on decision records; most others are dataset-based. Mapping preferences, selected metrics, date columns, titles, chart choices, and targets have existing persistence rules.

The cross-dataset product correction does not justify deleting those user preferences. It changes the primary review workflow and removes noisy distributed creation actions.

### Public sharing

Existing sharing supports:

- Per-dataset/dashboard share creation.
- Share status and revocation.
- Stopping all active workspace sharing.
- Public retrieval under /public.
- Workspace/agency branding.
- Selected preferences and compatible cached join context.
- Appropriate existing decision-summary presentation.

A public token link is intentionally a separate access path. It does not grant authenticated connector, team, billing, or platform-admin access.

Do not add correlation widgets or a full private Reports snapshot to public sharing merely because the page can render them internally. The existing advanced widget contract explicitly avoids automatic public exposure.

A "client-ready" or printable report is not proof of a new anonymous report-sharing API. Saved business reports remain authenticated/source-authorized.

### Public demo

The web demo uses a committed catalog and static exported assets with a dedicated browser cache/prefetch path. The landing demo CTA can prefetch on pointer, focus, and touch.

This is separate from loading a customer's live workspace, and separate from the untracked 2025 correlation CSVs. Demo export tooling must use deliberately safe sample data, not a production account export by default.

A dashboard template's description mentioning ROI, margin, or bookings does not certify that a particular chosen dataset supplies the required definitions.

## 9. Browser Request Handling, Caching, and Recovery

### API client

apps/web/lib/api.ts is a large shared contract surface. It handles:

- API URL normalization, including non-local HTTPS treatment.
- Workspace-aware request headers.
- Clerk token registration/lookup.
- Typed error extraction and customer-safe transport fallbacks.
- Availability-change events.
- Selected-read caching.
- Preference-write ordering and cache invalidation.
- Provider, report, marketing, admin, and decision request contracts.

Do not replace shared error handling with a local catch that labels every 503 as an authentication problem.

### Read cache

ApiReadCache:

- Shares in-flight requests.
- Starts TTL after successful completion, not at initial fetch.
- Removes failed requests rather than caching failure permanently.
- Prunes expired entries.
- Uses bounded entry handling.
- Supports prefix invalidation.

The API client builds cache identities from both user and workspace and bypasses its browser cache on the server side. Dataset preference writes are queued to avoid racing successive updates.

A performance fix must preserve user/workspace isolation and mutation invalidation. Do not use one global cache key for every account or swallow a failed write because a cached GET exists.

### Active workspace persistence

workspace-context.ts uses a per-user localStorage key and a session fallback map. If storage is unavailable, the current session can still select a workspace.

It publishes active-workspace/access-change events. UI components must reset their own stale state when scope changes; a persistent browser choice is not permission.

### PWA behavior

Current public/sw.js is cache version v5.

- It caches an offline document and selected logo assets.
- Navigation is network-first with offline fallback.
- It does not implement a general cache-first authenticated API/data layer.
- It does not cache every Next.js JavaScript bundle through the shown fetch handler.
- Development registration code unregisters service workers.
- Production registration waits for page load and failures do not block the application.

Do not blame every "old page" or mobile crash on an assumed service-worker data cache. Collect browser evidence first.

### Mobile recovery boundaries

The prior Android Chrome incident remains user-reported resolved, not a proven universal device fix. Storage, media, startup, and auth recovery paths have guards; physical-device behavior still needs reproduction if the issue returns.

The current repo contains error.tsx/global-error.tsx/dashboard error boundaries and shared runtime notices. These are different failure levels and should not all be replaced by the same redirect/reload loop.

## 10. Production Configuration and Secret Protection

### Actual startup guard

app/security/config.py checks production for:

- HTTPS auth JWKS configuration.
- A valid stored-secret encryption key.
- Sentry DSN.
- Non-SQLite PostgreSQL configuration.
- Remote storage restricted by the current guard to r2 or s3.
- HTTPS web and API URLs.
- Explicit CORS origins.
- No wildcard CORS origin.
- No localhost origins in production CORS.

This is more restrictive than the provider-neutral adapter list. GCS/Azure migration support must be reconciled with the production guard before claiming a working production deployment on those stores.

Health/guard configuration checks do not themselves prove remote provider reachability, exact bucket contents, or a fresh worker heartbeat.

### Stored secret format

app/security/secrets.py uses:

- Fernet with OAUTH_TOKEN_ENCRYPTION_KEY.
- An enc:v1: prefix for protected stored values.
- Fail-closed secret protection in production.
- A development fallback for unprotected values when encryption is not configured.

The development fallback is not an acceptable production deployment pattern.

Changing the encryption key without a planned data migration can make existing stored OAuth/provider/email secrets unreadable. Preserve required keys in secure deployment backups; never put them in this handoff or Git.

Worker/API key consistency matters because both must decrypt the same persisted credentials. Deleting copied worker variables can break work even while the API health page still loads.

### Process environment

The ingestion entry script imports application bootstrap but does not itself contain a generic dotenv loader. Starting the API with Uvicorn --env-file loads that API process's environment, not automatically an independently started worker process.

Railway supplies process variables. For local independent workers, supply the intended environment explicitly through the chosen safe launcher; do not assume a nearby .env file was read or source an arbitrary unreviewed file as shell code.

### Next.js local guidance

apps/web/AGENTS.md explicitly warns that this Next.js version has breaking APIs/conventions and requires reading the relevant installed guides in node_modules/next/dist/docs before code changes.

Public NEXT_PUBLIC_* values can be build-time inputs. A saved Railway environment edit or a refreshed browser tab does not necessarily rebuild an already generated frontend.

## 11. Request Limits and Middleware Coverage

### Body bounds

app/security/request_limits.py defines:

- Upload file cap constant: 100 MiB.
- Middleware envelope for /datasets/upload: that cap plus 1 MiB of multipart allowance.
- Other request-body limit: 10 MiB.

The middleware checks declared length and streamed bytes; oversized requests return 413. Do not describe the multipart allowance as an additional guaranteed file-size entitlement.

### Shared production request budget

app/security/rate_limits.py uses a database-backed per-workspace minute window.

- WORKSPACE_REQUESTS_PER_MINUTE defaults to 300.
- The configured limit has a minimum of 30.
- PostgreSQL and SQLite have matching upsert approaches.
- The production middleware returns 429 with Retry-After: 60 when that branch's budget is exhausted.

This is distinct from the five-import queue limit, provider rate limits, and marketing frequency cap.

### Important coverage caveat

The product middleware in main.py matches these legacy prefixes:

- /datasets
- /organizations
- /alerts
- /forecasting
- /decisions
- /billing
- /ai
- /marketing

It excludes explicitly protected scheduler/webhook/public-consent routes from its normal session branch.

The current /api/v2/correlation-* and /api/v2/business-reports paths do not start with those prefixes. Their handlers still perform their own authentication and dataset/workspace authorization; this is not evidence that they are public.

However, do not claim the middleware's request-budget or subscription-access branch automatically protects those newer paths. Consistency of billing/rate policies on v2 routes is an explicit follow-up review item. No application patch for that issue was made while preparing this documentation.

Likewise, a support/admin handler can perform its own auth even when its route is outside that prefix tuple. Inspect the actual route/dependencies rather than inferring permission from the tuple alone.

## 12. Billing Access, Notices, and Renewal Semantics

### Enforcement default differs by source

billing/lifecycle.py defaults BILLING_ENFORCEMENT_ENABLED to true when absent.

The example environment/runbook uses false for staged deployment. Therefore:

- Missing configuration is not equivalent to an explicit false.
- A live deployment cannot be classified as billing-disabled from the example file.
- The same gate affects checkout/portal/top-up route behavior.

### Access states

The lifecycle code distinguishes:

- Disabled enforcement.
- Legacy/untracked workspace without a subscription record.
- Active trial.
- Active paid subscription.
- Canceling at period end, with current entitlement retained.
- Payment-attention grace period.
- Expired/paused access.
- Provider confirmation still pending.

A checkout_completed state is not treated as verified paid access. Provider subscription records missing necessary period information also require verification rather than trusting the browser success URL.

Agency client billing resolves to the designated agency billing workspace. Do not create independent customer invoices for an agency-funded client just because that client has a workspace ID.

### Payment grace

The default grace period is seven days, configurable by BILLING_GRACE_PERIOD_DAYS.

The overdue anchor uses payment_due_at or an appropriate already-reached subscription period boundary. A newly advanced provider period is not assumed to mean payment succeeded.

When the grace period ends, the code pauses entitlement rather than granting infinite access.

### Service notices

The factual billing lifecycle notice workflow is independent of promotional marketing consent.

Its current stages include:

- Trial/subscription ended.
- Payment attention/grace.
- Annual automatic-renewal reminder within 30 days.
- Nonrenewing/trial ending notices within seven days and one day.

Content distinguishes an actual no-card trial, a provider-backed trial that will begin charging, and a canceled-at-period-end subscription. Do not use one misleading auto-renewal sentence for every account.

Deduplication uses stage plus deadline/period key. A scheduled run does not intentionally send the same stage every day.

Provider-verification failure skips affected notices and destructive retention rather than acting on an unverified billing state.

A marketing reminder controlled by MARKETING_TRIAL_ENDING_ENABLED is separate. Turning that flag off does not turn off the billing service notice path.

### Checkout and renewal operations

The API also has:

- Checkout creation and confirmation.
- Billing portal.
- Provider refresh/reconciliation.
- AI-credit top-up creation/confirmation.
- Signed billing webhook handling.
- Provider event deduplication.

Do not mark paid entitlements or one-time credits as granted solely because a browser reports a successful redirect.

Exact current product prices and deployed Stripe IDs remain unverified deployment facts, even where code contains defaults.

## 13. Retention Means Different Things in Different Systems

### Connector age retention

datasets/services/retention.py keeps the current month and preceding 35 calendar months.

- This is a calendar-month rule, not exactly 1,095 rolling days.
- Older source months are eligible for deletion.
- Rows with unusable source dates are retained because age cannot be established safely.
- The worker's independent sweep can apply even when a connection is revoked or scheduled sync is off.

### Expired subscription analytical-data purge

billing/data_retention.py currently defines:

- Period-end purge boundary: 89 days after period_end.
- Cancellation purge boundary: 90 days after canceled_at.
- If both exist, the earlier due boundary wins.
- already_purged_at prevents repeated destructive work.
- Active ingestion must be idle before cleanup proceeds.

Do not simplify the implementation to "all data always deleted exactly 90 days after expiry." If policy text and code differ, report/review the discrepancy; do not silently change retention while writing a handoff.

The purge removes dataset analytical files/references and associated derived analytics/shares/caches/preferences/report links within its scope. The function explicitly retains connector credentials/configuration to support reconnection after renewal.

That is NOT the same as a full account deletion or complete erasure of every decision/identity/billing/audit record.

### Full workspace/account deletion

Platform-admin deletion and explicit workspace deletion have separate rules and broader graphs. New business reports and advanced correlation evidence have cleanup hooks too.

Always inspect:

- Child/client workspace impact.
- Source storage references, including directories/partitions.
- Running jobs.
- Saved report templates and shares.
- Derived entity/correlation records.
- Audit and identity retention.

Deleting a database row without addressing remote objects is not a complete deletion procedure.

## 14. AI Credits, Provider Payloads, and Telemetry

### Credit arithmetic

Current credits.py uses one credit per 1,000 tokens, rounded up, with a minimum charge of one where its token-accounting helper is used.

The system distinguishes:

- Recurring allowance.
- Additional recurring packs.
- One-time purchased credits.
- Annual period allocation.
- Agency/client pooled billing workspace.

The documented annual multiplier is twelve. Configurable platform settings override the relevant code/environment defaults.

SQLite uses a writer-reservation strategy for credit transactions; PostgreSQL uses row locks. Do not replace this with an unlocked read-then-decrement.

Low-balance notification behavior and persisted usage records exist. AI usage cannot manufacture a new free trial after the trial period ends. Provider-backed periods rely on verified billing renewal rather than arbitrary usage resetting them.

These are application accounting rules, not a quote of any AI provider's token pricing.

### Exact configured AI request envelope

docs/openai-data-flow.md states that the user message contains two application fields:

- context
- facts

Facts can contain aggregate values, trends, relationship summaries, selected labels, and bounded workspace decisions/outcomes/lessons. Bounded does not automatically mean non-personal: labels and free-text lessons still require review.

The active workspace scopes data selection and cache/accounting. It is not added as a separate field to that user-message envelope.

The service does not intentionally send an entire Parquet file, unbounded dataframe, or all raw source rows. New callers must still review their facts for personal information or secrets.

Expected response: summary, up to five recommendations, up to five risks, and confidence. It does not automatically execute the recommended business action.

The application's request contract does not establish provider training/retention/data-residency terms. Verify the actual configured provider and settings before making those claims.

### Sentry

Current monitoring setup uses:

- send_default_pii=False
- include_local_variables=False
- max_request_body_size="never"
- Configured environment and trace sampling.

These reduce exposure but are not a guarantee that every custom log is free of personal data. Do not add raw provider payloads, query text, contact lists, or metric arrays to general logs.

### Operational usage is not marketing engagement

usage_activity.py stores authenticated route/method/status/duration activity and normalizes numeric/UUID path segments. It excludes selected health/public/docs paths and its own usage-list endpoint.

Marketing meaningful-activity classification is separate. A background request or usage row is not automatically proof of a person reviewing an insight.

Email opens and generic link visits are not causal attribution or a verified business outcome.

## 15. Maintenance and Support Are Real Existing Features

### Maintenance

- Public GET /maintenance/active returns the platform-wide active notice.
- It intentionally works before Clerk initialization.
- Admin operations can create/update/complete notices and send associated owner notifications.
- Branding remains recipient aware.
- Timestamps are normalized to UTC at the response boundary.

The shown module is a notification/status mechanism. Do not assume it automatically shuts down every API route or is a full incident-management system.

### Support

POST /support/requests:

- Authenticates the requester through the handler.
- Validates request type, contact email, subject, message, and bounded context.
- Includes authorized workspace/user context in the support email.
- Uses platform mail delivery.
- Returns 202 after the delivery path accepts the request; delivery failure returns a safe error.

The implementation is email-based support submission, not evidence of a full stored ticket/SLA workflow.

The requester-supplied reply email and the authenticated account identity are distinct. Do not promote a support-form email into verified account ownership or marketing consent.

## 16. Workflow Specifications and What Remains Deferred

The attached workflow files were specifications, not evidence that every suggested feature was implemented exactly under the proposed names.

### Default metric workflow

Current adaptations:

- Uses existing /datasets/{id}/metric-recommendations and PATCH metric-selection rather than inventing the document's example /api/v1 path.
- Stores selection/provenance in existing source configuration rather than introducing a competing metric table just to match conceptual names.
- Keeps unknown schemas/currencies/non-additive historical metrics fail-closed.
- Keeps manual selections and old pinned versions.
- Builds mocked emitted-schema inventories and policy tests.

Still external/not established:

- One sanitized real or vendor-sanctioned golden payload per connector resource/API version.
- Complete regional/currency metadata certification.
- Partner-only POS verification.
- All live account field/permission variants.

The document's golden-fixture acceptance gate is not satisfied merely because the mocked inventory is comprehensive.

### Multi-metric workflow

Current adaptations:

- Preserves old two-metric endpoints and shared-period lag behavior.
- Uses a separate gated worker/queue.
- Labels Outcome Associations without implying proven drivers.
- Keeps statistical significance unavailable if SciPy is absent.
- Adds the later core Reports workflow separately.

Deferred or not proven:

- Causal inference.
- Automatic business decisions.
- A production-sized worker/queue/resource-limit certification.
- Complete provider golden-payload approval.
- General AI explanations enabled for all correlation users.
- Arbitrary larger analyses through the synchronous report path.

requirements-optional.txt at this snapshot does not itself install SciPy either. "Optional statistical dependency" is a capability condition, not a claim of an existing supported install profile or a deployed package.

### Email marketing workflow

Current adaptations/deferred scope:

- Optional unchecked signup consent and account preferences implemented.
- Contacts/segments/outbox/lifecycle/ledger/webhooks implemented.
- Manual campaign authoring stays in Resend.
- Optional newsletter/prospect acquisition is NOT implemented as an initial landing form.
- Topics are not an active independent preference system in this initial release.
- No in-app campaign editor.
- No automatic recurring send of unfinished monthly content.
- No completed campaign-conversion attribution dashboard.
- First-insight, reactivation, and further campaigns are not inferred from reserved segment names.

Provider sync data must not include private business metrics, connector credentials, or API keys. Contact lifecycle classification is not permission to export a client's analytics to the email provider.

### Landing workflow

Current implementation superseded the earlier screenshot-driven standalone brand H1 and forced button alignment. Later user requirements superseded the workflow's original agency-section order and agency ownership wording.

Do not blindly reapply the uploaded documents over the current corrected product. Resolve a real conflict with the latest user direction and source, not by assuming the attachment is more authoritative.

## 17. Technical Inventory and How to Use It

[CHATGPT_PROJECT_TECHNICAL_INVENTORY.json](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json) was generated from static parsing of 129 Python source files under apps/api/app.

It includes:

- 185 decorated API route declarations.
- Their methods, mounted paths, handlers, source files, and definition lines.
- 52 SQLAlchemy table/model declarations.
- 576 model column attributes, with explicit database column-name aliases where declared.
- 253 variable-name entries from apps/api/.env.example.
- 4 variable-name entries from apps/web/.env.example.

It contains no environment values, database contents, provider secrets, or runtime-import output.

### Important limitations

- Static declarations are not an HTTP availability probe.
- Auto-generated framework docs routes are not counted as application declarations.
- Model declaration presence does not prove its production table/column was migrated.
- The inventory does not include every validation rule, dependency, dynamic route policy, relationship, index, or constraint.
- Line numbers belong to this exact commit and can move later.
- The variable list covers example files, not every os.getenv used anywhere in code.
- An environment variable's presence in an example does not establish a live setting.
- The inventory is not OpenAPI output and was not generated by importing app.main against a real database.

This makes it safe to use as a navigation reference without triggering startup migrations or needing production access.

### Key table families

- Identity and tenancy: app_users, auth_identities, organizations, organization_members, organization_invites, platform_admin_roles.
- Datasets and connections: datasets, dataset_analyses, data_source_connections, oauth_connection_states, oauth_credentials.
- Queue/limits: data_ingestion_jobs, ingestion_worker_heartbeats, workspace_request_budgets.
- Cross-source evidence: dataset_join_caches, dataset_relationships, canonical_entities, entity_identities.
- Advanced correlation: correlation_analyses, correlation_analysis_metrics, correlation_runs, correlation_run_requests, correlation_results, correlation_widgets, correlation_insights, correlation_events.
- Business reports: business_reports.
- Decisions: decisions, decision_activities.
- Sharing: dashboard_shares.
- Billing/credits: workspace_subscriptions, billing_webhook_events, ai_credit_purchases, ai_usage_events, platform_billing_settings.
- Weekly delivery: weekly_report_preferences, weekly_report_delivery_logs.
- Preferences/operations: user_preferences, usage_activity_events, platform_email_settings, platform_maintenance_notices, platform_admin_audit_events.
- Marketing: marketing_settings, marketing_contacts, marketing_consent_events, marketing_workspaces, marketing_dataset_states, marketing_memberships, marketing_jobs, marketing_emails, marketing_webhooks, marketing_link_visits.

## 18. What This Audit Did and Did Not Verify

Checked:

- Current Git HEAD and existing dirty-file boundaries.
- Current landing components/CSS/translations.
- Backend identity, client capacity, admin grants and relinking.
- Decision field/state contracts and exact outcome measurement.
- Forecast candidate comparison and quality labels.
- Entity matching and period-join mechanisms.
- Browser cache, workspace persistence, and service-worker behavior.
- Request size/rate limits and middleware prefix coverage.
- Production guard and stored-secret implementation.
- Billing access/notices/retention.
- AI-credit/payload/telemetry boundaries.
- Support/maintenance routes.
- Original text workflow contents and relevant DOCX sections using ZIP/XML parsing.
- Static API/model inventory without application import.

Not performed:

- A new application-code change.
- A new live provider documentation audit.
- A production configuration or database inspection.
- Production sends, user/tenant migrations, destructive cleanup, or credential rotation.
- A complete re-execution of the API/web suites.
- A line-by-line review of every diff in all 568 commits.
- Physical Android Chrome reproduction.

The earlier 232 web tests and 259 targeted API tests remain historical verification for the respective recent implementation changes, not fresh results produced by this documentation audit.

A complete commit index is traceability, not proof that every old feature remains active, secure, or certified. This correction matters given the user's explicit concern about unsupported claims.

## 19. Priority Follow-Up Without Inventing a New Roadmap

1. Verify production deployed both the Reports and centralized Decisions commits.
2. Verify additive PostgreSQL bootstrap and a real authorized two-source preview.
3. Review v2 request-budget/billing-enforcement consistency before asserting parity with legacy product routes.
4. Keep saved-report evidence and one-metric outcome measurement distinct in UI/product explanations.
5. Reconcile any public retention/pricing/capability text with actual code/configuration.
6. Test agency client-owner/user capacity, pending invitation occupancy, and client-approved agency access.
7. Verify the selected provider's real returned receipt fields after an actual successful resync, especially Lightspeed X.
8. Keep documented golden-payload/currency review incomplete where evidence is still missing.
9. Preserve marketing pilot/suppression/consent settings until deliberate release approval.
10. Treat physical-device and real-worker concurrency/resource checks as remaining external validation.
11. Review the untracked demo assets separately; they are still not claimed pushed.
12. Keep local DB/bytecode modifications untouched.

No commit or push was requested for this additional handoff. The documentation additions and corrections remain local until separately authorized.
