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
