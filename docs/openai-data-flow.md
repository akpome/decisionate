# Configured AI Data Flow

This document records the current API request shape so it can be reviewed when
AI features change.

## When a request is made

The API calls the configured AI provider only when `AI_PROVIDER`, `AI_API_KEY`,
`AI_MODEL`, and `AI_API_URL` are all present. Without those settings, the
application uses its rules-based fallback and does not make an AI request.
Analysis results may also be served from the configured analysis cache.

## Current request payload

The request is sent to `AI_API_URL` and contains:

- the configured model, temperature, output limit, and JSON response format;
- a system instruction describing Decisionate's analysis task and output
  schema; and
- a user message with exactly two application fields: `context` and `facts`.

`context` identifies the requested analysis. `facts` is the bounded object
prepared by the relevant dashboard, dataset, forecast, report, alert, or
decision workflow. It can include aggregate metric values, trend summaries,
relationship summaries, selected labels, and bounded decision outcomes or
lessons from the active workspace.

The AI service does not intentionally include the uploaded Parquet file, an
unbounded dataframe, or every raw source row. A caller that adds a new fact to
the `facts` object must review whether it contains personal information,
secrets, or raw records before shipping the change.

## Workspace and learning boundaries

The active workspace is used to scope the application-side data query and AI
cache key. The workspace identifier is used for internal accounting and cache
isolation; it is not included as a separate field in the OpenAI user payload.
Historical decision-learning context is selected from the same authorized
workspace and is bounded before being placed in `facts`.

## What comes back

The expected response is JSON containing a summary, up to five
recommendations, up to five risks, and a confidence value. The response is
stored or returned as application analysis. It does not automatically execute
a business action. A user can review a recommendation, create a decision,
record its outcome, and add a lesson for later bounded learning context.

## Review requirement

This is a current implementation description, not a promise about a provider's
retention or training policy. Review the configured provider terms and data
processing settings before production, and re-run the AI payload test whenever
the request builder changes.

## Help and Support guidance

Ask Decisionate uses a separate support prompt, not the analysis prompt or AI
credit accounting. It sends a bounded question, up to three recent user messages
and up to five approved customer-documentation sections to the configured Chat
Completions endpoint. No workspace datasets, account records, operator articles,
raw GitHub files or model execution tools are included. The browser's assistant
messages are not trusted context. Known credential patterns are blocked and
email addresses removed; users must still avoid private or sensitive records.

The support request sets store=false, a 900-token completion cap and an
18-second network timeout. The model returns only a coverage category and up to
three retrieved section IDs, not factual answer prose. The server rejects extra
answer text even with valid citations and composes responses from complete
approved sections. Unsupported questions get a server-written limitation;
partially supported questions include the documented information and acknowledge
what cannot be confirmed. An unrelated or ambiguous question can be redirected
or request clarification. No-match retrieval makes no provider request.

Missing configuration, provider failure or rejected selections return explicitly
labeled related documentation, with a warning that it may not answer the exact
question. Missing documentation is not evidence of a feature's availability or
roadmap. Selection relevance and source freshness still require review; this is
not a guarantee that every selected section answers every user question.

Conversation state lives in the page, not a persisted chat transcript. Separate
database counters bound platform-funded requests across replicas. Provider
processing/retention terms still apply, and stopping a browser request does not
necessarily cancel work already started upstream. Human support is a separate
reviewable form and is never sent automatically by an AI answer.
