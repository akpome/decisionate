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

A first save to `/admin/credit-settings` can fail on older billing tables with
`NOT NULL constraint failed` for `platform_billing_settings.agency_client_ai_credits`.
That retired column was removed from the ORM even though some existing tables
still require a value and have no server-side default. Fresh-schema saves can
pass while the older schema fails. The compatibility fix retains the legacy ORM
column with its original default and adds it during bootstrap when absent. It
does not overwrite existing legacy values, restore per-client AI allowances or
change subscriptions or Stripe charges. Client workspaces continue using the
agency's shared credit pool.

Pricing-save tests cover defaultless legacy tables, post-removal schemas,
bootstrap repetition, all four plans, partial updates, rollback and the audit's
actual saved values. Values outside the database integer range are rejected
before writes. The form preserves entered values after a failed save so an
administrator can correct and retry them. A generic browser 500 or an unrelated
startup billing-reconciliation warning is not proof of this diagnosis in a live
deployment; inspect the failed request's server traceback when available.

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
Platform Admin > People & access > Users > **Sign-in recovery** offers
**Repair user records** to a full-access administrator. Confirm to recover stored identity emails or verified
primary emails from the correct application's Clerk account. Each request checks
up to 25 profiles and makes at most five Clerk calls; the page continues through
remaining batches and can stop after the current batch. A provider error stops
further work without treating the failure as a missing or deleted account.

For employee handover, select **Reassign email** beside the account in Users.
The action remains visible when an email is already recorded; it is not limited
to missing-email repair. Review the current email, enter the replacement's email,
provide a reason, select **Review reassignment** and explicitly authorize the
reviewed change. Only full platform
administrators may reassign an account. Protected accounts, the acting account
and platform-admin accounts cannot be reassigned. Remove a limited administrator's
grant first when appropriate; platform-owner recovery needs separate review.

Reassignment retains the `usr_...` ID, datasets, decisions, subscriptions and
workspace memberships. The replacement receives every workspace and permission
attached to that ID. Existing login aliases are marked revoked rather than
deleted, so previous signed tokens are denied on subsequent API requests and
startup backfills cannot restore their access. The replacement must use a
separate sign-in and verify the assigned email before accessing the account
when that address is not already assigned to an existing account.
The operation does not create a Clerk user, send an invitation, modify the
external Clerk account or merge another application's accounts.

An address assigned to exactly one other active account in the same application
can be transferred after review. The preview identifies that source account;
confirmation must include its ID and the destination's expected old email.
The transaction pauses the source account, moves only matching email sign-ins
to the destination, revokes the source's other sign-ins and the destination's
former sign-ins, and activates the destination.
Clerk sign-ins missing a stored address require a verified primary-address
lookup, bounded to five calls; an unavailable provider rolls back both accounts.
Each ID keeps its own datasets,
decisions, memberships and subscription; nothing is merged or cancelled. Both
the reassignment and source pause are audited. Ambiguous duplicate mappings,
protected accounts and platform-admin accounts require separate review.

Paused accounts remain visible in Users with a **Paused** label and their
previous email as history. That stored address is not an active assignment and
is excluded from email-based sign-in lookup. Owner-email resolution returns no
recipient for a paused account. Marketing reconciliation cannot reactivate it
or transfer its consent. To restore a paused ID, use **Reassign email** to assign
an available email, or explicitly review another transfer. Old revoked sign-ins
stay revoked; the newly assigned verified email receives the ID's existing
workspace access. Bootstrap adds the nullable `access_paused_at` column without
pausing existing accounts or relaxing the required-email constraint.

Concurrent changes to the displayed old email require refreshing before retry.
The audit records the previous email, new email, reason and revoked login count.

Former personal names are cleared. Marketing contacts and pending marketing
messages for the former identity are retired; the replacement does not inherit
marketing consent. Review any explicitly configured extra report recipients and
public shared links separately, since those do not depend on the former login.
Historical unmapped records remain recoverable through the same reassignment
action without fabricating an email or destroying workspace data. The original
missing-email API remains for compatibility, not as the normal user-management UI.

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
