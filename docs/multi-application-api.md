# Multiple Frontends and Independent Billing

The API can serve Decisionate.ca and a separately built Decisionate.ai frontend
at the same time. An application is a deployment-registered brand above a
workspace. Workspaces retain their existing ownership, agency rules, settings,
datasets, subscriptions and access checks.

Static registration does not create the .ai frontend or change subscriptions.
The optional hosted self-service workflow can provision a branded copy of the
existing frontend; see the hosted-registration section below.

For an independently deployed frontend, use **Platform Admin > White-label setup**. It saves
non-secret drafts, generates application variables and Railway worker
references, and guides operators through configuration checks, manual launch
tests and a recorded launch confirmation. This confirmation does not activate
the application or automatically verify external services. See
[White-label onboarding](white-label-onboarding.md). The manual configuration
below remains supported.

## Compatibility and isolation

- `decisionate-ca` is the default. Existing callers, identities, workspace IDs,
  Stripe prices, webhook URLs and Platform Admin settings continue to work.
- The additive `workspace_applications` table records secondary application
  ownership. Existing workspaces without a row belong to `decisionate-ca`.
  No existing data is reassigned and no existing subscription is rebilled.
- Each additional application has a separate JWT issuer and identity namespace.
  Identical email addresses or external user IDs do not merge accounts across
  applications. Cross-application workspace access is rejected even if a
  membership record exists. Invitations are claimed within their application.
- Billing, email and authentication configuration for secondary applications
  uses their environment prefix. Missing secrets do not fall back to .ca.
- Jobs recover application ownership from their workspace, including connector
  ingestion, report analysis, weekly delivery and billing renewal processing.
  OAuth callbacks recover it from the saved authorization state.

## Register Decisionate.ai

Use the **same registry** on the API, analytics worker, ingestion worker and
other processes running application services. Keep the current .ca environment
variables unchanged. Set `DECISIONATE_APPLICATIONS` to the following JSON (one
line is convenient in Railway):

```json
[{"id":"decisionate-ai","name":"Decisionate International","web_url":"https://www.decisionate.ai","allowed_origins":["https://decisionate.ai"],"environment_prefix":"DECISIONATE_AI_"}]
```

Use the actual canonical frontend URL. Only explicitly registered origins are
accepted; HTTPS is required except for localhost development. Do not add .ai
origins to the default `CORS_ALLOWED_ORIGINS`: that list belongs to .ca. The API
adds the secondary registry origins to its CORS policy automatically.

Register the application only after configuring its authentication issuer and
JWKS URL. Startup rejects duplicate origins, environment prefixes and issuers.
For Clerk, create a separate application/instance. Another JWT/JWKS provider is
also supported, using compatible verified identity claims.

```dotenv
DECISIONATE_AI_AUTH_PROVIDER=clerk
DECISIONATE_AI_AUTH_JWT_ISSUER=https://YOUR-AI-CLERK-INSTANCE
DECISIONATE_AI_AUTH_JWKS_URL=https://YOUR-AI-CLERK-INSTANCE/.well-known/jwks.json
DECISIONATE_AI_AUTH_JWT_AUDIENCE=decisionate-ai-api
DECISIONATE_AI_CLERK_SECRET_KEY=SET_IN_SECRET_STORE
```

Configure the matching token audience in the issuer. The audience setting is
optional when the provider does not issue an audience; separate issuers are
required regardless. Never use `X-User-Id` as authentication in production.

## Independent Stripe billing

Configure a separate Stripe account/key and create its own prices. This is
server-side Stripe billing, not Stripe Connect or automatic revenue sharing.
Set the following on every API/worker process that performs billing operations:

```dotenv
DECISIONATE_AI_BILLING_PROVIDER=stripe
DECISIONATE_AI_BILLING_ENFORCEMENT_ENABLED=true
DECISIONATE_AI_BILLING_CURRENCY=USD
DECISIONATE_AI_STRIPE_SECRET_KEY=SET_IN_SECRET_STORE
DECISIONATE_AI_STRIPE_WEBHOOK_SECRET=SET_IN_SECRET_STORE
DECISIONATE_AI_STRIPE_PROFESSIONAL_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_AGENCY_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_AGENCY_ANNUAL_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_CLIENT_WORKSPACE_ADDON_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_CLIENT_WORKSPACE_ADDON_ANNUAL_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_AI_CREDIT_PACK_PRICE_ID=price_REPLACE
DECISIONATE_AI_STRIPE_AI_CREDIT_TOPUP_PRICE_ID=price_REPLACE
```

Configure only the plans/add-ons you offer; do not deploy placeholder values.
`STRIPE_API_URL` remains a shared technical provider URL. Prices must use the
chosen currency. Set the displayed amounts to match those prices using the
prefix plus `BILLING_` and one of these uppercase suffixes:

- `PROFESSIONAL_MONTHLY_PRICE_CENTS`, `PROFESSIONAL_ANNUAL_PRICE_CENTS`
- `AGENCY_MONTHLY_PRICE_CENTS`, `AGENCY_ANNUAL_PRICE_CENTS`
- `ADDITIONAL_CLIENT_WORKSPACE_MONTHLY_PRICE_CENTS`
- `ADDITIONAL_CLIENT_WORKSPACE_ANNUAL_PRICE_CENTS`
- `AI_CREDIT_PACK_PRICE_CENTS`, `AI_CREDIT_TOPUP_PRICE_CENTS`

For example, `DECISIONATE_AI_BILLING_PROFESSIONAL_MONTHLY_PRICE_CENTS=4900`.
Default plan rules and trial duration remain the existing Decisionate rules.
AI allocations can be overridden with prefixed existing settings, for example
`DECISIONATE_AI_DECISIONATE_PROFESSIONAL_AI_CREDITS=5000`. The repeated prefix
is intentional: the application prefix is prepended to the existing variable.

Create a Stripe webhook endpoint in the .ai Stripe account at:

```text
https://api.decisionate.ca/billing/webhook/decisionate-ai
```

Use the same event types as the existing .ca billing integration. Leave .ca's
`/billing/webhook` unchanged. Each endpoint verifies its own signing secret;
secondary checkout/subscription metadata includes `application_id`. Events
cannot update a workspace belonging to another application. Event deduplication
is application-scoped. Return URLs use the registered frontend URL, never a
URL supplied by the caller. Billing status includes `application_id` and
`currency` so a new frontend does not need to hardcode CAD.

## Email, links and connectors

For Resend, configure a verified sender and the application's own credentials:

```dotenv
DECISIONATE_AI_EMAIL_PROVIDER=resend
DECISIONATE_AI_RESEND_API_KEY=SET_IN_SECRET_STORE
DECISIONATE_AI_RESEND_FROM_EMAIL=no-reply@decisionate.ai
DECISIONATE_AI_SUPPORT_EMAIL=support@decisionate.ai
DECISIONATE_AI_APPLICATION_LOGO_URL=https://www.decisionate.ai/logo.png
```

Alternatively prefix the existing SMTP settings. Email sender settings saved in
the .ca Platform Admin do not override .ai. Invitations, billing links and weekly
report links use the application's registered frontend URL. Existing frontend
paths such as `/sign-in`, `/dashboard/billing` and `/dashboard/connections`
remain the link contract; the new frontend should implement those routes.

Connector OAuth client IDs/secrets must also be prefixed. Public provider URLs
and API versions may be shared. Keep the shared OAuth callback URL and token
encryption key unchanged. Register that callback with each connector OAuth app.
OAuth callbacks use the saved workspace state to choose credentials and the
correct frontend. Missing secondary credentials disable that integration;
they never borrow the default application's credentials.

## Frontend API contract

1. Read `GET /api/v2/application` for public name, URL, currency and feature
   flags. It returns no secrets and is not cached.
2. Authenticate with that application's issuer and send
   `Authorization: Bearer <session-token>` on authenticated API requests.
3. Browser requests select the application through their registered `Origin`.
   Server-side clients must also send `X-Application-Id: decisionate-ai`.
   A conflicting explicit header and Origin is rejected. Neither is an
   authorization credential.
4. Read `GET /organizations/workspaces` and send the returned workspace ID in
   `X-Workspace-Id`. Workspace membership and application ownership are both
   enforced on the server. Do not manufacture IDs from email addresses.
5. Use the existing product APIs. `/openapi.json` and `/docs` describe their
   request schemas and application/workspace headers. Existing endpoints have
   not been renamed or moved to a new version.

Authenticated example (use a short-lived session token, not an API secret):

```bash
curl https://api.decisionate.ca/organizations/workspaces \
  -H 'X-Application-Id: decisionate-ai' \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

No changes are needed in the current .ca frontend. For a separately deployed
frontend, configure its API base URL, authentication integration and currency
display. Public shared-dashboard API calls also need the registered browser
Origin or explicit application header.

## Boundaries and rollout

This is a shared backend with application isolation, not separate databases or
data residency. Storage, analytics, AI provider, worker queues, infrastructure
limits and operator maintenance controls remain shared. Workspace settings
remain isolated by workspace. Operator-managed application configuration is managed
through deployment secrets. The Platform Admin wizard prepares and checks this
configuration; saving a draft does not activate or change a live application.

The existing global Platform Admin and marketing automation/preferences belong
to .ca. Secondary requests to `/admin*` and `/marketing*` return 404. The public
application endpoint advertises those features as unavailable; a new frontend
must hide them. Transactional and weekly emails are application-aware. Custom
marketing automation, arbitrary plan catalogs and fully rebranded product copy
remain separate work. Hosted domain provisioning is described below.

### Hosted registrations

`HOSTED_PORTALS_ENABLED=true` adds verified, launched `hosted_portals` records to
the registry alongside static applications. Each process has a five-second
cache; workers restore registrations using the existing workspace mapping.
Invalid encrypted registrations are excluded, never interpreted as default-app
settings. Static startup validation does not need the database initialized.
Dynamic CORS accepts exact hosted origins only after launch.

Agency owners on the default app use `/api/v2/hosted-portals` to configure their
brand, authorize Stripe Connect, prepare resources and launch. Each portal uses
a distinct Clerk issuer, Vercel project and encrypted billing/email settings.
Stripe operations carry its `Stripe-Account` header using the Connect platform
key; .ca operations remain unchanged. Each `/billing/webhook/{portal_id}` has
its own signing secret. Portal builds send `X-Application-Id` for server and
browser API calls. Customers never receive stored credentials.

One-time Vercel, Clerk Platform API, Stripe Connect and Resend configuration is
required. See [hosted onboarding](white-label-onboarding.md) for variables,
provider access, rollout tests and limits. Do not copy hosted registrations into
`DECISIONATE_APPLICATIONS`: their source of truth is the shared database and
encrypted settings, not prefixed variables.

Before enabling .ai customers:

1. Back up the database; deploy this code to API and workers without registering
   .ai. Check existing .ca sign-in, agency access, reports and billing.
2. Configure the registry and credentials on staging API/workers. Use separate
   test authentication and Stripe test keys. Exercise both applications at once.
3. Test signup, invitations, agency pause/unlink, workspace selection, checkout,
   signed webhooks, renewal, weekly email, OAuth redirect and data deletion.
4. Verify a .ca token cannot access .ai and vice versa. Check both sender domains,
   pricing/currency and Stripe destinations before enabling live billing.
5. Deploy the new frontend only after its routes and API integration pass.

Keep application IDs immutable. Do not remove a registration while its
workspaces or queued jobs are active: those operations fail closed instead of
switching to .ca settings. The additive database table can remain during a
rollback, but **do not roll back to a pre-isolation server once secondary users
exist**. Disable the new frontend and keep an isolation-aware backend while
investigating. Moving customers between applications requires a separate,
explicit identity and billing migration, not changing their mapping row.
