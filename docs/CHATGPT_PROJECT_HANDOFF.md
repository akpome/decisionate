# Decisionate Project Handoff for ChatGPT

Snapshot date: 2026-10-18, America/Halifax.
Repository: /home/akpome/decisionate.
Current branch: main.
Current commit: 21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4.
Previous major commit: b2bcf41c, cross-dataset business reports.
Remote: github.com:akpome/decisionate.git.
Audience: ChatGPT or a subsequent coding agent continuing the project with Akpome.

Audit supplement: read [Additional Context and Corrections](CHATGPT_PROJECT_HANDOFF_ADDENDUM.md) together with this handoff. It supplies omitted platform behavior, narrower analytical claims, and operational caveats. [Technical Inventory](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json) indexes declared API routes, table columns, and example environment-variable names without live values.

Further continuation detail: [Contracts and Recovery Playbook](CHATGPT_PROJECT_CONTINUATION_PLAYBOOK.md) adds exact request shapes, metric-eligibility restrictions, report-status meanings, storage/import limits, recovery caveats, and a release-check matrix. Its catalog restriction corrects the earlier assumption that explicitly configured SQL metrics automatically qualify for v2 reports.

Latest detailed reference: [Deep Implementation Reference](CHATGPT_PROJECT_DEEP_IMPLEMENTATION_REFERENCE.md) adds policy/fixture coverage, legacy selection truth tables, client-role OAuth inconsistencies, exact daily/weekly scheduling, and transport-versus-delivery semantics. [Start Here](CHATGPT_HANDOFF_START_HERE.md) indexes the complete set, including the extracted [Connector and Metric Contracts](CHATGPT_CONNECTOR_METRIC_CONTRACTS.json).

This handoff covers the current product, the development conversation, implemented corrections, deployment operations, known limitations, and the complete 568-commit history reachable from this snapshot. Read Sections 1-4 before proposing changes. Later corrections supersede earlier experiments and reverted commits. The full code and commit diffs remain the authority for implementation details.

No production credentials, API keys, webhook secrets, customer records, or private postal address are included. Controlled test email addresses and historical segment identifiers are included because they matter to the testing history.

## Contents

1. Essential context and latest decisions
2. Status and evidence boundaries
3. Current architecture and repository map
4. Product navigation and customer permissions
5. Cross-dataset reports and weekly reviews
6. Centralized decision creation
7. Advanced correlation and lag interpretation
8. Connector inventory and ingestion
9. Transaction rows, schemas, and resynchronization
10. Metric selection and receipt or invoice defaults
11. Provider research and connector-specific corrections
12. Marketing, Resend, consent, and email identity
13. Landing page, branding, and mobile reliability
14. Earlier platform capabilities and development phases
15. Railway operations and configuration
16. Local development and safe testing
17. Verification already completed
18. Local uncommitted work and generated artifacts
19. Remaining checks, risks, and continuation guidance
20. Documentation and original workflow files
21. Detailed recent change timeline
22. Complete commit index

## 1. Essential Context and Latest Decisions

### What Decisionate is

Decisionate is a decision-intelligence application for businesses and agencies. It connects or imports business data, supports analysis and reporting, records decisions and actions, and tracks outcomes and lessons.

Production addresses used throughout the project:

- Web: https://decisionate.ca
- API: https://api.decisionate.ca
- Local web normally: http://localhost:3000
- Local API normally: http://localhost:8000

The API, persistent ingestion worker, scheduler, and PostgreSQL are deployed in Railway. Frontend hosting and the exact current object-storage provider were not freshly inspected for this handoff; do not assume a provider from the domain name.

### The crucial product correction

A customer challenged the value of single-source analytics: Meta Ads already provides Meta Ads analytics. Akpome identified this as a core product issue, not a request to learn that customer's industry.

The resulting direction is explicit:

1. Cross-dataset analysis must be Decisionate's core differentiator.
2. Analyze related business evidence across sources rather than merely reproducing provider dashboards.
3. Reports should interpret combined metrics, reporting-window changes, relationships, limitations, and follow-up.
4. Weekly reports must also be based on cross-dataset evidence to have meaning and depth.
5. Correlation alone is not a finished business workflow.
6. Single-dataset inspection remains available as a supporting capability, not the main value proposition.
7. A finding does not automatically require a decision. Monitoring, investigation, or no action can be appropriate.
8. Decision creation belongs in one central place: Decisions.

The first major implementation is commit b2bcf41c. The subsequent correction removing scattered creation controls is commit 21fce690. Both were pushed.

### Decisions that must not be reopened accidentally

- Do not restore Create decision buttons across dashboards, insights, forecasts, reports, alerts, relationship views, and dataset pages.
- The central Decisions form can attach a saved cross-dataset report or create a manual dataset-linked decision.
- Agency clients connect and manage their own data. Agencies create client workspaces and invite the client; do not describe the agency as automatically connecting all clients' data.
- Client-directed emails retain the managing agency's name and logo. Business and agency-owner emails use Decisionate branding.
- Automatic defaults for financial connectors are reviewed receipt/invoice measures, not every numeric field.
- Deliberate manual metric choices and explicit opt-outs are preserved within the same objective. An explicit objective change requests the new objective's defaults.
- Transaction items belong in vertical rows, not horizontally indexed columns.
- Do not multiply document totals by the number of transaction items.
- Do not silently opt people into marketing or pre-check the consent checkbox.
- Missing observations are not automatically zero. Different currencies or units are not automatically comparable.
- Correlation is not causation, attribution, a proven conversion delay, profit, or ROAS.
- Do not invent provider fields. The Salesforce ProductQuantity mistake was specifically challenged; the real field discussed is TotalOpportunityQuantity.
- Research official provider documentation, compare it with the actual emitted schema, and say when evidence or live data is unavailable.
- Pushed code is not proof that production deployed successfully or that every live connector was retested.

### Working style expected by Akpome

Be proactive, thorough, and precise. Read the code before changing it. Fix the common mechanism when an issue affects all connectors, but retain provider-specific field semantics. Validate the visible result rather than relying on repeated speculative CSS or retry changes. Use short progress updates and concise close-outs. When asked to push, commit only intended source changes and push the requested branch; never include local databases or bytecode.

## 2. Status and Evidence Boundaries

### Repository status at handoff

- main points to 21fce690.
- origin/main points to the same commit.
- The two most recent implementation commits were successfully pushed.
- The local comparison HEAD...origin/main returned 0 ahead and 0 behind.
- The worktree is NOT clean: tracked local databases and Python bytecode are modified, and demo assets remain untracked.
- No pending tracked application-source changes remained after the latest push.
- This handoff is a new documentation artifact. The handoff request itself did not authorize a commit or push.

### How to read status claims

- Current code: checked in repository source or documentation at this snapshot.
- Locally verified: exercised by the stated tests or browser checks, with the limitations described.
- User reported: Akpome supplied screenshots, logs, or a statement that production worked.
- Historical configuration: values used during setup, not a fresh inventory of live environment variables.
- Unconfirmed: requires production access, provider access, deployment confirmation, or a real device.

Older user statements such as "working now" are useful operational evidence but do not establish that all later releases remain healthy. Screenshots of saved settings do not establish complete provider delivery, permission, or compliance certification.

### Current release boundary

The latest locally verified source implements cross-dataset reports and centralized decisions. Fresh production verification of those two changes is still required. No live production email was sent as part of their local verification.

## 3. Current Architecture and Repository Map

### Technology

Frontend, according to apps/web/package.json:

- Next.js ^16.2.6, React and React DOM 19.2.4.
- TypeScript ^5, Tailwind CSS 4, ESLint 9.
- Clerk Next.js ^7.4.1.
- Recharts ^3.8.1, Zustand ^5.0.13.
- Lucide React icons.
- Papa Parse, html2canvas, jsPDF.

Backend, according to apps/api/requirements.txt:

- Python 3.12 is used by CI and the local environment.
- FastAPI 0.136.3 and Uvicorn 0.49.0.
- SQLAlchemy 2.0.50; PostgreSQL through psycopg 3.3.4.
- pandas 3.0.3, NumPy 2.4.6, PyArrow 25.0.0, DuckDB 1.5.5.
- Parquet and Excel readers.
- JWT verification, cryptography, curl-cffi.
- Object-storage clients for S3-compatible services, Azure, and Google Cloud.
- Sentry and Svix.
- The locked install file is apps/api/requirements.lock.
- SciPy is not silently included in the base statistical runtime. Optional availability changes whether p-values can be calculated.

Version ranges above are manifest declarations, not a claim that every deployed image has those exact resolved package versions.

### Major paths

| Area | Primary paths |
| --- | --- |
| API bootstrap and additive schema initialization | apps/api/app/main.py |
| Shared database and models | apps/api/app/db/ |
| Dataset routes | apps/api/app/modules/datasets/router.py |
| Provider catalog | apps/api/app/modules/datasets/services/sources.py |
| Provider adapters | apps/api/app/modules/datasets/services/connectors.py and google_analytics.py |
| Storage and analytical loading | datasets/services/dataset_loader.py, analytics_storage.py, analytics_engine.py, analytics_adapters.py |
| Transaction schema and deduplication | datasets/services/connector_schema.py, deduplication.py |
| Metric selection | datasets/services/metric_selection.py, metric_objectives.py, metric_registry.py |
| Receipt policies | datasets/services/receipt_metrics.py |
| Curated semantic policies | datasets/services/metric_policy.py, metric_recommendations.py, curated_metric_analytics.py, metric_policy_schemas.json |
| Salesforce selection | datasets/services/salesforce_metrics.py |
| Existing relationships | datasets/services/relationships.py |
| Advanced correlation | apps/api/app/modules/correlation/ |
| Business reports | apps/api/app/modules/reports/ |
| Decisions and outcome measurement | apps/api/app/modules/decisions/ |
| Forecasting | apps/api/app/modules/forecasting/ |
| Optional AI and credits | apps/api/app/modules/ai/ |
| Workspace and agency management | apps/api/app/modules/organizations/ |
| Authentication and identity | app/modules/auth_context.py, app/modules/identity/ |
| OAuth | apps/api/app/modules/oauth/ |
| Weekly delivery | apps/api/app/modules/alerts/ |
| Marketing | apps/api/app/modules/marketing/ |
| Billing and retention | apps/api/app/modules/billing/ |
| Internal operations | app/modules/platform_admin.py, maintenance.py, support/ |
| Ingestion supervisor | apps/api/app/infrastructure/ingestion_worker.py |
| Executable operational scripts | apps/api/scripts/ |
| Web routes | apps/web/app/ |
| Web feature components | apps/web/features/ |
| Web API client | apps/web/lib/api.ts |
| Web role capability checks | apps/web/lib/use-workspace-access.ts |
| Shared web styling | apps/web/app/globals.css |
| API tests | apps/api/tests/ |
| Web tests | apps/web/tests/ |
| Release workflow | .github/workflows/ci.yml |
| Runbooks and specifications | docs/ |

The repository also contains older supporting directories. Do not assume a folder is an active production service without tracing its imports and deployment.

### Durable data and portability

- PostgreSQL is the production transactional store; SQLite is used locally and in many isolated tests.
- Dataset files use provider-neutral storage resolution. Supported configurations include local files, Cloudflare R2, S3-compatible storage, GCS, and Azure.
- Stored object keys, explicit storage-provider fields, and legacy provider-prefixed references are supported.
- Legacy remote dataset keys and duplicate/list-valued columns received compatibility fixes.
- Analytics can use DuckDB/Parquet or the configured alternative. Do not assume BigQuery or Redis is deployed merely because the adapters exist.
- Secret encryption and HTTPS/auth/security checks are enforced in production configuration.
- Important deployment restriction: although storage adapters include GCS and Azure, the current production startup security guard accepts only r2 or s3. Adapter support alone does not establish that an APP_ENV=production GCS/Azure deployment can start; see the addendum before a provider migration.
- Startup schema initialization is serialized for PostgreSQL; new report tables and the weekly template column follow that existing additive mechanism.
- Provider moves have separate preflight, object-copy verification, and restore-verification tools. Never run a migration against production as a casual debugging step.

## 4. Product Navigation and Customer Permissions

### Important routes

| Route | Purpose |
| --- | --- |
| / | Public landing page |
| /demo | Public live demo |
| /sign-in and /sign-up | Clerk authentication |
| /onboarding | Workspace/profile setup |
| /dashboard | Main dashboard |
| /dashboard/dashboards | General and specialized dashboards |
| /dashboard/datasets | Dataset management |
| /dashboard/datasets/[id] | Inspection, metric selection, source details |
| /dashboard/connections | Provider connections and synchronization |
| /dashboard/reports | Primary cross-dataset Explore and Report workspace |
| /dashboard/reports/dataset | Secondary single-dataset report |
| /dashboard/relationships | Existing relationship monitors |
| /dashboard/relationships/explorer | Advanced multi-metric exploration |
| /dashboard/insights | Insights and saved relationship evidence |
| /dashboard/forecasts | Forecasts and model-quality information |
| /dashboard/decisions | Decision portfolio and the central creation entry |
| /dashboard/decisions/new | Central creation form |
| /dashboard/decisions/[id] | Decision details, actions, review, outcomes |
| /dashboard/action-needed | Review and follow-up work |
| /dashboard/alerts | Weekly delivery setup, preview, history, tests |
| /dashboard/settings | Workspace settings and account preferences |
| /dashboard/billing | Subscription management |
| /dashboard/entity-matching | Cross-source entity matching |
| /dashboard/help | Help and onboarding |
| /platform-admin | Internal platform administration |
| /share/dashboard | Token-authorized public dashboard |
| /privacy, /terms, /security | Public policies |

Reports is now the leading analysis workflow. The separate Relationships sidebar entry was removed, but existing monitor and advanced routes remain accessible from Explore. Removal from navigation is not deletion of legacy evidence or APIs.

### Roles require careful handling

Current code distinguishes owner, member, client, client_owner, client_user, and managed_client, plus unknown access. Platform-admin authority is separate.

The current frontend capability helper establishes:

- Owners: data management, connections, decisions, and appropriate configuration.
- Members: decision creation, but not owner/client data-setup capabilities.
- Client, client_owner, client_user: client workspace data-management and connection capabilities; no decision-creation permission.
- managed_client: agency-side managed workspace access, including decision creation and relevant alert access; do not equate this with ordinary client identity.
- Unknown/unresolved roles: controls remain unavailable until access resolves.

The backend independently verifies workspace membership and operation-specific permission. The data-manager guard permits owners and client workspace roles. The decision-manager guard rejects client workspace roles. Report saving additionally permits the known writable role set; setting a weekly template uses the existing data-manager guard.

Important route inconsistency: OAuth start, cancellation, and Sage-business refresh still require workspace_role exactly owner. The broader client data-management capability does not prove end-to-end client OAuth authorization works. See the deep reference's permission review before changing or promising this journey.

Do not infer that every client role has identical membership-administration rights. Specialized organization routes enforce additional role and ownership constraints.

Some older README/manual passages use a simplified "clients review only" or "owner-only" description. Those passages are not a complete description of the later explicit client roles. Consult auth_context.py, datasets/services/auth.py, organizations/router.py, decisions/router.py, and use-workspace-access.ts before any permission change.

### Agency operating model

- An agency creates the client workspace and invites the client owner/user.
- The client is responsible for connecting and managing the client's data.
- Agency management/review occurs through explicit managed-workspace access and the existing role boundaries.
- Data, connectors, reports, preferences, and decisions remain workspace scoped.
- Agency-funded client spaces must not receive direct-owner trial or billing-upgrade marketing.
- Agency credit pooling and client-workspace entitlement behavior already exist.
- Client invite authorization, sign-in aliases, verified-email invitation claiming, and legacy role normalization received fixes.
- The original owner cannot be casually demoted through ordinary membership controls.

## 5. Cross-Dataset Reports and Weekly Reviews

Implemented in b2bcf41c; final decision UI updated by 21fce690.

### User workflow

1. Open Reports.
2. Enter a real business question.
3. Choose approved metrics from at least two datasets.
4. Choose date columns, reporting window, grouping, and supported aggregation.
5. Explore current values, previous-period movements, separate-unit trends, coverage, and optional relationships.
6. Choose findings to retain.
7. Switch to Report for the printable business review.
8. Save an immutable snapshot when the evidence is ready.
9. Optionally select that snapshot as the weekly report template.
10. If a decision is justified, open Decisions and create it centrally, attaching the saved report.

An absent significant correlation does not make the report useless: contrasts and period movements can still support investigation.

### Frontend implementation

- Main feature: apps/web/features/reports/report-workspace.tsx.
- Supporting single-source report: features/reports/single-dataset-report.tsx.
- Route: app/dashboard/reports/page.tsx.
- Existing report URLs with dataset/metric inputs can seed the new workflow.
- Saved report links use /dashboard/reports?report=REPORT_ID.
- Weekly review links use /dashboard/reports?weekly=1.
- Advanced completed runs can seed a report and retain a link to original frozen evidence.
- Dataset catalog supports search, pagination, and hydration of directly linked datasets.
- Current/prior values, separate charts, missing buckets, warnings, finding selection, saved selection, printing, and recorded decisions are included.
- Browser print/PDF is available; do not describe this as an automated report attachment service.
- Report controls do not create decisions directly.

### API

Prefix: /api/v2/business-reports.

| Operation | Purpose |
| --- | --- |
| GET /catalog | Workspace-authorized metric catalog; pages of 25 datasets, optional dataset_id |
| GET /from-run/{run_id} | Seed a report from an authorized advanced run |
| POST /preview | Calculate a bounded unsaved review |
| POST to the prefix | Save an immutable report snapshot |
| GET the prefix | List saved reports |
| GET /weekly-preview | Preview the weekly cross-dataset review |
| GET /{report_id} | Read a snapshot, reauthorizing every source |
| POST /{report_id}/decision-evidence | Prepare evidence for the existing decision API |
| POST /{report_id}/weekly | Select a saved template without enabling delivery |

The core report API is available independently of the advanced correlation rollout flags. Do not mistakenly hide Reports behind the internal advanced-analysis cohort.

### Data and analytical contracts

- A report requires metrics from at least two datasets.
- Metric references must be saved and server-approved; source access and policy validity are rechecked.
- Guided reports allow at most 25 metrics, at most 12 lag periods, and at most 1,000 cross-dataset pair-lag tests.
- Date windows are ordered and bounded by the inherited ten-year validation.
- The question is trimmed and validated; included_findings distinguishes null/default selection from an explicit empty list.
- Current and previous values use their actual windows, not lifetime totals.
- The previous window immediately precedes the report and has equal length.
- Ratios use sufficient component statistics rather than summing row ratios.
- Distinct counts preserve their aggregation semantics.
- Incomplete current/prior bucket coverage withholds comparisons.
- A zero prior baseline withholds percentage change rather than inventing a percentage.
- Missing buckets and all-empty values remain unavailable/null.
- Trend gaps are visible; missing points are not connected as if observed.
- LAST aggregation orders by actual transaction time, including retained intraday/timezone information.
- Currency and units are labeled. No currency conversion is implied.
- Different units use separate charts, not misleading shared-scale totals.
- Relationships consider cross-dataset pairs only.
- Relationship history is at least 90 calendar days ending at the report end, or a longer requested reporting window.
- At least 30 matched observations are required for relationship evidence.
- Monthly or quarterly evidence may need a longer window to supply 30 observations.
- New report lags shift calendar buckets before dropping missing pairs.
- Benjamini-Hochberg correction covers all available tested pair/lag p-values.
- Without the optional statistical dependency, significance is unavailable and evidence remains exploratory.
- The report does not claim causal influence, attribution, profitability, or an observed conversion delay.

### Persistence and cleanup

- New model: BusinessReport in app/modules/reports/models.py.
- Snapshots store definition and calculated evidence, scoped to workspace/user.
- Saved reports are immutable. Editing creates unsaved work; saving again creates a new snapshot.
- The stored analytical snapshot is immutable, but saving recalculates rather than copying the last preview. A detail read supplements frozen analytics with current linked decision follow-up; the entire HTTP response is not a permanently byte-identical document.
- Reopening a snapshot still reauthorizes access to its datasets.
- WeeklyReportPreference gained nullable business_report_id.
- Deleting a source removes reports that reference it and clears their weekly template links.
- Workspace deletion and expiry purges include reports.
- No raw connector data or saved metric selection is rewritten by the reports feature.
- A report seeded from an old advanced run recalculates its current inputs. It is not falsely presented as the original frozen run.

### Weekly reports

- Values cover the latest completed Monday-Sunday week in the configured reporting timezone.
- Comparison is with the preceding completed week.
- Relationship evidence uses the longer history window.
- A saved template contributes its business question, source metrics, and selected finding pairs.
- Selected pairs remain selected even if their best current lag changes.
- A weekly/monthly/quarterly lag from a template is not silently reinterpreted as days. Daily weekly-reviews disable that lag with a warning and preserve the original report for timing analysis.
- Changed or unavailable policies are flagged.
- Fewer than two usable datasets prevents delivery instead of sending a misleading single-source review.
- Existing targets remain visible without assuming that increases are always improvements.
- HTML and plain text include question, windows, source movements, contrasts, selected relationships, limitations, and decision follow-up.
- Optional AI receives bounded aggregate facts; limited evidence does not acquire an invented AI explanation.
- Deterministic output remains usable if AI is absent.
- Existing recipients, agency branding, provider, due checks, delivery history, and safeguards remain.
- Selecting a template does NOT enable sending or replace recipients.
- Editing incompatible metric preferences detaches the saved template.

## 6. Centralized Decision Creation

Implemented and pushed in 21fce690.

### Final behavior

The creation entry is in the Decisions workspace. The main form is /dashboard/decisions/new. Analysis pages show evidence, recommendations, or existing decisions without direct creation actions.

Creation controls and their obsolete handlers/states/imports were removed from:

- Main dashboard and specialized dashboard registry.
- Insights, AI analysis panels, and anomaly panels.
- Forecasts.
- Dataset details and dataset join panels.
- Single-dataset and cross-dataset reports.
- Alerts.
- Relationship explorer and detail/evidence views.
- Help's direct onboarding creation shortcut.

This is not merely a label change or a collection of replacement links opening the same form. The noisy repeated creation surfaces were removed.

### Central form

New feature file:
apps/web/features/decisions/components/decision-report-evidence.tsx.

The form retains manual dataset/metric creation and existing templates, priority, category, and confidence controls. With report evidence selected:

- It fetches saved reports and the authorized immutable snapshot.
- It displays the question, reporting window, source metrics, coverage warnings, and report link.
- It offers only usable, non-null outcome metrics.
- It requires the user's action/title, reasoning, expected measurable outcome, outcome metric, and review date.
- A report with limited_coverage blocks creation. A ready report can still have incomplete comparisons or exploratory findings; ready is not a statistical or business-safety certification. See the continuation playbook for the exact status test.
- It prepares evidence through the report endpoint, then calls the existing decision API.
- Source metrics, report identity, reporting window, included findings, limitations, and recommendation provenance remain attached.
- Priority/category/confidence merge without dropping that evidence.
- Submission failures preserve entered text.
- Controls are disabled during submission to prevent duplicate creation.
- Stale asynchronous responses are ignored.
- Workspace or identity changes reset evidence instead of leaking another workspace's selection.
- Users without decision permission do not load creation evidence or gain an alternate API bypass.

The report endpoint prepares a decision_payload; it does not itself insert a Decision. Existing decision ownership and role guards remain authoritative.

Legacy centrally handled query parameters such as dataset, metric, template, and returnTo remain supported. Existing decision details, tasks, review, outcome tracking, and lessons were not removed.

The shared AI panel retains recommendation application where it edits an existing decision. Do not confuse that with a removed create-new-decision handler.

## 7. Advanced Correlation and Lag Interpretation

### Three related features must not be conflated

1. Existing two-metric relationship monitors.
2. Gated asynchronous multi-metric correlation matrix/explorer.
3. The newer bounded cross-dataset business report workspace.

There is also an older synchronous multi_metric_analysis.py summary/AI feature. It is not the asynchronous correlation matrix.

### Advanced feature implementation

Main commits:

- 50b8907c: characterize and preserve the original statistical contract.
- 771003b3: gated engine, persisted definitions/runs/results, separate queue.
- c293cbff: explorer, evidence views, widgets.

Characteristics:

- Definitions and membership are immutable.
- Runs freeze definition, data watermark, engine version, and relevant runtime information.
- Request keys make retries idempotent; equivalent successful requests can use cached runs.
- Failed or canceled retries get new execution identities unless replaying the original request key.
- Authorization is checked for all datasets and evidence reads.
- Policy-managed connector metrics need reviewed semantics, currency, aggregation, and schema.
- Legacy connector numerics without sufficient policy are not guessed safe.
- Explicitly selected file metrics may use supported registered semantics. The current catalog's no-policy exclusion applies to every source in IMPLEMENTED_CONNECTOR_TYPES, which includes postgresql, mysql, and sql_server. SQL-source metrics therefore do not automatically qualify merely because their selections are explicit; see the continuation playbook.
- Each dataset is prepared once; pairwise matching does not require every metric in every dataset to be complete.
- Results include Pearson or Spearman coefficients, observations, evidence limits, and optional adjusted significance.
- Small samples and temporal dependence remain limitations.
- There is no hidden production statistical dependency added for p-values.
- Saved relationship insights and private dashboard widgets exist.
- Widget types include Top Relationships, Outcome Associations, and Saved Relationship. Outcome Associations is intentionally not a causal "driver" claim.
- Matrices virtualize larger results; ranked views paginate.
- Correlation widgets are not implicitly exposed on public shared dashboards.
- Refresh preserves the last successful evidence if a new execution fails or is canceled.
- Deletion cleans up the added evidence graph.

### Limits and worker isolation

- Guided: 25 metrics.
- Advanced: 50 metrics.
- At least two datasets.
- Default maximum lag: 14, configurable up to 60.
- Hard ceiling: 20,000 pair-lag tasks.
- Three active runs per workspace.
- Up to 50 widgets per dashboard.
- Separate correlation queue, leases, worker tokens, retry/cancel/timeout handling.
- Separate optional worker: python scripts/run_correlation_worker.py.
- This worker must not claim ingestion jobs or replace the ingestion worker command.
- PostgreSQL/Linux supervision, advisory lock, memory limit, BLAS thread bounds, lower-priority child processes, and deadline/parent-death cleanup are part of the implementation.

### Lag semantics

Original relationships and advanced analyses preserve the legacy convention:

- Align/inner-join on shared periods first.
- Positive lag compares earlier left observations with later right observations.
- A lag is a count of shared matched periods, not necessarily elapsed calendar days if dates are missing.

New business reports use a different, explicit convention:

- Retain calendar buckets and missing values.
- Shift by calendar buckets first.
- Then drop unavailable pairs.
- Daily grouping therefore has calendar-day lag meaning; monthly grouping has calendar-month bucket meaning.

Do not claim that every historical analysis was migrated to calendar-day semantics. The distinction is intentional and documented.

The user can configure lag direction and range in the relevant analysis; the engine does not necessarily test 1 through 365. It tests the bounded configured range, including the zero-lag baseline as implemented. A best historical lag is exploratory timing evidence, not a verified customer conversion delay.

### Rollout flags

The example configuration defaults these changes off:

~~~dotenv
MULTI_METRIC_CORRELATION_API=false
MULTI_METRIC_CORRELATION_UI=false
MULTI_METRIC_CORRELATION_INTERNAL_USERS=
MULTI_METRIC_CORRELATION_ROLLOUT=internal
CORRELATION_DASHBOARD_WIDGETS=false
CORRELATION_LAG_MATRIX=false
CORRELATION_AI_EXPLANATIONS=false
CORRELATION_WORKER_ENABLED=false
CORRELATION_MAX_LAG=14
CORRELATION_REPORTING_TIMEZONE=UTC
CORRELATION_JOB_TIMEOUT_SECONDS=300
CORRELATION_JOB_MEMORY_MB=1536
~~~

Current production values were not inspected. Earlier "I cannot see multi-metric analysis" reports were related to access/rollout questions. Do not remove security/cohort controls blindly; also do not apply these advanced flags to the newer core Reports API.

No per-workspace reporting-timezone setting currently exists in the documented implementation. UTC is the default, not a timezone inferred from the user's country.

## 8. Connector Inventory and Ingestion

### Catalog at this snapshot

The source catalog contains 27 source entries: 4 uploads, 3 database sources, and 20 provider connectors. A code path or a base catalog label is not proof of live authorization.

| Source type | Display or purpose | Current implementation boundary |
| --- | --- | --- |
| csv | CSV upload | Supported reader |
| excel | Excel upload | Supported when required reader dependencies are installed |
| json | JSON upload | Supported reader |
| parquet | Parquet upload | Supported when required reader dependencies are installed |
| postgresql | Customer PostgreSQL | Read-only query ingestion; credentials/configuration required |
| mysql | Customer MySQL | Read-only query ingestion; driver/configuration required |
| sql_server | Customer Microsoft SQL Server | Read-only query ingestion; driver/configuration required |
| google_analytics | Google Analytics / GA4 | Adapter present; dependencies and Google OAuth required |
| google_ads | Google Ads | Adapter present; customer ID and configured provider access required |
| google_search_console | Google Search Console | Adapter present; property matching and Google OAuth required |
| google_business_profile | Google Business Profile | Forced planned pending provider approval |
| meta_ads | Meta Ads | OAuth, account discovery, selected ad account, provider settings required |
| hubspot | HubSpot | OAuth; object-specific datasets |
| salesforce | Salesforce Sales Cloud | OAuth/Describe; accounts, leads, opportunities |
| stripe | Stripe | Customer-owned read-only restricted API key; charges |
| square | Square | OAuth; selected location and completed orders |
| shopify | Shopify | OAuth; GraphQL orders and line items |
| woocommerce | WooCommerce | Store authorization; read-only order access |
| lightspeed | Lightspeed Retail R-Series | OAuth; sales and item rows |
| lightspeed_x | Lightspeed Retail X-Series | OAuth/domain; sales, customers, products |
| lightspeed_k | Lightspeed Restaurant K-Series | Forced planned; no live default activation |
| lightspeed_o | Lightspeed Restaurant O-Series | Forced planned; no live default activation |
| quickbooks | QuickBooks | OAuth; company and selected resources |
| freshbooks | FreshBooks | OAuth; selected account/resources |
| sage | Sage Cloud Accounting | Regional OAuth/business selection; selected resources |
| xero | Xero | OAuth/tenant; selected resources |
| zoho_books | Zoho Books | Regional OAuth/organization; selected resources |

sources.py computes availability dynamically. Many base entries say planned but become available or needs_setup after dependencies, OAuth, encryption, and endpoint configuration are checked. Google Business Profile and Lightspeed K/O remain explicitly planned. IMPLEMENTED_CONNECTOR_TYPES alone is not an availability guarantee.

NetSuite was added and removed historically; it is not in the current catalog. Older Salesforce removal commits were later superseded by its reintroduction.

### Selected resources

Verify the adapter before relying on a resource variant, but the current documented scope includes:

- QuickBooks: invoices, payments, sales receipts, estimates, bills, purchases, vendors, customers, products/services, accounts.
- FreshBooks: profile, invoices, expenses, payments, clients, chart of accounts, credit notes, projects.
- Sage: sales/purchase invoices and credits, contacts, ledger accounts, products, services, bank accounts, payments, other payments, journals.
- Xero: invoices, contacts, payments, credit notes, quotes, purchase orders, accounts, items.
- Zoho Books: invoices, contacts, expenses, customer payments, credit notes, estimates, sales orders, projects, items.
- HubSpot: contacts, companies, deals, tickets.
- Salesforce: accounts, leads, opportunities.

The data source, resource, selected account, field permissions, region, API version, and provider scopes affect the actual schema. Do not describe this as one universal fixed provider export.

### Ingestion behavior

- Uploads and connector imports use asynchronous ingestion rather than blocking the API request.
- The persistent ingestion worker supervises deadline-limited isolated execution.
- Initial connector sync is asynchronous too.
- Connections expose progress, successful/failed/no-data outcomes, recovery, and dataset links.
- Selected resources are separated/grouped appropriately instead of duplicating a single connection into confusing controls.
- Daily/weekly scheduling (supported intervals 24/168 hours) and manual bounded advanced date-range sync exist. Anchored connection schedules use their configured local clock; weekly email due selection separately uses UTC.
- Advanced date-range popouts gained a close control and close after Sync selected range.
- Provider permissions/history windows still apply. The calendar control does not create permission to fetch otherwise restricted history.
- OAuth configuration is persisted before authorization.
- Refresh and reauthorization received connector-specific recovery fixes.
- Revoked credentials still require customer reauthorization.
- Production execution refreshes credentials when queued work needs it. Do not promise every disabled connector receives an independent proactive refresh heartbeat.
- Customer-visible errors are safe and actionable; full diagnostics belong in logs.
- Connector authorization alone is not proof that a usable dataset was imported.
- Retention includes an independent three-year connector sweep; expiry deletion has its own billing lifecycle rules.

## 9. Transaction Rows, Schemas, and Resynchronization

Akpome repeatedly reported that transactions with different item counts created inconsistent schemas. Earlier per-provider fixes did not address every path, so the implementation moved toward shared contracts.

Important commits: dc91487c, f096b7f5, 676a9a5a, 050da408.

### Required shape

- One row per transaction item.
- Stable columns regardless of the number of items in a transaction.
- Parent document identity and line identity preserved.
- Document amounts stored once, on the first item row, rather than repeated and summed for each line.
- Text/IDs remain available as context where needed.
- Legacy horizontal item structures have repair logic; repair is not permission to invent missing provider fields.

### Shared contract

ReceiptConnectorPolicy in receipt_metrics.py declares reviewed resources, default resource, item resources, collection roots, document fields, and HTTPS evidence URLs.

The shared mechanism supports current and future financial connectors. A new connector still requires a reviewed registration and adapter tests; "future-proof" does not mean guessing fields from names.

### Complete document replacement

- An adapter must explicitly mark complete_document_items=true only after obtaining a complete, structurally valid item collection.
- Composite parent keys and a line-item key are required.
- Complete incoming documents can replace their previous item rows.
- Partial responses, summaries, missing parent IDs, and missing collections do not authorize deletion.
- Unrelated parent documents are preserved.
- Nested pagination must finish before the adapter claims completeness.

Provider-specific retrieval includes Shopify nested line pagination, Xero paged documents, QuickBooks complete documents, Sage full attributes, Zoho detail fetches for list summaries, and FreshBooks include[]=lines.

Do not fix duplication by globally deleting dataset contents or dropping the user's saved manual metric selections.

## 10. Metric Selection and Receipt or Invoice Defaults

### Persistence and semantics

- Saved selections live in Dataset.source_config.selected_metric_columns.
- Ingestion preserves selection metadata.
- Manual empty selection is a real opt-out, not "select all."
- Date/dimension fields can remain stored and usable without being selected numeric metrics.
- Excluding a field from default metrics does not mean deleting it from the dataset.
- Channel mix can use available dimensions through supported mappings/filtering; do not claim that selecting a numeric metric is required to retain a dimension.

### Business objectives

Changing the business objective recalculates the objective's recommended selection. The server detects an objective change even if a client sends the old checked list without a reset flag.

- New objective defaults replace the old objective defaults.
- Metrics unrelated to the new objective are not left checked.
- No matching recommendations can legitimately mean an empty automatic selection.
- Same-objective deliberate manual choices and empty opt-outs remain.
- The UI acknowledges objective and selection together after a successful save.
- Failed saves retain the customer's work and do not claim the old selection belongs to the new objective.

This resolves the apparent tension between preserving manual choices and refreshing defaults: the objective-change operation is an explicit reset to that objective's recommendations, not a silent background policy migration.

### Financial connector defaults

Accounting, commerce, and payment defaults intersect exact reviewed receipt/invoice field groups.

Examples of eligible measures, where the actual resource emits usable values:

- Quantity.
- Customer-facing unit price.
- Line amount.
- Document subtotal/total.
- Tax amount.
- Discount amount.
- Shipping charge.
- Paid/due/balance where the specific document defines them.
- Payment or refunded amount where the resource represents a payment/refund.

Not automatic defaults:

- Record IDs and transport/list counters.
- Exchange rates and base-currency duplicates.
- Internal inventory cost or FIFO/average cost.
- Risk scores, metadata numbers, fiscal/age counters, and unrelated technical flags.
- Ambiguous generic amounts or a percent mistaken for a money amount.
- Every numeric column merely because a dataset has few rows.

One reviewed numeric representation is chosen per measure. A null, malformed, or JSON-valued preferred alias cannot hide a valid reviewed alternative. Sparse but valid receipt totals are not rejected simply because they appear only once on a long invoice. Empty fields and actual identifiers remain excluded.

Reviewed automatic selection does not prevent a customer deliberately selecting additional columns through the supported manual workflow.

Legacy intent caveat: financial selections with source=user provenance are preserved, as are unclassified empty lists. Unclassified nonempty financial lists are treated as automatic because old pickers did not record intent. Salesforce differs: an unknown saved list is preserved. Do not infer reliable manual intent from every historical nonempty list; the deep reference gives the exact truth tables.

### Curated policy layer

This is separate from the receipt-only restriction.

- Exact emitted schema/version, field semantics, currency, grain, formula, and allowed aggregation are reviewed.
- Configuration stores curated_metric_selection, connector_schema_version, and metric_selection_provenance.
- Provenance identifies recommended versus user selection and policy/schema version.
- Saved manual policy selections remain pinned to their reviewed version.
- Unknown versions or missing sufficient statistics fail closed.
- The registry keeps older policies needed by existing manual selections.
- GET requests, reconnect, and background discovery do not assign invented provenance or rewrite every user's settings.
- Explicit restore/save is the mechanism for replacing a deliberate manual selection.

Curated flags default off in the example configuration:

~~~dotenv
CURATED_METRIC_DEFAULTS_BACKEND=false
CURATED_METRIC_DEFAULTS_UI=false
CURATED_METRIC_DEFAULTS_NEW_DATASETS=false
CURATED_METRIC_DEFAULTS_EXISTING_PROMPT=false
CURATED_METRIC_DEFAULTS_DIAGNOSTICS=true
CURATED_METRIC_DEFAULTS_INTERNAL_USERS=
CURATED_METRIC_DEFAULTS_ROLLOUT=internal
~~~

The receipt-only automatic restriction applies independently of those rollout flags. Enabling the policy infrastructure does not certify every provider.

### Aggregation and memory

- The analytical view respects selected/policy metrics rather than using every raw numeric column.
- Ratios such as CTR are recomputed from components.
- Distinct populations must not be blindly summed across time/audiences.
- Mixed or unresolved currencies are not converted or added together.
- Stripe raw charge amounts are minor units; unsupported denomination conversions must not be guessed.
- Google Ads normalized cost and Square normalized amounts must not be converted twice.
- Historical monthly summaries cannot reconstruct statistics they did not retain.
- Physical joins reject unsupported curated non-additive metrics rather than silently losing their sufficient state.
- Do not claim every raw storage read projects away all unselected fields; loading and policy application are implementation-specific.

### Dataset save failures

The user supplied repeated PATCH /datasets/55/metric-selection HTTP 503 errors and initially a network HTTP2 ping failure. UI retries alone did not solve the underlying issue.

The later server traceback identified:
KeyError: tax_calculation_method in build_metric_selection_profile, while indexing numeric_lookup.

Corrections included:

- Duplicate-column normalization.
- Preparing validated responses before committing updates.
- Safe handling of profiles with no numeric candidates.
- Avoiding a lookup of a nonnumeric candidate as though it were numeric.
- Recoverable, customer-friendly save feedback, retained selections, and retry.
- Shared fixes across connector datasets rather than only dataset 55.

Do not mistake an OPTIONS/preflight 200 in DevTools for a successful PATCH. The user eventually provided the actual failing fetch response and server traceback. Debug the real request and its deployment logs.

## 11. Provider Research and Connector-Specific Corrections

The detailed field evidence and limitations are in [CURATED_METRIC_DEFAULTS.md](CURATED_METRIC_DEFAULTS.md). Follow its provider links and current adapter code before adding fields.

### Research boundaries

- The workflow document's matrix is a specification, not an actual emitted schema.
- Fixture inventories are generated by mocked adapter tests.
- They are not live customer payloads or partner certification.
- Some documentation is partner-only or rendered as unreadable JavaScript.
- Unreadable documentation does not authorize a guessed field.
- Regional accounting APIs and invoice templates differ.
- Documentation that a field exists is not proof the customer's account returned a numeric value.
- Future provider changes require renewed official-documentation verification.

### Lightspeed X-Series

The user repeatedly saw only quantity selected. The documented receipt-compatible candidates in current policy include:

| Measure | Preferred or reviewed emitted alternatives |
| --- | --- |
| Quantity | quantity, line__quantity |
| Unit price | unit_price, line__unit_price, line__price, line__pricing__price |
| Line total | line_total, line__price_total, line__total_price, line__pricing__total |
| Line tax | line__tax_total, line__total_tax, line__tax__total |
| Line discount | line__discount_total, line__total_discount, line__pricing__discount_total |
| Document total | total, total_price, totals__price |
| Document tax | total_tax, totals__tax |
| Gross total | grand_total, totals__price_incl_tax |

These are alternative groups, not a promise that every dataset contains all of them. One usable representation per measure is selected, subject to objective and applicable policy checks.

Internal cost and loyalty fields are not automatic receipt metrics. Currency context was corrected separately.

The user was asked whether they had reconnected and successfully resynced Sales after the fix and answered "Not yet." Therefore, a source dataset created by the old importer can still lack amount columns. New code cannot fabricate missing historical prices. A real completed resync and inspection of current returned fields is the next operational check if only quantity persists.

Primary research reference: https://x-series-api.lightspeedhq.com/docs/sales_101

### Zoho Books

The initial symptom was only total selected. Fixes account for list responses that contain summaries without line detail and fetch individual documents where needed.

Reviewed invoice-compatible candidates include quantity, rate/unit_price, item_total/line_total, line discount amount, total, sub_total, tax_total, shipping_charge, adjustment, and invoice-specific balance/payment_made/credits_applied.

Base-currency copies and ambiguous percentage/fixed-discount inputs are not interchangeable money measures. Expenses and customer payments use their resource-specific definitions.

Primary reference: https://www.zoho.com/books/api/v3/invoices/

### Sage Cloud Accounting

The initial symptom was only quantity and unit price selected.

Reviewed fields distinguish line net amount, line tax, line discount amount, and document net_amount/tax_amount/total_amount. The ambiguous legacy line_total is not automatically treated as a verified net amount.

Use Sage Accounting references, not Sage Active, Sage 50, or another Sage ERP schema. The detailed API reference was not fully readable during research; invoice-display documentation and a developer-support example were used with explicit limitations.

Regional business selection and OAuth recovery were substantial earlier work. Do not reintroduce a generic guessed business ID or ignore supported region configuration.

### Salesforce

Current documented Opportunity defaults for general-business/sales objectives:

- Amount.
- ExpectedRevenue.
- Probability.
- TotalOpportunityQuantity.
- The curated policy can separately support a distinct record count.

Select these only if the actual available field has usable numeric values. Valid zeroes and constants are not automatically rejected merely for being constant.

Important meanings:

- Amount is estimated opportunity value, not automatically booked revenue.
- ExpectedRevenue is the weighted expected amount.
- Probability is a percentage, averaged rather than summed; it is not an observed win rate.
- TotalOpportunityQuantity is Opportunity-level Quantity. It may total related products when products exist, but is not a per-product breakdown or proof of product-level quantities.
- ProductQuantity was an incorrect field claim and must not be reintroduced.

Stage, won/closed flags, dates, lead source, owner/account references, and currency remain available as dimensions/context.

Multi-currency data retains CurrencyIsoCode. For single-currency organizations where Describe does not expose it, authenticated getUserInfo can supply explicitly verified organization currency. User-preferred currency is not substituted.

Historical d19b1500 made quantity optional; 8d3f29c7 restored TotalOpportunityQuantity in automatic defaults, including older recommended selections. Deliberate manual selections/exclusions and pinned policies remain. Empty source quantity is not invented; if it is absent/empty, inspect the actual sync and restore-to-default state before promising a selected useful metric.

Primary references:

- https://developer.salesforce.com/docs/platform/field-reference/references/field-reference/salesforce-field-reference-opportunity.html
- https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-getuserinfo-getuserinforesult.html

### Other reviewed financial semantics

- Shopify: actual requested line fields and money sets, not unrequested current* totals.
- WooCommerce: exact quantity/price/line total/tax and document charges; canceled/refunded status matters.
- Square: completed orders and normalized major-unit money, not duplicate raw minor amounts.
- Stripe: charge/refund amounts, not processing fees/card/risk metadata.
- QuickBooks: resource-specific line amount/quantity/price, document totals/tax, and balance only where appropriate.
- FreshBooks: money objects; invoice unit_cost is the customer-facing price, not inventory cost; ambiguous tax percent fields are not guessed money.
- Xero: line/document money; payment Amount differs from BankAmount.
- Lightspeed R: receipt Sale/SaleLine measures including documented calcTips; not inventory costs.
- Lightspeed K/O: no unverified live defaults; remain planned.

Some providers, currency contexts, historical summaries, and partner-only schemas still need external golden-payload review. Passing fixture tests does not remove that requirement.

## 12. Marketing, Resend, Consent, and Email Identity

Main implementation: fde6af94. Operational follow-ups include a4b5376b, 28753105, 9373656f, a5cd121d, 908105c5, d0233460, e1f75401.

Full runbook: [EMAIL_MARKETING.md](EMAIL_MARKETING.md).

### Provider setup history

- Akpome configured Resend for decisionate.ca, not only localhost.
- Resend showed decisionate.ca as Verified.
- An API key was saved through Decisionate's platform email settings.
- System sender shown in screenshots: no-reply@decisionate.ca, display name Decisionate.
- Marketing sender: updates@decisionate.ca.
- Monitored reply-to: support@decisionate.ca.
- Legal sender identity: Decisionate Inc.
- A real postal mailing address was eventually saved in Platform Admin. An email address in that field was corrected; do not substitute an email address for postal sender information.
- A Resend webhook was created according to the setup conversation.
- These are historical user-reported/screenshot states; current DNS, key permissions, and live configuration were not rechecked here.

A separately installed Resend desktop app is not required. An optional chat integration is distinct from the application's server-side API connection.

### Application architecture

- Clerk remains responsible for signup and verified identity.
- Marketing contacts, immutable consent evidence, readiness/activity, membership recipients, jobs, ledger, webhook receipts, and sender settings are local application records.
- Real workspace changes enqueue work through the existing transaction/outbox mechanism.
- Successful usable non-demo imports establish readiness; connector authorization, empty syncs, and failed imports do not.
- First readiness is distinct from present data availability.
- Existing ingestion worker processes marketing work. There is no additional marketing queue service.
- Scheduler calls protected /marketing/reconcile to page through persistent reconciliation cursors.
- Ordinary authenticated requests use the appropriate fast path; marketing failures must not lock up ordinary workspace operations.
- Platform Admin controls real legal sender/name/address/reply-to details.
- Sender changes do not rewrite historical consent evidence.
- Existing encrypted platform Resend key or environment fallback is used; SMTP/system email remains separately supported.

### Consent and transactional distinction

- Signup has a separate optional UNCHECKED marketing checkbox.
- Settings exposes the account-wide preference.
- Declining or being unable to save marketing preferences does not prevent signup.
- No provider-side subscription state is accepted as proof of new local consent.
- Withdrawing consent removes provider segment membership and unsubscribes globally.
- Hard bounces and complaints remain suppressed; no force-subscribe button.
- A fresh authenticated opt-in on the verified address is required to resubscribe.
- Essential billing/account/trial lifecycle notices are separate from promotional lifecycle messages.
- The optional marketing trial-ending reminder is not the same thing as the essential billing expiration workflow.
- Do not disable essential service notices just because a user declines marketing.

Akpome questioned why other services appeared to send marketing without a separate opt-in and asked for default-checked/signup consent. The implemented policy remained explicit consent. Do not interpret that discussion as authorization to remove consent safeguards. The repository does not claim a legal compliance certification or that express consent is the only possible lawful basis in every jurisdiction.

### Verified email lookup incident

Both controlled accounts initially saw:
"Your current email address is unavailable. Verify your address before changing email preferences."

Later the API returned:
"Account email verification is temporarily unavailable."

Fixes:

- Use verified signed email claims where available.
- For marketing preferences only, use server-only CLERK_SECRET_KEY to retrieve that authenticated subject's verified PRIMARY email if claims lack the address.
- Never trust a browser email header, unverified stored email, or an arbitrary secondary email.
- Preserve existing identity-linking and invitation rules.
- Provider outages return a retryable error instead of bypassing verification.
- Client requests identify themselves as Decisionate/1.0.
- Logs expose safe status/exception information, not credentials or full provider payloads.
- Check Clerk frontend/backend instance alignment if authentication lookup fails.

### Segments and future expansion

Initial free-plan setup was changed from agency_account + trial_data_ready to:

- trial_data_ready: e1c2814c-98bd-420a-aade-27e6a43f3970
- trial_expired: 5f20dc6a-b0dc-46b1-8a3d-1ce01408fec6

Those are historical account-specific IDs, not universal constants. Do not create replacement segments automatically or assume those IDs still exist without checking the account.

Optional MARKETING_SEGMENT_IDS supports:

- prospect
- trial_setup_incomplete
- trial_data_ready
- paying_customer
- trial_expired
- former_customer
- inactive_customer
- agency_account

Only configured groups are exported. Missing groups do not disable eligible contact sync or force the user to pay for more segments. Leave General unmanaged rather than mapping unrelated groups to it. Additional IDs can be added later without schema changes; scheduled reconciliation refreshes membership while respecting opt-outs.

There is no initial newsletter/prospect capture form, in-app campaign editor, campaign-attribution dashboard, or completed recurring broadcast automation merely because these groups exist.

### Historical pilot configuration

Controlled test addresses:

- meta_reviewer@decisionate.ca
- akpome@gmail.com

The user supplied/configured the following during the pilot:

~~~dotenv
MARKETING_ACTIVATION_CUTOFF=2026-10-12T21:57:48Z
MARKETING_TEST_MODE=true
MARKETING_TEST_RECIPIENTS=meta_reviewer@decisionate.ca,akpome@gmail.com
MARKETING_WELCOME_ENABLED=false
MARKETING_INCOMPLETE_SETUP_ENABLED=false
MARKETING_TRIAL_ENDING_ENABLED=false
MARKETING_SEND_ENABLED=true
~~~

MARKETING_ENABLED is a separate processing gate and was also configured during setup. Initial examples default both processing and sending to false.

These values are HISTORICAL, not an instruction to enable production sends now. Actual API and worker configuration must agree. Do not replace a deliberate activation cutoff with the current time without reviewing consequences.

### Send safety

- Test mode defaults true and enforces the controlled allowlist; staging remains allowlist restricted.
- Sends require verified consent, current contact sync, sender configuration, activation rules, automation flags, no suppression, provider preference checks, and applicable frequency cap.
- Default automated per-contact frequency cap is 24 hours.
- A neutral admin delivery_test supports eligible paid internal accounts without pretending they are trial accounts.
- Routine newer contact revisions can queue sync and wait; repeated test requests reuse pending work.
- Updating versus Synced states distinguish current revisions.
- Webhook jobs take priority over contact sync, then workspace refreshes.
- Provider acceptance is submitted, not delivered.
- Signed delivery webhooks update the ledger.
- Ambiguous retries reuse the same persisted payload/idempotency key within a conservative 23-hour window.
- Older uncertain submissions require provider reconciliation, not blind resend.
- Previewing does not send.
- Disabling send gates preserves ledger evidence and does not stop essential notices.

Both controlled recipients eventually showed delivered in the user's screenshot. A subsequent test for the first contact was pending with frequency_cap; this was not proof of a broken recipient address.

### Webhooks and unsubscribe

- Endpoint: https://api.decisionate.ca/marketing/webhook.
- RESEND_WEBHOOK_SECRET stays server-side.
- Svix verifies raw-body signatures/timestamps; event IDs are deduplicated.
- Contact updates/deletions, delivery/failure/bounce/complaint/suppression events are supported.
- Withdrawal/suppression is applied locally before acknowledgement even when background marketing processing is disabled.
- GET unsubscribe shows confirmation to avoid scanner-triggered withdrawal.
- POST performs withdrawal without requiring login, including one-click List-Unsubscribe.
- Stable unsubscribe signing secret and domain availability matter for old links.

### Sending marketing campaigns

Manual marketing campaigns are composed/scheduled in Resend Broadcasts using eligible synchronized segments.

- Preview recipient eligibility and current suppression.
- Include actual legal sender, postal address, monitored contact information, and provider unsubscribe URL.
- Coordinate timing: Resend dashboard Broadcasts are not governed by the application's automated frequency cap.
- Do not export all account emails or infer that registration means marketing consent.
- In-app campaign editor/topics/automated attribution were not part of the initial implementation.

### Recipient-aware email logos

- Business and agency workspace owner emails: Decisionate PNG header.
- Agency client reports, connector notices, and maintenance emails: managing agency logo/name only.
- Missing/invalid agency image: fallback to agency name, not a blanket Decisionate logo.
- Existing text-only powered-by attribution remains.
- Plain text remains readable without image loading.
- App logo URL uses publicly reachable DECISIONATE_WEB_APP_URL plus /icons/decisionate-logo.png.
- Queued idempotent marketing retries retain their original composed payload.
- Clerk-sent verification/invitation emails, Stripe-generated email, and manually authored Resend Broadcasts have provider-owned branding configuration. They are not automatically restyled by the application's renderer.

## 13. Landing Page, Branding, and Mobile Reliability

### Landing work

Several iterations revised the English/French landing page and product presentation:

- Clearer value proposition and brand identity.
- Existing accounting, sales, marketing, and spreadsheet data.
- Daily automatic syncing, weekly performance reports, KPI alerts.
- Reports, AI-assisted insight, decisions, assigned action, and outcomes.
- Real product walkthrough and public live demo.
- Connect / Analyze / Decide / Review chapter controls.
- Trial and demo CTAs.
- Dedicated business section and dedicated agency section.
- More detailed agency workflow/plan explanation.
- Alternating background sections consistent with the rest of the page.
- "Keep the evidence close to the action" moved below the agency section.
- Agency workflow corrected to say the client connects/manages the data.
- EN/FR policies, logos, responsive navigation, and mobile account controls.

The newer cross-dataset direction supersedes any old implication that a one-metric report is the core differentiator. A full audit of all marketing copy against that newer direction is not claimed by the reports commit.

### Historical Hero Alignment and Later Replacement

There were multiple corrections and reversals before the later landing workflow. At that earlier stage the user clarified:

- Decisionate heading aligns with the top of the video.
- The bottom of the CTA buttons aligns with the horizontal line above Connect / Analyze / Decide / Review.
- "No credit card required" sits beneath the buttons and below that alignment edge.
- Paragraph spacing remains consistent.
- Text sizes have a deliberate hierarchy.
- Benefit paragraphs stay with associated introductory copy on mobile, not below the video.

That clarification describes the earlier design, not the final current implementation. The subsequently supplied landing workflow and commit 94e070e5 replaced the standalone Decisionate H1 with "Turn your business data into better decisions." and requested normal-flow CTA spacing without bottom-pushing alignment rules. Current hero.tsx/landing.css use the benefit headline, two paragraphs, CTA margin, reassurance underneath, and a top-aligned responsive grid. Do not restore the older heading or forced chapter-edge alignment merely because it appears in this historical account. See the addendum for the exact current copy and layout.

### Android Chrome incident

User reported:

- Landing and then all full application pages briefly appeared and disappeared/crashed.
- Page thumbnails appeared normally.
- Incognito had the same behavior.
- The Google Search in-app browser worked while Chrome did not.
- The user later reported the app working and requested cleanup/push.

Code changes included browser-API guards in walkthrough/preview components, independent startup/page recovery, and simplified resize/error handling.

This conversation does not prove one isolated Android rendering root cause across all devices. No exact affected OS/Chrome version was supplied. Do not claim that a particular device bug is universally fixed based only on local desktop emulation.

If it recurs, collect actual device/browser versions and remote console/network evidence, reproduce the full-page case, and inspect shared startup code without repeatedly rewriting unrelated landing layout.

## 14. Earlier Platform Capabilities and Development Phases

The complete commit index below covers the whole reachable history, including work before the recent conversation. The following summarizes major existing systems. Historical commit subjects establish development history, not a fresh verification of every feature.

### May and June foundations

- Persistent dataset analytics.
- Clerk-protected routes and dataset ownership.
- Organization onboarding and scoped datasets.
- Forecasting dashboard and historical charts.
- Cross-page dataset/metric preferences.
- Recommendation engine.
- Decision portfolio, reviews, templates, and stable dashboard state.

### July and August readiness and provider work

- MVP readiness, portable storage resolution, and production configuration.
- Public pages/live demo independent of private Clerk initialization.
- Mobile auth placement, provider mounting, redirect recovery, and stale bundle fixes.
- Dashboard performance, layouts, metric mappings, date axes, and public demo controls.
- Broad connector implementation and OAuth account/resource configuration.
- Read-only customer database connectors.
- Per-dataset metric selections, unselect/reset/search, strict numeric detection, and all-column dimension mapping.
- Provider-safe error/no-data messaging, token refresh, and reauthorization.
- Various experiments were reverted; current catalog supersedes historical additions/removals.

### September customer and operational work

- Consistent 30-day no-card trial and onboarding profiles.
- Subscription checkout/portal, signed billing webhooks, renewal and expiry behavior.
- Annual AI-credit allocations, recurring packs and one-time top-ups.
- Agency/client workspace packages and pooled AI credits.
- Platform-managed email rather than customer-specific SMTP provider configuration.
- Branded client alerts and Decisionate owner emails.
- Internal customer/user/workspace tables, search, usage, audit, readiness, maintenance notices.
- Google Ads, Google Business Profile planned status, POS series, commerce data.
- Entity matching and persisted cross-source matches.
- Joined source evidence, titles, editable decisions, outcome metrics, action workflow.
- Mixed-content/HTTPS normalization.
- Sage regional/account/business selection, token recovery, full attributes, deduplication.
- Lightspeed cursor pagination, token-refresh serialization, incomplete-sale handling, and line items.
- Advanced bounded sync dates and recovery controls.
- Shopify uses the shared chunked three-year history policy; older orders require approved and granted all-orders access.
- Billing price administration and persisted top-up credits.
- Client invitation authorization and admin performance bounds.

### Existing decision workflow

The current system retains:

- Decision portfolio and detail pages.
- User reasoning and expected outcome.
- Metric-linked evidence and joined/source context.
- Status, review dates, priority/category/confidence.
- Assigned actions and follow-up.
- Actual outcome recording/measurement.
- Lessons learned and historical learning context.
- Audit/activity history and applicable ownership controls.

Centralizing creation did not remove these capabilities or make every report require a decision.

### Optional AI

- AI is optional and server-configured through provider/model/URL/key.
- Compatibility OPENAI_* aliases exist.
- Requests use bounded aggregate facts rather than raw source rows.
- Missing/unavailable AI returns explicitly labeled deterministic fallback.
- Forecasts expose holdout/model-quality information; weak validation caps confidence.
- AI credits/usage are distinct from provider authentication and account subscriptions.
- Do not claim AI is active in production without checking configuration/status.
- Do not describe deterministic fallback as a model-generated insight.

### Billing and retention caveats

The repository contains Stripe lifecycle, renewals, expiry, AI-credit purchases, pricing administration, and retention modules. Exact current prices, entitlements, enforcement flags, Stripe products, and live webhook state must be read from current configuration/admin records.

Some runbooks intentionally describe BILLING_ENFORCEMENT_ENABLED=false during staged rollout. This is not proof that enforcement is still off today. Do not reconfigure customer billing from a historical example.

### Internal Platform Admin

Internal administration includes permission-scoped operational views for customers/users/workspaces, usage, AI/recommendation outcomes, maintenance, alert delivery, provider settings, marketing, and pricing.

- Backend bootstrap/reference configuration: DECISIONATE_PLATFORM_ADMIN_USER_IDS; the server resolves external identities to internal users.
- Persisted PlatformAdminRole grants also authorize administrators and can scope their permissions. A blank legacy permissions field remains full access; an explicit permissions document is evaluated separately.
- DECISIONATE_PLATFORM_ADMIN_EMAILS is also supported by current server code. It is not a substitute for workspace permissions or a reason to trust browser-supplied email.
- NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS is a frontend navigation hint, not the complete authoritative grant model. The /admin/access response and backend checks determine actual access.
- Grant management and other full-access-only operations have additional server checks. See the addendum for the permission keys and identity-link behavior.
- Customer owners/agencies must not receive the global contact directory.
- Delete operations have ownership/protection/cascade rules.

The user reported tables wrapping headers and email addresses into single-letter columns and clipping actions. e1f75401 corrected table widths, overflow behavior, and action layout. Recheck desktop/mobile scanning and horizontal scroll before changing these shared layouts again.

## 15. Railway Operations and Configuration

Runbook: [railway-scheduling.md](railway-scheduling.md).

### Services and responsibilities

| Service | Start command | Responsibility |
| --- | --- | --- |
| decisionate-api | API image's web process | HTTP application and protected scheduler endpoints |
| decisionate-worker | python scripts/run_ingestion_worker.py | Persistent ingestion and marketing work |
| Decisionate Scheduler | python scripts/run_scheduled_jobs.py | Cron invocation of protected API endpoints, then exit |
| PostgreSQL | Managed database | Durable records, jobs, leases, advisory locks |
| Optional separate correlation worker | python scripts/run_correlation_worker.py | Gated advanced correlation queue only |

The worker and scheduler are not interchangeable. A successful scheduler response can mean work was queued, not completed.

### Build and worker configuration history

User showed:

- API service root /apps/api.
- Dockerfile /apps/api/Dockerfile.
- Dockerfile builder / build environment V3.
- Runtime V2.
- One worker replica in Amsterdam.
- Worker start command python scripts/run_ingestion_worker.py.
- sleepApplication=false.
- restartPolicyType=ALWAYS.
- No worker cron schedule and no HTTP healthcheck.

Treat these as the supplied worker settings, not a claim that this handoff queried the latest Railway configuration.

### Scheduler jobs

| Job | Protected API endpoint |
| --- | --- |
| connectors | POST /datasets/source-connections/sync-due |
| alerts | POST /alerts/weekly-report/send-due |
| billing | POST /billing/lifecycle/send-due |
| marketing | POST /marketing/reconcile |

Set the corresponding scheduler secrets on API and scheduler. With no explicit SCHEDULED_JOBS list, the runner selects jobs with configured secrets. With an explicit list, include only intended jobs.

The scheduler requires the API URL and selected job secrets. It does not require database/object-store/provider credentials. The persistent worker DOES require the shared database, object storage, encryption, connector, auth, monitoring, and appropriate marketing settings.

Railway reference variables can reference the corresponding API service values rather than duplicate secrets. API and worker must use matching settings/revision where required. Do not delete copied worker variables merely because the scheduler does not need them.

### Queue-full incident

Earlier scheduler output showed:

- connectors failed with HTTP 429: five imports already queued for the workspace.
- alerts and billing succeeded.

Correction:

- Five queued/running root jobs per workspace remains the limit.
- Scheduled connector sync treats saturation as temporary deferral with HTTP 200, deferred_count, and workspace_queue_full.
- Other workspaces continue.
- Deferred work remains due for the next run.
- Manual imports still return 429 at capacity.
- Missing/stale worker heartbeat is a real 503, not disguised success.

Do not delete queued imports or raise limits to conceal an unhealthy worker.

### Worker deployment-overlap incident

Observed exception:
RuntimeError: Another ingestion worker already owns the queue.

Correction in eb271154:

- Persistent new worker waits and retries the ownership lock instead of entering a crash/restart loop.
- Old deployment remains sole consumer until handover.
- Standby does not recover jobs, update readiness, or consume work before lock ownership.
- One-shot --once still rejects a competing owner.
- Logs show standby, lock acquisition, relevant marketing gates, and nonempty batches without secret/contact output.

A heartbeat proves some owner is alive, not that the newest deployment owns the queue. If a worker remains in standby, inspect old/duplicate services. Never remove the lock or restart the database to permit competing consumers.

### Diagnosis

- Build logs: image/dependency/compilation failures.
- Deploy logs: runtime startup, exceptions, worker state, job failures.
- Network logs: request-level transport/status details, not a substitute for a Python traceback.
- /health: non-secret capability/configuration view.
- /ready: database/worker operational readiness; stale ingestion heartbeat returns 503.
- Scheduler normal completion/exit is not itself a crash.
- Check terminal ingestion outcomes, not just cron success.

## 16. Local Development and Safe Testing

### Python environment

From repository root:

~~~bash
source apps/api/.venv/bin/activate
~~~

Or, already inside apps/api:

~~~bash
source .venv/bin/activate
~~~

Exit with deactivate. Prefer the explicit .venv/bin/python interpreter in scripts to avoid activating the wrong environment.

### Start API

From repository root:

~~~bash
apps/api/.venv/bin/python -m uvicorn app.main:app \
  --app-dir apps/api --reload --reload-dir apps \
  --port 8000 --env-file apps/api/.env
~~~

From apps/api:

~~~bash
.venv/bin/python -m uvicorn app.main:app --reload --port 8000 --env-file .env
~~~

Do not overwrite existing .env files with examples. They are already configured locally.

### Start web

From apps/web:

~~~bash
npm run dev
~~~

Use another port if occupied. NEXT_PUBLIC_API_URL is embedded into production web builds, so changing only a runtime variable may not update a built client.

The normal browser Clerk token provider is registered by the app. Do not enable legacy auth fallback flags as a shortcut around a mismatched API/Clerk instance.

### Existing local services

During recent work, the user's own web server on 3000 and API reload server on 8000 were left alone. An isolated preview was also started on 3001 using /tmp/decisionate-report-preview.

- Do not rely on recorded process IDs; inspect current processes/ports.
- Do not kill the user's servers to free a test port.
- Next.js 16 project locks can prevent two development servers against the same project even with separate ports/output settings.
- The isolated preview had its own temporary build directory and symlinked project code.
- Temporary fixture servers on 3102 and 3103 were stopped.
- Temporary paths and previews are not durable deployment assets.

### Safe API test environment

Never run a test suite against the user's existing SQLite database or production PostgreSQL.

From apps/api, an isolated targeted example:

~~~bash
PYTHONDONTWRITEBYTECODE=1 APP_ENV=development DATABASE_URL=sqlite:///:memory: \
  .venv/bin/python -B -m unittest tests.test_business_reports -v
~~~

The full discovery command is:

~~~bash
PYTHONDONTWRITEBYTECODE=1 APP_ENV=development DATABASE_URL=sqlite:////tmp/decisionate-handoff-tests.db \
  .venv/bin/python -B -m unittest discover -s tests -v
~~~

Use a fresh disposable /tmp filename. Some combined suites need shared metadata created after importing the relevant model/test modules; follow their fixtures rather than assuming a missing test table is a production migration issue.

Optional PostgreSQL tests use DECISIONATE_TEST_POSTGRES_URL pointing to a disposable test database, not production.

### Web checks

From apps/web:

~~~bash
npm test
npm run lint
npx tsc --noEmit
npm run build
~~~

Targeted decision checks:

~~~bash
npm run test:decisions
~~~

CI runs API locked installs/tests with Python 3.12 and a disposable PostgreSQL 16 service, and web checks with Node 22. Read .github/workflows/ci.yml for the exact environment.

A current CI workflow definition is not proof that a particular remote run passed.

### Operational tools

Inspect before executing:

- scripts/check_mvp_readiness.py --strict
- scripts/prepare_postgresql_migration.py
- scripts/migrate_object_storage.py
- scripts/verify_backup_restore.py
- scripts/migrate_marketing.py
- scripts/export_metric_schema_inventory.py
- scripts/export_public_demo.py
- scripts/remove_connector.py

Migration, deletion, exports, live sends, and provider writes require deliberate targeting. Do not run them simply to "check" configuration.

## 17. Verification Already Completed

### Latest decision-centralization change

Recorded results:

- 232 web tests passed, zero failures/skips in the final test log.
- TypeScript noEmit passed.
- ESLint passed for all changed TSX files without warnings after cleanup.
- Isolated Next production build passed, including both central decision routes.
- Playwright checks at widths 320, 390, 768, and 1440.
- Browser checks used real rendered feature components and real report API calculations with synthetic data/in-memory SQLite, but mocked identity and transport adapters.
- Report loading failure/retry was exercised.
- Evidence submission failure/retry retained entered text.
- Limited coverage blocked creation.
- Workspace changes reset evidence.
- Read-only access did not fetch report creation evidence.
- Report views contained no scattered create controls.
- No observed page errors or horizontal overflow in those checked views.
- Actual returned report decision evidence retained both source datasets and the selected outcome metric.
- Separate manual dataset-linked creation matched the real DecisionCreate schema.
- git diff --check passed.

These checks do not establish real Clerk production auth or provider availability.

### Cross-dataset reporting change

Recorded results:

- 259 affected API tests passed in the final isolated regression run.
- Coverage included business reports, weekly preferences, branding, agency notifications, relationships, correlation preservation, multi-metric behavior, workspace permissions/deletion, dataset auth/services/sharing, and platform-admin permissions.
- The business-report suite covered windows, missing/all-null data, weighted ratios, currency, calendar lag, scope, immutable snapshots, policy changes, evidence, and weekly templates/previews.
- Web tests, TypeScript, changed-file lint, and production build passed.
- Responsive browser checks used synthetic data and mocked identity.
- No production sends were performed.

A full API discovery run was attempted but interrupted during slow unrelated billing tests. Therefore, do NOT say the entire current API suite passed. The final verified reporting regression total is 259, not a full-project total.

An older conversation cited "508 tests passed" for an earlier connector/schema change. That is a historical per-change claim, not a current whole-repository certification. Use the appropriate commit/test evidence rather than combining counts across dates.

### Remaining verification boundaries

Not established by the latest local checks:

- Fresh production web/API rollout.
- Production PostgreSQL bootstrap for the new report model/column.
- Actual provider payloads for every connector.
- Real advanced-worker PostgreSQL handover, resource limits, and concurrency under deployment load.
- Every regional/currency schema.
- Physical Android Chrome regression on the originally affected phone.
- Current live Resend DNS/permissions/secrets or complete lifecycle rollout.
- A full latest API discovery pass.
- A fresh full remote CI run.

### Ephemeral evidence paths

Useful if they still exist:

- /tmp/decisionate-central-web-tests-final.log
- /tmp/decisionate-central-lint-final.log
- /tmp/decisionate-central-types-verified.log
- /tmp/decisionate-central-form-lint.log
- /tmp/decisionate-report-preview/build-central.log
- /tmp/decisionate-central-check/browser-done.log
- /tmp/decisionate-central-check/decision-320.png through decision-1440.png
- /tmp/decisionate-central-check/report-*.png
- /tmp/decisionate-cross-dataset-api-final.log
- /tmp/decisionate-report-check/run_regressions.py

These files are not committed and are not substitutes for reproducible repository tests.

## 18. Local Uncommitted Work and Generated Artifacts

### Existing tracked modifications

At handoff, local runtime changes include:

- Python __pycache__/*.pyc files under API app/db and datasets, decisions, forecasting, organizations modules.
- apps/api/decisionate.db.
- apps/api/decisionate.db-shm.
- apps/api/decisionate.db-wal.
- Root decisionate.db.

Untracked root decisionate.db-shm and decisionate.db-wal also exist.

These were excluded from recent source commits. Do not stage all files indiscriminately, delete the databases, revert them, or assume they are disposable.

### Untracked synthetic demo work

Files intentionally not included in the latest implementation commits:

- apps/api/demo_data/connectors/generate_correlation_demo_data.py
- apps/api/tests/test_correlation_demo_data.py
- sample-data/meta_ads_shopify_2025/README.txt
- sample-data/meta_ads_shopify_2025/manifest.json
- sample-data/meta_ads_shopify_2025/meta_ads_daily_2025.csv
- sample-data/meta_ads_shopify_2025/shopify_daily_2025.csv
- sample-data/meta_ads_shopify_2025/meta_ads_shopify_correlation_2025.zip

Do not claim these artifacts have been pushed.

### Demo scenario

The user requested one year of Meta Ads and Shopify data for correlation demos, then requested regeneration because ad-spend values numerically exceeded orders.

Current files describe:

- 2025-01-01 through 2025-12-31.
- 365 daily rows per CSV.
- CAD.
- Seed 20251018.
- Fictional established store with mostly organic/repeat purchases and a small advertising budget.
- Daily spend at most CAD 40 and total daily orders greater than the numerical spend value on all exported dates.
- These are aggregate CSV uploads, NOT native provider API payloads.
- Model includes seasonality, weekdays, promotions, fatigue, basket variation, and delayed partial refunds.
- A synthetic paid-order response lag of two days does not guarantee the strongest total-store correlation occurs at two days.
- Attributed orders/revenue are synthetic labels, not invented claims about native provider fields.

Manifest totals:

| Measure | Synthetic total |
| --- | --- |
| Ad spend | CAD 9,668.13 |
| Orders | 27,770 |
| Attributed orders | 344 |
| Non-ad orders | 27,426 |
| Attributed revenue | CAD 30,788.43 |
| Gross sales | CAD 2,491,223.25 |
| Net sales | CAD 2,360,088.47 |
| Discounts | CAD 69,080.07 |
| Merchandise refund amount | CAD 62,054.71 |

The manifest's media-only attributed ROAS is 3.1845; blended net-sales/spend is 244.1101 because most store activity is non-ad. These are measurements of fictional data, not benchmarks or profitability.

Do not compare the vertical height of CAD spend to an order-count line as an economic ratio. Use separate axes/standardized charts or spend versus money-valued sales. Gross/net and attribution-subset relationships are partly mechanical.

The demo README still refers to the older multi-metric workflow. For a present-day walkthrough, map its inputs into Reports or the authorized advanced explorer; do not assume the label mentioned in the old README appears in current navigation.

## 19. Remaining Checks, Risks, and Continuation Guidance

### First continuation checks

1. Re-read git status and the current HEAD. This handoff is a snapshot, not authority over newer work.
2. Confirm the latest web and API deployment contains both b2bcf41c and 21fce690.
3. Confirm serialized PostgreSQL startup created business_reports and the weekly template column without errors.
4. Open Reports with two approved usable datasets in the same workspace.
5. Check missing-data warnings, date boundaries, units, and previous-period values.
6. Save a snapshot, reload it, and verify scope and immutability.
7. Open Decisions, create a report-backed decision centrally, and confirm both source metrics survive.
8. Confirm the old scattered create controls remain absent.
9. Preview a current two-source weekly report without triggering a production send.
10. Confirm selecting a weekly template has not enabled mail or changed recipients.
11. Test relevant owner/member/client/managed-client roles against server authorization, not just visible navigation.
12. If Lightspeed still has only quantity, verify an actual successful latest Sales resync and inspect emitted amount/currency columns.
13. Keep marketing pilot gates unchanged until the operator deliberately approves broader rollout.
14. Review untracked demo work separately before deciding whether to commit it.

### Known product and rollout boundaries

- Single-dataset analytics still exists; the cross-dataset correction does not delete every old page.
- A report can be meaningful without a statistically significant relationship.
- Core Reports is bounded synchronous work; larger matrices require the separate gated asynchronous workflow.
- Missing source observations can limit period comparisons. Do not suppress those warnings to make the report look stronger.
- Saved evidence cannot bypass revoked dataset access.
- Source deletion removes related saved report evidence.
- New connector money defaults require actual reviewed data/schema/currency.
- Unresolved/mixed currency, insufficient historical statistics, and unknown policy versions stay unavailable.
- Receipt compatibility does not automatically certify monetary aggregation across every provider.
- Existing datasets may require resync for importer changes; code changes do not conjure previously absent values.
- Marketing broadcasts, service notices, and weekly reports have different consent/configuration paths.
- Provider-generated emails need provider-specific branding settings.
- Google Business Profile and restaurant-series approval/availability remain planned.
- The current status of Google Analytics Admin API verification and other external app reviews is unknown from the supplied conversation.
- Exact current pricing, billing enforcement, AI provider/model, storage, feature flags, and secrets are deployment facts, not assumptions to infer from examples.

### Engineering rules for the next agent

- Research primary provider documentation when changing fields/scopes/semantics.
- Distinguish provider fields from Decisionate normalization aliases.
- Be explicit about synthetic fixtures versus real payloads.
- Never fill missing revenue, quantities, currency, or p-values with invented data.
- Preserve the legacy statistical contract unless a separately authorized migration changes it.
- Preserve deliberate manual choices and the selected objective's explicit reset semantics.
- Keep changes focused; do not refactor unrelated billing/auth/storage during a report fix.
- Do not use git reset --hard or git checkout -- to discard existing user work.
- Stage intended files explicitly; inspect git diff --cached before committing.
- Do not print secret environment values, customer rows, or provider tokens.
- Do not send test messages to real customers.
- Do not turn off opt-in, suppression, tenancy, or rollout safeguards simply to make a test pass.
- Do not confuse a passed local check, successful push, and successful deployment.
- Document exactly which tests ran, with their actual count and environment.
- Maintain this handoff when product contracts change; obsolete decisions should be labeled rather than silently retained as current instructions.

### Suggested opening context for a new ChatGPT session

"Decisionate is an existing Next.js/FastAPI application at /home/akpome/decisionate. Read this handoff before proposing changes. The core is cross-dataset business analysis and weekly reports, not single-source provider analytics. Latest pushed commit is 21fce690, centralizing decision creation under Decisions; prior b2bcf41c added cross-dataset Reports. Preserve agency-client data ownership and branding, receipt-only automatic financial defaults, manual selections, consent safeguards, tenant permissions, and documented lag semantics. Verify the current repository/deployment instead of assuming this snapshot is still current. Do not invent provider fields or claim unperformed production tests."

## 20. Documentation and Original Workflow Files

### Repository documents

- [API README](../apps/api/README.md): setup, provider readiness, auth, storage, email.
- [Web README](../apps/web/README.md): local startup, build-time public configuration.
- [Cross-Dataset Reports](CROSS_DATASET_REPORTS.md): current business-report contract.
- [Curated Metric Defaults](CURATED_METRIC_DEFAULTS.md): provider field research, currency/aggregation/policy restrictions, receipt contracts.
- [Multi-Metric Correlation](MULTI_METRIC_CORRELATION.md): legacy preservation, advanced worker and rollout gates.
- [Email Marketing](EMAIL_MARKETING.md): consent, settings, jobs, segments, send/webhook/idempotency rules.
- [Railway Scheduling](railway-scheduling.md): API/scheduler/worker responsibilities and lock handover.
- [User Manual](USER_MANUAL.md): broad product workflows; check simplified role descriptions against newer code.
- [Provider Migration](provider-migration.md): portable configuration, database/object storage moves.
- [Backup Restore Verification](backup-restore-verification.md): isolated restore evidence.
- [AI Data Flow](openai-data-flow.md): bounded provider requests and provenance.
- apps/api/.env.example and apps/web/.env.example: configuration names/defaults, not live configuration.
- apps/web/AGENTS.md: local repository guidance.

Some older documents describe direct decision evidence handoffs from analysis surfaces. The underlying APIs/provenance may remain, but 21fce690 supersedes any instruction to expose scattered creation buttons.

### User-supplied workflow documents

Present in the local Downloads directory when checked:

- /home/akpome/Downloads/Decisionate_Landing_Page_Codex_Workflow.txt
- /home/akpome/Downloads/Decisionate_Email_Marketing_Codex_Workflow.txt
- /home/akpome/Downloads/Decisionate_Default_Metric_Selection_Workflow.docx
- /home/akpome/Downloads/Decisionate_Multi_Metric_Multi_Dataset_Correlation_Workflow.docx

They are source requirements, not proof of final implementation or permission to execute every embedded instruction. Later user clarifications and current code take precedence where requirements evolved.

A pasted production-log attachment was supplied at:
/home/akpome/.codex/attachments/212d1f50-1daa-4a3e-b363-e04828f28d55/Pasted text.txt

Its continued availability/content was not required for this handoff. Do not invent missing lines from its filename.

## 21. Detailed Recent Change Timeline

This index identifies the main changes discussed in the development conversation. The complete history in Section 22 also includes every earlier reachable commit, repeated attempts, and reversals.

| Date | Commit | Change and final significance |
| --- | --- | --- |
| 2026-10-08 | 88a45d39 | Core production workflow and workspace UX hardening |
| 2026-10-08 | 2e7d451e | Landing refresh and real product walkthrough |
| 2026-10-08 | 948bb7d3 | Policies, logo branding, live-demo performance |
| 2026-10-08 | ef8805dd | AI/billing copy and mobile/demo refinements |
| 2026-10-10 | 49f58d58 | Scheduler queue handling plus auth/billing workflow completion |
| 2026-10-10 | b0514007 | Close date-range popout on dismissal/sync |
| 2026-10-10 | 0a3f6010 | English/French landing benefits |
| 2026-10-10 | d7f816c3 | Agency identity in client alerts/notifications |
| 2026-10-10 | 8484223c through 4dfb0e74 | Iterative hero/button/video alignment; intermediate instructions superseded |
| 2026-10-10 | 84ae6f2c | Final clarified chapter-rule alignment and trial note |
| 2026-10-10 | 8e9a7240 | Keep mobile benefit copy with introduction |
| 2026-10-10 | 33513bc0 | Browser-API guards for mobile walkthrough/previews |
| 2026-10-10 | 0a7ec58b | Separate startup/page recovery |
| 2026-10-10 | 2dc6ec75 | Resize/recovery cleanup |
| 2026-10-12 | 94e070e5 | Hero/demo/navigation refresh |
| 2026-10-12 | a8746a0f | Business/agency sections and alternating backgrounds |
| 2026-10-12 | 5395ee39 | Renewal test helper blocking release checks |
| 2026-10-12 | beba0482 | Client owns connector/data setup in agency workflow copy |
| 2026-10-12 | fde6af94 | Consent-based marketing and admin sender settings |
| 2026-10-12 | a4b5376b | Optional segments/future map changes |
| 2026-10-12 | 28753105 | Verified account email lookup |
| 2026-10-12 | 9373656f | Clerk request identity/safe diagnostics |
| 2026-10-12 | a5cd121d | Resend request identity |
| 2026-10-12 | eb271154 | Safe queue ownership handover instead of worker crash loop |
| 2026-10-12 | 908105c5 | Safe delivery tests for paid internal accounts |
| 2026-10-12 | d0233460 | Test contact sync/queue priority |
| 2026-10-12 | e1f75401 | Recipient-aware email logos and admin tables |
| 2026-10-15 | 4ba6c90b | Gated curated defaults and semantic aggregation |
| 2026-10-15 | 50b8907c | Frozen characterization of legacy correlation |
| 2026-10-15 | 771003b3 | Separate gated asynchronous multi-source engine |
| 2026-10-15 | c293cbff | Relationship explorer/evidence/widgets |
| 2026-10-15 | 556528d7 | Interrupted save recovery without losing selections |
| 2026-10-15 | b3a110ce | Duplicate-column saves and response-before-commit |
| 2026-10-15 | 2c4b57a9 | Empty numeric profile safety across connectors |
| 2026-10-15 | f599efac | Objective-change defaults reset |
| 2026-10-15 | 676a9a5a | Stable vertical transaction items and legacy repair |
| 2026-10-16 | 9e011097 | Receipt/invoice-only automatic financial fields |
| 2026-10-16 | 8a2919de | Legacy automatic selection/effective UI state |
| 2026-10-16 | e92db736 | Objective/selection refresh consistency |
| 2026-10-16 | 9a960ca7 | Provider documentation field audit |
| 2026-10-16 | dfb516bb | Restore documented Lightspeed X/Zoho/Sage amounts |
| 2026-10-17 | 050da408 | Shared receipt safeguards for current/future adapters |
| 2026-10-17 | 41a993ea | Lightspeed X currency and receipt defaults |
| 2026-10-17 | e8f3bbeb | Salesforce sales-performance defaults |
| 2026-10-17 | d19b1500 | Quantity made optional; later superseded |
| 2026-10-17 | 8d3f29c7 | Restore actual TotalOpportunityQuantity default |
| 2026-10-18 | b2bcf41c | Cross-dataset business review/report/weekly workflow |
| 2026-10-18 | 21fce690 | One central decision-creation workflow |

## 22. Complete Commit Index

The following is the complete reachable commit index at this snapshot, oldest first. It contains 568 commits from 2026-05-31 through 2026-10-18, with full hashes, author dates, and subjects.

Commit titles describe what was attempted at that point. Reverts, replacements, repeated fixes, and superseded product directions must be interpreted through the final code and the sections above. A title alone is not proof that the feature is still active or that a test/deployment passed.

To inspect the actual files and changes for any entry:

~~~bash
git show --stat COMMIT_HASH
git show COMMIT_HASH -- path/to/relevant/file
~~~

~~~text
67e51292e62d34424698da7739a3e4dfb5cd3713 | 2026-05-31 | first commit
33b159f89ccd2312c36f5388fd9de166a96a0e00 | 2026-05-31 | second commit
74c86949739bdb7d5b6384be39591ec4a9162522 | 2026-06-02 | Backend dataset persistence and analytics services
3257e041059932476ace2bb4b0b6c646b8a55561 | 2026-06-03 | Build persisted dataset analytics workflow
98c23fd8ee92ce495f3fd8106082f1697a22adee | 2026-06-04 | complete Clerk dataset ownership integration
11d644f92b90eeeb5af707c6131e261b3cd4e0f1 | 2026-06-04 | enable Clerk middleware and protected routes
f99b26bb1125bc973dfb2834f8b476204880f386 | 2026-06-04 | cleaned tempory codes after debug
eff70b787145c40d35a56c7e5a6929c46d7918a0 | 2026-06-05 | implement organization onboarding and user scoped datasets
5975b6b36bfca6edf65cda08426a617cc1c4b2bf | 2026-06-05 | add organizations, onboarding, and forecasting module
434df5b39df5eb5e1de8af1780ca50370854eaa3 | 2026-06-06 | feat: add forecasting dashboard with historical trend visualization
c76769c91a081da05b927e0c1bb6a9b8ad92ef69 | 2026-06-07 | feat: add user dataset preferences and cross-page dataset persistence
48fef9c3ee0f5d3e06fcf0e6e3a05b85a09f615e | 2026-06-07 | feat: add dataset preferences and dynamic forecast metrics
7a03ed8b31e72c88c1cf7738c266f0aef70daa13 | 2026-06-09 | feat: add metric selection and trend-based forecasting
0ff9ea47e0af33d85d449a7f4607fbfd33027c76 | 2026-06-10 | feat: persist forecast metric preferences
409aca1d722d78e18ce03079566130e7a5a80500 | 2026-06-10 | feat: add recommendation engine and metric persistence
3fc685ec9b50442461b8f83f3fcebc284fcc78b2 | 2026-06-17 | feat(decisions): redesign dashboard with analytics, reviews and portfolio improvements
462b97c9ae86256520bdab5e8437c607c81c903f | 2026-06-25 | Implement dashboard templates and restore stable dashboard state
7af51b3364da06d5e64e0fb962ce5f402b57e2a3 | 2026-07-14 | MVP readiness updates
5e2b7ef92993b6b7b9b4b8d9621bd639c9353b98 | 2026-07-26 | MVP readiness updates 2
116edc83347e7077e4c3004980e3f92dec00b234 | 2026-07-26 | MVP readiness updates 3
954a243e4c2a2dd745a4ebd10f5ddcb8da2e61b0 | 2026-08-19 | MVP readiness updates 4
51b8ae25723ba9a47e7762c87b6a3829b54b27f7 | 2026-08-19 | Harden provider-neutral object storage resolution
647b63935c4f30375af8d0877dd8e2382baa84cd | 2026-08-22 | MVP readiness updates 5
99e8febce8ace23d9a50f20af849409c11777116 | 2026-08-22 | Add Railway scheduled job runner
57097a9987253b056e2b0d79f0968b0dab132232 | 2026-08-22 | Harden scheduler API URL handling
07a494974e1ba958307ebbeb8e62af97f28b4fc8 | 2026-08-22 | Make public pages independent of Clerk
934d53143015bc86bc2ad78a124bf080aca69f0a | 2026-08-22 | updated live demo dashboard
01c936a536a1c47befad8bec385e732f66bb1d3b | 2026-08-22 | Fix live demo access and controls
df6eda9832ad30131a5e175865665b3bf5e08905 | 2026-08-22 | Align live demo dashboard selector with dataset selector
bb57bc82a295fa146607f44688dd34286ac3f26e | 2026-08-22 | Align live demo dashboard selector with dataset selector
0dc0bac5b8e9f6d2270349d85e1777252dbd9022 | 2026-08-22 | Align live demo dashboard selector with dataset selector
ad65a9e1aef5641b4f7ccb849e029e12e35aa4d6 | 2026-08-22 | Align live demo dashboard selector with dataset selector 1
e3514e5e7800ddba1a6321df5facd80623378d70 | 2026-08-22 | Align live demo dashboard selector with dataset selector 2
dea1bec96b5b2e7101319a9de0c9e6151b8e9976 | 2026-08-22 | Fix live demo dashboard type and status layout
9766f1f302a3c50bec496239ef2daae80ce6826a | 2026-08-22 | Fix live demo dashboard type and status layout
08a1ed9db579d8fa8766dd98fc5677acac34e03a | 2026-08-22 | Fix live demo dashboard type and status layout
d4c83ae872bd0bc85468b368ee8aab3e535b410c | 2026-08-22 | Fix live demo dashboard type and status layout
5a78f1ff758ebb29f6368fa98bca4da5c6406b5c | 2026-08-22 | Move demo controls beside live demo status
495abbbb1280d88304468556d723f5e7f4a209f9 | 2026-08-22 | Move demo controls beside live demo status
ce098e4f451a5b9de0bd5ad072b6394574f080d3 | 2026-08-22 | Move demo controls beside live demo status
d1181a589fdb47438b3887416e89afa01c8ea381 | 2026-08-22 | Make industry KPI cards horizontally scrollable
1ae7473017fe2a33826d59bd48c5e8151d726f42 | 2026-08-22 | Make industry KPI cards horizontally scrollable
78458028bcdfc2a710c6988b1d1eff349e97d828 | 2026-08-22 | Make industry KPI cards horizontally scrollable
075bbfb5ec92db5dfb7afdb08b8864d8951f4e57 | 2026-08-22 | Make industry KPI cards horizontally scrollable
870a69c3ae9615a6f49d88b4a3697f08eea321c4 | 2026-08-22 | Keep demo action buttons side by side
acf48bc70a92016410a039bf30d598dd8b70b870 | 2026-08-23 | Fix sign-in server error
1369fd0ebe11d2d187212eb8a1383f70c3db1bdc | 2026-08-23 | Fix Clerk provider document placement
cae482e0bca72fcf01265bc4b3dce63fea05b258 | 2026-08-23 | Mobile login fixed
725563da27b52d09533404bdb3be0f941a2bcc96 | 2026-08-23 | Fix mobile Clerk login layout
926a6a05393a0717e7d3ec59bc7894a92117bfc3 | 2026-08-23 | Fix Clerk authentication redirect
26521bd05ee679af32073dd559b9710183530410 | 2026-08-23 | Keep Clerk provider mounted across routes
ff3b57c09a77f0da56747b569d71d71130b256f3 | 2026-08-23 | Fix mobile Clerk card rendering
901a47e215b035c9af6b77724b878729e207ef79 | 2026-08-23 | Fix Clerk initialization on Android Chrome
7ec47724cee80455ae14f6b8114b0fa01de989f9 | 2026-08-23 | Show Clerk initialization failures
9fb11d63cead9245f2c94b1ff15480584d2d0036 | 2026-08-23 | Prevent stale mobile auth bundles
690f09b718337e578a6f2e820cddc3e5fe991aef | 2026-08-23 | Fix auth redirects and dataset storage loading
6a2378069d451aec8539e114fb33924cdf377554 | 2026-08-23 | Fix auth redirects and dataset storage loading
d24d111f0775c5e610e90106fbfab7f3db04f3ab | 2026-08-23 | Increase dataset loading timeout
f2f2c3e34cfa11b2e7d932ed31222bfa6eeb91db | 2026-08-24 | Widen industry dashboard KPI cards
af846187aa341b4a1c9b65600e211eaea2fd8842 | 2026-08-24 | Place dashboard decision action at left edge
e14631a846a4422c59dd6989c5d15ab9e41146e9 | 2026-08-24 | Restore dashboard intelligence panel
d5518342ed59636bb5a24e2bf185c0fea23af5da | 2026-08-24 | Improve dashboard loading performance
4df6b5d971af813398642f5e48e61804c6fe9cdc | 2026-08-24 | Restore individual dashboard card backgrounds
c7b7f99e50a7204e115461e633c914eb92df3bc2 | 2026-08-24 | Audit connector provider settings
121efc917ebca6c5dd46d0d8d545b3aa4290cc7a | 2026-08-24 | Add reliable Salesforce Sales Cloud connector
eb73727b8869a8290d0c6e5f470c3ef1728ae7a9 | 2026-08-24 | Restrict Salesforce connector to Sales Cloud datasets
2e51c15c6cd8cfd87bf159ee768796f69684b8f3 | 2026-08-24 | Add NetSuite accounting connector
3a15f040e949c8c1ad3c6234b069c8fb3c0f6701 | 2026-08-24 | NetSuite accounting connector removed
6245428d8f8b66bbb7730174251697ce3d5effc8 | 2026-08-24 | Completely remove Salesforce connector
0468f734beed229423d8eaf2463a2afc7c67eb93 | 2026-08-24 | Keep dashboard chart layout at tablet width
83d4f36fb7574828b6ec073ec8fafeac10fabbef | 2026-08-24 | Keep dashboard charts arranged on small tablets
3352dd56e5317e8e367881c9714172ef952bf220 | 2026-08-26 | Clarify connector configuration requirements
020e446558cb3b8ed73ee36b096fa2e2d8c58e22 | 2026-08-26 | Allow connection service cold starts
d5668d50c461eb9d61f59a457477d32cd53c8245 | 2026-08-26 | Add Google Analytics OAuth connector
9cfe8f32ad44ba12ef1c204dc2b4bb04da4383d7 | 2026-08-26 | Add Google Analytics OAuth connector
6b719ec4b007058cea6f27b38c96f05009e7f845 | 2026-08-26 | Add OAuth authorization cancellation
b3abf2f70f71dcf55429ef785f867a9c8af7e9cb | 2026-08-26 | Add daily and weekly connector schedules
e75aedc47391a9cd39d50d51bca1fe5250825466 | 2026-08-26 | Add Salesforce Sales Cloud connector
cfe62cfcaf4170450e7f2264bd73adae6cdfdeb5 | 2026-08-26 | Add Salesforce Sales Cloud connector
a336b8fc89a6e5e0288bc5346062290b1a1466ee | 2026-08-26 | Improve connector sync error handling
05a030aad981110c746d0c152e8220e8f2b4281c | 2026-08-26 | Require Stripe account ID for connector sync
1ebfda2d488bb8aafe69b5a98506fa23745acc41 | 2026-08-26 | Use customer-owned Stripe keys for data ingestion
da3ee19b351343d30f0b46a67ea4a037058cd183 | 2026-08-26 | Flatten nested QuickBooks data for analysis
8b0da88a9f41264352c7c3a2ab62eb84e57698f9 | 2026-08-27 | Add dataset metric selection
fbc172486bb1f3e58a9e25fb402ea0c119dae2d6 | 2026-08-27 | Fix dataset metric selection and OAuth row rendering
209cd2c9dff145c26ac070dbbbe13f6a15de41bc | 2026-08-27 | Use strict numeric dataset metric selection
8cbf0a1973a2553d74204ff2dff59d53f6f30dfa | 2026-08-27 | Restrict dashboards to selected dataset metrics
0a640f871b663499e0e9e5fe9a5f5278d5a7b6ef | 2026-08-27 | Filter unselected metrics from dashboard rows
1b0b8b74918c71e2ed34168030b00a9b68c5ce21 | 2026-08-27 | Resolve datasets by authenticated email
cdafd2a6470fa8e6dace3f97fdbe756282795030 | 2026-08-27 | Resolve datasets by authenticated email
7dae993803d5262ea2e517b6b6b2cd3eea5e74ed | 2026-08-27 | Handle QuickBooks flattened count metrics
b5b07f4682e9cd882c409ae89d44ad0fd969da42 | 2026-08-27 | Filter QuickBooks metrics by dataset selection
d809d9b94253fa9116dd57755d48d8e090f50399 | 2026-08-27 | Respect selected metrics across dashboards
55b404a0cd48d284a0ac20406c94d02f875f58a0 | 2026-08-28 | Restore dataset metric checkbox selection
17dc64b25c8e54f8605d4e50a46b59706ff4c1de | 2026-08-28 | Fix QuickBooks metric column selection
e9d9c1a90d7c272e3411d7c442c7ded0b1974eae | 2026-08-28 | Link synced connections to datasets
e9c7e10c65f2aa6e6cbdc793a18f7f5f90537a3c | 2026-08-28 | Use reliable Python container registry
f7f1c1ef78c881e6e32e336a15d7128383ed7d40 | 2026-08-28 | Allow all columns for industry dimension mappings
416e083c7a106828d67fed3dd046e908f4f6ed7c | 2026-08-28 | Set connector sync default to midnight
4ca611a4a759848a77381ae372fabed7eb662dad | 2026-08-28 | Allow dataset column selection reset
c2de672d23a8410931ce598310cfcc0606fe88d2 | 2026-08-28 | Detect connector date columns across industry dashboards
e24a5b76ca2a6a9ceb22640b40a892b0d37e2c5c | 2026-08-28 | Label industry charts with mapped data fields
19763932a45c846ad556847c88deacd0f5ec58f4 | 2026-08-28 | Label industry charts with mapped data fields
82f18168ee7ec90c96b71c32d4c004d0cab25583 | 2026-08-28 | Show mapped date column on trend charts
a2505ead23793c3de3ff125a3c4c73bb97037eea | 2026-08-28 | Add selectable date column to main dashboard
9da2d44f65ecfb7de1170e822662145b23c3e8fe | 2026-08-28 | Prefer date columns for dashboard chart axes
1a56d3939e03045a698c9a5ccf60ac9d0bde7da7 | 2026-08-28 | Use resolved date columns across chart axes
a25fac45822ed42c23856d1b8c1148fdf855aa09 | 2026-08-28 | Normalize anomaly detection date timezones
0d2bac3a86ec7267af1fa17195f93310a4e8e8ec | 2026-08-28 | Prefer normalized connector date columns
cca9f2fe27239ec8cd348547ae0ff9ddbecd47b1 | 2026-08-28 | Use resolved dataset columns for chart axes
714801b6b604b32cb6fa0b358f20d6f107a04377 | 2026-08-28 | Configure FreshBooks read-only OAuth
cd01df661863a03ecefe138fee7de13e4b5a8771 | 2026-08-28 | Auto-discover FreshBooks account after OAuth
3559be96a84234eb3f9f9c152bcc3c3c1106b9e4 | 2026-08-28 | Preserve OAuth return destination through sign-in
8902e24a7a14c195e5adb779cd7522e672f112cf | 2026-08-28 | Remove manual QuickBooks company configuration
c894e12f75e39c726d00b03bfdbc6403d0bc0c12 | 2026-08-28 | Clarify automatic QuickBooks company selection
7d2fb813029d7a533add5285ce450dcf956fde54 | 2026-08-28 | Add selectable FreshBooks resources
31e05e2791af959c1ac75fea604d5b80d53d740c | 2026-08-28 | Add selectable FreshBooks resources
e7e22195b7aa82ea3b36e00836d70302cfd49959 | 2026-08-28 | Support multi-object FreshBooks datasets
27d37b8df3bd0d6b0d887e238afb954e9d1d0587 | 2026-08-28 | Support multi-object QuickBooks datasets
90ffed40546b74210eae5bc1b7b701292d5e76f8 | 2026-08-28 | Add unselect all dataset columns
c94f5273e3dedf7b4c122165ef46c6d688245f0d | 2026-08-28 | Improve dataset table scrolling
d4a8eb1c5892b912e9c8e611802b9d561fb644b9 | 2026-08-28 | Constrain dataset insights panel
dc69a7096306fd5fc32c4f1a3b046c79fa391a2a | 2026-08-28 | Constrain dataset metrics panel
2f2a7240db7287d42b4e7852c09357835a2bc3eb | 2026-08-28 | Constrain dataset metrics panel
856ed9a5c500f02de5bd7f8ee70fdc2cf4f60850 | 2026-08-28 | Add dataset column search
a0e388e42d4fa8af712ae58980b848cedab9bf63 | 2026-08-28 | Add dataset details section search
f8cdd0bd22443b0bd00806e3024f1c46ba2e8c72 | 2026-08-28 | Remove duplicate dataset table scrollbar
4d6aa29cc7e387253e4021d82816d716f2022337 | 2026-08-28 | Hide outer dashboard scrollbar
a45b1104a281b6780df5545c45837e5b540bd2fc | 2026-08-28 | Remove outer dashboard page scrollbar
3c483e55741b61090e13312bcc1d69068ca57fea | 2026-08-28 | Align insight decision action styling
2010cf0ee9b309b28ee771df6abb3afe130c56ff | 2026-08-28 | Add Zoho Books connector
3346fd7b1bc36b68850379787c5822330c19742f | 2026-08-28 | Add Zoho Books connector
90e0f3b67279cf1b6837955b69ee90c36404ae2e | 2026-08-28 | Make Railway API deployment reliable
6309d7bd7696dbf0f2cf8201a4ac08db202008ff | 2026-08-28 | Expand Zoho Books object ingestion
5fb237b108de1c5420f80bd35eae238e288cbdc4 | 2026-08-28 | Add multi-object Sage and Xero ingestion
13cd2d76da28f5d7066bb9b3e016ea5050156c6f | 2026-08-29 | Retry transient scheduler API failures
b2fb6d0eb174f1bc0550619498aeb19c92beb7eb | 2026-08-29 | Retry transient scheduler API failures
5aea3c4bcbe8be1632c0be05cdf37fe2788cbb84 | 2026-08-29 | Rollback changes introduced after Zoho setup
31d66fd5c58fa8cfe8eb79d1d84f639c56cd6354 | 2026-08-29 | Restore known-good Zoho Books deployment
417908b69679bec6fa8e03e0f408703b552ae454 | 2026-08-29 | Revert "Add Zoho Books connector"
1eb0df64dd53c6623b96e007206084d061c3a818 | 2026-08-29 | Fix Zoho Books OAuth callback handling
1bb32c9fbf8a92b7d7ae71e5e71ada3c86f4c570 | 2026-08-29 | Harden Zoho Books OAuth callback handling
ca50727ed6986c47c56d51e5df4ec67d68c30fdd | 2026-08-29 | Harden Zoho Books OAuth callback handling
7e613a9f615a470d3fee2da0743eba9f36edd307 | 2026-08-29 | Expand Xero connector resource ingestion
c96abd8779eb4eb00b654e6caaef5df2383e443f | 2026-08-29 | Handle empty Xero resources during sync
b888d66d977551ae2f84846fa1e9459e78ac5e8b | 2026-08-29 | Expose Zoho OAuth rejection reason
2b3683d41060b2c74f4fa2850c49639d61cc4518 | 2026-08-30 | Deduplicate connector datasets in connections
a26dfdcc1230db025efeabce853399ca7a62198d | 2026-08-30 | Group connector datasets by object
09025c1c78172f6ff12c86ec2bff4fcf91cabed7 | 2026-08-30 | Mark Sage and Zoho Books as upcoming
447631a2634f7847b6bc32e6b9c6dd93635b04a1 | 2026-08-30 | Restrict landing page to live demo access
75fd1ec0529959e10aa64725bb141828ef971fa6 | 2026-08-30 | Remove trial CTA from live demo
47bb2edc3fc053695416a436002e6a81335a3454 | 2026-08-30 | Add Salesforce Sales Cloud to landing page
ecdec34d38fd55b24ba7453e7c0d592c5e67ed5e | 2026-08-30 | Simplify multi-object dataset navigation
a68871953a41a023bade6f97338ad4c0730c2c87 | 2026-08-30 | Fix HubSpot tickets OAuth scope
0748ee9979bb2495616bb9d3f40d404daeea3708 | 2026-08-30 | Add HubSpot object selection to OAuth connector
d01121aae8f7c0a67e594c455fdc536b6c589687 | 2026-08-30 | Normalize connector dates for analytics
622dcd5fbc35d237e6fd92e6a5ffaf4a52b3b457 | 2026-08-30 | Normalize provider date fields
13e84d3cc74468c2d1d0b6386b346371c7995b4b | 2026-08-30 | Standardize connector object selection
89b9bd8e9ef4b7d4ccefc2949650d47cff6121ab | 2026-08-31 | Add Salesforce OAuth PKCE support
55fd7e714893c810015488036bdc608ab5abe54c | 2026-08-31 | Log connector sync failure reasons
2238732fd632321c5bb232f01a630148f704d8a0 | 2026-08-31 | Require Salesforce object before sync
1490d4b5f3fea4b29b91dc71edf327de23938e09 | 2026-08-31 | Use Salesforce multi-object checkbox selection
aa37ca675b01ad883bb6db90f3c2113a0ae28e84 | 2026-08-31 | Improve connector object selection UX
0e3c934fa6a408c3315947dd89e23a7cf8b99fc1 | 2026-08-31 | Arrange connection controls in four-cell grid
85d6c81034ee6b7a5a6b434690a562f1fa58abee | 2026-08-31 | Simplify OAuth connector configuration
75d713aa809258d1f63659210c3b5d94735ade5c | 2026-08-31 | Arrange OAuth connection settings cards
24c1773b4f03f1e75a1de80c380c1d5d42e5013c | 2026-08-31 | Harden Google Analytics connector sync
5b2ca37e2a5681d4dd18366bab9b74054cf03b4f | 2026-08-31 | Standardize connector configuration requirements
33270ad7e48ba60a24c5daeddbd8f7abbcb249b9 | 2026-08-31 | Hide saved connector settings by default
fbb7a638e70710a592829fbae4ac81f5930ff565 | 2026-08-31 | Clarify required connector settings
70c63b1f5bcc65b99f5a5251aed447e118c3f17d | 2026-08-31 | Remove Stripe configure button
a764824da0a70b5578a94a3c18c4f9f3a9802936 | 2026-08-31 | Use visibility toggles for connector settings
9be384f3dd6743a39220c4de8545dc89a2a1a8c8 | 2026-08-31 | Add Sage Accounting object selection
2929e450f00462653aabc7a860910563c0090519 | 2026-08-31 | Show connector settings visibility toggles
75da2f420e25de6c68cff304f41cc3e0aa5173e2 | 2026-08-31 | Align connector setup guide widths
09a6b3991c80de5adbb8a710eae78f9e6ad86e11 | 2026-08-31 | Align connector setup guide widths
9d24f60af2261296e9a9cddb9fd389c871c410a9 | 2026-08-31 | Use field visibility controls for connector settings
77157217f5efe270cf7ab8c6149a3ff008ac6b81 | 2026-08-31 | Harden Zoho Books OAuth code handling
41b82dc710d078baf675452c279d386d3c5028ee | 2026-08-31 | Support Zoho Canada OAuth accounts server
c409d65d903d13786e26751433a6e6270c8ac6e4 | 2026-08-31 | Simplify dataset details view
d61a323fa6344a354fdd207e84152268860900cb | 2026-09-01 | Improve mobile demo controls
3b0c33e70c6c028f11ebb2b5042540c6366e853f | 2026-09-01 | Improve dataset preview scrolling
367ccda15e4b189fc395f4353344edb96cdf8cf3 | 2026-09-01 | Remove dataset preview vertical scrolling
0dae727958b4484166e3b415491fc002be9e748c | 2026-09-04 | Remove dataset preview vertical scrolling
13d40c80aac5660917abb7c4a158c46f79cb78c5 | 2026-09-05 | Exclude key columns from dataset metrics
b241eea585a3390ceeee24bbdc6260bab12eb9f6 | 2026-09-05 | Add Google Ads connector
caa4066da443e35b9e58722792a334cd3998eb37 | 2026-09-05 | Clarify Google Ads manager account field
1ad88835e0c4dfae29239b26e3b04602bc840921 | 2026-09-05 | Add Google Ads account selection after OAuth
1555b7259ad88f84f76b01a6981330939047dd19 | 2026-09-05 | Use one OAuth callback for all connectors
8376dd3829953f1b77496ad5fec0d4b5fd1fc466 | 2026-09-05 | Prevent invalid Google Ads account selections
345af82c01814b115ba91729cf47ebd4ec431446 | 2026-09-05 | Fix Google Ads account authorization handling
ae45cb38783813cd1c5e4556534d3f033bd9a9d2 | 2026-09-05 | Prevent sync for unavailable Google Ads accounts
4e4a22eedf67a4c64457fd7d8d336b3524f6a839 | 2026-09-05 | Add Decisionate logo SVG
02df1d8a64e57b976beb05e43facf890adb190fe | 2026-09-05 | Require Google Ads customer ID before OAuth
b5af53bc9a7830a89fc5edd570f7f218f61177b1 | 2026-09-05 | Remove Google Ads account selector
d6a579e1e3942a751c5c8a91597acc6fabb0871b | 2026-09-05 | Simplify Google Ads connection to customer ID
19a5bb0fae594ce5628e67d7ad179fd0075ee3fc | 2026-09-05 | Resolve Google Ads manager routing automatically
79823fa1557620103d0af7f868c09320fb3c1a2d | 2026-09-05 | Gate OAuth setup and notify on empty syncs
4f5ef6bac058aa869c463d2a4d7b3a55d5dd96f3 | 2026-09-06 | Show transient sync feedback inside connection cards
22b9654dae16386519acee212b0986e59830b040 | 2026-09-06 | Handle connector errors and no-data feedback
5b5b0e0ad345d16a39b5484a19b7ccdbdd689d7d | 2026-09-06 | Use customer-safe connector error messages
81e62c94416dd633088f9ab9bf54398664e6cef2 | 2026-09-06 | Validate Shopify domain before OAuth
e98ac606bac08d79484ee0cfb90db6124fb9f747 | 2026-09-06 | Classify empty connector syncs as no data
c95303d6b5f793f9d0516d414da2f06789b01da4 | 2026-09-06 | Prevent OAuth without required connector settings
69a591a6d81cba28412770dc79f9779f6e88266a | 2026-09-06 | Show connector sync outcomes in connection cards
af464155440328db068f8de10a0dd932215430ab | 2026-09-06 | Handle expired QuickBooks authorization
874afe2d9b6fd65832973ba1fd7c8458d3384b3d | 2026-09-06 | Refresh OAuth tokens during scheduled syncs
01b68d47034759667368e6e3e04c03bc06b26301 | 2026-09-06 | Show authorization failures on connections
a478f72dda8d1ff5532a715f25cf77955aeb6502 | 2026-09-06 | Email workspace owners about OAuth authorization failures
70c1831353de8c88ca83f0a93dcef5b8823e1120 | 2026-09-06 | Force fresh QuickBooks authorization on reconnect
dede8cbc60907e1a79e81d42f130d7344dbf7008 | 2026-09-06 | Standardize OAuth reauthorization across connectors
569f778edf01ab1466fdba56dfb600b7463bf391 | 2026-09-06 | Increase connector sync request timeout
482474a85fd1e879ab24f93551d90333bb86337e | 2026-09-06 | Handle QuickBooks sandbox API connections
568c6c7e4684ee3a37d5d94a9eb078fab105faab | 2026-09-06 | Handle Google Ads campaigns without performance rows
ad55699ff168267acdcf2645316c59961992fd8e | 2026-09-07 | Refresh OAuth tokens proactively in background
0e7d6494cf1cffe5e742834b11f18e83c79bb6de | 2026-09-07 | Refresh OAuth tokens one hour before expiry
a34777d65b73e3a1894f19728a104325a1e30b67 | 2026-09-07 | Add customer PostgreSQL dataset connector
1ee9a2047ca2f3181088452b47d4463227ac00cc | 2026-09-07 | Add MySQL and SQL Server dataset connectors
096f15d59ddfeea378951f21e196a8739e3a62cd | 2026-09-07 | Align connection settings beside sync schedule
c4e5a68b9b469e2c3d39a302fca1c44373139b7a | 2026-09-07 | Add Google Ads to landing page integrations
2cb3c779dd8855cc901d96bf4813d701bcf87183 | 2026-09-07 | Implement 30-day no-card free trial
dd4c089f4ae0ae2b741b99e6fc7739a874aac466 | 2026-09-07 | Collect customer profile during onboarding
06f004489f1ddace7c9dd45b3c72475f514f984d | 2026-09-07 | Implement annual AI credit allocations
faf1d2b1d38bd6ffb3a7da6e3cf3c253f3f0ba4c | 2026-09-07 | Set additional workspace AI credits
00f25f85ec5af1746f1e3dd72a022e0782afd7c5 | 2026-09-07 | Fix duplicate workspace role type
65367d5da9e7dd87d3510f215f89525245a164ba | 2026-09-07 | Clarify free plan annual AI credits
cef6e3f8d187f365a1995a0f988f11c95c64ef68 | 2026-09-07 | Clarify trial workspace entitlements
4a8fb44fa259b1e0424d99e346c1680d128212c8 | 2026-09-07 | Add agency workspace addon packages
f1b0c607831b6c4ff8d0e40750e993d74850520b | 2026-09-07 | Add Zoho Books Google Ads and Salesforce demo datasets
4aff51f3a1f61002b37169fca8a31c8df74f2fec | 2026-09-07 | Restore variable client workspace billing
db2435c0c358be886f28071ab22adc6b14e06f9b | 2026-09-07 | Add demo target KPI metric selector
4b97b573c4a083d56628166ed925a4c00dbe66e8 | 2026-09-07 | Hide identifier columns from demo metrics
870695ee9f35da86b4de9ef4ff7b3fa8850972f6 | 2026-09-07 | Move demo KPI selector to top controls
977f170982321cc0f00598e610de41fd1724937e | 2026-09-07 | Align demo KPI selector at bottom
29c4d61601acbb78cb3927d067b6516cf82f0c41 | 2026-09-07 | Align KPI selector in metrics card
b429397dbc4b01e6af9af68b59ffbf79007d1581 | 2026-09-07 | Align KPI selector with metrics heading
ca0a8a322b105dcfa004602da046e41e32464ce1 | 2026-09-07 | Make alerts page loading non-blocking
3ca94ee53279430f30270cc2414435fe8791218e | 2026-09-08 | Remove workspace mail delivery settings
d6ae8c4d5f442bae18e159f19a1758639869f69a | 2026-09-08 | Remove workspace mail delivery settings
522264c32960afd2133b4cbfad69e6d62af522f5 | 2026-09-08 | Show transient test email status
8bb79a5a028844772562cdd37381f9c41afa61b3 | 2026-09-08 | Allow removing metrics from saved digest
68a61c20dc0f1b808c2291d557e40c5201f1f94c | 2026-09-08 | Fix removing metrics from saved digest
bb36df586622732040e3828d2404c8a832047eba | 2026-09-08 | Clarify decision metric selection
95f588638c364c8b1c910e029c76ed3a3cce80e0 | 2026-09-08 | Exclude identifier columns from metric lists
fdfc2e67bfebabf5358d20aba4c264d79004241d | 2026-09-08 | Hide plan chooser for active trials
bd3daec3ad20582a03f89d38c5d1510cc2badc81 | 2026-09-08 | Fix dataset metadata errors masked as CORS
83adbce96621b2feaeaf13294dbfb9510257e3f1 | 2026-09-08 | Improve join metadata failure diagnostics
5a17618f591f914411542710d5d8c6824a53a7d7 | 2026-09-08 | Include join metadata error details in logs
19c5f3ad5e4abe83c1f9ccb6535d62713238a455 | 2026-09-08 | Include join metadata error details in logs
b2011ee1c470d4f01e2a570444104de937234e5d | 2026-09-08 | Harden dataset join metadata inference
9771d0bb1e85c440b692e8ca448c3e1c775dc312 | 2026-09-08 | Make saved relationships deletable
2ecbad58fb8dfdb03a7b05668dcb79c6f20235fd | 2026-09-08 | Brand agency client alert emails
55ac3d2adad45c67587422d11ee9f26a1f6f99da | 2026-09-08 | Use Decisionate branding for business alert emails
10af942baead9c96ceec15e51e1aa4159ce85e52 | 2026-09-08 | Use Decisionate branding for business alert emails
402f94f06296f1d1171d5af56b62b9c16328741a | 2026-09-08 | Add customer admin table and clarify landing positioning
43cfe1e822c26d615dedc538c3697ecda523d841 | 2026-09-08 | Restore landing copy and update logo tagline
221e0a0eb899675ad497c09b2c0585baa24a6afc | 2026-09-08 | Update landing page positioning
abeeb9ecd55bd38cc7b4f4e9a97510949e4e37fa | 2026-09-08 | Update landing page positioning
e1043c50d74422d8e65cff1935ce443aaaa3ba7d | 2026-09-08 | Update landing language to decision intelligence
6c643e2492e482b5e7ac35724f1377b5f1290b85 | 2026-09-08 | Update landing page positioning
6df7126c9706007a2039653f604d684ffe0db639 | 2026-09-08 | Update landing page positioning
479e014a437b18e5fcb5e7f04d67175f275bf2ed | 2026-09-08 | Slightly increase landing category text
f95f02c6de4804d804885e99b1061e768c8813c9 | 2026-09-08 | Increase landing category font size
ca30b6dd14190efa1d42d8b54ec0e9e5ccc7534d | 2026-09-08 | Fine tune landing category font size
99a265bb55c3b6f7b33acc5a3479158367acfc23 | 2026-09-08 | Fix mobile product demo header overlap
2826d51a2e8c8d833d1e033ad8cdc7664d9816fc | 2026-09-08 | Add platform maintenance notifications
924dccb6b0ff20467f55906a46c6f973646f0c4e | 2026-09-08 | Add platform maintenance notifications
07019ebb9438932ffce876216bf911ccdc0c8b90 | 2026-09-08 | Expand platform admin customer details
ad434e668ca877e80a3fdb33fa2cd477e0fa7954 | 2026-09-08 | Stretch platform admin recent activity card
fedff00702c05e1ac906468d826b48f9c542e273 | 2026-09-08 | Align platform admin activity cards
0d8ab5b02877ac4a6013d024f2c1fc67d27a4dc6 | 2026-09-08 | Match platform admin activity card heights
2ea9970f8310a0ea7492510807cc29052d83e81d | 2026-09-08 | Match platform admin activity card heights
80452b3e7ddf6631e3ed205ca6d9459e39a34f2d | 2026-09-08 | Optimize platform administration for production
4f783fb55c80661b14adf6815de2b651c5777a70 | 2026-09-08 | Document production platform code
0d98298e5d6f9839043e32fca3897b1dcf31e5f6 | 2026-09-08 | Add search to growing platform admin lists
a77ad9e0d54911a95350c638cebd373fa77dffbf | 2026-09-08 | Add independent usage card searches
b8df73b252c292edc5242fc5a96ede789752e551 | 2026-09-09 | Improve dashboard API response performance
2579789e9bba2e1e0f5e6afb3b1bdadffd6e71e7 | 2026-09-09 | Improve dashboard API response performance
90a7f6256c0f1b3256f4848a4f8c0f8b0be94a37 | 2026-09-10 | Clarify expired client workspace billing access
79a105fdc0c69abc6b313578c75b711f66de15f2 | 2026-09-10 | Clarify expired client workspace billing access
db20f6834ab1bb7f277111b8f4399cfcf94ad1a2 | 2026-09-10 | Use a consistent 30-day billing trial
e9dc92e9571df78c1a3d23bb0c8b3d5a3f2c1c0a | 2026-09-10 | Offer billing interval on subscription expiry
7726c063c8a1302c552af942490224db78ea96de | 2026-09-10 | Offer billing interval on subscription expiry
1ce64229fcd7048ff873e68571a4602843f8cc51 | 2026-09-10 | Clarify Stripe restricted key field
0e04784810f09c393df14f248845daf50dbd68eb | 2026-09-10 | Clarify Stripe restricted key field
837f20051d75b095a7c4d5ab22f166499911dff9 | 2026-09-12 | Support project-based Google Ads API access
905fad6f885c6f3f54d937d0ac88305c6505520e | 2026-09-12 | Fix Google Ads campaign metadata fields
99711a1b087625dd75c0dd974cb7e79a309503ec | 2026-09-12 | Keep sync action for connected sources
23fe5eb7dc30969ed42620be351a7fb7d0765467 | 2026-09-12 | Refresh connection configuration after saves
ec832584b7a922f673fb371055b4e7137bf060d4 | 2026-09-12 | Replace Nigeria with New Zealand in signup
3434131b342d83f0544700b5f927668c29526c12 | 2026-09-12 | Fix HubSpot OAuth token endpoint example
8ca3756352b5bfbf5d535bec3bf588179816337e | 2026-09-12 | Add Decisionate PNG logo
8f007249b098da866dcd9b9ad8e0d20b52d4db24 | 2026-09-12 | Increase workspace logo upload limit
ecbce3556adcb45f85d765f8ea2c99e52649ab24 | 2026-09-17 | Add decision workflows, AI credit pooling, and commerce connectors
f82e713fd8cc3589d7c0be679d8d53cac4b1e456 | 2026-09-17 | Update Decisionate logo with blue and teal accent
8e87c926b1fdec164fb79b1473721b4aaece3bb5 | 2026-09-18 | Add Google Business Profile and auto repair dashboard
1e8ead3de200e6976b7be4c873ef526fec4ff47a | 2026-09-18 | Fix auto repair dashboard selection
ace40264a917945a1f8eaee13e1cbea65ec16d50 | 2026-09-18 | Use uploaded Decisionate logo asset
4e3320cf061b6e8ae774950ddd836bb9047e8ea0 | 2026-09-19 | feat(connectors): add Lightspeed retail series support
c78d151e0e9782f01f08c9f7c0e96e018e06975f | 2026-09-19 | feat(connectors): add Lightspeed restaurant series
862b91e9aed5f8e1479a235befb002d673267838 | 2026-09-19 | chore(connectors): remove unsupported restaurant series
41bbd79bf69da0bcec686effc33ea82c628c8201 | 2026-09-19 | feat(connectors): clarify Search Console property matching
74e5fe58e6b12637ebf16141b12678f2b3fd8686 | 2026-09-19 | chore(connectors): mark Business Profile pending approval
d9a8c8921c268ef44fd9737cac5d613a49d9394b | 2026-09-19 | fix(connectors): show Square location settings
81a4664a400175faa702e4a88b6ae0545e5997ae | 2026-09-19 | fix(connectors): filter Square orders by closed state
8bcefce29c358cc784a47a3caaaf6df3794418f7 | 2026-09-20 | feat(datasets): persist unified entity matches
dc6aba441c7cb42039a626ebe61cb1b3afa78aa7 | 2026-09-20 | fix(dashboards): add decision action to industry analysis
614531c2bc2aa7bd8297fc256979a5e25fca1028 | 2026-09-20 | fix(web): prevent mixed content API requests
cd4ada188e169e8d48f8263dca0638cc93ca5dbc | 2026-09-20 | style(dashboards): match joined decision button
e71021f0bd6957ee1e53b743ed14d36ebdc79988 | 2026-09-20 | fix(web): normalize non-local API URLs to HTTPS
9d3fb2e4ec2eb089ea0468e8a2ac0979d1c4ee45 | 2026-09-20 | fix(web): avoid insecure decision redirect
03272c8ac78d7c90ae1be84e0436b9103782f3c8 | 2026-09-20 | feat(decisions): retain joined evidence metrics
b6e6e1b281360c7a72b040243d53910f5b2a5c99 | 2026-09-20 | fix(decisions): avoid arbitrary joined metric focus
3d1976e20cd2381f292af03c7e1ed73bef1df9fd | 2026-09-20 | feat(decisions): move joined metrics into selector
d06d109c491f17efd447cb10ea6ce7ba51f9e806 | 2026-09-20 | feat(decisions): generate joined evidence titles
f7cd9bebb559f8a2aea905ac1cf10024dc74a6bf | 2026-09-20 | fix(decisions): expose title editing and joined sources
bd4a38c9054ef84d189f0c8444a2ba217941ef85 | 2026-09-20 | feat(decisions): add cancel details action
af3fac02f6aab66721b727e0069d0173a172504b | 2026-09-20 | fix(decisions): align detail actions
2d24e5d925b0bc463d64af01fb35e8e1bce2d11b | 2026-09-20 | fix(decisions): avoid joined detail request timeout
8dd9a42fbfca885bae070ef49659903d2dadf48e | 2026-09-20 | feat(datasets): persist joined datasets for selection
e3e5614324301839b7b201bed4b512cc80613685 | 2026-09-20 | feat(entity-matching): allow per-dataset identity columns
e899233efb8e78a4ce2eca32a000236a56bffd8d | 2026-09-20 | fix(dashboard): smooth dataset switching
578d9644e263ec6740c75d3418929b6262cd1ffd | 2026-09-20 | fix(join): stabilize dataset joins and charts
097a5488dacb1dfbe994bec1b0319a1ccf16082a | 2026-09-20 | fix(datasets): handle join source filters
ce51bc64f60265a8254232ebc726895f0ae70938 | 2026-09-20 | fix(join): serialize cached result timestamps
51af4a74d94b12421c5269ee6674a2dbf8ca6f0d | 2026-09-20 | feat(datasets): select metrics for joins and matching
b35c325c92f7d974101a767a59702ea07a2e42a2 | 2026-09-20 | fix(auth): refresh rejected session tokens
b7d030ea6f165318c37807341b67f316452971fd | 2026-09-20 | fix(dashboard): preserve joined evidence actions
2e54eb254b98938dee1ef78e18ba015bfa3553ff | 2026-09-20 | fix(join): share identical datasets across dashboards
3e80ddeb9aa288d1851b205913e8e5dfe398c235 | 2026-09-20 | fix(datasets): remove stale derived datasets after deletion
0520c8068335ac6aeb1be8d1b258eea690a33701 | 2026-09-20 | feat(web): add English and French language switch
e14ef1f246b24274b123de69d5bd1df9f0e7fee9 | 2026-09-21 | feat(web): localize public landing page
81cd49b9f0d45b5e4c25f71839fe394ca2d89973 | 2026-09-21 | feat(web): expand English and French translations
ff9e56003ae9318b2c554aee2727c67c1463b3c8 | 2026-09-21 | feat(web): add theme switcher to dashboard
6f6f23dfc52e8eda5b6be3f7183c385d47d350ae | 2026-09-21 | fix(web): position theme switcher beside language control
33ba3e894d128bfeafa77dd710634009fd8e69c9 | 2026-09-21 | feat(connectors): add Lightspeed X-Series domain prefix setup
dad90d6300e6f334be0df85fc97ca933a60d1dba | 2026-09-21 | fix(connectors): default Lightspeed X-Series to sales
be9ac03a43a5f4634b3385eca47700245cb712b1 | 2026-09-21 | fix(connectors): show Lightspeed X settings by default
1d28a22d669051a32332f73c4b7ddb4710af4037 | 2026-09-21 | fix(connectors): keep Lightspeed settings visible
14825e49a5ccf213eb82b2ab7cfefa8cc76c166d | 2026-09-21 | fix(lightspeed): handle incomplete X-Series config
2dbbd9345ccca0242f7fcbfb456ad473e1e3f668 | 2026-09-21 | fix(metrics): exclude identifier-like columns by default
a409f645c9f547967b9d03d8bda6087fc617b509 | 2026-09-21 | fix(connectors): gate object selection on OAuth
36f546af780e366259f7a228f5d4fbfc48fc9d9e | 2026-09-21 | fix(connectors): toggle settings and object selection
f47e82d0b17aa0493ae42fd27b5f05125a293f22 | 2026-09-21 | fix(connectors): complete oauth settings cards
c1212fb46598b9feeb49b30b48def8774cd2b7d6 | 2026-09-21 | fix(connectors): gate oauth on saved resource types
4588b89f5405c6fc18cf0a820e741ae9f3482bd6 | 2026-09-21 | fix(connectors): separate resource selection card
8bb1d7f1f6a7268e2f3c6e94fc48921df99730e6 | 2026-09-21 | fix(connectors): match resource settings form
89d97a352dde3e56cdd87e27363d85abc3e352cb | 2026-09-21 | fix(connectors): restore separate resource selection
8fbd8a5c4a7b9e2a5a838334b126c192907dee15 | 2026-09-21 | fix(connectors): show provider account settings
24d7409d37618fd7d5fc0563137d944ad1d420a4 | 2026-09-21 | fix(connectors): defer oauth account selection until authorization
95ef31c5af67739573dc75fe6f2df10413a0138e | 2026-09-21 | fix(connectors): hide empty oauth settings card
3450fd46ee5c581d73e6eb2d3be2d097b4a12ed5 | 2026-09-21 | fix(connectors): keep resource selector visible
8f4a6315f447002eaec53a781ee28ef7f4de1749 | 2026-09-21 | fix(connectors): toggle settings and resource cards
8694f0443f569720b35db4f35b3b39cdc6a81804 | 2026-09-22 | Fix delayed Search Console ingestion
afeb8a4c9f8b08b90241bea72973208027bc596f | 2026-09-22 | Include recent Search Console data
8e88d23421d5eef91d31a7a72be57b1b2b0c2259 | 2026-09-22 | Handle empty detailed Search Console results
7aa2b7824482cd2fdce0e0f73539b5a38dc93e07 | 2026-09-22 | Limit initial connector sync to 30 days
f1318f3867ea00dd69c48588cd3c6611c1b3ed12 | 2026-09-22 | Retry incomplete Search Console backfills
b61cccab0af4e947c613f6433d8f10e40ace242a | 2026-09-22 | Fix incomplete Search Console daily metrics
577cd5de1f7340758369489d79335e2ade80e9c6 | 2026-09-22 | Use property-level Search Console aggregates
707c1604118a40f8b59c3413ad9b52040ba20d2a | 2026-09-22 | Recover finalized Search Console metrics
dc3fc90d012813a0efb1ba7622f666a110c92257 | 2026-09-22 | Retry Search Console before data boundary
64910e5701847ab23c85c17402f70e54f42618df | 2026-09-22 | Fix Search Console daily metric persistence
bd9ef9fade426a9293e859cb8d8459a2083fbb4d | 2026-09-22 | Validate Search Console property data
69689281f669084b89daa702d1379059b294ce72 | 2026-09-22 | Fallback Search Console URL prefix to domain property
7a8e13f4d987e5b1191b75d79f2a2be6123ee123 | 2026-09-22 | Paginate Google Analytics reports
e4ea621126f875b7f360ac6736f7794ef7b5a7ce | 2026-09-22 | Include updated HubSpot records in syncs
6836d062555843054eee94d9b15b8854db47ab5f | 2026-09-22 | Refresh Shopify orders by update time
9a0f226f5c2abcb6e065d7cd050b4d68b6153049 | 2026-09-22 | Refresh WooCommerce orders by modified time
4f2ad714431ebfae7fe40cb335a1bac56c2978b7 | 2026-09-22 | Refresh FreshBooks records by updated date
830e168a03540c9b58ba43566a70a98838633a31 | 2026-09-22 | Use Zoho Books modification windows
c9a3691b204c38ff7ceaecfec9dbcd01a0e3cbaa | 2026-09-22 | Use QuickBooks modification windows
b8c269c9ed0cc39c75b3fa2da2d815e291b1d211 | 2026-09-22 | Use Sage change-time windows
201752ef3ed496fd7e63391be1e016e53565c3f5 | 2026-09-22 | Keep WooCommerce orders changed in window
c63c9371a1a00001994ddc4739dc62db155b51c1 | 2026-09-22 | Filter database rows by change time
512ec9105c00707552496a0df8b1d77a2f20a450 | 2026-09-22 | Avoid duplicating data on empty syncs
fe8091acb0da9254fee41c3f91db1f2310fb5841 | 2026-09-22 | Reconcile Search Console daily rows
71debc23f7f8bacca38c36a9740fa62ba23d96d4 | 2026-09-22 | Reject non-authoritative connector rows
5b662eafa634c8c270612ee8379a8ebc9c3d84d5 | 2026-09-22 | Clean legacy connector placeholders
6f3c5fc16d02de9a8ddd94c08abd41fe4645afc8 | 2026-09-22 | Make connector-only scheduler runs reliable
0514ae74bcff54c16e6dcc38e7a841bcf668fd52 | 2026-09-22 | Remove obsolete Sage subscription key requirement
ce7d529af6e71f48ded8eef920360ba413ee3dce | 2026-09-23 | Handle Shopify protected customer data authorization
2f3a35c0a6956ab1af89e4be37c29e31068e8043 | 2026-09-23 | Harden Square production OAuth flow
97831296349a114b3cf660eb2b43821c670c165e | 2026-09-24 | Fix Sage Accounting OAuth authorization URL
fc1e9b058b7dac1921c07751dc26097fc85ae498 | 2026-09-24 | Fix Sage regional OAuth token exchange
447a953d182c3b449e9dcd15612507a4040cbb9a | 2026-09-24 | Require Sage OAuth region selection
f78d02d46cc5b212d34be0684d8e53850d223b28 | 2026-09-24 | Persist Sage region before OAuth
7337c8c83abe813d783a8f49ffd9f121006ac689 | 2026-09-24 | Allow Sage OAuth before resource selection
7be3caf9a3a49f52408b573128132588b654255a | 2026-09-24 | Use central Sage Accounting OAuth endpoint
1148d7cf33b2fefe2c9191c5948dccaab8cfdd61 | 2026-09-24 | Use compatible Sage OAuth client signature
c23215de101510951885ad6abc985f5724a75cef | 2026-09-24 | Use browser fingerprint for Sage OAuth
8c1c7d322c0952b417fd1fcd87c412b857e7bfab | 2026-09-24 | Use regional Sage OAuth token endpoints
47a69650407789e59bad95aead9284c78b0f9060 | 2026-09-24 | Fallback Sage OAuth token exchange after regional block
c8ef4d7664d71be5361d29c43a31d108ef89db6b | 2026-09-24 | Retry Sage OAuth after regional 403
d15eb9004d5794d76b3e7d1490f03fcdcad86b06 | 2026-09-24 | Always retry Sage central OAuth endpoint
cf3c9f088e30333ff0e34c3828d183d63d81dacd | 2026-09-24 | Persist current Sage OAuth failures
dd05bb21cd04a627bfbb2a73ede76ff9afdcb7df | 2026-09-24 | Remove redundant Sage configure action
05271d247aa9c5bcf6926ce81478de318d61be7f | 2026-09-24 | Tighten dataset preview rows
58c9251c44935bf2c306a813b497a9e78302f5cd | 2026-09-24 | Keep connector preview rows compact
e6e5fd44bbb46e9808752dca7cfad2b07de4bc2c | 2026-09-24 | Fix connector ingestion and Sage business selection
d0e9ead019ad77977e4377013b2c01b02498dd93 | 2026-09-24 | Require Sage reauthorization for business changes
157ca1749aa5d9f0059a9fb34dcb4396de22db76 | 2026-09-24 | Align Sage business selection with OAuth
7433572d8e1fbf5a30f1c3dd87ff5a9d8e8830b2 | 2026-09-24 | Revert recent Sage business changes
e167b647690251aee68d663b7a8013308921e53c | 2026-09-24 | Remove Sage manual business selection
cea791017bdbdbc5e280490c8372f482e93d1f35 | 2026-09-24 | Add Sage multi-business OAuth selection
74896de3457330bcc83527e2867dca90932fe3f2 | 2026-09-24 | Make Sage business discovery automatic
b365061e806e33d6b7cab24d85e886aa78b1a80a | 2026-09-24 | Fix Sage business discovery and refresh
cf375758dd87f3f4109390abaefd8e0b664e952f | 2026-09-24 | Force fresh Sage authorization by region
c1b2d57b011c6099cb3c777ab36e96887e95b40c | 2026-09-24 | Use Sage v3.1 flow for regional business selection
5bb579ce9bbeb69e8d865387511e34c54ccddd6e | 2026-09-24 | Fix Sage business discovery and token recovery
6f323da4e46f76c090dec2c5bf8f6df7337f6975 | 2026-09-24 | Retry Sage business discovery after upstream 5xx
7cbe299d1d91df9919c010553b4431f08030ee39 | 2026-09-24 | Expose Sage sync state during business refresh
0680e5c6ee7651ac5c432ce6aa3c3453c85df39a | 2026-09-24 | Clarify Sage authorization refresh failures
803e9bc9f4cf046560d20ed65904ac163406234b | 2026-09-24 | Use supported Sage Accounting OAuth scopes
780ca7483a0a69cc880436bb4f9f244520b4e785 | 2026-09-24 | Fix Sage business selection refresh flow
03de0d86cd3bf48a6a39caee82d4b333344a8e29 | 2026-09-24 | Handle transient Sage data request errors
0c26ee1d7ba9283018070d52f7e0265b983b8a17 | 2026-09-24 | Make Sage sync resilient to provider query failures
872a82edf13af4ed48d91ac58502261495e8966b | 2026-09-24 | Harden Sage data requests and diagnostics
ffda421f6ecb120dc12dfc1d05cfe45e7f23110e | 2026-09-24 | Harden connector Parquet writes
b0d93669425557620c6b7ed890e21fe48bac0861 | 2026-09-24 | Expose connector storage failures
4098e1f4a621168aff86a9950f2d17ff5ffa7a3d | 2026-09-24 | Normalize connector partition months
de427a605c00d6705d8c13aaf3660e4dccfd8843 | 2026-09-24 | Require explicit Sage business selection
51f20394d1e4aac34dd8d340cd919ee0cf3b44bb | 2026-09-24 | Align Sage business account refresh action
eba7ba12f55dae66c76ffb26b25bfab2c23661d5 | 2026-09-24 | Ingest full Sage invoice and contact attributes
10254f915036dc6644a1c8da945d092ea359398e | 2026-09-24 | Remove Sage transport metadata from records
7883c7a0e7d28bd2688869d24b44c62bc98fc45d | 2026-09-24 | Return actionable connector sync failures
8a68022eeac6f24c92e0a59b83f324f64fb01cbe | 2026-09-24 | Normalize connector values before deduplication
92f28da77b37e6777e0e66608a606a0e272ee066 | 2026-09-24 | Clean and deduplicate Sage dataset rows
24da60c46a80046a4a38bbe4fdc7833e1b000f1c | 2026-09-24 | Remove Sage href metadata
0dc05002efb5d3620f34c2704d49ba0fc041b55c | 2026-09-24 | Deduplicate Sage object rows
8179d7c5aa0050105652ff75d649e69d65d6eecd | 2026-09-24 | Surface scheduled connector failures
893982ba9752bb35d513bb838691b06f1cfdeff0 | 2026-09-26 | Auto-select a single Sage business
828c9dbd59aeae807995a704ddd0340244a5c8bd | 2026-09-26 | Keep expired OAuth from failing connector scheduler
4313405d1c7467383afde13409367d39dd52413d | 2026-09-26 | Refresh expired OAuth tokens before reauthorization
f4bb240f700fea7e163694b65a252c158d434b24 | 2026-09-27 | Stabilize connector account selection and test suite
7dee09b688849e09948243b6363aee8d4440a1f7 | 2026-09-27 | Persist connector configuration before OAuth
9458481ac990eb65b785b209ddd89bb8b89a1ad8 | 2026-09-27 | Fix Lightspeed R-Series edge authorization failures
f576fd2bd3bc2fa0cae6531c081ec3df69c7e6e1 | 2026-09-27 | Use browser transport for Lightspeed token refresh
e0698de56672df27e21e9b20eef76e7a564364e3 | 2026-09-27 | Serialize Lightspeed token refreshes
cc656ea5145aa0f0a38a9b6bc550c73509884e40 | 2026-09-27 | Prevent Lightspeed refresh rate limiting
fb42b9d89b77b95c1d4dad52f06cd98b85463736 | 2026-09-27 | Revert "Prevent Lightspeed refresh rate limiting"
72133fb3709c478c0ac38afe468744f98b407ef7 | 2026-09-27 | Use cursor pagination for Lightspeed R-Series
9199a672867127f9747afef3f1d91e4c0a31e7c0 | 2026-09-27 | Deduplicate Lightspeed sales during ingestion
f10f95d1da0788499f35a3f349124d9d063a0fed | 2026-09-27 | Filter incomplete Lightspeed sales and preserve timestamps
e2b9e09c90c55e8df7f0e9bd2c04172ff73ea5db | 2026-09-27 | Clean incomplete Lightspeed rows on sync
6eeea88a1e5e086f3409e7d66515836ee4335620 | 2026-09-27 | Store Lightspeed sale items as rows
0711d853e361ab1eefb08e7dee772e46205ca8d3 | 2026-09-27 | Expand Lightspeed X-Series sales by line item
dc91487c4f904e711101e8bc512690b5e1e9b706 | 2026-09-27 | Normalize connector line items as rows
1b3525f20aa3f20e8f18d46661dc82c9c8cfa715 | 2026-09-27 | Restore Sage multi-business selection
90b617d288fb693224887e177eb6b8d374250fb7 | 2026-09-27 | Avoid repeating Lightspeed transaction metrics
f096b7f5c5b759ab112565ac7addf67360e5fda8 | 2026-09-27 | Deduplicate transaction metrics across item rows
894bdda121021f5e5f5c46709f96ef513e991c9c | 2026-09-27 | Add bounded advanced connector sync dates
607923df3dfd54a51c5e3e599ca68992714b9363 | 2026-09-27 | Improve connector sync lifecycle and recovery
2245787d0f4e4cab23a3ac417ee01d958329652f | 2026-09-27 | Polish connector recovery controls
b806aa66041f740e8c206b4add4f99e8df979dad | 2026-09-27 | Prepare staging connector deployment
f4be5308fa308ed2ecf5e91c098a71fff9cd8640 | 2026-09-28 | Limit Shopify sync history to standard window
aa7b86a21206bbb5f260a10d7466f463ace18389 | 2026-09-28 | Keep Lightspeed restaurant connectors planned
a407cad8a195f4de29e340db845872647fb03fbb | 2026-09-28 | Set AI credit pack price to ten dollars
3788c73778eb551e2dddb6d3448f9fb898811b91 | 2026-09-28 | Price recurring AI packs below top-ups
2788c0843911a8ac3536da862d55fccde6606677 | 2026-09-28 | Persist one-time AI top-up credits
9344cca6cf7c87ebbf9081acbddd554e2d1c88a9 | 2026-09-28 | Manage billing pricing from platform admin
4159460b6b591c735540ab260d82257685194665 | 2026-09-28 | Label admin account types and share agency AI credits
506733c03fe8f0f5eb40e79fe31adb37b2eba066 | 2026-09-28 | Show account names in platform admin users
e4f561777cc1c0550c61855504651d0db3e5d92e | 2026-09-28 | Bound platform admin refresh history requests
7240cfe0ad7878877f58f9964671b9d63b05ae91 | 2026-09-28 | Fix agency client invite authorization
dcb17a1a622151804ab0b0fd138dcf991b2c94fd | 2026-10-01 | Fix maintenance status CORS polling
06d8d9daf4ae41b867e86e0fb2916e9d95dc2dfe | 2026-10-01 | Add intelligent metric selection pipeline
7a696a35b9004df3ae2782669fc124d70c167106 | 2026-10-02 | Make data ingestion asynchronous
c7c10fe84b7271e853770ad33821ef6fc2cf2ccd | 2026-10-02 | Limit default dataset metrics
06370a53c8031e0933d64ef91066f8083106760c | 2026-10-02 | Select fallback dataset metrics
44d8b5743df63953d23a78e3f30fbf68d42d766b | 2026-10-02 | Allow explicit selection of any dataset columns
71509693638ddef564f0d74fa22e780c67f65f14 | 2026-10-02 | Prioritize quantity and line item metrics
0661a76010c390961218eb547532bcf320b6ea5c | 2026-10-02 | Recognize unit quantity metric aliases
a60a12e04cfb4d90fb18ea9b42a6da53e0246cfe | 2026-10-03 | Show account control on mobile dashboard
361ec1e1451ff917da64b8bc318c5d42edebf739 | 2026-10-03 | Keep mobile account controls visible
08d7199ea4409f251a7191212dbff55f3aee1877 | 2026-10-03 | Keep mobile account footer above browser bars
32f932863415edf3dcb6d405386bff7d0711087e | 2026-10-03 | Harden dataset metric selection updates
32f983b9a8de8f3a7be660d5d68d7134fcaf803e | 2026-10-03 | Support metric detection for single-row datasets
c11318bc8c609a91d6cec9b612b9d431890ff6fb | 2026-10-03 | Recognize semantic amount metrics in one-row data
8b5e8e10cd13add1b2d5ea176924036023327e47 | 2026-10-03 | Broaden default metric selection for small datasets
51eec09fdd89c9f0c647925a39359515965f047c | 2026-10-03 | Select all recommended metrics for business objectives
271713955e18fac3aa02250c8eb3b20ad607a146 | 2026-10-03 | Prevent dataset requests from racing Clerk auth
e56018e0be45a4c5a19428efd30b65e86e9c7461 | 2026-10-03 | Select recommended dataset metrics by default
3df574b1fa5d6aed8a8c4475af487ff4774b20ae | 2026-10-04 | Make connector initial sync asynchronous
6f02939819966e55e630d8a171715afb2095bd78 | 2026-10-04 | Add explicit agency client roles
5c2c66a898346940e950eb8f5c7ee854164692c4 | 2026-10-04 | Improve application performance
619cb9882c8930287ca58f152f66988f50d8bd27 | 2026-10-04 | Include analysis model in deployment
87a80ea16873e2d8f3f23982611557fe61cbec3f | 2026-10-04 | Fix Meta Ads OAuth permission grants
460b709bebbf6df42c4c49f84f63fbd841bde37d | 2026-10-04 | Implement customer-facing Meta Ads OAuth account discovery
39bf9ebb39e0dee5e0260a12fc8b2fb00414d787 | 2026-10-04 | Fix Meta Ads account selector visibility
4ff21784274192d8a9f0a5e5628cc126bba5686f | 2026-10-04 | Allow Meta Ads OAuth reconnection
a29c08b78cc93bc02e11c008c552e0b1c87d47a4 | 2026-10-04 | Show connector no-data outcomes
f903b0d2ac60ab1be989248847b1a0e0de0ab1f6 | 2026-10-04 | Fix Meta account selection sync state
cd09ceb52627f71e8fc4db86b761b6d1b8257da5 | 2026-10-04 | Recover orphaned OAuth imports
32c6bf111ac4f8717b4c58a68e257b414ecccbe6 | 2026-10-04 | Expose verified Sage Accounting regions
2a7c50b86e57d48ba6f95bf7bf5c7ca9cc6940f7 | 2026-10-05 | Clarify connector data retention policy
7613757ec555587499cd01c34ef947617416b33d | 2026-10-05 | Restore Meta Ads sync action after OAuth
a4cba919bedcef8ce5c3ecdaac8da0e77dccac08 | 2026-10-05 | Align advanced sync visibility with sync action
10bd9e32cb8916d0a28f886f2e0f6b9057d31fa5 | 2026-10-05 | Harden dataset row JSON serialization
75bd7f017462e07f67542444b4ff358c96db8e6c | 2026-10-05 | Prevent unbounded dataset detail failures
7df2c6c97ef21e7df79e97e2c5163c35e9af9a8f | 2026-10-05 | Handle list-valued dataset dimensions
291947a7355fab04f787a7122f2b9fba8f4e9472 | 2026-10-05 | Skip analysis lookup when dataset AI analysis is disabled
bbc1961087fffc1936a9b3949ec2328cf2001e94 | 2026-10-05 | Normalize duplicate dataset detail columns
d189881822bbfacffc15637e949b7fdc8a7e96ab | 2026-10-05 | Map dataset read failures to service errors
6b614a189a06a27debe61d4af2cdd11a8dfebaa5 | 2026-10-05 | Guard dataset details response failures
f8c8e6e3584a0556af1c5988e149b74ed8c4ac6f | 2026-10-07 | Resolve legacy dataset keys through remote storage
79058b5e8a489feb97e1c8655789462f0cc5c03c | 2026-10-07 | Keep dataset details available across legacy data
8de74287e810d2ce21c42809e00919e7b053323f | 2026-10-07 | Make dataset anomaly requests resilient
0a91ae14509e48ba3360a01ea64bd053e08a1e1c | 2026-10-08 | Streamline decision creation actions and permissions
88a45d39a580255e60ef126904150ab47ecb6e9d | 2026-10-08 | Harden core production workflows and improve workspace UX
2e7d451e1a703a7f1769ef08afe7a689535e5aee | 2026-10-08 | Refresh landing page and record real product walkthrough
948bb7d3e1474b5050d404bfd9ef6dbd9897216d | 2026-10-08 | Refresh public policies, logo branding, and live demo performance
ef8805dd3c0f6c7797b0a914c4000e3d193ff3c3 | 2026-10-08 | Clarify AI and billing and improve mobile layouts and demo transitions
7dd8b74d7fd3414fd7d345f4ea2aa2115d9e39cb | 2026-10-08 | Bring landing walkthrough into first viewport and align brand styling
8de4c99062ef3faf84c8a0f4f85b28fdbe05baa8 | 2026-10-08 | Align landing hero copy left and walkthrough video right
0cf239718c364e29290c061c273a12f91beb3ab1 | 2026-10-08 | Refine landing hero alignment and turquoise icon styling
6afe806f530410754725225181b55ebf89136736 | 2026-10-09 | Simplify landing video controls and restore previous icons
ca35b0d8631ac459b93574094bb9619d3cf3f578 | 2026-10-09 | Update landing hero insights wording
49f58d58881f4c7ebfd2d069eeb88d8b05c77e5e | 2026-10-10 | Fix scheduler queue handling and complete auth and billing workflows
b0514007f81516d8420f445214521b8a4e217576 | 2026-10-10 | Close connector date-range panel on dismissal and sync
0a3f601005c4be79629ac8aa9e2dd7c246d7add5 | 2026-10-10 | Clarify landing-page benefits in English and French
d7f816c3f31f1d3168087955fc6e64ffdd5658e8 | 2026-10-10 | Include agency identity in client alerts and notifications
8484223c80b6dea03bd9f748a8b6cb7fd5a35f1c | 2026-10-10 | Align landing actions with the demo video bottom
2da1040c8f14931af8b6c95895d3a073bbcaa4b1 | 2026-10-10 | Add landing automation benefits and correct preview alignment
9fd270923ea3278b6881843768698d0774abb1f4 | 2026-10-10 | Fix landing hero alignment and consistent paragraph spacing
d1b2e2324ff854a517ee638c6f8594e23a463998 | 2026-10-10 | Refine landing hero hierarchy and align action row with video
4062fe6334638e3033335c8d3a87fd0fd649050d | 2026-10-10 | Align landing hero edges and restore trial note below buttons
ef97d3ebc66a47733d58138598f79a18fa2439ea | 2026-10-10 | Use shared grid edge for landing buttons and video
4dfb0e74b8b3acb8f0aff1a0b6e3c740b95a59a2 | 2026-10-10 | Remove landing hero credit-card note and retain video alignment
84ae6f2cc7d5336bb0462ce20f2fd209f59cfd00 | 2026-10-10 | Align landing buttons with chapter rule and restore trial note
8e9a72401a43f0507db05e3b9ae66620f1d38645 | 2026-10-10 | Keep mobile hero benefits with the introduction
33513bc035ee08b98d41226dbde9f4df79f666d0 | 2026-10-10 | Guard mobile browser APIs in walkthrough and dataset previews
0a7ec58b6670816cc8b70e86733fee4860368829 | 2026-10-10 | Add independent recovery for page and shared startup errors
2dc6ec7517c05090e5e3b59a1101e9e30ac0f2e0 | 2026-10-10 | Simplify mobile resize handling and error recovery copy
94e070e5c85095e8f06ab80eb3459ab8636edc49 | 2026-10-12 | Refresh landing hero, demo presentation and mobile navigation
a8746a0f94e2b670c440401bcf603e43184502e1 | 2026-10-12 | Expand business and agency sections with consistent backgrounds
5395ee399714082844b7de3ff6feeea1d73d9793 | 2026-10-12 | Fix renewal test helper blocking web release checks
beba0482104b53ceea213caf32d50fa6c16fd06d | 2026-10-12 | Clarify client data ownership in agency landing workflow
fde6af943834f1fe93c3b438b3919d8e370aa49f | 2026-10-12 | Add consent-based customer email marketing and admin sender settings
a4b5376bcbc284f27cde86e58dadfd355571ff52 | 2026-10-12 | Support optional Resend segments and future mapping updates
287531051ffe01cca1068ece3466699d6ac7b6d7 | 2026-10-12 | Fix verified email lookup for marketing preferences
9373656f89d658dcd5fafb53988acd0be5759263 | 2026-10-12 | Identify Clerk lookup requests and log safe failure details
a5cd121d6e06bbc91f083f20b7e50809183fb4da | 2026-10-12 | Identify Resend marketing requests to avoid client rejection
eb2711547addba6e90a5af777bab0e9857198e10 | 2026-10-12 | Wait safely for worker queue ownership during deployment handover
908105c5efdf8c7ed7b4739a59ae9e74684d2a69 | 2026-10-12 | Add safe internal delivery tests for paid accounts
d0233460e815fef0067ef43a89ff20bed5890a27 | 2026-10-12 | Fix internal marketing test sync workflow and queue priority
e1f7540176d78d7196ca6c811e153690a26937d3 | 2026-10-12 | Fix recipient email branding and platform admin table layouts
4ba6c90bb5ac3a9633c1136bb9e05b39ef91df3c | 2026-10-15 | Add gated curated metric defaults and policy-aware aggregation
50b8907c43c2675acec5924f9a08c59e2c895b01 | 2026-10-15 | Characterize existing correlation and document preservation contract
771003b3fe2beab3ec8e29f964e3c37d102b01c1 | 2026-10-15 | Add gated asynchronous multi-dataset correlation engine and queue
c293cbff2b1b6d35613e8f6eda6e42ce160c7849 | 2026-10-15 | Add relationship explorer, evidence views and dashboard widgets
556528d78285c47303345deaa7f507b97748c223 | 2026-10-15 | Recover interrupted metric saves without losing customer selections
b3a110ce0c02f8db0936d4117b47af7cfb23d9e0 | 2026-10-15 | Fix duplicate-column metric saves and prepare responses before commit
2c4b57a9a2d556f3cd0241b64e45528ee1dc6ca2 | 2026-10-15 | Fix empty numeric metric profiling across all connectors
f599efac2515e02297b942fbb7d98bf4fc9ad3a4 | 2026-10-15 | Reset metric defaults when business objectives change
676a9a5adf4d3c7063a7ef857313d5ce182b935c | 2026-10-15 | Normalize connector transaction items into stable vertical rows
9e0110979d8402bdc44120e6773d25851b4c6934 | 2026-10-16 | Restrict financial metric defaults to receipt and invoice fields
8a2919de0b800484ce9cc048e0546d37e9fd2615 | 2026-10-16 | Apply receipt defaults to legacy selections and honor effective UI state
e92db7361901cfbaf5c3d3015213c95c2801c078 | 2026-10-16 | Refresh metric selections when business objectives change
9a960ca7be1f2316bbe222d977621c9f684f621e | 2026-10-16 | Audit receipt metric defaults against provider documentation
dfb516bbc866a334fb54658ec01b3e6adacaef7f | 2026-10-16 | Restore documented receipt amounts for Lightspeed X Zoho and Sage
050da408db530896b18fb2ee99483f4dca2e507e | 2026-10-17 | Apply shared receipt safeguards across connector adapters
41a993eae3ae3c3bdf0e74a4e7ecbac60283fe57 | 2026-10-17 | Fix Lightspeed X currency and receipt metric defaults
e8f3bbebe1ca041075c3f1f7c113ffb5ce99a317 | 2026-10-17 | Set Salesforce sales performance metric defaults
d19b150079c7c27af7cd9de867c6e752cf8cb033 | 2026-10-17 | Make Salesforce opportunity quantity optional
8d3f29c770e299c947023148aedd292801de091d | 2026-10-17 | Restore TotalOpportunityQuantity in Salesforce defaults
b2bcf41c9b40aa43fdc431671811bc571732ba64 | 2026-10-18 | Make cross-dataset reports the business review workflow
21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4 | 2026-10-18 | Centralize decision creation in the Decisions workspace
~~~
