# Operator architecture and trust boundaries

This article is for authorized operators, not the customer retrieval index.
Source-level architecture does not establish the current production revision,
configured vendors or deployed service names.

## Runtime responsibilities

The Next.js web application calls the FastAPI API. PostgreSQL holds application
records and durable job state. Configured object storage holds dataset assets;
the default analytics configuration is DuckDB and Parquet. This is not a claim
that every calculation is executed as a DuckDB query: report and statistical
modules also use pandas, NumPy, SciPy and statsmodels paths.

The ingestion worker consumes its own queue. The persistent Reports analysis
worker runs report previews, selected-metric anomaly jobs, weekly previews and
weekly sends in supervised child processes. Forecasts and basic relationship
monitors were not moved into that Reports queue. The retired advanced
correlation worker must not be recreated to fix a current report.

## Isolation and authorization

The active workspace and verified user identity scope data access. Server
authorization, source revision checks and role-specific write permissions remain
authoritative. Platform Admin is separate from workspace ownership; support
chat cannot elevate either role. Object identifiers or public metadata are not
authorization credentials.

## Multiple frontends

The backend also supports deployment-registered applications above workspaces.
`decisionate-ca` remains the implicit default for existing data and clients.
Additional applications use separate authentication issuers, scoped identities,
Stripe billing configuration and transactional email settings. The
`workspace_applications` mapping preserves that ownership for HTTP requests,
OAuth callbacks and background jobs. An Origin or `X-Application-Id` selects
configuration; it does not authorize access. Workspace membership is still
required and cross-application access is rejected.

`GET /api/v2/application` supplies public application configuration. The existing
Platform Admin and marketing automation remain default-application-only;
secondary frontends must honor the returned feature flags. This is not a
separate data-residency deployment or an already launched .ai frontend.
See `docs/multi-application-api.md` for registration, independent billing,
credential isolation, staging checks and rollback boundaries.

Full-access operators can now use Platform Admin > White-label setup to save
non-secret setup drafts, download deployment variables and Railway worker
references, and check configuration. Drafts do not activate applications or
provision provider accounts. Configuration checks are local to the API process;
saved launch confirmations are operator attestations, not live provider tests.
The four stages are Brand, Sign-in and billing, Deployment, and Launch review.
Export requires complete fields and a public HTTPS API URL. Confirm launch
requires a saved revision, matching API configuration and all saved manual
checks. Setup edits or detected deployed configuration changes invalidate that
confirmation. The additive `white_label_launch_confirmations` table stores its
revision, operator, time and a change-detection digest, never raw credentials.
See `docs/white-label-onboarding.md` for the onboarding sequence and limits.

The separate hosted self-service path lives at `/dashboard/white-label` for
default-application Agency owners. With operator provider configuration enabled,
it creates a Vercel project, isolated production Clerk application, Stripe Connect
prices/webhook and a restricted Resend sending key. The customer supplies brand,
domain, legal links and prices, authorizes Stripe and adds DNS. Launch verifies
provider readiness and HTTPS before the `hosted_portals` registration becomes
active. Per-portal secrets are encrypted with the shared application encryption
key; API/workers cache live registrations for five seconds. Stripe requests use
the portal's connected-account header, not .ca's customer account.

This needs Clerk Platform API access, Vercel repository access, Stripe Connect
and Resend configuration once at the platform level. It does not imply those
accounts are configured in production. Mocked tests are not a live provider
certification. Connector OAuth apps, account migration, live configuration
changes, teardown, custom plan catalogs and regional isolation are not automated
by this flow. The original operator wizard remains unchanged for static brands.

Knowledge articles are static approved guidance. An authenticated live-data tool
would be a separate product surface requiring its own authorization, minimized
response schema, auditing and testing. Do not expose database credentials,
arbitrary SQL, raw stack traces or GitHub write operations to a public chatbot.

## Proposed support integration

Use the existing backend to retrieve customer-only knowledge and call the
configured model. This repository does not add that endpoint or change current
AI analysis billing. Operator retrieval belongs in a separately authorized index.
MCP is optional interoperability, not a requirement for product documentation
retrieval. An MCP server would not replace tenant authorization or safe tool
design if external AI clients are added later.
