# Advanced Correlation Explorer: Retired

The separate multi-metric explorer, new-analysis queue, rollout gates and
dedicated correlation worker have been removed. Reports is the only active
multi-dataset analysis builder. The basic two-metric Relationships page and
saved relationship monitors are unchanged.

Reports now has its own execution-only analysis worker. This does not restore
the retired explorer, its queue, rollout flags or alternative analysis rules.
See [Reports worker deployment](railway-scheduling.md#persistent-reports-analysis-worker).

## Preserved Evidence

- Existing analysis/run/result tables are retained; no records are migrated,
  recalculated or deleted automatically.
- Existing saved insights, dashboard evidence and decision contexts remain
  readable under their original workspace/source permissions.
- The old explorer URL redirects to Reports when it has no evidence identity.
  Links with a run or result identity redirect to the read-only
  /dashboard/reports/evidence page.
- That page displays frozen matrix results, normalized aligned history, legacy
  lag profiles, original date ranges and engine provenance. It has no analysis,
  refresh, pinning or insight-creation controls.
- Historical widgets retain their saved results, are labelled historical, and
  do not poll or enqueue refreshes. Authorized widget removal remains available.
- Completed runs containing at most 25 metrics can seed a new report. This is a
  new calculation using Reports' current rules, not a rewrite of the old evidence.

## Compatibility API

Authenticated historical GET routes remain available for analyses, runs,
results, matrices, saved insights and widgets. Every historical read rechecks
current workspace and source access; removing a source/workspace continues to
clean up its derived records.

The capabilities endpoint reports retired=true and all creation/UI capabilities
false. New analysis submission, reruns, advanced catalogue access, new widget
creation and insight/decision-evidence creation return HTTP 410 regardless of
old environment values. Cancellation of pre-existing jobs remains available for
operators draining the old service.

The shared catalogue, metric policies, Pearson/Spearman calculations, significance
correction and calendar-aligned report timing remain in use by Reports. They
have not been deleted with the explorer.

## Railway Cleanup

Repository removal does not stop an already-deployed Railway service. Deployment
cleanup must target only a separate service whose start command is
python scripts/run_correlation_worker.py.

1. Disable that service's automatic deployments before this revision is rolled
   out to it. Pause new claims by setting CORRELATION_WORKER_ENABLED=false on its
   existing deployment. Do not change the ingestion worker or scheduler.
2. Deploy the API/frontend revision that rejects new advanced submissions.
3. Inspect correlation_runs for queued/running jobs. Let in-flight jobs finish
   on the old deployment, or explicitly cancel them through the retained
   cancellation endpoint. Cancel remaining queued jobs before removing the
   service. Do not delete results or relabel completed runs.
4. Stop/remove only the dedicated correlation-worker service. Do not redeploy
   that service with this revision: its start script has been removed.
5. Remove these obsolete variables wherever they were configured:
   MULTI_METRIC_CORRELATION_API, MULTI_METRIC_CORRELATION_UI,
   MULTI_METRIC_CORRELATION_INTERNAL_USERS, MULTI_METRIC_CORRELATION_ROLLOUT,
   CORRELATION_DASHBOARD_WIDGETS, CORRELATION_LAG_MATRIX,
   CORRELATION_AI_EXPLANATIONS, CORRELATION_WORKER_ENABLED,
   CORRELATION_MAX_LAG, CORRELATION_JOB_TIMEOUT_SECONDS, CORRELATION_JOB_MEMORY_MB.

Keep CORRELATION_REPORTING_TIMEZONE: Reports, weekly reviews and historical date
handling still use it. The obsolete variables cannot reactivate the retired
workflow in the new code.

A read-only queue audit is:

~~~sql
SELECT status, COUNT(*)
FROM correlation_runs
WHERE status IN ('queued', 'running')
GROUP BY status;
~~~

## Verification

Shared engine characterization remains covered by test_correlation_characterization
and MultiMetricEngineTests. RetiredExplorerTests seeds historical records directly
and checks retirement even with old flags enabled, immutable reads, workspace
denial, revoked source access, retained insights/widgets, report imports and
source/workspace cleanup. Frontend tests cover old-link redirects, read-only
historical rendering, aborted/stale requests and the absence of queue controls.
