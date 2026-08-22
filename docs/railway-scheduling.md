# Railway Scheduling

Decisionate keeps scheduled work behind protected API endpoints. A Railway
Cron service calls the API; it does not connect directly to PostgreSQL or
object storage.

## Create the scheduler service

Create a second Railway service in the same project from the Decisionate
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
BILLING_SCHEDULER_SECRET=<same-secret-configured-on-the-api-service>
SCHEDULED_JOBS=connectors,alerts,billing
SCHEDULER_TIMEOUT_SECONDS=60
```

`DECISIONATE_API_URL` must be the public domain of the existing persistent
`decisionate` API service. Do not use the `decisionate-scheduler` domain; the
cron service must call the API service rather than call itself. Include the
`https://` prefix.

The three scheduler secrets must also be configured on the API service. They
must match exactly. Do not expose them in the frontend or commit them to Git.

If a deployment does not use a feature, select only the jobs it needs. For
example:

```text
SCHEDULED_JOBS=connectors,alerts
```

## What runs

The combined runner calls these protected endpoints in order:

| Job | Endpoint | Purpose |
| --- | --- | --- |
| `connectors` | `POST /datasets/source-connections/sync-due` | Runs due connector syncs and connector retention cleanup |
| `alerts` | `POST /alerts/weekly-report/send-due` | Sends enabled weekly reports due for the current day |
| `billing` | `POST /billing/lifecycle/send-due` | Sends subscription lifecycle notices and applies due data-retention actions |

The runner continues if one job fails, prints a JSON result for each job, and
returns exit code `1` when any selected job fails. Railway should mark that run
failed so it is visible in deployment logs.

## Verify the setup

1. Deploy the API with the three scheduler secrets configured.
2. Deploy the scheduler service with the command above.
3. Trigger one manual scheduler run if Railway provides a manual run action.
4. Open the scheduler service logs and confirm each selected job reports
   `"status": "succeeded"`.
5. Confirm the API logs show the corresponding protected POST requests.
6. Confirm a connector with automatic sync enabled, a due alert/report, or a
   due billing notification produces the expected result.

The scheduler service does not need `DATABASE_URL`, `OBJECT_STORAGE_*`, or
connector provider credentials. Those remain on the API service, where the
protected endpoints execute the work.
