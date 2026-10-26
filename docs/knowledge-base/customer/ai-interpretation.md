# AI interpretation and rules fallback

The statistical engines compute metric comparisons, anomaly evidence and
relationship tests. Optional AI interpretation explains the supplied evidence
and suggests risks or follow-up actions. The AI does not create missing
observations, change statistical results or prove a causal business explanation.

## Request an interpretation

For a manual report, select Include AI interpretation and generate a fresh
preview. That option is off by default in manual report definitions. A previously
saved snapshot keeps its original narrative; adding provider credentials does
not rewrite its history.

Provider configuration, a supported model/endpoint, workspace AI credits and
service availability affect whether an external AI response can be obtained.
The current implementation supports an OpenAI provider adapter; this static
article does not certify a currently available model or a particular account's
provider access.

## Understand the source label

A source of rules means deterministic fallback, not an external AI response.
Missing configuration, an unsupported provider, exhausted credits or a failed
provider request can trigger fallback where the feature implements it. A
successful report or Configured status alone does not prove external AI ran.

Provider and model names can be displayed without an API key. A key is required
to call the provider, not to render those names. Customer users should not add
platform credentials or paste a secret into chat; configuration is an operator
responsibility.

## What information is supplied

Report interpretation uses bounded selected metric facts, included relationship
findings and anomaly summaries rather than the full raw dataset or every trend
point. Relevant authorized decision outcomes and lessons can supply context.
Do not infer a provider's retention, training or data-processing policy from this
request shape. Consult current approved Privacy and Security information.
