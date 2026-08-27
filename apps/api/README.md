# Decisionate API

FastAPI backend for Decisionate.

## Local Setup

Copy the example environment file and adjust values if needed:

```bash
cp .env.example .env
```

Install the base API dependencies:

```bash
.venv/bin/python -m pip install -r requirements.txt
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

`CLERK_JWKS_URL`, `CLERK_JWT_AUDIENCE`, and `CLERK_JWT_ISSUER` enable Clerk JWT verification for protected product routes. If `CLERK_JWKS_URL` is not set, local development can use the existing header-based auth flow. For production invitation claiming, configure the verified Clerk session token to include the signed user email claim; the API does not trust a client-supplied email header when bearer verification is enabled.

## AI Analysis And Forecasting

AI-assisted analysis is part of the MVP. Configure the API server with:

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

Decisionate system mail (support, signup, subscription, and AI credit notifications) uses the platform email configuration. Platform admins can manage it from `/platform-admin`; the environment variables below remain the deployment bootstrap/fallback. Alerts can send dataset-derived KPI digests by email. Workspace owners can optionally override those customer alert/report messages from the Alerts page with their own SMTP provider:

Set `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to
use Resend for Decisionate-owned mail. `RESEND_API_URL` defaults to
`https://api.resend.com/emails` and only needs to be set when using a compatible
custom endpoint. Workspace SMTP overrides remain SMTP-only and continue to take
precedence for workspace-owned report delivery.

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
CI or a release check; it fails until the required MVP services and production
security guard are configured. Individual connector provider credentials are
still verified through staging acceptance tests because availability alone
cannot prove that a provider account, OAuth flow or sync works.

The runner exits with `0` when all due workspaces are sent or skipped, `1` when the scheduler request itself fails, and `2` when the API processed the request but at least one workspace failed delivery validation or email sending.

For a single Railway Cron service, use the combined runner instead:

```bash
python scripts/run_scheduled_jobs.py
```

Set `DECISIONATE_API_URL`, `CONNECTORS_SCHEDULER_SECRET`,
`ALERTS_SCHEDULER_SECRET`, and `BILLING_SCHEDULER_SECRET` on that service.
`SCHEDULED_JOBS` defaults to `connectors,alerts,billing`; set it to a
comma-separated subset when a deployment does not use every scheduled feature.
The runner continues through all selected jobs and exits non-zero if any job
fails. It does not require `DATABASE_URL` because the protected API performs
the database work.

## Billing

Billing uses Stripe Checkout and the Stripe customer portal. Configure these
server-side values before enabling paid plans:

- `STRIPE_SECRET_KEY`
- `STRIPE_PROFESSIONAL_PRICE_ID` for Professional ($79/month)
- `STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID` for Professional annual billing
- `STRIPE_AGENCY_PRICE_ID` for Agency ($199/month, 10 clients)
- `STRIPE_AGENCY_ANNUAL_PRICE_ID` for Agency annual billing
- `STRIPE_CLIENT_WORKSPACE_ADDON_PRICE_ID` for additional client workspaces ($20/month each)
- `STRIPE_CLIENT_WORKSPACE_ADDON_ANNUAL_PRICE_ID` for additional client workspaces ($200/year each)
- `STRIPE_AI_CREDIT_PACK_PRICE_ID` for optional 5,000-credit monthly packs
- `STRIPE_WEBHOOK_SECRET`
- `DECISIONATE_WEB_APP_URL`

Professional includes one direct workspace and a 30-day full-access trial. Agency
includes up to 10 client workspaces, and additional client workspaces are
priced separately rather than charging per seat. The owner starts
Checkout from `/dashboard/billing`, while subscription state is updated only from
signed Stripe webhooks at `/billing/webhook`. Configure the webhook
for `checkout.session.completed` and `customer.subscription.created`,
`customer.subscription.updated`, and `customer.subscription.deleted`. The
webhook endpoint consumes the raw request body and rejects duplicate event IDs.

## OAuth Connectors And Automated Sync

Owner-only OAuth authorization is available for Shopify, QuickBooks, FreshBooks,
Sage Cloud Accounting, HubSpot, Meta Ads, and Xero. Configure each
provider's client ID and secret, `OAUTH_CALLBACK_URL`, and a Fernet
`OAUTH_TOKEN_ENCRYPTION_KEY`.
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
Sage requires `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`,
`SAGE_API_SUBSCRIPTION_KEY`, and an encrypted OAuth token key. Sage is imported
with the provider's read-only OAuth consent and the selected business resource
owner ID returned during authorization. The default adapter targets the Sage
UK/Ireland Accounting API path; set `SAGE_API_BASE_URL` for another supported
country or deployment endpoint.
PostgreSQL, MySQL, and SQL Server require their corresponding read-only source
URL and a SELECT or WITH query on the connection. Connector source status in
the Connections page reports which server-side requirement is missing. Use
provider-native read-only or minimum-scope credentials wherever available;
SQL validation is an additional guard, not a replacement for a read-only
database role.

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

The recommended initial deployment is a Vercel web app, Railway API and
Postgres, Cloudflare R2 for Parquet, OpenAI for model calls, Stripe for billing,
Resend for system email, Railway cron for the scheduler, Upstash Redis for
distributed cache/rate limiting, and Sentry for error monitoring. Provider
selection lives in environment variables and adapters rather than in product
routes. Clerk remains the current authentication adapter while the internal
Decisionate identity records preserve a future migration path.
