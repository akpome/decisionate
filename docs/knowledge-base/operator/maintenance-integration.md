# Maintain knowledge and integrate a guidance chatbot

Ask Decisionate on Help & Support is a read-only product guidance tool, not a
GitHub browser, operational agent or live account tool.

## Current integration

POST /support/chat uses the reviewed customer JSONL bundled in the API image.
Only an exact match to a reviewed question or approved variant can return its
answer. Case, spacing and punctuation do not matter, but changes to the wording
are not silently ignored. The answer includes its approved section and route.

For unmatched questions the endpoint states that it cannot confirm an answer.
Local search may suggest up to three reviewed questions; it does not quote
related sections as answers. Short dependent follow-ups can use the recent
user topic to rank suggestions, never to widen the rules for giving an answer.
This prefers an honest gap to an incorrect match. Add natural phrasings only
after reviewing that the corresponding answer fully addresses them. Test both
approved phrasings and variants with unverified qualifiers.

Ask Decisionate does not call an AI provider or use business-analysis AI
credits. Report AI interpretation is a separate feature. No workspace datasets,
billing records, operator articles or GitHub files are queried. Known credential
patterns and explicit privileged requests are declined without logging question
text. These checks do not replace the instruction to avoid sensitive data.

Requests use the existing verified authentication and workspace helper. Shared
database limits are five requests per user per minute and 60 per UTC day,
20 per workspace per minute and 200 per UTC day, and 1,000 per deployment per
UTC day. Counter keys use hashed user and workspace identifiers.

The browser shows up to 20 messages and resets when identity or workspace
changes. The API does not store a chat transcript. Human handoff pre-fills the
last question in the support form, which the customer reviews and submits.

## Boundaries for later live tools

Use separately authenticated backend operations for permitted current account
facts. Resolve the user and workspace on the server, authorize each object and
return minimized typed data. Never trust an audience, role or workspace asserted
in a prompt or request body. Use explicit approvals for consequential actions;
retrieved troubleshooting text cannot grant execution permission.

The operator index is a different authorized collection. Do not rely on a prompt
instruction alone to keep internal articles private, and do not download the
operator index into a customer browser. Source hashes detect change, not prompt
injection or factual correctness.

## Update and evaluate

Review affected implementation, current UI and tests; update articles, related
questions and evaluation cases; regenerate the source snapshot and customer
export and packaged API copy; run structural checks and review the diff. Use
actual review dates. The knowledge check rejects source/article drift and a
stale API bundle. Operator exports into the API app directory are prohibited.

Evaluate normal guidance, unsupported features, missing live evidence, private
data requests and injection attempts before release. The supplied cases define
expected behavior; structural test success is not an AI-quality score. Add
human review, citation checks and a safe support escalation path before making
the chatbot customer-facing.
