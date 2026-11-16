# Decisionate-hosted agency portals

## Status and architecture

The shared `agency.decisionate.app` implementation is independent of the existing
custom-domain product. It includes self-service billing, reservation, branding,
preview/publication, central sign-in, workspace isolation and admin lifecycle
controls. Both commercial switches default **Off**. Live Vercel, Clerk, Stripe,
Resend and connector acceptance checks have **not** been performed.

The owner approved central sign-in: a branded welcome page sends users to the
existing `app.decisionate.ca` Clerk sign-in, then returns through Clerk session
synchronization. Credential entry and password recovery retain the primary
Decisionate identity. No second Clerk instance is created.

Audit findings and differences from the original handoff:

- Existing `modules/hosted_portals.py` implements **custom-domain** provisioning
  with separate Vercel/Clerk applications, Stripe Connect and sender setup. Its
  technical `HOSTED_PORTALS_ENABLED` is not a commercial availability switch.
  Existing registrations, drafts and operator maintenance are retained.
- Existing default-application workspaces cannot safely be assigned new agency
  application IDs. The new portal is a **branded access context over
  decisionate-ca**, not another application identity or analytical data store.
- Existing JWT issuer/audience verification and workspace roles remain decisive.
  Hostnames and Origin headers are not authentication. Portal access further
  restricts users to their agency and its currently managed client workspaces.
- Workers restore current portal context from workspace ownership without changing
  the application credentials. Context is reset after each operation.
- The new modules use `hosted_subdomains`; the old `hosted_portals` naming remains
  for backward compatibility. No identities, subscriptions or data are migrated.

## Agency workflow

1. Agency owner opens Settings > Hosted portal on the main application.
2. Review the current recurring add-on quote and confirm adding it to the existing
   Agency subscription. Complete any payment verification before setup.
3. Enter the subdomain, name, support address, colors, optional images and welcome
   message. Save draft atomically reserves the address; it cannot then be renamed.
4. Preview desktop/mobile appearance, then explicitly activate/publish. Draft
   editing does not provision Clerk resources or change live branding.
5. Open/copy the URL and manage client invitations using existing Settings.
   Signup alone never grants membership in an agency or client workspace.

Owner/admin can edit branding; only the owner can change billing. Cancellation
under Subscription options immediately stops hosted access without a current-period
refund. The confirmation explains this. The base Agency plan and data remain.

## Database and API

The existing serialized SQLAlchemy startup bootstrap creates additive tables:

- `white_label_availability`: independent persisted flags and revision.
- `hosted_subdomain_portals`: unique agency/slug/hostname, draft/published config,
  status, revisions, Clerk reference, provisioning errors and timestamps.
- `hosted_subdomain_entitlements`: confirmed add-on on an existing subscription.
- `hosted_subdomain_events`: attributed configuration/lifecycle audit.
- `hosted_subdomain_oauth_returns`: initiating connector state to portal binding.

No existing records are rewritten. New routes:

| Route | Purpose |
| --- | --- |
| `GET /api/v2/hosted-subdomains/resolve?hostname=...` | Exact public config, no secrets, no-store |
| `GET /api/v2/hosted-subdomains/assets/{hostname}/{field}` | Active published raster images |
| `GET/PUT /api/v2/hosted-subdomains` | Agency owner/admin setup and versioned drafts |
| `POST /api/v2/hosted-subdomains/activate` | Entitlement/readiness/revision-checked publication |
| `GET /api/v2/hosted-subdomains/subscription-offer` | Owner-only Stripe quote |
| `POST/DELETE /api/v2/hosted-subdomains/subscription` | Owner-only add/cancel hosted add-on |
| `POST /admin/hosted-subdomains/{id}/status` | Full-admin suspend/resume/retire, reason and revision |
| `GET /admin/hosted-subdomains/{id}/events` | Full-admin history |
| `GET/PUT /admin/white-label-availability` | Commercial flags and technical blockers |

Unknown/retired hosts fail closed. Inactive/reserved hosts expose no branding;
only Clerk proxy bootstrap is available on the frontend. Active exact origins
enter CORS dynamically. No wildcard authentication/CORS/redirect permission is
added. Hosted origins cannot access platform or marketing administration.

Uploads allow PNG/JPEG/WebP up to 128 KB each, validated base64 and signatures;
SVG/HTML/scripts are rejected. Bounded image data is stored with the configuration
and served through fixed raster URLs. Optional HTTPS raster URLs require an
operator-approved asset hostname. Arbitrary CSS/HTML is not accepted.

## Authentication and routing

The existing Next.js 16 proxy integrates hostname lookup and Clerk. Existing `.ca`
marketing redirects, primary app, root navigation, custom portals and PWA rules
remain. Hosted PWA installation is not introduced.

The branded entry uses Clerk URL builders. Primary sign-in validates the return
host with the backend and permits only that exact origin and safe application
routes. Spoofed request headers cannot supply a trusted return. Satellites reuse
the same issuer with a Frontend API proxy at `/__clerk`. Publication reconciles the
exact Clerk hostname, satellite status and proxy URL; conflicts fail closed.

Discovery shows only permitted workspaces. Unrelated users get an access message,
not a new agency. Signup, invitation acceptance, recovery, wrong-account switching
and logout need real cross-domain testing before launch.

## Billing and lifecycle

Use one fixed licensed add-on price per supported base billing interval, not a
product per agency. Quote amount/currency and subscription/customer ownership are
revalidated server-side. Stripe writes use idempotency keys and pending payment
behavior. Server-retrieved state and existing signed webhook processing synchronize
entitlement; frontend success redirects do not. Hosted prices are excluded from
base-plan detection. Keep price IDs stable while subscribers use them.

| Event | Behavior |
| --- | --- |
| New sales Off | Blocks new purchase/setup/publication, preserves live portals and published-brand edits |
| Add-on removal or subscription cancellation/expiry | Portal unavailable, configuration/data retained |
| Past due | Existing bounded subscription grace rules |
| Agency pause | Portal unavailable, no deletion |
| Client pause | Existing client restrictions |
| Client unlink | No former agency portal access; existing main-app recovery/settings remain |
| Admin suspend | Agency cannot self-resume |
| Admin resume | Published config, Clerk reference and paid entitlement required |
| Admin retire | Address cannot be reactivated by agency |
| Workspace deletion | Removes hosted database references through existing deletion workflow |

Workspace deletion does not automatically delete the external Clerk satellite.
Operators must confirm ownership and remove unused provider resources separately.
Do not remove live/shared provider domains as a side effect of toggling sales.

## Email and OAuth

Existing Decisionate sender credentials remain authoritative. Agency name/logo,
reply-to and links can change; the sending address stays on a verified
Decisionate-controlled domain. Invitations, standard notification templates and
weekly-report branding use hosted context, including jobs restored by workspace.
Clerk-managed account emails keep primary-instance settings.

An invitation to attach an existing independent workspace starts on the main app:
it is not yet authorized on the destination portal. Normal managed-client
invitations can return to their agency portal.

OAuth keeps existing backend callbacks and one-use-state validation. A server row
binds the initiating portal; return uses it only if active and still managing that
workspace. Otherwise it uses the primary app. Custom-domain provider credentials
are never borrowed. Shared callbacks do not establish provider approval: test
each enabled connector and confirm its registered app/branding permits this use.
Additional Meta, Google, Shopify or accounting-provider review may be required.

## Platform Admin

Overview is the initial screen. Customers, People & access, Usage, Billing, Email,
White label, Marketing and Operations have separate, permission-aware views.
Only selected-section data loads. Unsaved settings remain in state; sensitive
editors require discard confirmation. AI polling runs only on Overview.

White label distinguishes the two products, technical blockers, commercial state
and counts. Hosted records include lifecycle/errors and explicit actions/history.
Listings are bounded to 200 records, audit to 100 events; inline image data is not
loaded into listings. Availability is not an emergency suspension mechanism.

## Deployment runbook

### Deploy safely

Back up production PostgreSQL. Deploy API, workers and schedulers on the same
revision/shared database, then the existing Vercel project. Startup creates the
additive tables. Leave both commercial settings Off. Preserve existing custom
technical flags, registry and provider credentials.

### Vercel

Add `*.decisionate.app` to the existing shared project. Complete the exact wildcard
DNS/TLS instructions Vercel displays (Vercel nameservers or delegated ACME challenge
records where supported). Keep `.ca` assignments. Verify HTTPS for two candidate
hosts and rejection of an unknown host. Use a unique deployment ID if your pipeline
supplies one. No agency project or custom frontend deployment is needed.

Before assigning the wildcard, confirm no existing custom-domain application or
operator-managed registration uses `decisionate.app` or its subdomains. The new
offering owns that namespace. Any conflict requires a separately reviewed migration;
do not overwrite an existing registration or turn on hosted sales over it.

Reuse `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and existing server
`CLERK_SECRET_KEY`. Do not set global satellite/domain overrides: proxy/provider
configuration is selected per validated request. Do not set the custom product's
`NEXT_PUBLIC_PORTAL_*` configuration on the shared project.

### Clerk

Keep the existing production instance, primary `app.decisionate.ca`, sign-in/up
paths and verified JWT issuer/audience. Confirm production satellite support on
the instance's plan. Give the API its ordinary primary-instance `CLERK_SECRET_KEY`,
not the custom product's Platform API token. Activation registers the exact
satellite and `/__clerk` proxy; verify Clerk's proxy checks succeed after deployment.
Use staging for end-to-end login/signup/invitation/recovery/logout and two-agency
isolation. Do not add wildcard redirect origins or weaken issuer verification.

### Stripe and Railway variables

Create Decisionate-owned licensed per-unit recurring prices at the approved amount
and currency for each Agency interval sold. Reuse the existing Stripe account and
signed webhook endpoint; no hosted-agency Stripe Connect account is involved.

```dotenv
STRIPE_HOSTED_SUBDOMAIN_PRICE_ID=<approved monthly price>
STRIPE_HOSTED_SUBDOMAIN_ANNUAL_PRICE_ID=<approved annual price>
HOSTED_SUBDOMAINS_HOSTING_VERIFIED=false
HOSTED_SUBDOMAINS_AUTH_VERIFIED=false
HOSTED_SUBDOMAINS_DELIVERY_VERIFIED=false
HOSTED_SUBDOMAINS_ASSET_HOSTS=app.decisionate.ca
DECISIONATE_API_URL=https://api.decisionate.ca
CLERK_SECRET_KEY=<existing primary-instance backend key>
```

The three verification flags accept exactly `true` after operator checks; they
are attestations, not live provider probes. API/worker/scheduler must share price
IDs, database, primary application registry and public API URL. Provisioning
credentials are API-only. Do not add wildcard CORS origins; exact active origins
come from the database. Never paste secrets into support chat or source control.

Test successful/pending payment, authentication-required invoice, retry after
timeout, cancellation, renewal and delayed webhook. Confirm the base Agency plan,
client quantities and AI credits remain intact. Use authorized test subscriptions.

### Email, workers and connectors

Use the existing verified sender/key. Send test invitations, alerts and weekly
reports to authorized test recipients. Inspect logos, names, reply-to and links
from agency/client background jobs. Test pause/unlink during queued work and
primary URL restoration for independent clients. Test OAuth main/hosted/custom
callbacks and each provider's approvals. Set delivery verification only afterward.

### Launch and rollback

Complete staging checks before production. Enable only Decisionate-Hosted White
Label through full Platform Admin after all readiness checks pass. Custom-domain
sales stay Off unless separately approved. Never migrate existing workspaces.

For rollback, close new sales first, explicitly suspend affected portals if needed,
and retain tables/audit/drafts. Preserve the commercial gate on any API rollback
so direct custom provisioning does not reopen. Maintain entitlement webhook
handling while add-on subscriptions exist. Coordinate shutdown/refunds instead
of removing routing and stranding paid users.

## Verification and limitations

Automated tests cover signed test JWTs, real membership checks, exact origins,
revision conflicts, reservation, entitlement loss during activation, pause/unlink,
worker restoration, OAuth binding, bounded assets, add-on purchase/cancellation,
and primary/custom routing. Browser fixtures use actual components with mocked
API/Clerk, not live provider sessions.
Production PostgreSQL concurrency, real Clerk synchronization, provider approvals
and deliverability require the runbook. No production provider state was changed
by local tests. Ready flags intentionally keep sales closed.

Local checks completed on November 15, 2026:

- API: all 2,215 discovered tests ran in six isolated batches; 2,183 passed and
  32 PostgreSQL-only tests were skipped because no isolated PostgreSQL server was
  available locally. No test failures remained. CI supplies PostgreSQL for those
  existing integration tests; CI results must still be checked after push.
- Frontend: 1,057 tests passed, lint passed, production build/type checking passed.
- Hosted backend: 22 focused tests passed, including signed-JWT authorization,
  subscription changes, publication, worker context, assets and OAuth returns.
- Marketing: all 80 tests passed; the previously intermittent workspace-change
  test passed 250 consecutive runs after fixing listener setup/cleanup in its fixture.
- Actual admin/setup components passed mocked-provider browser checks at 1440,
  768 and 390 pixel widths, including forms, confirmation, preview and navigation.
- Approved customer knowledge validation and generated export checks passed.

## Files

Backend: `apps/api/.env.example`, `app/db/models.py`, `app/modules/hosted_subdomains/`
(`context`, `service`, `router`, `billing`, `admin`, `cleanup`),
`app/modules/white_label_availability.py`, `app/application_context.py`,
`app/configuration.py`, `app/main.py`, `app/modules/applications.py`,
`app/modules/auth_context.py`, existing billing router/service, OAuth router,
organization agency/invitation/branding helpers, email branding, alerts router/
delivery and platform-admin deletion. Tests include `test_hosted_subdomains.py`
and billing fixtures.

Frontend: `features/hosted-subdomains/`, `app/dashboard/hosted-portal/page.tsx`,
`proxy.ts`, root/Clerk/auth layouts, auth redirect, dashboard shell, marketing
tracker, white-label settings/admin components, `lib/application-routes.ts`,
`lib/api.ts`; hosted-subdomain, auth-flow, custom-portal, invitation-login,
marketing-reliability and PWA tests. Earlier admin cleanup is in
`app/platform-admin/page.tsx` and `features/platform-admin/sections.ts`.

Documentation: this runbook, `docs/white-label-onboarding.md`, approved customer
portal knowledge, its manifest/source snapshot and generated JSONL exports.
Unrelated databases, bytecode, sample data and previous handoffs are excluded.

Provider references: [Clerk satellites](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains),
[Clerk proxy](https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi),
[Clerk domains](https://clerk.com/docs/reference/backend/domains/add),
[Vercel domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain),
[Stripe pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates).
