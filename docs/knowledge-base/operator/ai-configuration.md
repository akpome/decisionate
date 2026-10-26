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
