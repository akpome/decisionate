# Hosted subdomain implementation status

## Scope and current status

The November 15, 2026 handoff requests a new shared, Decisionate-managed
`agency.decisionate.app` offering alongside the existing custom-domain product.
This change implements the independent commercial-control foundation and
Platform Admin cleanup. It does **not** complete the hosted-subdomain offering.

Both commercial settings default to Off. Custom-domain setup can be reopened
by a full-access administrator, subject to existing technical checks. Hosted
subdomain sales cannot be enabled until the authentication decision, remaining
implementation and real-provider launch checks are complete. No production
provider configuration was changed or validated by this implementation.

## Repository audit

- `modules/hosted_portals.py` is the existing custom-domain product. It provisions
  separate Vercel and Clerk applications, uses customer Stripe Connect accounts,
  and provisions a sender domain. It must not implement the new shared product.
- `modules/hosted_portal_registry.py` restores live custom-domain applications.
  Its `HOSTED_PORTALS_ENABLED` flag is technical, not a safe commercial kill switch.
- `application_context.py` validates distinct issuers for independent applications.
  Existing default-app workspaces cannot simply be assigned a new agency
  application ID without affecting identity and authorization.
- `auth_context.py` and organization membership/lifecycle code already enforce
  workspace ownership and agency-client access. These remain authoritative.
- Billing stores the existing agency subscription and processes verified Stripe
  updates. The new product needs a narrowly scoped entitlement extension, not a
  second customer account, duplicate base subscription or Connect account.
- Background jobs restore application context from the workspace. Hosted-brand
  context must eventually extend this for email links and OAuth returns.
- The primary Next.js proxy already implements `.ca` marketing/application
  routing and isolated custom portals. This change does not modify it, Clerk
  configuration, PWA handling, OAuth, billing returns or invitation routing.

## Authentication decision pending

The requested agency-branded login must be reconciled with Clerk's supported
cross-domain flow. Clerk satellites reuse an instance, but credential entry is
completed on its primary domain. A satellite may present an agency-branded
entry screen and securely return after primary-domain sign-in; it cannot simply
embed an independent sign-in form and assume cookies span `.ca` and `.app`.
[Clerk satellite-domain documentation](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains).

The proposed user-facing flow is:

1. Open the agency's branded portal entry page.
2. Continue through supported Clerk sign-in on `app.decisionate.ca`.
3. Return to the registered agency portal with Clerk's session synchronization.
4. Resolve only workspaces authorized for both the verified identity and agency.

Approval for this departure from a wholly agency-hosted sign-in experience is
pending. The implementation must use Clerk's URL builders and exact registered
redirect origins, verify paid production satellite support and DNS, and test
sign-in, invitation acceptance, password recovery and logout on real domains.
Do not create a custom token-exchange authentication system as a workaround.

The recommended data model is a separate hosted-subdomain portal record and a
branded access context over the existing default application. No workspace or
identity migration is proposed. This model and routing are **not yet implemented**.

## Implemented controls

`white_label_availability` is an additive table created through the existing
serialized SQLAlchemy startup bootstrap. It contains a singleton record with:

- Independent `hosted_subdomain_enabled` and `custom_domain_enabled` booleans.
- An optimistic-concurrency revision.
- Last modifying administrator and timestamp.

An absent row means both settings are Off. Reads do not create a row. No existing
tables or business data are rewritten. Availability changes are recorded in the
existing Platform Admin audit table in the same transaction.

### API

- `GET /admin/white-label-availability`: full-admin-only current settings,
  technical blockers, custom-domain counts and latest 200 portal records.
- `PUT /admin/white-label-availability`: full-admin-only, with `offering`,
  `enabled`, `revision`, `confirmation: "CHANGE AVAILABILITY"`, optional `reason`.
  Stale writes return 409; unsupported hosted enablement returns 409.
- `GET /api/v2/hosted-portals`: adds `commercially_available` to the existing
  agency-owned setup response.
- Existing custom-domain save, Stripe-start, prepare and launch endpoints enforce
  the commercial setting. In-progress Stripe callbacks retain their original
  one-use-state checks, but cannot bypass the separate launch gate.

Live custom-domain registrations, protected credentials, operator-managed drafts
and existing application identities are preserved. Commercial availability does
not suspend individual portals. Individual hosted suspension remains part of the
unimplemented hosted lifecycle.

## Platform Admin

The initial screen is Overview. Permission-aware navigation separates Customers,
People & access, Usage, Billing, Email, White label, Marketing and Operations.
Customers has separate Accounts, Workspaces and New workspace views.

Only the current section's data is requested. Previously loaded settings remain
in page state when switching sections, preserving unsaved email, billing and
maintenance edits. Explicit Refresh reloads the selected section. Hidden panels
are not mounted; white-label operator setup and marketing do not load on Overview.
AI status polling runs only on Overview. Existing destructive confirmations and
backend permissions remain in place.

Marketing and operator-setup editors require confirmation before discarding
unsaved changes on section navigation or page Refresh. Section navigation is
disabled while either editor saves. Collapsing the operator section preserves
its open draft.

## Remaining implementation

The following must be completed before announcing hosted subdomains:

- Separate portal model, atomic slug reservation, reserved names and revisions.
- Shared frontend host lookup, unknown-host rejection and exact-origin CORS.
- Supported shared Clerk flow, JWT/workspace/agency isolation and invitations.
- Agency branding, login appearance, safe assets and responsive previews.
- Verified hosted entitlement using existing subscription/webhook infrastructure.
- Decisionate-owned sender branding and trusted worker/OAuth portal context.
- Explicit subscription, agency, client-unlink and portal-suspension lifecycles.
- Agency self-service onboarding and hosted portal administration.
- Real-domain/provider acceptance tests from the supplied handoff.

## Deployment and rollback

Deploy the API first so its additive table and new response fields exist, then
the web build. No new environment secrets are required for the completed work.
Do not enable Custom-Domain White Label as part of this deployment. No DNS or
Clerk changes are required for the commercial controls or admin cleanup.

Keep existing `HOSTED_PORTALS_ENABLED` and encryption/provider settings unchanged
where live custom portals depend on them. Persist the commercial switch in the
shared production database; do not substitute an ephemeral environment variable.

For rollback, retain the additive table and audit events. Revert frontend changes
independently if necessary. Rolling the API back to a version without the gate
would reopen direct custom provisioning when its technical flag is on; preserve
the gate or restrict new provisioning endpoints during an API rollback. Never
disable the existing live registry just to stop new sales.

For the future hosted rollout, assign a shared Vercel wildcard deployment and
validate DNS/TLS separately from Clerk's satellite DNS. Check the current provider
requirements before configuration. None of those future settings is claimed as
deployed or working by this change.

## Verification

Automated coverage includes default-off behavior, full-admin access, explicit
confirmation, persistent independent flags, stale revisions, audit attribution,
API provisioning denial, preserved live portals and custom setup with the gate on.
Browser fixtures exercise desktop/mobile sections, permission-restricted navigation,
lazy requests, unsaved form preservation, confirmation/cancellation and layout.
These fixtures do not establish live provider readiness.

Completed verification on November 15, 2026:

- Full API unittest suite: 2,193 tests run, successful with 32 skipped.
- Focused availability/custom-domain suite: 30 tests passed.
- Full frontend suite: 1,049 tests passed, no failures or skips.
- Next.js production build and TypeScript checks passed.
- Full frontend lint and final changed-component lint passed.
- Knowledge repository validation and staged whitespace checks passed.
- Playwright fixtures passed at 1440px, 768px and 390px widths, including
  restricted-admin access, selective loading, confirmation/cancellation,
  unsaved-draft protection and no page-level horizontal overflow.

API tests used an isolated temporary SQLite database, not the workspace's
existing database. Provider calls and Clerk sessions in browser fixtures were
mocked. Production PostgreSQL concurrency and live Clerk, Stripe, Vercel, DNS
and Resend flows still require deployment-environment verification.

## Changed files

Backend implementation:

- `apps/api/.env.example`
- `apps/api/app/db/models.py`
- `apps/api/app/main.py`
- `apps/api/app/modules/hosted_portals.py`
- `apps/api/app/modules/white_label_availability.py`

Frontend implementation:

- `apps/web/app/platform-admin/page.tsx`
- `apps/web/features/platform-admin/sections.ts`
- `apps/web/features/white-label/availability.tsx`
- `apps/web/features/white-label/settings-link.tsx`
- `apps/web/features/white-label/hosted-setup.tsx`
- `apps/web/features/white-label/setup.tsx`
- `apps/web/features/marketing/marketing-admin.tsx`
- `apps/web/app/dashboard/settings/settings-client.tsx`
- `apps/web/lib/api.ts`

Regression tests:

- `apps/api/tests/test_white_label_availability.py`
- `apps/api/tests/test_hosted_portals.py`
- `apps/web/tests/platform-admin-sections.test.mjs`
- `apps/web/tests/white-label-setup.test.mjs`
- `apps/web/tests/marketing.test.mjs`

Documentation and approved support knowledge:

- This status document.
- `docs/white-label-onboarding.md`
- `docs/knowledge-base/customer/hosted-portals.md`
- `docs/knowledge-base/source-snapshot.json`
- `docs/knowledge-base/generated/customer.jsonl`
- `apps/api/app/modules/support/knowledge/customer.jsonl`

Existing database files, generated bytecode, sample datasets and earlier handoff
documents are deliberately excluded from this implementation commit.
