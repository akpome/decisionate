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
lock rejects a second ingestion worker.

The worker executes queued jobs in isolated, deadline-limited processes and
independently sweeps three-year connector retention hourly, including revoked
and sync-disabled connections. API `/ready` returns `503` when its heartbeat
is missing or stale. A successful cron response only confirms that work was
queued; confirm the ingestion job's terminal result too.

## What runs

The combined runner calls these protected endpoints in order:

| Job | Endpoint | Purpose |
| --- | --- | --- |
| `connectors` | `POST /datasets/source-connections/sync-due` | Queues due connector syncs for the worker |
| `alerts` | `POST /alerts/weekly-report/send-due` | Sends enabled weekly reports due for the current day |
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
2. Start the persistent worker and confirm API `/ready` returns `200`.
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
