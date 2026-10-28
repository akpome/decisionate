# Verify analytics and report-worker execution

Treat configuration, liveness, job completion and numerical validity as different
checks. Do not tell a customer the engine completed their analysis merely because
a public endpoint returned HTTP 200.

## Readiness checks

Read the deployed API's `/health` and `/ready`. The former reports configuration
including analytics engine and AI configuration. `duckdb_configured` is a
configuration flag, not a completed benchmark. `/ready` checks the database and
required ingestion/analysis heartbeats. The analysis heartbeat is named
`reports-analysis` and must be recent within the implemented 30-second check.

No values in this document are current live results. Confirm which deployment,
environment and service domain answered the request before interpreting it.

## Safe end-to-end test

Use authorized synthetic or approved datasets with overlapping dates and enough
real observations. In Reports, select metrics from two sources, choose dates
and grouping, and request a preview. The report builder requests interpretation
automatically; check its source label separately from the statistical results.
For an isolated operator API check without an external AI call, explicitly send
`include_ai_analysis: false` in the report definition.
Inspect the same job identity through submission and
`/api/v2/business-reports/jobs/{job_id}` until `status: succeeded` and
`phase: completed` with a non-null result. Compare summaries against a small
known aggregate and confirm the selected filters were honored.

Worker logs record `Report analysis <id> started (<kind>)` and
`Report analysis <id> completed`. That shows execution, not scientific correctness.
An insufficient-history warning or zero anomalies can be a legitimate output.
Do not send production weekly email merely to test deployment health.

## Operational limits and recovery

The worker uses a distinct PostgreSQL advisory lock, one persistent consumer
and supervised subprocesses. Defaults are 900 seconds and a 2048 MB child
resident-memory budget, not a guaranteed provider container memory allocation.
At most three queued/running jobs are allowed per workspace. Preserve queued
work and inspect job errors before retrying.

The supervisor runs schema initialization in a short-lived subprocess before
consuming jobs. Ordinary queue supervision avoids retaining API and numerical
imports. Container memory must still cover both the supervisor and analysis
child; increasing the child's resident budget does not increase Railway RAM.
The supervisor samples Linux process RSS and stops the process group when an
observed sample exceeds the budget. Samples can miss short peaks; the provider's
container hard limit is still essential. Virtual memory is logged separately,
not counted as RAM. Native thread and allocator settings are passed before exec.

Analysis children no longer install `RLIMIT_AS`. A virtual-address-space cap can
make glibc abort a thread-local allocation with exit 127 even when RSS is low.
The exact `cannot allocate memory for thread-local data: ABORT` text identifies
a native allocation failure, but does not by itself prove that Railway's RAM was
exhausted. A controlled old-cap probe reproduced it at about 12 MB resident usage;
the new child probe permits a 3 GB virtual reservation with low resident usage.
This does not prove every production allocation failure has the same cause.

For an unexpected child exit, find `Report analysis child stopped` and match the
job identity, return code, `timed_out`, phase and attempts to the failed job.
The older `Analysis worker stopped before completion` message and the newer
interruption message do not identify the underlying cause. A negative POSIX
return code means termination by that signal, but even `-9` alone does not prove
an out-of-memory kill. Inspect Railway resource graphs and deployment logs, and
the child traceback immediately before the exit. A Python `MemoryError` has a
separate worker log and customer message. A process-start failure or pre-claim
exit fails only the selected job, leaving other queued work intact.

New resource diagnostics include the resident limit, sampled RSS and virtual
peaks, maximum observed threads and `memory_exceeded`. Check these alongside
Railway's actual memory graphs before recommending a larger container. The queue
ownership warning followed by successful lock acquisition is expected during a
rolling deployment; it is not the thread-local allocation failure. Failed old
jobs stay failed: generate a fresh preview after the corrected worker deploys.

Reloading a report reconnects to its job; it cannot restart a failed analysis.
After correcting the cause, generate a new preview with the preserved selections.
Never infer success from a reload or a healthy heartbeat alone.

If the customer opened an old analysis URL, check whether its saved report was
deleted or the temporary job expired. Missing-job HTTP 404/410
responses are availability errors, not evidence that a worker stopped. Deleted
snapshots remove their linked jobs, and the frontend clears stale selections and
URLs. Report pages offer Saved reports, not a recent-analysis selector or a
background job-history lookup. Active job progress, cancellation and URL-based
reload recovery remain available.

Source or permission changes can invalidate a job. Safe interrupted computation
has bounded recovery; AI interpretation and email side effects are not blindly
replayed. A scheduler success is only an enqueue acknowledgement. Check job and
delivery state before any manual resend.
