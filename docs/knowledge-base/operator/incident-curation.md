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

An identity backfill can fail during API and worker startup when both a legacy
workspace ID and its internal replacement already have subscription records.
The observed failure is a unique-constraint violation on the subscription's
workspace ID, before request handling or report execution starts. Do not label
this as a malformed upload or an analytics computation failure.

The source correction migrates non-conflicting subscriptions normally. On a
collision it preserves both records and leaves the canonical workspace's
subscription unchanged, with a billing-reconciliation warning. A savepoint
contains a collision caused by a concurrent insert. It does not merge plans,
provider subscriptions, credit balances or charges. Reconciliation still needs
an authorized review of the provider records and both local subscriptions,
especially if the legacy record is paid and the canonical record is free.
Tests cover startup repetition, unchanged billing fields and continuation of
other workspace migrations, with separate PostgreSQL coverage. Do not mark the
incident deployed or production-verified based only on those source tests.

Email-less `usr_...` rows need identity review, not blanket workspace deletion.
Platform Admin > People & access > Users offers **Repair user records** to a
full-access administrator. Confirm to recover stored identity emails or verified
primary emails from the correct application's Clerk account. Each request checks
up to 25 profiles and makes at most five Clerk calls; the page continues through
remaining batches and can stop after the current batch. A provider error stops
further work without treating the failure as a missing or deleted account.

For an account that automatic repair cannot resolve, select **Map email** beside
its **Email required** entry in Users or in the repair results. Enter the real
account owner's email and confirm ownership. This action requires full platform
administrator access. It preserves the account ID, workspaces and data, and logs
the mapping in the audit trail. It does not create a Clerk user, send an email,
change workspace ownership or merge accounts. Subsequent sign-in still requires
email verification. An existing active Clerk sign-in must have a matching
verified primary email; provider failures cannot be bypassed by manual entry.
An address already assigned to another account in the same application is
rejected and needs explicit identity review. An already mapped email cannot be
replaced through this recovery action.

The repair result reports the number of unmapped accounts still requiring an
email. It is not complete while this count is nonzero. Unused records can be
removed automatically; linked accounts whose real address cannot be recovered
need an administrator to supply that address. Never fabricate a placeholder.

Only unused, email-less records with no application-data references and no known
active provider account are removed. Protected accounts, workspace owners,
memberships, billing, historical actors and unsupported provider identities stay
intact. The result names preserved accounts requiring review; do not invent
email addresses or merge accounts solely because their addresses match. Batch
changes and removed IDs are audited. Retrying checks remaining records rather
than repeating completed deletions. This does not delete external Clerk users.

Client workspace namespaces are not user accounts and are no longer synthesized
as people in the Users table. Real client owners are listed from their membership.
Sign-in obtains a verified email from Clerk when JWT claims omit it, using the
existing API-side `CLERK_SECRET_KEY` scoped to the application. Lookup failures
fail closed; the code never trusts an email header to link accounts. Verification
results are briefly cached with application and credential isolation. Unknown
member references now require an invitation instead of creating empty profiles.
Production user creation and identity linking require an email. A PostgreSQL
check constraint also blocks new blank-email user rows or clearing a mapped
email. It initially leaves historical incomplete rows recoverable; it is fully
validated when repair or manual mapping resolves the final row. Startup backfill
no longer creates blank users from raw legacy references. Verified first sign-in
can migrate those older workspace references without changing billing records
when a conflicting subscription already exists. Client workspace namespace IDs
are not login accounts and are excluded from this user-email requirement.

## Publication gate

Customer articles should contain safe observable symptoms, non-destructive
checks and an escalation route. Operator traces, infrastructure identifiers,
internal remediation commands and unresolved conjectures stay in the operator
index. Retrieved incidents never authorize arbitrary shell commands, GitHub
writes or changes to another workspace.
