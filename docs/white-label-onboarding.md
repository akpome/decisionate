# White-label onboarding

## Hosted self-service portals

Agency owners open **Settings > Set up your branded portal** on Decisionate.ca.
This provisions a separate branded frontend from the existing repository; the
customer does not deploy code, copy API credentials or create Stripe prices.
The operator-managed workflow below remains available for independently deployed
frontends. Neither workflow migrates existing workspaces between brands.

### Customer steps

1. Enter your brand, portal domain, optional logo, color, support email, currency
   and prices. Supply privacy and terms URLs on your business website, outside
   the portal domain. Annual prices are total annual charges. Save details.
2. Choose **Connect Stripe** and authorize your own live Standard Stripe account.
   Complete Stripe's business requirements. The platform's own account and an
   account already assigned to another portal are rejected. Details are locked
   once connected to avoid changing provisioned billing or identity settings.
3. Choose **Prepare portal**. Setup creates a Vercel project, separate production
   Clerk application, sender setup, billing products/prices and signed webhook,
   then deploys the frontend. It saves progress after each bounded step.
4. Add the displayed DNS records with your domain provider, including any MX
   priority. This requires the domain owner's authorization. Choose **Check
   setup again** after DNS propagates and the build completes.
5. Choose **Launch portal** when ready. Launch repeats provider checks, validates
   HTTPS and the expected portal identity, then activates the registration.

Closing setup does not discard completed steps. Reopen it and continue. Retries
reconcile provider resources before creating replacements. A second preparation
cannot run concurrently; a stale ten-minute operation lease can be reclaimed.

One portal is supported per Agency owner. It starts at sign-in, not a generated
marketing website. Signup creates a new isolated workspace. Payments go to the
connected Stripe account; no new commission or revenue-sharing model is added.
The existing catalog, trials, features and AI-credit rules remain shared.

### One-time operator configuration

Keep `HOSTED_PORTALS_ENABLED=false` until the provider accounts are ready.
Customer setup shows missing configuration and will not claim success. Configure
these on the API in the deployment secret store:

| Setting | Purpose |
| --- | --- |
| `HOSTED_PORTALS_CLERK_PLATFORM_TOKEN` | Clerk Platform API token, not a normal application secret |
| `HOSTED_PORTALS_VERCEL_TOKEN` | Permission to create projects, domains, environment variables and deployments |
| `HOSTED_PORTALS_VERCEL_TEAM_ID` | Team hosting the generated portals |
| `HOSTED_PORTALS_GITHUB_REPOSITORY` | Repository in `owner/repository` form |
| `HOSTED_PORTALS_GITHUB_REPO_ID` | Numeric GitHub repository ID for deployments |
| `HOSTED_PORTALS_GITHUB_REF` | Approved deployment branch, normally `main` |
| `HOSTED_PORTALS_STRIPE_SECRET_KEY` | Live Stripe Connect platform key |
| `HOSTED_PORTALS_STRIPE_CLIENT_ID` | Live Standard Connect OAuth client ID |
| `HOSTED_PORTALS_RESEND_API_KEY` | Permission to manage domains and restricted sending keys |

The [Clerk Platform API](https://clerk.com/docs/reference/platform-api) requires
separate access (private beta at implementation); ordinary Clerk application
keys cannot create applications. Confirm access before offering automatic setup.
Install the Vercel GitHub integration with access to the selected repository.
Use provider plans and quotas suitable for customer hosting.

Register this exact live callback in
[Stripe Connect settings](https://docs.stripe.com/connect/oauth-reference):
`https://<public-api-domain>/api/v2/hosted-portals/stripe/callback`.
Set `DECISIONATE_API_URL` to the public HTTPS origin and `STRIPE_API_URL` to
`https://api.stripe.com/v1`. Connect callbacks use expiring, one-use state.

API, analytics, ingestion and scheduler processes need the same database,
`OAUTH_TOKEN_ENCRYPTION_KEY`, `HOSTED_PORTALS_ENABLED=true` and
`HOSTED_PORTALS_STRIPE_SECRET_KEY`. Keep existing storage and provider settings.
Provisioning-only Clerk/Vercel/Resend credentials belong on the API. Portal Resend
keys can only send from their mail domain; the sender is
`no-reply@mail.<portal-domain>`. Monitor bounces, complaints and reputation in the
email provider. The displayed DMARC record uses monitoring (`p=none`); verified
sender status does not prove DMARC enforcement or inbox delivery.

The additive `hosted_portals` table holds configuration, revisions, resumable
progress and encrypted secrets. API/workers read live registrations through a
five-second cache. Customer launches do not edit Railway variables or redeploy
the backend. Back up this table and protect the encryption key for recovery.

### Verification and limits

Launch checks cover domain ownership/routing, Clerk DNS/SSL readiness, Resend
domain status, production-build readiness, HTTPS portal identity, Stripe charges
and payouts, price amounts/intervals and the enabled webhook URL. They do not
simulate a human sign-in, collect a payment or send a test email. Repository
tests use mocked provider responses. Run a real portal pilot before public
rollout: sign-in/out, invitations, checkout, signed webhooks, worker email,
cross-application access denial and existing .ca workflows must all be checked.
Use provider-approved test procedures; the customer wizard rejects test-mode
Connect accounts for launch.

This release does not add self-service edits to a launched domain, prices or
credentials; automated teardown; account transfer; arbitrary plan catalogs;
regional data residency; or marketing automation. Provider resources can incur
costs during preparation. Operators must clean up abandoned resources without
deleting those belonging to live portals. Connector OAuth credentials and
approvals are not provisioned here and never borrowed from .ca. File uploads
remain available; connector enablement needs operator integration for the brand.
Help still documents the shared Decisionate product, not custom approved content
for each reseller. Review that copy before public rollout.

Do not disable the hosted registry or remove registrations while customer
workspaces or jobs depend on them. Invalid or unavailable registrations fail
closed, never falling back to another brand's secrets. These are launch checks,
not continuous monitoring or automatic account suspension.

## Operator-managed frontends: Start in Platform Admin

Sign in to Decisionate.ca as a **full-access platform administrator**, open
**Platform Admin > White-label setup**, and expand the section. Workspace and
agency administrators cannot use these controls.

The wizard saves setup drafts. It does not create a website, turn on billing,
send email or change a live application's settings.

1. **Brand:** enter the brand name, a permanent application ID (for example
   `decisionate-ai`), frontend URL, optional alternate origin, support and sender
   addresses, logo, color, privacy page and terms page. Use a different frontend
   origin from every other application.
2. **Sign-in and billing:** enter the separate Clerk application's issuer URL,
   billing currency, and that brand's Stripe prices and displayed amounts.
   Prices are entered in currency units, not cents. Annual prices are the total
   annual charge. All eight existing products are listed so an enabled checkout
   or add-on does not unexpectedly lack configuration. Drafts may be incomplete.
3. **Deployment:** complete the required brand and billing fields and save before
   downloading. Missing fields are listed with links back to their step. The API
   must have `DECISIONATE_API_URL` set to its public HTTPS origin; there is no
   localhost fallback. Use the actual Railway API service name to generate worker
   references. No secrets are saved in this form or included in the download.
4. **Launch review:** after deploying, choose **Check deployment**. Resolve
   configuration differences, perform the listed launch tests, choose **Save
   launch tests**, then **Confirm launch**. This records the operator's sign-off,
   not automatic deployment or verification by the providers.

**Save and continue** saves the current step. Selecting a saved setup returns to
its first incomplete stage. Switching applications or reloading with unsaved
edits asks whether to discard them; failed saves preserve the entered values.

## What the package contains

| File | Purpose |
| --- | --- |
| `START-HERE.md` | Brand-specific installation sequence, URLs and remaining fields |
| `api-variables.json` | Non-secret API variables with the correct prefix and merged registry |
| `worker-references.json` | Railway references to the API service's configuration and secrets |
| `required-secrets.txt` | Names of the four credentials to add in the secret store |
| `frontend-settings.json` | API URL, application ID, frontend URL and authentication issuer |
| `stripe-events.json` | Events to enable on the separate Stripe webhook |
| `launch-checks.json` | Provider, frontend, worker and isolation acceptance checks |

Merge the variables into existing deployment settings. **Do not replace all
service variables.** Required fields and all eight price IDs and amounts must be
complete before export; a logo is optional. Add these credentials separately
using the prefix in the downloaded file:

- Clerk secret key for the separate authentication application.
- Stripe secret key for the brand's billing account.
- Stripe signing secret for `/billing/webhook/{application_id}`.
- Resend key with permission to send from the verified brand domain.

This operator path supports Clerk, Stripe and Resend. The backend
also supports other configured JWT providers and SMTP through the existing
deployment configuration; that is an advanced setup outside this wizard.

The generated registry preserves all applications registered **at download
time**, including their custom environment prefixes. Download again after any
other brand is registered. The package never exports existing secret values or
replaces the default Decisionate.ca variables.

Redeploy the API, analytics worker, ingestion worker and scheduler with matching
configuration. Railway references reduce repeated entry but do not deploy or
restart these services automatically. Keep their shared database, storage and
queue settings. Each connector still needs the brand's own prefixed OAuth
credentials and any provider review; the wizard does not provision them.

## Check before launch

Refresh the setup to compare the draft with the running API's registration and
environment. Missing credentials, mismatched configuration and incomplete price
settings remain visible. **Configuration matches does not mean launch verified.**
The checks do not contact Stripe, Clerk, Resend, DNS or other worker processes.

Complete and save the launch checkboxes only after testing:

- The frontend domain and HTTPS, including the brand's public/shared pages.
- Sign-in, sign-out and a workspace invitation using the new Clerk application.
- Checkout, payment failure, subscription changes and a signed Stripe webhook,
  with the brand's currency and prices, first in a test environment.
- A real test invitation and weekly email from the brand's verified sender;
  check SPF, DKIM and DMARC setup with the email provider.
- Jobs running in each worker with the same registration and secret references.
- Tokens and workspaces rejected across application boundaries.

The application list distinguishes **Draft**, **Ready to deploy**, **Deployment
incomplete**, **Ready for launch review**, **Launch confirmed**, and **Launch needs
review**. A confirmed launch shows its recorded time. Editing setup fields clears
the manual checks and invalidates the confirmation. Deployed configuration or
credential changes also invalidate it when the setup is next fetched; review,
save the launch tests and confirm again. This is not continuous monitoring.

Concurrent saves, downloads from the wizard and confirmations are protected by
revisions. When a conflict occurs, **Reload setup** can discard your local edits
and fetch the latest version. Saving and confirming never activate changes. Only
unregistered setup drafts can be deleted here; no workspaces or subscriptions
are deleted.

Launch confirmations use the additive `white_label_launch_confirmations` table,
created by the existing database initialization. It records application ID,
revision, operator and time, plus a configuration digest to detect changes; no
credential values are stored in that table or returned to the browser. The
full-access-only `POST /admin/white-label/{application_id}/complete` accepts the
saved revision, rechecks readiness and records an audit event. Database backups
and normal staging checks still apply before rollout.

## Frontend integration and boundaries

`GET /api/v2/application` now includes a `branding` object with `logo_url`,
`primary_color`, `support_email`, `privacy_url` and `terms_url`, alongside the
application name, currency and feature flags. It contains no credentials. An
omitted secondary logo stays omitted rather than using Decisionate's logo.
Transactional and weekly emails use the selected brand name. An agency client's
agency branding continues to take precedence within its application.

The new frontend must implement the existing callback routes and use the
bootstrap settings, its own authentication integration and currency display.
It is **not generated or automatically rebranded** by this wizard. The current
.ca site is unchanged. Product documentation and public marketing copy require
review for a different brand; do not present Decisionate-specific help as that
brand's approved documentation.

This older wizard is operator-managed onboarding, separate from hosted setup.
The plan catalog, trial rules and analytics remain shared; price amounts,
credentials, subscriptions, identities and workspaces are application-scoped.
It is not Stripe Connect, automated revenue sharing or separate regional data
residency. Domain ownership and provider accounts are verified with their
respective services, not claimed from the setup form.

See [the API configuration guide](multi-application-api.md) for advanced
configuration, compatibility, connector credentials and rollback rules.
