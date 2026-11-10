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
an allowlisted provider error code, a validated provider request ID when
available, and a recognized completion reason.

For example, HTTP 429 with `insufficient_quota` and HTTP 429 with
`rate_limit_exceeded` are different failures. `response_incomplete` with
`finish_reason=length` identifies a truncated response, not a network outage.
These diagnostics never log credentials, URLs, raw errors, response text,
user facts or refusal explanations. Unknown provider codes and request IDs
that do not match the safe format are omitted. Failed interpretations retain
calculated rules-based results, release internal credit reservations, are not
cached as successful AI responses, and do not automatically repeat a paid
provider request. Saved reports retain their earlier interpretation until a
new report is generated. A locally passing diagnostic test does not establish
the cause of a historical production failure.
