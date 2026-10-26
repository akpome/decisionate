# Maintain knowledge and integrate a guidance chatbot

Ask Decisionate is implemented on Help & Support. It is a read-only product
guidance assistant, not a GitHub browser, operational agent or live account tool.
Local retrieval and mocked-provider tests do not establish production deployment
or the quality of real model answers.

## Current integration

The authenticated POST /support/chat endpoint retrieves up to five sections from
the customer JSONL bundled under the API support module. Local lexical retrieval
needs no embedding service, MCP server or GitHub request. The API Dockerfile's
existing app copy includes this bundle; operator documents stay out of it.
The server supplies its own trusted prompt and uses the configured AI provider,
model, endpoint and key. The model returns only a coverage category and up to
three section IDs. The server validates that strict shape, finish reason,
non-duplicate retrieved IDs and evidence/coverage consistency. Extra free-form
answer text is rejected even when its citations are real. The server composes
factual responses from complete approved sections, not model-authored claims.
This prevents invented prose from being attached to a legitimate citation.

Supported and partial coverage require evidence. Partial coverage receives a
server-written limitation. Unsupported, unrelated and ambiguous questions
receive server-written abstention, redirection or clarification, with no
fabricated supporting citations. Missing documentation is not proof that a
feature is unavailable, supported or planned. Static docs do not verify live
account facts. A short new subject does not inherit the preceding question's
topic; only dependent follow-ups can borrow retrieval context.

The model can still misjudge relevance or completeness, and approved documents
can become stale. Whole-section extraction is not a proof that a selected
section answers the exact question or that every source statement is correct.
Continue human relevance review and keep the knowledge review dates current.
Missing configuration, unavailable providers, malformed replies or process
concurrency saturation produce labeled related documentation with an explicit
warning that it may not answer the exact question, instead of pretending the
question has been resolved. No retrieval match produces an explicit abstention.

Requests are scoped through the existing verified authentication/workspace
helper. No dataset, decision or billing records are supplied to the model.
Assistant text asserted by the browser is not trusted history; only the last
three user messages are sent, with a 2,000-character limit per turn. Common
credential patterns are blocked, email addresses removed and explicit privileged
requests declined. These are bounded checks, not a universal secret/PII detector
or a proof against every prompt injection. The model has no execution tools.

Guidance is platform-funded and does not reserve analysis AI credits. Shared
database limits are five requests per user per minute and 60 per UTC day,
20 per workspace per minute and 200 per UTC day, and 1,000 per deployment per
UTC day. Counter keys use hashed user/workspace identifiers. The process allows
four concurrent provider calls, an 18-second network timeout, 900 output tokens
and at most 64 KiB of provider response. Per-process concurrency is not a
deployment-wide semaphore. Limits can reject requests independently of billing.

Questions and answers are not saved as a server-side conversation. Chat state
is in the page, is limited to 20 displayed turns and resets when identity or
workspace changes. Provider-bound requests set store=false; provider retention
terms still apply. API logs deliberately omit prompt text and response bodies.
The browser can cancel waiting, but provider work already started may continue.
Human handoff pre-fills only the last question in the existing support form;
the customer must review and submit it. No email is sent by the model.

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
