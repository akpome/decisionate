# Provider Migration Runbook

Decisionate is deployed as two stateless applications:

- `apps/api`: FastAPI and background runner entrypoints.
- `apps/web`: Next.js standalone Node server.

The database and object storage are the durable system of record. The API
does not require provider-specific business logic for a hosting move.

## Provider-neutral contract

Change deployment configuration, not application code:

| Capability | Configuration boundary | Accepted providers |
| --- | --- | --- |
| Web | `NEXT_PUBLIC_API_URL` at web build time | Any Node/Next host |
| API | `DATABASE_URL` and container port `8000` | Any Python/container host |
| Transaction data | SQLAlchemy `DATABASE_URL` | PostgreSQL or SQLite for local development |
| Dataset files | `OBJECT_STORAGE_*` | Local development, Cloudflare R2, AWS S3, Google Cloud Storage, or Azure Blob Storage |
| Analytics | `ANALYTICS_ENGINE`, `ANALYTICS_STORAGE_FORMAT` | DuckDB/Parquet or BigQuery |
| Cache | `CACHE_PROVIDER`, `REDIS_URL` | In-memory development cache or Redis-compatible service |
| Authentication | `AUTH_PROVIDER`, `AUTH_JWKS_URL`, audience, issuer | Any JWT/JWKS-compatible provider |
| Email | Platform email settings or `EMAIL_PROVIDER` | SMTP or Resend-compatible API |
| AI | `AI_PROVIDER`, `AI_API_URL`, `AI_MODEL`, and `AI_API_KEY` | OpenAI-compatible chat-completions endpoint; no model, URL, or key is embedded in code (`OPENAI_*` aliases remain supported) |
| Billing | `BILLING_PROVIDER`, `STRIPE_API_URL`, and Stripe settings | Stripe currently; billing remains isolated behind its service module |
| Connector APIs | Provider-specific `*_API_BASE_URL`, version, OAuth URL, and scope variables | Connector code has no vendor endpoint defaults |
| Scheduled work | API URL plus scheduler secret | Any cron, Railway job, Cloud Scheduler, EventBridge, or worker |

The API exposes the selected non-secret providers at `GET /health` under
`capabilities.configuration`. It never returns credentials.

## First deployment

1. Provision PostgreSQL and record its connection URL.
2. Provision a durable object-storage bucket/container and credentials.
3. Copy `apps/api/.env.example` to the API provider's secret/configuration
   store. Set `APP_ENV=production`, `DATABASE_URL`, explicit runtime provider
   choices, remote object-storage values, HTTPS URLs, explicit CORS origins,
   JWT/JWKS settings, `OAUTH_TOKEN_ENCRYPTION_KEY`, and `SENTRY_DSN`.
   Configure AI, billing, email, and every connector endpoint/version/OAuth
   scope there as well. Do not rely on application defaults: missing provider
   settings are reported as unavailable.
4. Run the API container from `apps/api/Dockerfile`.
5. Build the web container from `apps/web/Dockerfile` with the deployed API
   URL as `NEXT_PUBLIC_API_URL`.
6. Configure the provider's HTTPS domain and health check against `/health`.
7. Run `apps/api/scripts/check_mvp_readiness.py --strict` before opening the
   application to customers.

When running locally, start the API with the environment file (for example,
Uvicorn's `--env-file apps/api/.env` option). Python imports do not load `.env`
files by themselves.

## Moving the API or web host

1. Export the current secret/configuration values from the old provider.
2. Create equivalent environment variables at the new provider. Do not copy
   secrets into source control or Docker images.
3. Deploy the API container and confirm `/health` reports the expected
   database, object storage, cache, analytics, and authentication providers.
4. Deploy the web container with the new API URL baked into
   `NEXT_PUBLIC_API_URL`.
5. Update `CORS_ALLOWED_ORIGINS`, authentication callback URLs, OAuth callback
   URLs, Stripe webhook URLs, and scheduler URLs.
6. Run one read-only dashboard load, one connector sync check, one alert test,
   and the backup/restore verification before changing DNS.

## Moving PostgreSQL

Use the existing migration preflight for a SQLite development database:

```bash
.venv/bin/python scripts/prepare_postgresql_migration.py \
  --source sqlite:///./decisionate.db \
  --migrate-to "$DATABASE_URL" \
  --report postgres-migration-report.json
```

For PostgreSQL-to-PostgreSQL moves, use the source and target provider's
native logical backup/restore tools. Keep the application `DATABASE_URL`
unchanged at the code level. Run `scripts/verify_backup_restore.py` against
an isolated restore before cutover.

## Moving object storage

The migration utility copies every persisted `Dataset.file_path`, including
single-file uploads and connector partition directories. It verifies every
copied object byte-for-byte before changing database references. It keeps the
source objects by default and updates all dataset references in one database
transaction.

Set the source and target settings as deployment secrets. The variable names
after each prefix are `PROVIDER`, `BUCKET`, `ENDPOINT`, `ACCESS_KEY`,
`SECRET_KEY`, `REGION`, `PROJECT`, `CREDENTIALS_FILE`, `CREDENTIALS_JSON`,
`CONNECTION_STRING`, `ACCOUNT_URL`, `ACCOUNT_NAME`, `ACCOUNT_KEY`, and
`SAS_TOKEN` as applicable:

```bash
export STORAGE_MIGRATION_SOURCE_PROVIDER=r2
export STORAGE_MIGRATION_SOURCE_BUCKET=decisionate-production
export STORAGE_MIGRATION_SOURCE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
export STORAGE_MIGRATION_SOURCE_ACCESS_KEY=...
export STORAGE_MIGRATION_SOURCE_SECRET_KEY=...

export STORAGE_MIGRATION_TARGET_PROVIDER=gcs
export STORAGE_MIGRATION_TARGET_BUCKET=decisionate-production
export STORAGE_MIGRATION_TARGET_PROJECT=your-gcp-project
export STORAGE_MIGRATION_TARGET_CREDENTIALS_FILE=/run/secrets/gcs.json

export DATABASE_URL=...
```

Run a read-only inventory first:

```bash
.venv/bin/python scripts/migrate_object_storage.py --dry-run \
  --report storage-migration-plan.json
```

Run the verified copy and database update:

```bash
.venv/bin/python scripts/migrate_object_storage.py \
  --report storage-migration-result.json
```

For Azure, use `STORAGE_MIGRATION_TARGET_PROVIDER=azure`,
`STORAGE_MIGRATION_TARGET_BUCKET=<container>`, and either a connection string
or account URL plus account key/SAS token. For GCS, use `gs://` references and
service-account JSON or application-default credentials.

The database stores the complete object reference in `datasets.file_path`.
The storage resolver chooses the client from that reference (`r2://`,
`s3://`, `gs://`, or `azure://`) rather than assuming every row belongs to the
currently selected provider. Keep the old provider's provider-specific
credentials configured while migrating so reads, verification, rollback, and
the final database-reference update can happen without an application-wide
storage cutover. Older R2 rows that contain `s3://` are resolved as legacy R2
when `OBJECT_STORAGE_LEGACY_S3_PROVIDER=r2` is set.

Only after the new provider passes dataset preview, dashboard query, shared
dashboard, connector partition, deletion, and backup/restore checks should the
source be removed. The optional `--delete-source` flag performs that cleanup
after the database update; it is intentionally never the default.

## Moving authentication

The API resolves authenticated external identities into internal Decisionate
user IDs. A provider change requires a compatible JWT/JWKS configuration and
an identity migration plan, but product data remains attached to internal
users and workspace IDs rather than provider-specific user IDs.

Set `AUTH_PROVIDER`, `AUTH_JWKS_URL`, `AUTH_JWT_AUDIENCE`, and
`AUTH_JWT_ISSUER` at the new provider. Keep the provider's email claim stable
where possible and test owner, member, and client workspace permissions with
negative authorization checks.

## Scheduled jobs

The API is not required to stay active for scheduled work beyond serving the
job request. Run these scripts from any scheduler:

- `scripts/sync_due_connectors.py`
- `scripts/send_due_weekly_reports.py`
- `scripts/send_due_billing_lifecycle.py`

Each script calls the API using its configured URL and secret. Moving from
Railway cron to Cloud Scheduler, GitHub Actions, ECS scheduled tasks, or a
different provider changes the scheduler definition only.

## Cutover checklist

- PostgreSQL restore verified in isolation.
- Object storage objects copied and readable.
- API `/health` is healthy and reports expected providers.
- Strict readiness check passes.
- Web build points to the new API URL.
- CORS and OAuth callback URLs updated.
- Stripe webhook endpoint updated.
- All three scheduled jobs run successfully.
- Workspace isolation negative tests pass.
- Old provider remains available until production verification completes.
