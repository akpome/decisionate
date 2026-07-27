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

Run the API from `apps/api` with the local virtual environment:

```bash
.venv/bin/python -m uvicorn app.main:app --reload --port 8000 --env-file .env
```

The web app defaults to `http://localhost:8000`. Set `NEXT_PUBLIC_API_URL` in
`apps/web/.env.local` when the API runs on another host or port.

## Tests

Run the API unit tests from `apps/api`:

```bash
.venv/bin/python -m unittest discover -s tests
```

## Environment

`DATABASE_URL` controls the SQLAlchemy database connection. The local default is `sqlite:///./decisionate.db`.

`DATASET_UPLOAD_DIR` controls where uploaded dataset files are stored. The local default is `uploads`.

`CORS_ALLOWED_ORIGINS` is a comma-separated list of web origins that can call the API. Include the deployed web app origin so public shared dashboard links can load data in the browser.

`CLERK_JWKS_URL`, `CLERK_JWT_AUDIENCE`, and `CLERK_JWT_ISSUER` enable Clerk JWT verification for protected product routes. If `CLERK_JWKS_URL` is not set, local development can use the existing header-based auth flow.

## AI Analysis And Forecasting

AI-assisted analysis is part of the MVP. Configure the API server with:

- `AI_PROVIDER=openai`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (defaults to `gpt-4o-mini`)
- `OPENAI_API_URL` (defaults to the OpenAI Chat Completions endpoint)
- `AI_REQUEST_TIMEOUT_SECONDS` (defaults to `20`)
- `AI_MAX_OUTPUT_TOKENS` (defaults to `500` and is capped at `1000`)
- `AI_ANALYSIS_CACHE_TTL_SECONDS` (defaults to `300`)

The API sends bounded aggregate facts rather than raw dataset rows. AI analysis is used by dataset insights, reports, dashboards, decision summaries, forecasts, and weekly alert digests. Forecasts also expose linear-regression holdout quality metrics and a `model_quality.reliability` level (`limited`, `low`, `moderate`, or `good`); recommendation confidence is capped when validation is unavailable or error is high.

When the provider is not configured, unavailable, or unsupported, the API returns an explicitly labeled deterministic rules fallback. Fallback results remain usable, but the UI and generated decisions preserve that provenance so users can distinguish model output from baseline guidance.

## Workspace And Customer Model

Decisionate supports a mixed customer base:

- Direct customers manage their own workspace, datasets, dashboards, reports, forecasts, alerts, and decisions.
- Agencies manage branded workspaces for themselves and client workspaces they share externally.
- Client users can review shared workspaces without managing data setup or connector configuration.

Backend routes should preserve this model by scoping product data to the active workspace and checking workspace role permissions before allowing data setup, connector changes, notification setup, or team/client access changes.

## Weekly KPI Email Alerts

Alerts can send dataset-derived KPI digests by email. Configure SMTP on the API server before enabling real sends:

- `SMTP_HOST`
- `SMTP_FROM_EMAIL`
- `SMTP_PORT` (defaults to `587`)
- `SMTP_USERNAME` and `SMTP_PASSWORD` when your SMTP provider requires auth
- `SMTP_FROM_NAME` (defaults to `Decisionate`)
- `SMTP_USE_TLS` / `SMTP_USE_SSL`

Decisionate exposes two send paths:

- `POST /alerts/weekly-report/send` sends the current workspace digest immediately for a workspace manager.
- `POST /alerts/weekly-report/send-due` sends all enabled workspace digests due today. This endpoint requires the `X-Alerts-Scheduler-Secret` header to match `ALERTS_SCHEDULER_SECRET`.

For cron or hosted scheduled jobs, use the included runner from `apps/api`:

```bash
DECISIONATE_API_URL=https://api.example.com \
ALERTS_SCHEDULER_SECRET=replace-me \
.venv/bin/python scripts/send_due_weekly_reports.py
```

Example weekday cron entry:

```cron
0 13 * * 1-5 cd /path/to/decisionate/apps/api && DECISIONATE_API_URL=https://api.example.com ALERTS_SCHEDULER_SECRET=replace-me .venv/bin/python scripts/send_due_weekly_reports.py
```

The runner exits with `0` when all due workspaces are sent or skipped, `1` when the scheduler request itself fails, and `2` when the API processed the request but at least one workspace failed delivery validation or email sending.

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

## Future Data Source Connectors

The dataset source registry already lists the planned connector roadmap. CSV and JSON uploads work with the base API dependencies. Parquet and Excel uploads are wired through the same loader, but require optional pandas reader dependencies on the API server:

- Parquet: `pyarrow` or `fastparquet`
- Excel: `openpyxl` or `xlrd`
- BigQuery analytics adapter: `google-cloud-bigquery`

Install the common optional readers with:

```bash
.venv/bin/python -m pip install -r requirements-optional.txt
```

The commented connector values in `.env.example` are placeholders for future work:

- OAuth apps: Shopify, Google Drive, Google Analytics, OneDrive, QuickBooks, Xero, CRM systems, marketing platforms
- API-key connectors: Stripe and custom REST APIs
- Databases: PostgreSQL, MySQL, SQL Server
- Data warehouses: BigQuery, Snowflake
- Cloud object storage: Google Cloud Storage, Azure Blob Storage, Amazon S3
- Near real-time ingestion: provider webhooks and generic dataset webhooks

The data source registry may report which connector environment variable names are configured, but it must not expose secret values in API responses.

Do not store production connector secrets directly in `.env` long term. These names document the expected local development shape; production should use managed secret storage.
