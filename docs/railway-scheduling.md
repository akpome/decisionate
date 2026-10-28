# Railway Scheduling

Decisionate keeps scheduled work behind protected API endpoints. A Railway
Cron service calls the API; it does not connect directly to PostgreSQL or
object storage.

## Create the scheduler service

Create a scheduler Railway service in the same project from the Decisionate
repository. Use the same repository and deploy context as the API, with the
service root set to `apps/api` when Railway asks for a root directory. The
service uses the existing `apps/api/Dockerfile`, which copies the scheduler
script into `/app/scripts`.

Override the scheduler service start command with:

```text
python scripts/run_scheduled_jobs.py
```

Set the scheduler service's cron schedule to run at the desired interval. A
15-minute schedule is a practical starting point because each connection still
decides whether its own hourly or daily sync is due. The API also prevents
duplicate weekly reports and connector work through its due checks.

## Scheduler variables

Add these as variables on the **scheduler service**, not the PostgreSQL
service. Enter the variable name and raw value separately; do not include
`export`:

```text
DECISIONATE_API_URL=https://<your-api-service-domain>
CONNECTORS_SCHEDULER_SECRET=<same-secret-configured-on-the-api-service>
ALERTS_SCHEDULER_SECRET=<same-secret-configured-on-the-api-service>
SCHEDULED_JOBS=connectors,alerts
SCHEDULER_TIMEOUT_SECONDS=60
```

When `SCHEDULED_JOBS` is omitted, the combined runner executes only the jobs
whose scheduler secret is configured on that service. For connector ingestion
only, `DECISIONATE_API_URL`, `CONNECTORS_SCHEDULER_SECRET`, and
`SCHEDULER_TIMEOUT_SECONDS` are sufficient; setting
`SCHEDULED_JOBS=connectors` is also valid and explicit.

`DECISIONATE_API_URL` must be the public domain of the existing persistent
`decisionate` API service. Do not use the `decisionate-scheduler` domain; the
cron service must call the API service rather than call itself. Include the
`https://` prefix.

Each selected scheduler secret must also be configured on the API service. They
must match exactly. Do not expose them in the frontend or commit them to Git.

If a deployment does not use a feature, select only the jobs it needs. For
example:

```text
SCHEDULED_JOBS=connectors,alerts
```

For a connector-only scheduler, use `SCHEDULED_JOBS=connectors` or omit the
variable and configure only `CONNECTORS_SCHEDULER_SECRET`.

Leave billing out while `BILLING_ENFORCEMENT_ENABLED=false`. When billing is
activated, add `BILLING_SCHEDULER_SECRET` to both services and include `billing`
in `SCHEDULED_JOBS`.

## Persistent ingestion worker

Production imports do not execute inside the API or cron process. Create a
separate persistent service using the API image, rooted at `apps/api`, with:

```text
python scripts/run_ingestion_worker.py
```

Unlike the HTTP-only scheduler, this worker needs the API's PostgreSQL, object
storage, connector credentials, encryption key, authentication configuration,
and monitoring variables. Use the same application revision and
`APP_ENV=production`; set `BILLING_ENFORCEMENT_ENABLED=false` while billing is
deferred. Configure automatic restart and run one replica. A database advisory
lock ensures only one ingestion worker consumes the queue. During deployment
overlap, the new persistent worker stays running and retries the lock every
five seconds until the previous worker stops. It does not mark imports as
interrupted, consume jobs, or update readiness before it owns the lock.
One-shot `--once` runs still reject a competing worker immediately.

Worker deploy logs report standby, lock acquisition, the marketing sync/send
flags, and nonempty marketing batches without printing credentials or contact
addresses. A fresh heartbeat proves that a lock owner is running, not that the
latest deployment has taken over. If standby persists, check for an older
worker deployment or duplicate worker service; retain only the intended owner.
Do not remove the lock or restart PostgreSQL to force concurrent consumers.

Railway overlaps old and new deployments during replacement; the old process
is stopped after the new deployment becomes active. Keep this worker without
an HTTP healthcheck or cron schedule. Use API `/ready` to check queue-owner
readiness. See [Railway deployment teardown](https://docs.railway.com/deployments/deployment-teardown).

The worker executes queued jobs in isolated, deadline-limited processes and
independently sweeps three-year connector retention hourly, including revoked
and sync-disabled connections. API `/ready` returns `503` when its heartbeat
is missing or stale. A successful cron response only confirms that work was
queued; confirm the ingestion job's terminal result too.

### Connector History and Retention

New connector imports load the most recent 90 days first, then queue older
history back to the same calendar date three years before the import date.
History runs newest-first in inclusive chunks of at most 30 days. Set
`CONNECTOR_BACKFILL_CHUNK_DAYS` on the API and ingestion worker to 1-30 for
high-volume accounts (default 30). Only one chunk per connection is queued;
the next joins the queue after the previous chunk finishes, allowing other
imports to run between chunks. Existing process memory and deadline limits
still apply. A chunk is not a promise that a provider has unlimited row volume.
Deploy the ingestion worker and API from the same revision, worker first, so
checkpoint advancement is handled by the new worker before new submissions.

Successful chunks, including legitimately empty windows, commit a durable
cursor. Failed or interrupted chunks retain their cursor and can be retried by
the scheduler without skipping dates. Multi-object connections advance only
after all objects succeed or return no data. Existing completed connections
extend their recorded old lower bound to three years on the next scheduler
pass; connections without a reliable prior bound replay bounded historical
windows, using their existing deduplication rules. Previously queued monolithic
backfills are bounded before provider I/O. Backfill does not advance the recent
incremental watermark and therefore cannot skip fresh activity.

Manual recovery accepts up to three calendar years. Manual imports and stale
scheduled imports spanning more than 90 inclusive days use the same bounded
chunk size, one root job at a time, newest-first. Continuations join the end of
the queue rather than keeping one worker subprocess busy for the entire range.
The selected range and its cursor are persisted separately from the initial
history checkpoint. Empty chunks advance; failures and worker restarts retain
the current cursor. The scheduler resumes pending ranges even if automatic
recurring sync is disabled. Resubmitting the same range resumes its checkpoint;
submitting a different explicit range replaces the pending range once no job
is active. Older-only recovery preserves the existing incremental watermark;
a range reaching today advances it to the submission time only after completion,
so fresh activity after submission remains eligible for incremental sync.

Monthly Parquet revisions are merged one month at a time, rather than loading
the entire retained raw history into pandas for every chunk. Existing provider
identity, complete-line-item and Search Console fallback merge rules remain in
effect. Superseded storage is removed after its replacement is committed.

Retention uses an exact rolling three-calendar-year source-date cutoff,
including leap-day handling. It removes expired raw rows, old partitions and
legacy summaries during sync and the independent hourly sweep, even if auto
sync is disabled or authorization has expired. The boundary month can contain
only the still-retained rows; an indivisible legacy monthly summary crossing
the cutoff is dropped conservatively. Unparseable dates cannot be assigned a
fabricated age; their ingestion partition supplies the existing fallback.
Uploaded files, decisions and frozen report snapshots are not connector raw
history and are not deleted by this rule. Provider backup/versioning policies
remain separate from live storage deletion.

Provider history limits still apply. Shopify follows the shared 90-day initial
import and chunked three-year history policy, with no separate backfill switch
or recovery date cap. Existing shorter plans extend at their saved checkpoint.
Orders older than 60 days still require Shopify-approved `read_all_orders`
access alongside `read_orders`. After approval, configure
`SHOPIFY_REQUIRE_ALL_ORDERS_ACCESS=true` and
`SHOPIFY_OAUTH_SCOPES=read_orders,read_all_orders` on the API and worker, then
reconnect Shopify. A token without the grant blocks historical import with an actionable
error and an unchanged checkpoint, rather than completing an empty backfill.
The 90-day initial import also needs this grant; an explicit range limited to
the latest 60 days can still use `read_orders` alone.
See [Shopify access scopes](https://shopify.dev/docs/api/usage/access-scopes).
No provider data or unavailable historical observations are fabricated.

## Persistent Reports Analysis Worker

Reports previews, selected-metric anomaly checks, weekly previews and weekly
delivery now execute outside the API. Create a **separate persistent service**
using the API image and `apps/api` root, with this start command:

```text
python scripts/run_analysis_worker.py
```

Run one replica, enable automatic restart, and configure no HTTP healthcheck or
cron schedule. Share the API's PostgreSQL, object storage, encryption, auth,
monitoring, reporting timezone and applicable AI/email configuration. Production
files must be in the same shared object storage, not on the API container's local
disk. No Redis broker or advanced-correlation rollout flags are needed.

Worker-only optional resource limits (defaults shown):

```text
ANALYSIS_JOB_TIMEOUT_SECONDS=900
ANALYSIS_JOB_MEMORY_MB=2048
```

Each job runs in a separate Linux subprocess with a deadline, supervised resident
memory budget, restricted native-library threads and parent-death protection. An independent
PostgreSQL advisory lock prevents duplicate consumers during deployment overlap;
the new service waits for the existing owner. It does not share the ingestion
queue, lock or heartbeat. Three queued/running analyses per workspace provide
backpressure, and scheduling gives waiting workspaces a turn.

Schema initialization runs through the API's existing serialized bootstrap in a
short-lived subprocess before the supervisor starts. Ordinary queue supervision
does not import the API or numeric-analysis libraries; each analysis child loads
its own dependencies. `ANALYSIS_JOB_MEMORY_MB` now budgets the child's resident
memory (RAM), not its virtual address space. The supervisor samples Linux
`/proc/<pid>/status` once per loop and kills the process group on an observed
budget excess, preserving the job's failure and delivery boundary. This is a
sampled guard, not an instantaneous kernel hard limit; a rapid allocation can
overshoot it. Railway's container limit remains the hard boundary and must
accommodate the supervisor and child together. The start command and environment
references do not change; do not increase Railway RAM solely because virtual
memory is large.

The old `RLIMIT_AS` address-space cap could cause glibc's
`cannot allocate memory for thread-local data: ABORT` and exit 127 while resident
usage was low. Analysis children no longer install that cap. Numeric/Arrow
thread limits and `MALLOC_ARENA_MAX=2` are passed before child exec. Diagnostics
record sampled resident/virtual peaks, thread count and the configured budget
alongside a failed child's exit code. Virtual reservations are not billed to the
resident budget. A standalone regression probe reproduced the old exit with
about 12 MB resident usage; this is not a measurement of a production container.

References: [Python resource limits](https://docs.python.org/3.12/library/resource.html),
[Linux process status](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html),
[glibc allocator tunables](https://sourceware.org/glibc/manual/latest/html_node/Memory-Allocation-Tunables.html),
[Arrow CPU thread settings](https://arrow.apache.org/docs/python/generated/pyarrow.cpu_count.html).

The API validates permissions and queues immutable settings and source-version
fingerprints. The worker checks access and revisions before and after analysis;
changed data or weekly preferences require a new preview. Saving a completed
preview is idempotent and does not recompute, accept client-provided evidence or
create decisions. Current aggregation, lag, significance and seasonal anomaly
rules remain unchanged. Forecasts and the basic Relationships page are not moved.

The report URL retains its job identity so reloads can reconnect. Status and
cancellation are under `/api/v2/business-reports/jobs/{job_id}`. Cancelling a job
stops its subprocess; closing the browser only stops polling. Old preview/save
HTTP contracts wait up to 45 seconds for worker output and are deprecated;
new clients use submission/status/save endpoints rather than long HTTP requests.
Reloading reconnects to the saved job state; it does not restart a failed job.
Generate a new preview after resolving the failure. An unexpected child exit is
logged with job identity, return code, timeout state, last phase and attempt
count. A negative POSIX return code identifies a terminating signal, not its
cause; correlate it with Railway resource/deployment logs before diagnosing
memory exhaustion. A child that fails before claiming its selected queued job
marks that job failed rather than repeatedly relaunching it. Other queued jobs
remain available to the worker.

The alerts scheduler now returns `queued_count` and per-workspace `job_id` values.
A successful cron invocation means work was queued, **not** that mail was sent.
Confirm terminal job status and Alerts delivery history. Scheduled delivery has
one durable claim per workspace and completed reporting week, independent of
template edits. Worker retries are bounded to one restart of safe computation;
AI work and external sending are not blindly replayed. Interrupted/partially
accepted email delivery requires provider-log reconciliation before a deliberate
manual resend. SMTP cannot guarantee exactly-once external delivery. A changed
reporting week prevents a delayed job from sending an obsolete weekly report.

Completed interactive jobs expire after seven days (save the snapshot to retain
it). Weekly-send claims expire after 90 days. Source/workspace deletion removes
associated jobs and stored results along with existing report cleanup.
Deleting a saved report also removes its originating temporary analysis result.

Deploy the analysis worker from this revision **before** switching the API and
web frontend. In production, `/ready` requires both `ingestion_worker_ready` and
`analysis_worker_ready`. A missing analysis heartbeat rejects new analysis with
HTTP 503 rather than falling back to expensive API computation. Verify with a
report preview and saved snapshot; do not send production email as a deployment
smoke test.

## What Runs

The former advanced-correlation worker has been retired. Do not deploy
`scripts/run_correlation_worker.py`; it has been removed. The new Reports analysis
worker above runs the unified Reports engine, not that retired product/workflow.
Do not remove the ingestion worker or the scheduler as part of this retirement.
For an existing correlation-worker service, follow the
[retirement sequence](MULTI_METRIC_CORRELATION.md#railway-cleanup) before deploying
the new revision to that service.

The combined runner calls these protected endpoints in order:

| Job | Endpoint | Purpose |
| --- | --- | --- |
| `connectors` | `POST /datasets/source-connections/sync-due` | Queues due connector syncs for the worker |
| `alerts` | `POST /alerts/weekly-report/send-due` | Queues enabled weekly reports due for the current day |
| `billing` | `POST /billing/lifecycle/send-due` | Sends subscription lifecycle notices and applies due data-retention actions |

The runner continues if one job fails, prints a JSON result for each job, and
returns exit code `1` when any selected job fails. Railway should mark that run
failed so it is visible in deployment logs.

Billing verification, notification and deletion failures also fail the billing
job even when the API returns HTTP 200 with per-workspace results. Successful
workspaces are not retried destructively: renewal state and notice keys are
persisted, and already-purged data is marked. Connector item failures continue
to be logged as warnings so one disconnected provider does not fail the whole
connector scheduling request.

The worker checks OAuth credentials when executing a queued connector import.
It refreshes tokens when due and a refresh token is available. This is not a
proactive token-refresh heartbeat for every connection: connections with sync
disabled are not refreshed merely because cron runs. Inspect failed ingestion
jobs and connection authorization notices rather than treating cron success as
proof of provider access. A revoked or expired refresh token requires the
customer to authorize the connection again.

## Queue saturation and worker failures

Railway cron services are meant to finish and exit after each run, as described
in the [Railway cron documentation](https://docs.railway.com/cron-jobs). Normal
completion is not a crash. The persistent ingestion worker is different: it
must remain running between cron invocations.

The five-import limit applies per workspace and counts queued or running root
jobs. A full queue is temporary backpressure, not a connector failure: the
connector endpoint returns HTTP `200`, a `deferred_count`, and per-connection
results with `status: deferred` and `reason: workspace_queue_full`. It continues
processing other workspaces. Deferred connections remain due and are retried
on the next cron run once capacity is available. Manual imports still return
HTTP `429` when their workspace queue is full; the limit is not bypassed.

The connector scheduler checks the persistent worker heartbeat before queuing
work. If it is missing or stale, the endpoint returns HTTP `503` with an
ingestion-worker-unavailable message. The cron runner reports this as a failure
but still runs the selected alerts and billing jobs. It does not disguise a
missing worker or other API errors as successful scheduling.

If repeated restarts show a full import queue:

1. Check the API's `/ready` response. If `database_ready` is true but
   `ingestion_worker_ready` is false, the database is reachable but no recent
   worker heartbeat is available.
2. Start or restore the separate **persistent ingestion worker** described
   above. Its start command is `python scripts/run_ingestion_worker.py`; do
   not give this service a cron schedule or the HTTP-only scheduler command.
3. Inspect that worker's logs for startup, configuration, database, or import
   errors. It must use the same database and object storage as the API.
4. Confirm `/ready` returns `200` and existing imports reach terminal states,
   then run the scheduler again. Restarting cron does not consume queued jobs.

Deploy the API changes as well as the scheduler service's image when updating
the application. Redeploying only the scheduler cannot fix an API endpoint
that still aborts on a full workspace queue. Do not delete queued imports or
raise the capacity limit to hide an unhealthy worker.

## Verify the setup

1. Deploy the API with the selected scheduler secrets configured.
2. Start both persistent workers and confirm API `/ready` returns `200`.
3. Deploy the scheduler service with the command above.
4. Trigger one manual scheduler run if Railway provides a manual run action.
5. Open the scheduler service logs and confirm each selected job reports
   `"status": "succeeded"`.
6. Confirm the API logs show the corresponding protected POST requests.
7. Confirm a connector with automatic sync enabled, a due alert/report, or a
   due billing notification produces the expected result.

The scheduler service does not need `DATABASE_URL`, `OBJECT_STORAGE_*`, or
connector provider credentials. Those belong on the API and persistent worker;
the protected endpoints authorize and queue work, and the worker executes imports.
