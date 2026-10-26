# Operator architecture and trust boundaries

This article is for authorized operators, not the customer retrieval index.
Source-level architecture does not establish the current production revision,
configured vendors or deployed service names.

## Runtime responsibilities

The Next.js web application calls the FastAPI API. PostgreSQL holds application
records and durable job state. Configured object storage holds dataset assets;
the default analytics configuration is DuckDB and Parquet. This is not a claim
that every calculation is executed as a DuckDB query: report and statistical
modules also use pandas, NumPy, SciPy and statsmodels paths.

The ingestion worker consumes its own queue. The persistent Reports analysis
worker runs report previews, selected-metric anomaly jobs, weekly previews and
weekly sends in supervised child processes. Forecasts and basic relationship
monitors were not moved into that Reports queue. The retired advanced
correlation worker must not be recreated to fix a current report.

## Isolation and authorization

The active workspace and verified user identity scope data access. Server
authorization, source revision checks and role-specific write permissions remain
authoritative. Platform Admin is separate from workspace ownership; support
chat cannot elevate either role. Object identifiers or public metadata are not
authorization credentials.

Knowledge articles are static approved guidance. An authenticated live-data tool
would be a separate product surface requiring its own authorization, minimized
response schema, auditing and testing. Do not expose database credentials,
arbitrary SQL, raw stack traces or GitHub write operations to a public chatbot.

## Proposed support integration

Use the existing backend to retrieve customer-only knowledge and call the
configured model. This repository does not add that endpoint or change current
AI analysis billing. Operator retrieval belongs in a separately authorized index.
MCP is optional interoperability, not a requirement for product documentation
retrieval. An MCP server would not replace tenant authorization or safe tool
design if external AI clients are added later.
