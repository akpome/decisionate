# White-label onboarding

## Start in Platform Admin

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
3. **Deployment:** save the setup, then download the setup package. Use the actual
   Railway API service name to generate worker references. No secrets are saved
   in this form or included in the download.

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
service variables.** Blank non-secret settings remain blank; they are shown as
incomplete in readiness checks. Add these credentials separately using the
prefix in the downloaded file:

- Clerk secret key for the separate authentication application.
- Stripe secret key for the brand's billing account.
- Stripe signing secret for `/billing/webhook/{application_id}`.
- Resend key with permission to send from the verified brand domain.

This is the shortest supported setup path: Clerk, Stripe and Resend. The backend
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

Changing the draft clears saved launch confirmations. Saving never activates
changes. Concurrent edits are protected by revisions; reload rather than
overwriting another administrator's changes. Only unregistered setup drafts can
be deleted here. No workspaces or customer subscriptions are deleted.

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

This is operator-managed onboarding, not public self-service reseller signup.
The plan catalog, trial rules and analytics remain shared; price amounts,
credentials, subscriptions, identities and workspaces are application-scoped.
It is not Stripe Connect, automated revenue sharing or separate regional data
residency. Domain ownership and provider accounts are verified with their
respective services, not claimed from the setup form.

See [the API configuration guide](multi-application-api.md) for advanced
configuration, compatibility, connector credentials and rollback rules.
