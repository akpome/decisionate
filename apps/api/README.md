# Decisionate API

FastAPI backend for Decisionate.

## Local Setup

Copy the example environment file and adjust values if needed:

```bash
cp .env.example .env
```

Install the base API dependencies:

```bash
.venv/bin/python -m pip install -r requirements.lock
```

From the repository root, use an explicit app directory so reload mode can
watch the whole `apps` tree without breaking Python imports:

```bash
apps/api/.venv/bin/python -m uvicorn app.main:app \
  --app-dir apps/api --reload --reload-dir apps \
  --port 8000 --env-file apps/api/.env
```

Alternatively, run the API from `apps/api` with the local virtual environment:

```bash
.venv/bin/python -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

The web app defaults to `http://localhost:8000`. Set `NEXT_PUBLIC_API_URL` in
`apps/web/.env.local` when the API runs on another host or port.

For provider-neutral deployment and migration, use the portable container and
configuration runbook in `docs/provider-migration.md`. The API container is
`apps/api/Dockerfile`; the web container is `apps/web/Dockerfile`.

## Tests

Run the API unit tests from `apps/api`:

```bash
.venv/bin/python -m unittest discover -s tests
```

## Environment

`DATABASE_URL` controls the SQLAlchemy database connection. The local default is
`sqlite:///./decisionate.db`. Railway's `postgres://` and `postgresql://` URLs
are normalized to the portable `psycopg` SQLAlchemy driver automatically.

Before switching a deployment, run the migration preflight from `apps/api`:

```bash
.venv/bin/python scripts/prepare_postgresql_migration.py \
  --source sqlite:///./decisionate.db \
  --report postgres-migration-report.json
```

This creates a SQLite backup, checks database integrity, foreign keys, required
columns, unique values, and required-field nulls. It exits non-zero when the
copy is unsafe. After the report is clean, copy into a PostgreSQL database with
the explicit `--migrate-to` option. The target must contain no application
rows; an empty schema created by the API is okay. The script preserves integer
IDs and resets PostgreSQL sequences.

`OBJECT_STORAGE_PROVIDER=local` keeps development data on the local filesystem.
For durable deployments, use `r2`, `s3`, `gcs`, or `azure` and configure the
matching `OBJECT_STORAGE_*` settings. New references use `r2://` for R2,
`s3://` for AWS/S3-compatible storage, `gs://` for GCS, and `azure://` for
Azure. Dataset routes and analytics code are provider-neutral. The resolver
selects the client from each stored URI, so references from an old and new
provider can coexist during a migration. Older R2 references written as
`s3://` are supported as legacy R2 references when `R2_*` variables and
`OBJECT_STORAGE_LEGACY_S3_PROVIDER=r2` are configured. Use
`scripts/migrate_object_storage.py` to copy existing objects and update
database references before changing providers.

For remote storage, new dataset rows store a provider-neutral object key in
`datasets.file_path` and the provider in `datasets.storage_provider`. Legacy
rows containing a full `r2://`, `gs://`, or `azure://` reference remain readable
and are resolved without a data rewrite. `DATASET_UPLOAD_DIR` controls local
staging files; it is not the source of truth when object storage is enabled.

`CORS_ALLOWED_ORIGINS` is a comma-separated list of web origins that can call the API. Include the deployed web app origin so public shared dashboard links can load data in the browser.

`GET /health` reports API, analytics, AI, alert, billing, connector, and
security-configuration readiness. It does not expose credentials or scheduler
secrets. In `APP_ENV=production`, the API fails closed at startup when verified
auth configuration, secret encryption, Sentry, PostgreSQL, remote object
storage, or HTTPS deployment URLs are missing.

The release readiness command includes the same checks:

```bash
.venv/bin/python scripts/check_mvp_readiness.py --strict
```

Run `docs/backup-restore-verification.md` after every provider restore drill.
The application can verify an isolated restored database, but provider
snapshot creation and object-storage restoration remain deployment operations.

`CLERK_JWKS_URL`, `CLERK_JWT_AUDIENCE`, and `CLERK_JWT_ISSUER` enable Clerk JWT verification for protected product routes. If `CLERK_JWKS_URL` is not set, local development can use the existing header-based auth flow. For identity linking and invitation claiming, configure the issuer to include a signed `email` and boolean `email_verified: true` only for verified addresses. A token without those claims can authenticate by subject but cannot claim email invitations or link accounts by email. Browser-supplied `X-User-Email` is never trusted for those operations.

## AI Analysis And Forecasting

AI-assisted analysis is optional for the core launch. Leave `AI_PROVIDER` blank
until integration is ready; deterministic analytics remain available and are
labelled as fallback output. To enable provider-generated analysis, configure:

- `AI_PROVIDER` (the configured provider identifier)
- `AI_API_KEY`, `AI_MODEL`, and `AI_API_URL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_API_URL` remain supported as
  compatibility aliases
- `AI_REQUEST_TIMEOUT_SECONDS` (defaults to `20`)
- `AI_MAX_OUTPUT_TOKENS` (defaults to `500` and is capped at `1000`)
- `AI_ANALYSIS_CACHE_TTL_SECONDS` (defaults to `300`)

The API sends bounded aggregate facts rather than raw dataset rows. The exact
current request shape is documented in `docs/openai-data-flow.md` and covered
by an API test. AI analysis is used by dataset insights, reports, dashboards,
decision summaries, forecasts, and weekly alert digests. Forecasts also expose
linear-regression holdout quality metrics and a `model_quality.reliability`
level (`limited`, `low`, `moderate`, or `good`); recommendation confidence is
capped when validation is unavailable or error is high.

When the provider is not configured, unavailable, or unsupported, the API returns an explicitly labeled deterministic rules fallback. Fallback results remain usable, but the UI and generated decisions preserve that provenance so users can distinguish model output from baseline guidance.

## Workspace And Customer Model

Decisionate supports a mixed customer base:

- Direct customers manage their own workspace, datasets, dashboards, reports, forecasts, alerts, and decisions.
- Agencies manage branded workspaces for themselves and client workspaces they share externally.
- Client users can review shared workspaces without managing data setup or connector configuration.

Backend routes should preserve this model by scoping product data to the active workspace and checking workspace role permissions before allowing data setup, connector changes, notification setup, or team/client access changes.

## Internal Platform Admin

The separate `/platform-admin` surface is protected by a comma-separated Clerk user ID allowlist:

- `DECISIONATE_PLATFORM_ADMIN_USER_IDS`

Configure the same IDs in `NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS` in the web app to show the internal navigation link. The API allowlist remains the authoritative access check.

## Weekly KPI Email Alerts

Decisionate system mail and workspace alert delivery use the platform email configuration. Platform admins can manage it from `/platform-admin`; the environment variables below remain the deployment bootstrap/fallback. Workspace owners can manage alert recipients, schedule, KPI focus, and delivery tests, but cannot configure a separate mail provider or SMTP credentials:

Set `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to
use Resend for Decisionate-owned mail. `RESEND_API_URL` defaults to
`https://api.resend.com/emails` and only needs to be set when using a compatible
custom endpoint. All workspace report delivery uses the selected platform provider.

- `SMTP_HOST`
- `SMTP_FROM_EMAIL`
- `SMTP_PORT` (defaults to `587`)
- `SMTP_USERNAME` and `SMTP_PASSWORD` when your SMTP provider requires auth
- `SMTP_FROM_NAME` (defaults to `Decisionate`)
- `SMTP_USE_TLS` / `SMTP_USE_SSL`

Decisionate exposes these alert operations:

- `GET /alerts/weekly-report/digest` previews the current workspace digest, including AI analysis and historical decision-learning context.
- `GET /alerts/weekly-report/delivery-history` returns recent delivery attempts for the workspace owner.
- `POST /alerts/weekly-report/send` sends the current workspace digest immediately for a workspace owner.
- `POST /alerts/weekly-report/send-test` sends a configuration test email for a workspace owner.
- `POST /alerts/weekly-report/send-due` sends all enabled workspace digests due today. This endpoint requires the `X-Alerts-Scheduler-Secret` header to match `ALERTS_SCHEDULER_SECRET`.

Weekly report setup, previews, delivery history, and manual sends are owner-only. Members and client users can use analysis and decision workflows but cannot change notification configuration or send workspace email.

For cron or hosted scheduled jobs, use the included runner from `apps/api`:

```bash
DECISIONATE_API_URL=https://api.example.com \
ALERTS_SCHEDULER_SECRET=replace-me \
.venv/bin/python scripts/send_due_weekly_reports.py
```

The runner also accepts `ALERTS_SCHEDULER_TIMEOUT_SECONDS` (default `30`) for
slower hosted API deployments.

Example weekday cron entry:

```cron
0 13 * * 1-5 cd /path/to/decisionate/apps/api && DECISIONATE_API_URL=https://api.example.com ALERTS_SCHEDULER_SECRET=replace-me .venv/bin/python scripts/send_due_weekly_reports.py
```

Before deployment, run `apps/api/scripts/check_mvp_readiness.py`. It reports AI,
analytics, portable storage, server email, billing, connector scheduling and
production security readiness without printing credentials. Add `--strict` in
CI or a release check; it requires the core services, a live ingestion worker,
and the production security guard. AI is optional unless `--with-ai` is used.
Billing is required only when enabled, or when `--with-billing` is used.
Individual connector provider credentials are
still verified through staging acceptance tests because availability alone
cannot prove that a provider account, OAuth flow or sync works.

The runner exits with `0` when all due workspaces are sent or skipped, `1` when the scheduler request itself fails, and `2` when the API processed the request but at least one workspace failed delivery validation or email sending.

For a single Railway Cron service, use the combined runner instead:

```bash
python scripts/run_scheduled_jobs.py
```

Set `DECISIONATE_API_URL` and the secrets for selected jobs, such as
`CONNECTORS_SCHEDULER_SECRET` and `ALERTS_SCHEDULER_SECRET`, on that service.
Add `BILLING_SCHEDULER_SECRET` only when billing is enabled.
If `SCHEDULED_JOBS` is omitted, the runner executes only jobs whose matching
secret is configured. Set it to an explicit comma-separated subset when a
deployment should control the selected jobs, for example
`SCHEDULED_JOBS=connectors` for connector ingestion only.
The runner continues through all selected jobs and exits non-zero only if a
selected job cannot complete its API request. Per-connection connector failures
remain visible in each job's API result without turning the whole cron process
into a failed run. It does not require `DATABASE_URL` because the protected API
performs the database work.

## Billing

For a launch without billing, set `BILLING_ENFORCEMENT_ENABLED=false` on both
the API and worker, leave `BILLING_PROVIDER` blank, and omit `billing` from
`SCHEDULED_JOBS`. This disables payment controls, subscription lockouts,
lifecycle emails, and billing-driven data deletion. It does not disable the
three-year connector retention policy. Enabling billing later requires an
explicit switch to `BILLING_ENFORCEMENT_ENABLED=true` and configured Stripe
credentials and webhook.

Billing uses Stripe Checkout and the Stripe customer portal. Configure these
server-side values before enabling paid plans:

- `STRIPE_SECRET_KEY`
- `STRIPE_PROFESSIONAL_PRICE_ID` for Professional ($79/month)
- `STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID` for Professional annual billing
- `STRIPE_AGENCY_PRICE_ID` for Agency ($199/month, 10 clients)
- `STRIPE_AGENCY_ANNUAL_PRICE_ID` for Agency annual billing
- `STRIPE_CLIENT_WORKSPACE_ADDON_PRICE_ID` for additional client workspaces ($20/month each)
- `STRIPE_CLIENT_WORKSPACE_ADDON_ANNUAL_PRICE_ID` for additional client workspaces ($200/year each)
- `STRIPE_AI_CREDIT_PACK_PRICE_ID` for optional 5,000-credit monthly packs at
  CAD $7.50 per pack
- `STRIPE_AI_CREDIT_TOPUP_PRICE_ID` for one-time AI credit top-ups. This price
  represents one 5,000-credit pack at CAD $10; workspace owners can purchase
  any positive number of packs.
- `STRIPE_WEBHOOK_SECRET`
- `DECISIONATE_WEB_APP_URL`

The environment values are bootstrap fallbacks. Platform administrators can
manage the live plan prices, add-on prices, AI bundle prices, AI entitlements,
and Stripe Price IDs from the platform admin portal under **Billing and AI
credit pricing**. Create matching recurring or one-time Prices in Stripe first,
then save their IDs there; checkout uses the saved IDs and the customer billing
page uses the saved amounts without requiring a frontend code change.

Professional includes one direct workspace and a 30-day full-access trial. Agency
includes up to 10 client workspaces, and additional client workspaces are
priced separately rather than charging per seat. The owner starts
Checkout from `/dashboard/billing`. Subscription state is verified against Stripe
after checkout, on portal return, during expiry recovery and by signed webhooks
at `/billing/webhook`. Configure the webhook for `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`, `invoice.payment_action_required`,
`invoice.finalization_failed` and `invoice.updated`. The endpoint consumes the
raw request body and rejects duplicate event IDs. Configure the Stripe customer
portal to allow payment updates, invoices and cancellation at period end; allow
customers to resume scheduled cancellations and switch supported monthly/annual
prices. Use Stripe test mode to verify these settings before enabling payments.

Monthly and annual periods use Stripe's calendar dates, not fixed 30/365-day
calculations. Both renew automatically unless canceled. Scheduled cancellation
keeps access until period end; an already canceled subscription requires a new
checkout without another trial. Failed renewals have a seven-day grace period
(`BILLING_GRACE_PERIOD_DAYS`), anchored to the unpaid invoice rather than the next
period end. Retries do not extend that deadline or grant another credit allowance.
Successful payment restores access and resets recurring credits once per paid
period. Purchased credits carry over unchanged. Expired records are reconciled
before denying access; provider outages produce a retryable verification error.

Enable the `billing` scheduler job and system email delivery for trial/cancellation
reminders, payment-recovery notices and an annual renewal reminder within 30 days.
The scheduler reconciles provider subscriptions before notices or expiry-driven
deletion, skips destructive work during provider failures and never deletes an
accessible workspace merely because its old local renewal date has elapsed.

Agency client workspaces use the agency owner's subscription AI credit pool;
their usage remains attributed to the client workspace for reporting. Low
balances trigger one owner email per billing period. Professional owners receive
the same low-balance notification for their direct workspace. One-time top-ups
are granted only after verified payment confirmation or a signed webhook and remain
available until consumed; they do not renew or expire. Optional monthly AI credit
packs reset with each paid billing period.

## OAuth Connectors And Automated Sync

Owner-only OAuth authorization is available for Shopify, Google Search Console,
Square, QuickBooks, FreshBooks, Sage Cloud Accounting, HubSpot, Google Ads, Meta
Ads, Lightspeed Retail R-Series, Lightspeed Retail X-Series, Xero, and WooCommerce. Configure each OAuth provider's
client ID and secret, `OAUTH_CALLBACK_URL`, and a Fernet
`OAUTH_TOKEN_ENCRYPTION_KEY`. WooCommerce is the exception to provider client
credentials: it uses the client store's WooCommerce Application Authentication
Endpoint to generate a read-only API key for Decisionate.
OAuth callbacks store encrypted access and refresh tokens in the database; raw
tokens are never returned to the web app.

Google Analytics and the listed business connectors have dataset adapters.
Owners can enable an hourly or daily schedule on a connection. A scheduled job calls
`POST /datasets/source-connections/sync-due` with the
`X-Connectors-Scheduler-Secret` header. Run the included scheduler with:

```bash
DECISIONATE_API_URL=https://api.example.com \
CONNECTORS_SCHEDULER_SECRET=replace-me \
.venv/bin/python scripts/sync_due_connectors.py
```

OAuth providers still require their provider application credentials on the API
server before authorization can begin. Stripe data ingestion uses a restricted,
read-only API key supplied by each customer on their own connection; it does not
use Stripe Connect or a global customer-data key. Keep `STRIPE_SECRET_KEY`
separate for Decisionate billing.
Google Search Console imports Search Analytics rows by date, query, and page.
The connection value must match the property added in Search Console exactly.
For a URL-prefix property, enter the complete URL such as
`https://www.example.com/`. For a Domain property, enter the domain name such as
`example.com` (the connector converts it to Google's `sc-domain:example.com`
API identifier).
Google Business Profile imports accessible locations and daily profile
performance metrics from Google Search and Maps. Configure the OAuth settings,
enable the Business Profile Information and Performance APIs in Google Cloud,
and request Google Business Profile API access if the project has zero quota.
Shopify imports order-level sales and line items through the versioned GraphQL Admin API.
Configure `SHOPIFY_API_VERSION` and either
`SHOPIFY_GRAPHQL_API_URL_TEMPLATE` or the compatible
`SHOPIFY_API_BASE_URL_TEMPLATE`. The adapter requests only order and line-item fields,
does not request customer email or address fields, and defaults to a 60-day initial
sync with no historical backfill. Manual Shopify date-range syncs are limited to
60 days. These windows remain configurable through
`SHOPIFY_INITIAL_SYNC_DAYS`, `SHOPIFY_INITIAL_BACKFILL_ENABLED`,
`SHOPIFY_INITIAL_BACKFILL_DAYS`, and `SHOPIFY_INITIAL_BACKFILL_MONTHS`.
The default OAuth request uses `read_orders` only, so all-orders access and its
associated Shopify review can be enabled later with
`SHOPIFY_REQUIRE_ALL_ORDERS_ACCESS=true`.
Square imports order-level sales from the selected location and requires the
`ORDERS_READ` OAuth permission. To connect WooCommerce, the workspace owner
enters the client's HTTPS store URL, selects Connect with OAuth, and the client
store owner approves read-only access. Decisionate receives the generated key
through `POST /oauth/callback` and encrypts it before persistence; the current
adapter imports orders with embedded customer and billing fields rather than a
standalone list of customers who have never placed an order.
Lightspeed Retail (R-Series) imports account sales using the configured Retail
account ID. Register a Lightspeed R-Series API client, set its redirect URL to
the deployed `OAUTH_CALLBACK_URL`, and configure `LIGHTSPEED_CLIENT_ID`,
`LIGHTSPEED_CLIENT_SECRET`, and `OAUTH_TOKEN_ENCRYPTION_KEY` on the API server.
Use the R-Series OAuth endpoints in `.env.example` and request the
`employee:register_read` scope. The workspace owner then enters the client's
numeric Retail account ID and selects Connect with OAuth; the client account
owner completes the consent screen.
Lightspeed Retail (X-Series) is a separate connector because it uses a
tenant-specific domain and API version. It imports selected sales, customers,
and products resources. Configure the X-Series OAuth credentials and API
settings from `.env.example`; enter the retailer's domain prefix in the
Decisionate connection settings (for example, `developerdemodv182z` for a
test store). Lightspeed also returns the domain prefix during OAuth, and
Decisionate preserves that callback value when it is available.
Lightspeed Restaurant (K-Series) and O-Series are separate planned restaurant
connectors. Their adapter and OAuth configuration remain documented for
development, but both are intentionally unavailable in the connector catalog
until their restaurant integrations are released.
Google Search Console uses read-only OAuth and imports Search Analytics rows
for a URL-prefix or Domain property. In Google Cloud, enable the Search
Console API, create a Web application OAuth client, and add the deployed
`OAUTH_CALLBACK_URL` as an authorized redirect URI. Configure
`GOOGLE_SEARCH_CONSOLE_CLIENT_ID`, `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`, and
`OAUTH_TOKEN_ENCRYPTION_KEY` on the API server. The workspace owner must enter
the property exactly as added in Search Console: the complete URL-prefix URL,
or the Domain property name such as `example.com`, and then connect with OAuth.
Google Ads requires the server-side OAuth app credentials and the
`https://www.googleapis.com/auth/adwords` scope. Google Ads API access is
managed by the Google Cloud project that owns the OAuth credentials; an older
developer token may still be supplied for compatibility. The customer enters
the target 10-digit `customer_id` on the connection. If Google Ads requires
manager routing, the adapter discovers an authorized manager automatically.
The adapter uses the read-only campaign performance `SearchStream` report and
stores one row per campaign and day. Configure
`GOOGLE_ADS_API_BASE_URL` and `GOOGLE_ADS_API_VERSION` alongside the Google Ads
OAuth settings in `.env.example`.
Sage requires `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, and an encrypted OAuth
token key. Sage is imported with the provider's read-only OAuth consent and the
selected business ID returned during authorization. For the current v3.1 API,
set `SAGE_BUSINESSES_API_URL` to the provider's `/v3.1/businesses` endpoint
(or leave it blank to use Decisionate's v3.1 default); after OAuth, Decisionate
lists the businesses, stores the user's selection, and uses it for subsequent
requests. Set `SAGE_BUSINESS_HEADER=X-Business` with the v3.1 API. Legacy
regional v3 deployments fall back to `resource_owner_id` with
`SAGE_BUSINESS_HEADER=X-Site` if business discovery is unavailable.
The connector uses the OAuth bearer token directly; it does not require an
APIM or subscription key.
PostgreSQL, MySQL, and SQL Server use customer-specific connection settings:
host, optional port, database, read-only username, password, and a SELECT or
WITH query. Passwords are encrypted before persistence. PostgreSQL and MySQL
also expose an SSL mode; SQL Server uses the `pymssql` driver. The three
legacy `*_SOURCE_URL` environment variables remain optional fallbacks for old
rows, but new connections do not require server-wide database credentials.
Use provider-native read-only credentials wherever available; SQL validation is
an additional guard, not a replacement for a read-only database role.

## Analytics Engine

Decisionate keeps transactional product state in `DATABASE_URL` and analytical data behind an analytics engine boundary. Local development defaults to DuckDB:

- `ANALYTICS_ENGINE=duckdb`
- `DUCKDB_DATABASE_PATH=analytics/decisionate.duckdb`
- `ANALYTICS_STORAGE_DIR=analytics/datasets`
- `ANALYTICS_STORAGE_FORMAT=parquet`

Keep analytics storage portable and table-oriented. Parquet is the preferred local storage format because it lets the DuckDB-backed analytics layer migrate cleanly to warehouse-backed analytics. To run the BigQuery analytics adapter, install the optional API dependencies, configure Google application credentials for the API process, and set:

- `ANALYTICS_ENGINE=bigquery`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_ANALYTICS_DATASET`
- `BIGQUERY_LOCATION`

The BigQuery adapter reads from the configured analytics table identity for each dataset. Application code should call analytics services rather than depending directly on DuckDB or BigQuery APIs. That lets the adapter change without rewriting dashboard, forecasting, or sharing routes.

Google Analytics can be pulled manually into a new dataset when the optional
`google-analytics-data` and `google-auth` packages are installed. Configure a
server-side service-account file with `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE`
or inject its JSON through `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON`; do not save
credential material in a workspace connection. Add a Google Analytics source
connection with its GA4 `property_id`, then use the connection's manual sync
action. The service account must have viewer access to that property.

## Future Data Source Connectors

The dataset source registry already lists the planned connector roadmap. CSV,
JSON, Parquet, and Excel uploads are included in the base API dependencies.
Additional connector and analytics packages remain optional:

- Legacy Excel `.xls`: `xlrd`
- BigQuery analytics adapter: `google-cloud-bigquery`
- Google Analytics connector: `google-analytics-data` and `google-auth`

Install optional connector packages with:

```bash
.venv/bin/python -m pip install -r requirements-optional.txt
```

Connector values in `.env.example` document the supported and planned integrations:

- Manual Google Analytics sync: `google-analytics-data`, `google-auth`, and a server-side service account are supported now
- OAuth apps: Shopify, Google Drive, OneDrive, QuickBooks, Xero, CRM systems, marketing platforms
- API-key connectors: Stripe and custom REST APIs
- Databases: PostgreSQL, MySQL, SQL Server
- Data warehouses: BigQuery, Snowflake
- Cloud object storage: Google Cloud Storage, Azure Blob Storage, Amazon S3
- Near real-time ingestion: provider webhooks and generic dataset webhooks

The data source registry may report which connector environment variable names are configured, but it must not expose secret values in API responses.

Do not store production connector secrets directly in `.env` long term. These names document the expected local development shape; production should use managed secret storage.

## Deployment Shape

The core deployment uses the web app, API, PostgreSQL, remote object storage
(R2 or S3), Clerk authentication, system email, Sentry, a persistent ingestion
worker, and a scheduler. AI and billing are optional integrations, not prerequisites
for launching the core product. Clerk remains the current authentication adapter
while internal Decisionate identity records preserve a future migration path.

## Core Production Release

This release supports a core launch without AI or billing. Configuration and
automated tests do not replace acceptance testing against the deployed services.

### API and Worker

1. Back up PostgreSQL and object storage, and verify a restore into a separate
   environment before deployment. Database bootstrap changes run at startup
   under a PostgreSQL lock; they are not a substitute for a backup.
2. Configure `APP_ENV=production`, a PostgreSQL `DATABASE_URL`, HTTPS web/API
   URLs, explicit `CORS_ALLOWED_ORIGINS`, Clerk JWKS verification, encrypted OAuth
   token storage, R2/S3 credentials, email delivery, and `SENTRY_DSN`. The API
   refuses to start when its production security guard fails.
3. Set `BILLING_ENFORCEMENT_ENABLED=false` on both API and worker. This disables
   billing access restrictions, payment commands, lifecycle emails, and
   subscription-expiry data deletion. Leave `AI_PROVIDER` unset while AI is
   deferred. Any rules-based analysis remains a fallback, not provider AI.
4. Deploy a separate persistent service using the API image and start command
   `python scripts/run_ingestion_worker.py`. Give it the API's database, object
   storage, connector, authentication, encryption, and monitoring configuration.
   Enable automatic restart. Run exactly one worker; a PostgreSQL advisory lock
   rejects a second consumer. Production ingestion is always queued to this worker.
5. Allow at least 2 GiB of job address space plus supervisor/container overhead.
   Tune `INGESTION_JOB_MEMORY_MB` and `INGESTION_JOB_TIMEOUT_SECONDS` for the
   deployment. Each job runs in an isolated process with a deadline. A restart
   marks interrupted work failed with a retry message; partial imports are not
   automatically replayed. Queued uploads are staged in shared object storage.
6. Stop old in-process ingestion before the rollout. Start the API and worker
   from the same revision. The worker applies three-year connector retention
   hourly, including disconnected and auto-sync-disabled connections. No
   historical summarization is performed.
7. Configure the scheduler with `SCHEDULED_JOBS=connectors,alerts`. Follow
   [Railway scheduling](../../docs/railway-scheduling.md); omit the billing job
   while billing is disabled.

For email-based invitations and account linking, the signed Clerk JWT must
include `email` and boolean `email_verified=true` only for a verified address.
Subject-based authentication still works without these claims, but email-based
invitation acceptance does not. Never substitute browser-supplied email headers.

### Release Gates

Run these from the deployed API environment after the worker starts:

```bash
python scripts/check_mvp_readiness.py --strict --json
```

`GET /health` is liveness/configuration; `GET /ready` checks the database and a
worker heartbeat no older than 30 seconds. Monitor readiness, API 5xx responses,
failed/stale ingestion jobs, scheduler results, storage errors, and Sentry.
The strict command does not require AI or billing when deferred. Add `--with-ai`
or `--with-billing` when activating those integrations.

Before allowing customers onto a release, verify:

- Two independent workspaces cannot read or change each other's data; verified
  invitations, role restrictions, and revoked sharing work as intended.
- A real upload survives API/worker separation, produces a readable dataset,
  and its staged object is removed. Verify reporting against real connector
  data, including multiple objects, empty results, and provider failures.
- A worker restart reports failure instead of leaving an import running forever;
  customers can retry. Test the configured timeout and memory budget.
- Dataset/workspace deletion removes analysis records, ingestion payloads, and
  relevant storage. Deletion during a running import must return a conflict.
- Three-year retention removes expired connector data and derived join caches
  even when synchronization is disabled or provider authorization is revoked.
- System emails arrive, scheduler secrets are enforced, and monitoring alerts
  reach the operator. Confirm provider app approval for customers outside app
  roles before offering a restricted OAuth connector publicly.
- The edge proxy/WAF limits anonymous/public traffic and slow or oversized
  requests. The API limits authenticated workspace requests and request bodies;
  it does not provide an anonymous edge rate limiter.

Keep a known-good application image and documented rollback procedure. If a
rollback changes database expectations, test it against a restored copy first.
Do not overwrite live customer data with an old backup as an automatic rollback.
