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

Review only necessary metadata first: subject/category, time, From, recipient
scope and provider delivery status. Do not copy full private message bodies or
unrelated mailbox records into an incident article. Do not send a test message
without explicit authorization and verified test recipients.

## Customer-safe response

Explain that the platform sender and agency display name are distinct, preserve
the agency logo requirement, and state whether an address was verified from
current settings or only an older delivery. Never claim that changing a logo
verifies a sender domain or fixes authentication.
