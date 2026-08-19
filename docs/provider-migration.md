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
| Dataset files | `OBJECT_STORAGE_*` | Local development, Cloudflare R2, AWS S3, or another S3-compatible store |
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
2. Provision an S3-compatible bucket and credentials.
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

The application stores dataset references as local paths in development or
`s3://bucket/key` references in remote mode. To move R2 to S3, or S3 to
another S3-compatible service:

1. Copy objects while preserving keys.
2. Change only `OBJECT_STORAGE_PROVIDER`, bucket, endpoint, region, access
   key, and secret key.
3. Verify a dataset preview, a dashboard query, a shared dashboard, and a
   connector dataset before switching traffic.

Do not delete the old bucket until the restore and query checks pass.

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
