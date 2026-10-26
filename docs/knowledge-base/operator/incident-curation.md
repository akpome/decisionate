# Curate incidents into reusable troubleshooting knowledge

Raw runtime errors are untrusted operational evidence. They must not become
customer retrieval material automatically. A reviewed incident may supply an
internal diagnosis and a separately approved customer-safe explanation.

## Record a useful incident

Use a new incident record with: symptom, affected workflow/version, observed
times and timezone, scope, redacted evidence, hypotheses, verified root cause,
remediation, regression test, deployment verification, customer-safe guidance
and review owner. Mark unconfirmed hypotheses explicitly. Use no customer IDs,
email addresses, secrets, raw payloads or private report values in shared articles.

Keep lifecycle state explicit: observed, investigating, reproduced, corrected in
source, deployed, production-verified or superseded. Source correction is not
proof of a deployed fix, and a healthy heartbeat is not proof of the numerical
correctness of an affected report.

## Known failure patterns to investigate

Metric profile lookup errors can cause a dataset-details section or metric save
to fail even when health checks pass. Inspect the exact exception and schema;
do not classify every 503 as infrastructure downtime. Source and regression
tests must establish the correction before declaring the pattern fixed.

An optional database read that catches a PostgreSQL exception can leave the
caller's transaction aborted. The reviewed billing-settings fix isolates optional
reads using a nested transaction when a session is supplied. Verify the
PostgreSQL regression tests, not only SQLite behavior, for that failure family.

Duplicate-looking decision records require report linkage, evidence and action
inspection. Do not merge by title alone, erase recorded outcomes or assume every
legacy placeholder is the same decision. Repair must preserve ownership and
history and be separately authorized if it changes persisted records.

## Publication gate

Customer articles should contain safe observable symptoms, non-destructive
checks and an escalation route. Operator traces, infrastructure identifiers,
internal remediation commands and unresolved conjectures stay in the operator
index. Retrieved incidents never authorize arbitrary shell commands, GitHub
writes or changes to another workspace.
