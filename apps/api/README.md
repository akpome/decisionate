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

Run the API from `apps/api` with your preferred Python environment.

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

## Analytics Engine

Decisionate keeps transactional product state in `DATABASE_URL` and analytical data behind an analytics engine boundary. Local development defaults to DuckDB:

- `ANALYTICS_ENGINE=duckdb`
- `DUCKDB_DATABASE_PATH=analytics/decisionate.duckdb`
- `ANALYTICS_STORAGE_DIR=analytics/datasets`
- `ANALYTICS_STORAGE_FORMAT=parquet`

Keep analytics storage portable and table-oriented. Parquet is the preferred local storage format because it lets the DuckDB-backed analytics layer migrate cleanly to BigQuery later. When BigQuery becomes the analytics engine, set:

- `ANALYTICS_ENGINE=bigquery`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_ANALYTICS_DATASET`
- `BIGQUERY_LOCATION`

Application code should call analytics services rather than depending directly on DuckDB APIs. That lets the adapter change from DuckDB to BigQuery without rewriting dashboard, forecasting, or sharing routes.

## Future Data Source Connectors

The dataset source registry already lists the planned connector roadmap. CSV and JSON uploads work with the base API dependencies. Parquet and Excel uploads are wired through the same loader, but require optional pandas reader dependencies on the API server:

- Parquet: `pyarrow` or `fastparquet`
- Excel: `openpyxl` or `xlrd`

Install the common optional readers with:

```bash
.venv/bin/python -m pip install -r requirements-optional.txt
```

The commented connector values in `.env.example` are placeholders for future work:

- OAuth apps: Shopify, Google Drive, Google Analytics, OneDrive, QuickBooks, CRM systems, marketing platforms
- API-key connectors: Stripe and custom REST APIs
- Databases and warehouses: PostgreSQL, MySQL, SQL Server, BigQuery, Snowflake
- Near real-time ingestion: provider webhooks and generic dataset webhooks

The data source registry may report which connector environment variable names are configured, but it must not expose secret values in API responses.

Do not store production connector secrets directly in `.env` long term. These names document the expected local development shape; production should use managed secret storage.
