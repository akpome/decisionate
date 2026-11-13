# Verify report sender and delivery

Weekly report delivery uses the centrally configured platform provider, not a
workspace's arbitrary SMTP credentials. Read current settings through authorized
Platform Admin controls; do not inspect or export secret values into chat.

## Sender selection

`get_platform_sender_details` chooses the configured Resend sender when the
provider is Resend, otherwise the configured SMTP sender. Saved database values
have precedence over environment fallbacks where set. Marketing sender settings
are a separate configuration surface.

For managed clients, `build_weekly_report_email_message` changes the display name
to the agency name followed by `via Decisionate`, retaining the platform email
address. Resend preserves that requested display name only when the requested
address matches its configured sender. The agency logo and footer do not prove
an agency-domain sender. The weekly builder does not set an agency Reply-To.

Neither `no-reply@decisionate.ca` nor `alert@decisionate.ca` is hardcoded as the
weekly From address. A delivery record proves its dated message, not every
future send or a different category of email. Confirm a relevant recent weekly
message and the current effective setting before making a categorical claim.

## Delivery evidence

Distinguish job queued, computation completed, sending phase, provider acceptance
and recipient delivery. The worker commits the sending boundary before external
side effects. A restart or partial acceptance requires reconciliation with
delivery history and provider records; do not automatically replay the send.

The Weekly Reports page offers Send report now for an owner-only, one-time send.
`POST /api/v2/business-reports/weekly-owner-jobs` submits a distinct
`weekly_owner_send` job, resolving and freezing the workspace owner's address on the
server, including managed-client owners, and the worker rechecks it before the
external send. It can run with scheduled sending paused. Its success/failure
logs do not update the schedule's last-send markers or recipient list, so they
must not be mistaken for a scheduled delivery. Idempotent retries reuse the
same job; an interrupted external send is never automatically replayed.
The page stores the delivery job in its URL while waiting; reloading reconnects
to that job and does not submit a fresh owner send.

For saved weekly settings, enqueue snapshots and computation are restricted to
the selected dataset IDs. Changes or heavy files in unrelated datasets do not
invalidate or inflate that send. Legacy configurations without a template retain
their existing scope. Missing current-week coverage fails before provider calls
with HTTP 400 and the actual required dates, not a shifted historical week.

Job status includes `retry_safe`, true for a failed send only when the worker
explicitly records that delivery had not started. Provider failures and interrupted
or legacy-unknown sends are not assumed safe. Failed delivery jobs retain a small
delivery-boundary marker; the public result stays null. The frontend releases its
request key only for an explicitly safe, deliberate retry and blocks a known
insufficient-coverage preview. It never automatically replays an external send.

Review only necessary metadata first: subject/category, time, From, recipient
scope and provider delivery status. Do not copy full private message bodies or
unrelated mailbox records into an incident article. Do not send a test message
without explicit authorization and verified test recipients.

## Customer-safe response

Explain that the platform sender and agency display name are distinct, preserve
the agency logo requirement, and state whether an address was verified from
current settings or only an older delivery. Never claim that changing a logo
verifies a sender domain or fixes authentication.

## Workspace invitations

Client workspace creation and adding a member invitation call
`organizations/invitations.py` after the workspace and invitation are committed.
The helper uses the platform system email provider, with agency branding for a
managed client, and a trusted `DECISIONATE_WEB_APP_URL` sign-in link targeting that workspace.
Invitation links use the configured website's origin and the root `/sign-in`
route. A dashboard path, query or fragment in that setting is not appended to
the login path. The client workspace is encoded only as the post-login return
destination. An invalid origin fails the email attempt without sending a broken
link or undoing workspace creation.
An existing browser session without access to the requested workspace returns
from `/auth/redirect` to `/sign-in` with a validated workspace return URL and an
account-switch prompt. The sign-in proxy permits that public prompt without
redirecting it back to the resolver. No protected route is exempted and no GET
request signs anyone out: the user explicitly chooses Use invited account, then
signs in with the invited email. Authentication-service failures retain their
retry state rather than being treated as a wrong-account invitation.
An email failure leaves the invitation pending and the workspace intact.
`email_status`, `email_attempted_at`, `email_sent_at` and a safe `email_error`
record the attempt separately from invitation acceptance. Sent means provider
acceptance, not recipient delivery. A sending or unknown state after interruption
must not be automatically retried. Check provider records before a deliberate
resend using Settings > Client Workspaces > Send invitation. The endpoint has a
one-minute per-invitation cooldown and supplies a Resend idempotency header.
With INFO logging enabled, the API logs `Workspace invitation email accepted by provider`
on a successful automatic send. A `Workspace invitation email was not confirmed` warning records
the invitation ID, organization ID, safe status and exception type without the
recipient's address, credentials or private provider response. Check the API
deployment containing this creation request, then the email provider's delivery
records; provider acceptance alone does not establish inbox delivery.

First sign-in claims invitations only using a verified email from the session or
the authenticated subject's verified primary Clerk email. Standard Clerk session
tokens may omit verified-email claims; configure `CLERK_SECRET_KEY` on the API
server for that server-side lookup. The browser email header is only a lookup
hint, not evidence of ownership. Missing configuration or a provider failure
returns a safe access/service error instead of silently creating a personal
workspace. Do not paste the secret key or invitation email body into diagnostics.
