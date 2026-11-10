# Diagnose AI configuration without exposing credentials

The current adapter supports `AI_PROVIDER=openai`. The runtime reader also needs
`AI_API_KEY`, `AI_MODEL` and `AI_API_URL` for configuration readiness. Key, model
and URL have `OPENAI_API_KEY`, `OPENAI_MODEL` and `OPENAI_API_URL` aliases.
Provider itself has no equivalent inferred default.

## What status proves

`build_ai_status` returns provider, model and a configuration boolean. Provider
and model do not depend on a key being present. Blank provider/model indicates
the responding process did not expose those settings through the reader, not
that an intentionally missing key suppressed their labels.

`configured: true` means the supported-provider and non-empty-value check passed.
It does not validate a secret, endpoint syntax, account access, model availability,
credits or a successful provider request. A placeholder string can pass a
presence check and still fail interpretation.

Previously successful settings do not rule out a timeout, a provider-side
request rejection or a later response that cannot be read. The shared
`provider_unavailable` fallback is not proof of a provider outage or a missing
key. By default the request timeout is 20 seconds and output is capped at 500
tokens; `AI_REQUEST_TIMEOUT_SECONDS` and `AI_MAX_OUTPUT_TOKENS` can override
those values. A token-limited JSON response may be incomplete even when an
earlier response with the same settings worked. Do not change credentials or
increase paid-request budgets solely because the generic banner appeared.

## Trace a mismatch

Compare live `/health` or authenticated `/ai/status` with the admin panel.
Confirm the actual API service, environment, active deployment and custom-domain
routing. Variable edits must reach a new running deployment. API and analysis
worker are separate processes; worker-only values do not populate API status.
Do not expose environment dumps or print the key while diagnosing.

The locally reviewed admin source includes focused, visible-page AI-status
refresh, focus refresh and a manual control. Check deployment revision before
claiming that UI change is live. An old browser snapshot and a missing backend
setting are separate failure modes.

## Verify a real interpretation

The adapter expects a Chat Completions-style JSON response and currently sends
`temperature`, `max_tokens` and JSON-object response format. Do not select a new
model or Responses endpoint merely because it appears newer; verify official
provider compatibility and retirement notices before configuring it.

Generate a fresh authorized report with interpretation requested and inspect
`ai_analysis.source`. `openai` distinguishes a successful external response from
`rules`. Credits exhausted, unsupported/missing configuration, request failure
or malformed output can cause fallback. Saved snapshots do not recompute after
configuration changes. Do not infer provider token billing from internal credits.

## Read safe failure diagnostics

Generate a new preview, then look for `AI analysis fallback:` in the process
that generated it. Reports normally run in the analytics worker; an API-only
configuration check is not a worker request test. The warning distinguishes
`provider_http_error`, `provider_timeout`, `provider_network_error`,
`response_incomplete`, `response_refused`, `invalid_response` and
`invalid_request_settings`. It includes the request/response phase, HTTP status,
an allowlisted provider error code and error type, a validated provider request
ID when available, and a recognized completion reason. It also includes bounded
request/token limit, remaining and reset headers (including project token
limits), plus `Retry-After` when present and safe to parse. Retry delays are
logged as seconds or a normalized timestamp; they do not trigger a retry.

`request_bytes`, `estimated_input_tokens` and `max_output_tokens` describe the
failed request without exposing its contents. The input estimate uses character
count, not the provider's tokenizer. It is not billed usage or proof that a
token limit was exceeded. The actual configured model and output allowance
remain unchanged.

For example, HTTP 429 with `rate_limit_exceeded` and type `tokens` or `requests`
differs from an account restriction. Recognized restriction codes include
`credit_balance_exhausted`, `organization_spend_limit_exceeded`,
`project_spend_limit_exceeded` and `organization_usage_limit_exceeded`.
`insufficient_quota` may appear as an error type even when the code is null.
`slow_down` identifies temporary throttling; `server_is_overloaded` identifies
a provider capacity rejection. Do not assume a card-billed account needs
prepaid credits, or that HTTP 429 proves heavy recent usage. The specific error
code/type and headers must guide the diagnosis. `response_incomplete` with
`finish_reason=length` identifies a truncated response, not a network outage.
These diagnostics never log credentials, URLs, raw errors, response text,
user facts or refusal explanations. Unknown provider codes/types are replaced
with `unrecognized`, distinct from a missing or null field (`None`). Request IDs
and header values that do not match the safe formats are omitted. Failed
interpretations retain calculated rules-based results, release internal credit reservations, are not
cached as successful AI responses, and do not automatically repeat a paid
provider request. Saved reports retain their earlier interpretation until a
new report is generated. A locally passing diagnostic test does not establish
the cause of a historical production failure.

After deploying a diagnostic change to the analytics worker, generate one new
preview (rather than opening a saved snapshot), then inspect its warning and
request ID in that worker's deployment logs. This makes a normal provider
request and may incur usage charges if it succeeds. Share only the sanitized
diagnostic line, never credentials or an environment dump. If the error details
are still unavailable, preserve the request ID and timestamp for provider
support rather than guessing a billing fix or repeatedly regenerating reports.
