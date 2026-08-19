# Decisionate Deployment Runbook

This is the initial provider mapping. Product code should use the adapter
settings below rather than provider-specific environment names.

## MVP release gate

Run the readiness check from `apps/api` in the same environment that will
serve production:

```bash
.venv/bin/python scripts/check_mvp_readiness.py --strict
```

The strict gate must pass before public launch. It checks for configured AI,
analytics, portable storage, platform email, alert scheduling, billing and its
webhook, connector scheduling, and production security mode. It does not claim
that a provider account or connector works merely because an environment
variable exists; those still require the staging acceptance checks below.

Before launch, complete these checks in staging:

- Load a real dataset and exercise the dashboard, insight, forecast, report,
  alert, recommendation, decision and outcome-learning workflow.
- Connect and sync at least one representative provider for every connector
  advertised at launch, then verify the resulting Parquet dataset and retry
  behavior.
- Deliver a real alert and system email, receive the Stripe webhook, and run
  the billing lifecycle job.
- Verify negative authorization cases across two workspaces, including
  datasets, decisions, alerts, relationships, shared dashboards and AI context.
- Perform a backup restore drill, verify restored data, and verify workspace
  deletion removes associated users, metadata and stored dataset objects.
- Confirm the production domain, HTTPS, CORS, authentication verification,
  secret encryption, Sentry monitoring and scheduler secrets are active.

The local development configuration is intentionally not a passing release
configuration. It uses SQLite/local storage, memory cache, development auth
behavior and rules-only AI until production services are configured.

## API on Railway

Use the API directory as the Railway service root. Start the service with:

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set `APP_ENV=production`, the deployed web origin in
`CORS_ALLOWED_ORIGINS`, and the Railway Postgres `DATABASE_URL`. The API
normalizes Railway's `postgres://` URL to the `psycopg` SQLAlchemy driver.

## Parquet on Cloudflare R2

Set:

```text
OBJECT_STORAGE_PROVIDER=r2
OBJECT_STORAGE_BUCKET=<bucket>
OBJECT_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
OBJECT_STORAGE_ACCESS_KEY=<r2-access-key>
OBJECT_STORAGE_SECRET_KEY=<r2-secret-key>
OBJECT_STORAGE_REGION=auto
```

Uploaded and connector datasets are staged locally, converted to Parquet, and
stored in R2. PostgreSQL stores metadata and `s3://` object references. Reads
materialize only the requested object or partition directory, so the API can
move from R2 to AWS S3 without changing dataset routes.

## Email, AI, billing

- `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` deliver
  Decisionate-owned system mail. Workspace SMTP overrides remain separate.
- `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` enable AI analysis.
- `BILLING_PROVIDER=stripe` and the Stripe secret, price, and webhook settings
  enable billing.

Secrets may be supplied through the platform admin settings where supported,
but production deployment secrets should live in Railway/Vercel secret stores.

## Jobs

Use Railway cron or an equivalent scheduler to invoke the existing authenticated
runners from `scripts/`:

- `scripts/sync_due_connectors.py`
- `scripts/send_due_weekly_reports.py`
- `scripts/send_due_billing_lifecycle.py`

Each runner calls its API endpoint with its separate scheduler secret. Keep
these secrets distinct so a connector job cannot invoke an alert or billing
job.

## Redis and Sentry

Set `CACHE_PROVIDER=redis` and `REDIS_URL` for Upstash Redis. The AI analysis
cache becomes shared across Railway instances; local memory remains the safe
development fallback. Set `SENTRY_DSN` and optionally
`SENTRY_TRACES_SAMPLE_RATE` to enable API error monitoring.

## Authentication migration seam

Clerk remains the current web authentication provider. The API resolves the
external subject into an internal `usr_...` identity and stores provider
mapping separately. `AUTH_PROVIDER`, `AUTH_JWKS_URL`, `AUTH_JWT_AUDIENCE`, and
`AUTH_JWT_ISSUER` are the provider-neutral names; current `CLERK_*` names are
accepted as compatibility aliases. A future Auth0, WorkOS, or self-managed
adapter should implement the same verified identity contract instead of
rewriting workspace ownership queries.
