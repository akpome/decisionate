# Customer Email Marketing

## Implementation Map

- Clerk remains responsible for signup and address verification. `identity/service.py` creates a local marketing contact and an outbox entry in the same transaction as the resolved account. Only the server-verified address can become eligible.
- Preserve the existing identity contract: Clerk's signed session claims can include the address and boolean `email_verified: true` only for a verified address, as described in `apps/api/README.md`. When those claims are absent, marketing preferences use the API service's `CLERK_SECRET_KEY` to fetch the authenticated subject's verified primary address directly from Clerk. Missing/unverified primary addresses remain ineligible, and lookup outages return a retryable error. Browser-supplied email headers and saved unverified addresses are not verification. The fallback is confined to preferences, so ordinary product requests do not acquire an extra provider call and existing identity-linking/invitation rules remain unchanged.
- Clerk lookups and Resend marketing requests identify the client with `User-Agent: Decisionate/1.0`. On Clerk lookup failure, API deploy logs include the HTTP status or exception type, never keys, addresses, user IDs, or provider response bodies. A 401 indicates a rejected credential; a 403 may be an authorization or request-filtering failure; a 404 means the authenticated user could not be retrieved. Check that the API service's secret key belongs to the same Clerk instance as the frontend. Network/timeouts and 429/5xx responses require checking provider connectivity or availability rather than asking customers to verify their email again.
- Signup has a separate optional, unchecked checkbox. Settings exposes the account-wide marketing preference to business, agency and client users. Signup succeeds when marketing is declined or unavailable.
- `marketing/models.py` adds contacts, immutable consent evidence, workspace readiness/activity, membership recipients, jobs, an email ledger, webhook receipts and sender settings. No billing facts are copied into another subscription table.
- `marketing/hooks.py` writes actual workspace changes to the database outbox; assigning unchanged scalar values does not enqueue another refresh. Asynchronous imports qualify only after successful completion with usable, non-demo rows; empty/failed imports and connector authorization do not qualify. First readiness is preserved independently of current data availability.
- `marketing/worker.py` runs through the existing supervised ingestion worker. There is no new queue service. Resend REST uses the platform's existing encrypted Resend key/environment fallback; SMTP or Resend system-email delivery is unchanged. No Resend SDK was previously installed; Svix is the signature verifier.
- `run_scheduled_jobs.py` adds an optional marketing reconciliation job. Persistent cursors page through identities and contacts, refreshing inactive states, recipient membership, segments, due dates and provider preferences without loading all tenants in one request.
- Platform Admin, restricted to full platform administrators, holds sender details and displays consent/suppression, lifecycle, sync errors, email history, previews and failed-job retries. Agency users cannot access the global directory.

## Database Rollout

Back up the database first. The API's existing serialized startup schema bootstrap creates these additive tables. For an explicit pre-deployment migration, from `apps/api`:

```sh
python scripts/migrate_marketing.py
python scripts/migrate_marketing.py --apply
```

The first command is a dry run. Neither command grants consent, calls Resend or schedules historical messages. Reconciliation backfills unknown identities only. Unknown and unverified contacts are not exported as new Resend contacts. Existing customers must opt in through Settings.

## Sender Settings

In **Platform Admin > Customer email marketing**, save the real legal sender identity, mailing address, verified sender email, display name and monitored reply-to. Do not enter example addresses in production. Those values feed the public consent request and email footers; each grant retains its exact English/French text, version and sender details even if settings change later.

Sender-domain verification remains an external Resend/DNS action. Follow [Resend's domain instructions](https://resend.com/docs/add-a-domain) to publish the records supplied by your account and confirm domain verification. This feature does not migrate or replace existing essential-email settings.

## Environment Contract

Configure on the API and existing worker:

| Variable | Default / Purpose |
| --- | --- |
| `RESEND_API_KEY` | Existing environment fallback; an encrypted key saved in platform email settings also works. Requires Contacts/Segments and email permissions. |
| `CLERK_SECRET_KEY` | API service only; enables verified primary-email lookup for preferences when the session token lacks verified address claims. This is a Clerk backend key, not the Resend key. |
| `RESEND_WEBHOOK_SECRET` | Resend signing secret, server-side only. |
| `MARKETING_ENABLED` | `false`; enables background contact/webhook processing. |
| `MARKETING_SEND_ENABLED` | `false`; sending gate independent of sync. |
| `MARKETING_TEST_MODE` | `true`; even production sends require an explicitly allowlisted test recipient until deliberately turned off. Staging always requires the allowlist. |
| `MARKETING_TEST_RECIPIENTS` | Empty; comma-separated internal test addresses. Never redirect customer messages to an unrelated test address. |
| `MARKETING_WELCOME_ENABLED` | `false`. |
| `MARKETING_INCOMPLETE_SETUP_ENABLED` | `false`. |
| `MARKETING_TRIAL_ENDING_ENABLED` | `false`. |
| `MARKETING_ACTIVATION_CUTOFF` | Required before sending; an ISO UTC timestamp, for example a real rollout timestamp chosen by the operator. Older welcome/setup messages are not backfilled; a still-useful future trial-ending reminder remains eligible after fresh opt-in. |
| `MARKETING_UNSUBSCRIBE_SECRET` | Stable random secret of at least 32 characters. Links do not expire. Preserve the key for outstanding links; rotating it invalidates older links, so do not rotate within their required validity period. |
| `MARKETING_SEGMENT_IDS` | Optional JSON mapping below, using actual IDs from Resend only for the groups you choose to export. |
| `MARKETING_INACTIVITY_DAYS` | `14`, product assumption, configurable. |
| `MARKETING_WELCOME_WINDOW_HOURS` | `48`; a delayed verification outside this window skips welcome. |
| `MARKETING_SETUP_DELAY_HOURS` | `48` after the actual trial start. Active ingestion defers six hours; existing import-error notices take precedence. |
| `MARKETING_TRIAL_REMINDER_HOURS` | `48` before the actual billing trial deadline; an extension moves unsent reminders. |
| `MARKETING_TRIAL_MIN_NOTICE_HOURS` | `6`; skip reminders that no longer leave useful time to act. Very short trials also respect the welcome frequency interval. |
| `MARKETING_FREQUENCY_CAP_HOURS` | `24` per contact, across automated workspace messages. |
| `DECISIONATE_WEB_APP_URL` | Existing absolute app URL; HTTPS in production. |
| `DECISIONATE_API_URL` | Existing absolute API URL for no-login unsubscribe links; HTTPS in production. |

Optional sender environment fallbacks are `MARKETING_SENDER_IDENTITY`, `MARKETING_MAILING_ADDRESS`, `MARKETING_FROM_EMAIL`, `MARKETING_FROM_NAME` and `MARKETING_REPLY_TO`. Saved admin values take precedence. No secrets are exposed to browser code.

Configure `MARKETING_SCHEDULER_SECRET` on the API and scheduler and add `marketing` to an explicitly configured `SCHEDULED_JOBS`. Without an explicit list, the existing runner selects jobs with configured secrets. The protected endpoint is `POST /marketing/reconcile`, using `X-Marketing-Scheduler-Secret`. It advances persistent cursors in batches of up to 100; the existing recurring cron invocation completes successive pages. Run often enough for the contact population to complete at least one pass per day. Email submission occurs in the worker, not the scheduler request.

## Segments and Recipients

Decisionate tracks eight lifecycle groups internally. You do not need to purchase or create eight Resend segments: configure only the groups useful for your current plan. An omitted or empty mapping skips that group's Resend membership, not contact sync or eligible lifecycle emails. All consent, verification, suppression and send gates still apply.

For the initial two-segment setup, configure:

```json
{
  "trial_data_ready": "ACTUAL_SEGMENT_ID",
  "trial_expired": "ACTUAL_SEGMENT_ID"
}
```

Leave the existing `General` segment unmanaged; do not map unrelated lifecycle groups to it just to satisfy configuration. Decisionate preserves unmanaged membership during normal sync, but removes all memberships on withdrawal. A subscribed contact may have no mapped segment while still qualifying for a lifecycle email. For example, an incomplete-setup trial owner need not be in either of the two initial segments to receive an eligible welcome or setup reminder.

The complete optional mapping is:

```json
{
  "prospect": "ACTUAL_SEGMENT_ID",
  "trial_setup_incomplete": "ACTUAL_SEGMENT_ID",
  "trial_data_ready": "ACTUAL_SEGMENT_ID",
  "paying_customer": "ACTUAL_SEGMENT_ID",
  "trial_expired": "ACTUAL_SEGMENT_ID",
  "former_customer": "ACTUAL_SEGMENT_ID",
  "inactive_customer": "ACTUAL_SEGMENT_ID",
  "agency_account": "ACTUAL_SEGMENT_ID"
}
```

These are placeholders, not usable IDs. One persisted primary marketing workspace determines the subscription/setup segments. Owner status is derived from real membership/ownership. Invited team members and agency-funded client spaces do not receive trial or billing upgrade prompts. The existing billing workflow designates the owner as billing recipient. Inactive/agency segments can overlap. Scheduled cancellation stays paying until entitlement ends; payment trouble is not labeled former. Obsolete managed segment membership is removed, not just supplemented. Withdrawal removes every provider segment and marks the contact globally unsubscribed.

To add a segment later, create it in Resend and add its actual ID under the matching group name in `MARKETING_SEGMENT_IDS` on both the API and worker. Retain the existing IDs. Omitted keys and empty strings both leave room for future groups without requiring extra provider segments. Redeploy both services to load the updated environment; normal scheduled reconciliation then queues existing contacts for membership refresh even when their account or consent has not changed. Existing eligibility rules determine membership, and withdrawn or suppressed contacts are not resubscribed. Adding any of the eight supported groups requires no schema or code changes, and does not enable an email automation or grant new consent.

On Railway, the worker can use `${{decisionate-api.MARKETING_SEGMENT_IDS}}` as a reference variable instead of a duplicated JSON value, provided `decisionate-api` is the actual API service name. Future edits then happen only on the API; review and deploy the staged changes for both services. See [Railway reference variables](https://docs.railway.com/variables).

There is no newsletter form or prospect signup in this initial release; the prospect segment is reserved for that later scope. Monthly updates and reactivation are manual campaign use cases, not automatic sequences. Topics and a campaign editor inside Decisionate are not added.

## Webhooks and Unsubscribe

In Resend, register `https://YOUR_API_HOST/marketing/webhook` for:

- `contact.updated`, `contact.deleted`
- `email.sent`, `email.delivered`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`
- `suppression.added`

Use the actual API host and signing secret. Svix validates the raw body, signature and timestamp. The event ID is unique. Only minimal preference/delivery identifiers are retained, not the full email content. Explicit withdrawal/suppression applies locally before acknowledgement even if marketing processing is disabled. Events lacking unsubscribe details are fetched through the outbox. Provider opt-ins never grant local consent or clear a newer opt-out. A fresh authenticated opt-in on the verified address is required to resubscribe. Hard bounces/complaints stay suppressed; there is no force-subscribe control.

Marketing email `GET /marketing/unsubscribe?token=...` displays confirmation to avoid link-scanner withdrawals; POST immediately suppresses without login. It also supports List-Unsubscribe one-click POST. Signing tokens authorize withdrawal only, not access to workspace data. Keep the configured API domain and signing secret available for outstanding links.

## Delivery and Dry Run

Welcome, incomplete setup and trial ending use HTML and plain-text templates with one main CTA, actual trial timestamps and authenticated app links. `workspace_id` links are selected only after verifying membership. The ledger has unique contact/workspace/sequence/type keys. API acceptance is `submitted`, not `delivered`; delivery webhooks update the ledger. The original payload and idempotency key are reused on ambiguous retries only inside a conservative 23-hour window. Older uncertain submissions are held for manual provider reconciliation, never blindly replayed. Failed sync retries always read current preference/state; they cannot restore withdrawn consent.

The current application creates one onboarding trial per workspace subscription. Its sequence uses the immutable workspace/subscription record IDs, not a mutable billing-period timestamp. Extending the deadline or adjusting the billing period cannot create another welcome or repeat a sent reminder. Future support for genuinely separate trials on the same subscription row requires an explicit authoritative trial-instance identifier.

Agency welcome/setup copy directs the agency to create a client workspace and invite its owner, not to connect client data. The setup reminder stops once a client workspace exists. Data-based segment classification remains separate from this agency onboarding milestone; no client's private metrics are read or exported to describe agency setup.

With sync enabled and sending disabled, due ledger entries record `dry_run_sending_disabled`. Full admins can preview messages. The admin contact table's test button queues a neutral `delivery_test` email for a verified, opted-in, allowlisted internal contact with an owned workspace, an existing provider contact and no known sync failure. A routine revision update does not prevent queueing: the request also queues current contact sync, and the worker waits for that revision before sending. The table shows `Updating` instead of `Synced` while a newer revision is pending. Repeated requests reuse the pending test and its sync job. Paid accounts can use it without altering billing, claiming a trial, or enabling any lifecycle automation. The test includes the normal sender footer, unsubscribe links, delivery tracking and idempotency; it remains subject to sync/send gates, provider opt-out checks and the contact frequency cap. The API also supports `POST /marketing/admin/contacts/{id}/test?kind=welcome` for an internal active-trial owner, still gated by the welcome automation flag. A preview does not send. No real external delivery was performed by repository tests.

For an initial delivery check, keep `MARKETING_TEST_MODE=true`, allowlist only the controlled test addresses and leave `MARKETING_WELCOME_ENABLED`, `MARKETING_INCOMPLETE_SETUP_ENABLED` and `MARKETING_TRIAL_ENDING_ENABLED` false. Configure a current UTC `MARKETING_ACTIVATION_CUTOFF` on the API and worker, then deliberately enable `MARKETING_SEND_ENABLED` on both. After deploying and refreshing the admin page, queue one neutral test. Confirm the ledger reaches delivered via a signed webhook, verify the inbox, then test withdrawal before testing another send. Return the send gate to false after the check until the lifecycle rollout is deliberately approved. Manual delivery tests are not scheduled automatically and cannot be sent to unverified, unconsented, suppressed or non-allowlisted contacts.

All sends wait for a successful current contact sync and fetch the provider's global unsubscribe state again immediately before submission. Due webhook jobs take priority over contact sync, which takes priority over workspace refreshes; retry deadlines still apply. Successful contact sync completes queued versioned jobs covered by that revision and wakes emails waiting specifically for contact sync, without shortening frequency caps or provider retry deadlines. Provider outages defer work; ordinary authenticated requests use a read-only contact fast path so a marketing-sync lock does not hold up regular business requests.

For an uncertain submission, inspect Resend email logs and the ledger's provider message ID/tags before any manual decision. The UI intentionally has no retry-send button for uncertain messages. Ordinary provider timeouts and 429/5xx use bounded backoff and jitter; exhausted sync failures remain visible and retryable. Disabling sends preserves evidence/ledger state and does not affect essential notices or user-configured reports.

## Founder Broadcast Checklist

1. Confirm domain verification, sender settings, the IDs for your configured segments and current contact sync health.
2. In [Resend Broadcasts](https://resend.com/docs/dashboard/broadcasts/editor), select an application-managed segment. Leave topic unset for the initial single global marketing preference; adding topics requires extending synchronization and topic webhooks first.
3. Check the recipient list, exclude unsubscribed/suppressed addresses and coordinate timing against recent lifecycle sends in Platform Admin. The worker's 24-hour cap does not control dashboard Broadcasts.
4. Compose a short subject and one main action. Supported first-name fallback is `{{{contact.first_name|there}}}`. Insert the actual legal sender, mailing address and monitored contact details.
5. Add the provider unsubscribe URL `{{{RESEND_UNSUBSCRIBE_URL}}}` as a footer link. A segment selection never bypasses global unsubscribe.
6. Preview mobile/desktop, inspect plain text and links, and send an internal test. Then deliberately schedule/send the final copy. No CSV transfer or recurring unfinished campaign is needed.
7. Review delivery, complaints and unsubscribes alongside product outcomes. Lifecycle links carry sequence/UTM identifiers and record deduplicated authenticated recipient visits in the authorized workspace; forwarded links from another user do not count. Link visits alone, opens and background sync are not meaningful product activity. Readiness, activity, existing decision/action records and billing provide downstream facts to review; this release does not claim causal conversion attribution or a completed campaign-attribution dashboard.

## Release Verification

Run the marketing API tests, related auth/billing/ingestion/service-email regressions, web tests, lint and build. Verify migration twice on a disposable database. Render all three email templates at mobile and desktop widths. The mocked end-to-end checks cover identity, opt-in, verification, segment reconciliation, welcome submission, usable data, unsubscribe and blocked future delivery.

External rollout is still required: saved real sender details, verified domain/DNS, a working Resend key and webhook secret, actual IDs for the configured segments, stable unsubscribe secret, scheduler configuration, activation cutoff, and internal test recipients. Start with sync only, inspect dry-run decisions, perform a real internal delivery/unsubscribe test, then enable the three flags and finally disable test mode for eligible customers. Repository tests do not establish production deliverability.

Consent policy here deliberately requires express opt-in for promotional onboarding. It does not claim that this is the only lawful basis under Canadian law. Consult [CRTC's CASL guidance](https://crtc.gc.ca/eng/com500/guide.htm) for compliance review. Provider references verified during implementation: [Contacts](https://resend.com/docs/api-reference/contacts/create-contact), [Segments](https://resend.com/docs/api-reference/contacts/list-contact-segments), [contact.updated](https://resend.com/docs/webhooks/contacts/updated), [verification](https://resend.com/docs/webhooks/verify-webhooks-requests), and [24-hour idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys).
