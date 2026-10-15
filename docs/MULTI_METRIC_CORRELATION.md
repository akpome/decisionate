# Multi-Metric Correlation

## Current-State Map

Discovery completed before implementation. Names in the supplied workflow are
logical contracts; the existing product is preserved:

| Concern | Current implementation |
| --- | --- |
| Two-metric endpoints | `datasets/router.py`: `/datasets/relationships/preview`, GET/POST `/datasets/relationships`, DELETE by ID |
| Validation | `datasets/schemas.py`: `DatasetRelationship*` |
| Statistics and lag | `datasets/services/relationships.py`: `_calculate_correlation`, `_calculate_lag_result`, `_build_metric_series`, `build_dataset_relationship` |
| Lag convention | Positive lag compares earlier left observations to later right observations **after an inner join on shared periods**. A lag is a number of matched periods, not necessarily elapsed calendar days. |
| Old persistence | `db/models.py`: `DatasetRelationship`; results are calculated on read |
| Other multi-metric feature | `datasets/services/multi_metric_analysis.py`: synchronous summaries/AI, not a correlation matrix; unchanged |
| Old UI | `app/dashboard/relationships/page.tsx`; retained |
| Metric semantics | Saved dataset metric selection, curated policy descriptors and metric registry |
| Dashboard storage | Dataset/dashboard preferences, not an extensible persisted widget table. New correlation widget records coexist without rewriting preferences. |
| Jobs | Supervised PostgreSQL ingestion worker; its queue, priorities, lock and retry behavior must not change |
| Authorization | `datasets/services/auth.py`, `ownership.py`, `auth_context.py`; active workspace is server-verified, including agency-client restrictions |
| Schema lifecycle | `main.py` imports models before `Base.metadata.create_all`, under the existing PostgreSQL schema lock |
| Baseline | 62 dataset/relationship/metric-policy/join tests passed. No frozen statistical fixtures existed; additive characterization tests were introduced first. |

The v2 module calls the existing statistical and lag primitives. It does not
route old requests into new orchestration, change connector storage, or backfill
old analyses. All new entry points start disabled.

## Contracts and Rollout

All v2 endpoints live under `/api/v2`. Analyses have immutable definitions and
metric membership, runs freeze their definition/data watermark/engine version,
and unique pair/lag results live in separate tables. Run-request keys make
retries idempotent. Equivalent completed requests reuse the cached run. A retry
of a failed/canceled execution receives a new run identity unless the caller
explicitly replays an earlier idempotency key.

The catalogue requires explicit saved dataset selections. Policy-managed
connectors use their reviewed aggregation, currency, formula and grain; legacy
connector selections without a policy are excluded rather than guessing safe
line/header semantics. Explicitly configured file/database metrics may use
existing registered semantics. Unknown numerics, IDs and unclassified ratios
are excluded. Historical monthly data cannot be requested at a finer grain.
Currencies are labelled without conversion; known mixed-currency file columns
are excluded. Unspecified legacy currencies are visibly marked unspecified.

Preparation reads each dataset once and groups policy metrics once per date
field. Pairwise inner joins preserve the old shared-period lag convention;
there is no global complete-case intersection. Exactly two metrics use the same
coefficient, tie-ranking, aggregation and lag primitive as the old endpoint.
Legacy SUM treats entirely missing observations in a period as zero; frozen
tests preserve this convention rather than silently changing the old engine.

The queue is separate from ingestion. It has atomic claims, fenced worker
tokens, heartbeat expiry, at most three transient attempts, between-pair
cancellation and pair-batched writes. Only completed runs are published.
Source changes during calculation fail the run without replacing prior results.
Normalized evidence is bounded to 200 aligned points per retained lag. No raw
observations or customer names enter application logs.

BH correction includes every available pair/lag p-value, not just the winning
lags. The existing runtime has no SciPy: p-values then remain null and results
are exploratory. When SciPy is available, its version becomes part of the cache
identity. Small-sample Spearman significance is explicitly flagged; nominal
time-series significance is still exploratory evidence, not causal proof. See
the [SciPy Spearman reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html)
and [BH implementation reference](https://www.statsmodels.org/v0.13.5/_modules/statsmodels/stats/multitest.html).
No statistical dependency was silently added to production.

Limits: 25 guided/50 advanced metrics, at least two datasets, 14 default maximum
lags (server-configurable up to 60), 20,000 hard pair-lag tasks, three active runs
per workspace and 50 widgets per dashboard. The default builder starts with no
metrics selected. A 50-metric matrix virtualizes its rows; the ranked list is
paginated and the matrix/detail payloads are loaded separately.

The private dashboard supports Top Relationships, Outcome Associations (the
workflow's Outcome Drivers surface, without implying causation), and Saved
Relationship widgets. Refreshes follow compatible successful runs; empty,
failed or canceled refreshes preserve the pinned successful result. Same-lag
coefficient change is shown when a previous comparable run exists. Existing
dashboard preferences and public-share payloads are unchanged; correlation
widgets are never added to a public share implicitly.

Saved relationship insights appear on Insights. Decision creation uses the
existing decision API and its role guards, with immutable run/result links and
structured evidence in the recommendation context. Audit records cover creation,
enqueue, completion, retry/failure/cancellation, widget actions and evidence
handoffs. Dataset/workspace deletion removes the new result graphs too.

The decision handoff uses the existing `rules` recommendation source and marks
the structured evidence `correlation_v2`, avoiding changes to the old decision
API's controlled source values. The target dataset and metric stay consistent.

## Worker Deployment

Do not change `decisionate-worker` or the scheduler start commands. Deploy an
optional dedicated service from `/apps/api`, using the same API image/database
and storage credentials, with this start command:

```text
python scripts/run_correlation_worker.py
```

The supervisor requires PostgreSQL and Linux, owns its own advisory lock, runs
one lower-priority child at a time, limits memory/BLAS threads, kills children
on deadline or parent death, and never claims ingestion jobs. Initial settings:

```dotenv
MULTI_METRIC_CORRELATION_API=false
MULTI_METRIC_CORRELATION_UI=false
MULTI_METRIC_CORRELATION_INTERNAL_USERS=
MULTI_METRIC_CORRELATION_ROLLOUT=internal
CORRELATION_DASHBOARD_WIDGETS=false
CORRELATION_LAG_MATRIX=false
CORRELATION_AI_EXPLANATIONS=false
CORRELATION_WORKER_ENABLED=false
CORRELATION_MAX_LAG=14
CORRELATION_REPORTING_TIMEZONE=UTC
CORRELATION_JOB_TIMEOUT_SECONDS=300
CORRELATION_JOB_MEMORY_MB=1536
```

Use the same reporting timezone on API and worker. It is frozen with the
definition; naive business dates stay unchanged and timezone-aware instants are
converted before bucketing. The current repository has no per-workspace
reporting-timezone setting; UTC is the default rather than an inferred country.

For an internal pilot, set the allowed internal user IDs and enable API, UI,
widgets and the separate worker. Enable lag only after zero-lag validation.
Policy-managed connector selection must also be enabled for those internal
datasets using the metric-default rollout. Existing rows are never migrated.
`ROLLOUT=all` is a separate, explicit release decision, not the initial state.
AI explanations remain reserved and disabled; no generated causal narrative is
introduced. New tables are created through the existing serialized bootstrap;
no legacy tables or records require a backfill.

## Verification and Gates

- Frozen Pearson/Spearman ties, missing-value, constant, insufficient and positive
  lag fixtures characterize the old engine and prove two-metric v2 parity.
- API tests cover overlap, source-policy eligibility, currency/grain boundaries,
  idempotency, retries, stale leases, cancellation, tenant isolation, access
  revocation, result contracts, insights, widgets and deletion.
- Synthetic CPU benchmark: ten metrics over 3,653 daily observations, 45 pairs,
  zero lag, with a 15-second test ceiling. This is not a production I/O SLO.
- Pilot gates still require an isolated PostgreSQL deployment exercising
  advisory-lock handover/concurrent claims, real storage latency, deadline and
  memory limits, production error-rate/queue-delay telemetry and accessibility
  feedback. No production service or flags have been changed by implementation.
- Partner-only POS schemas, including unverified Lightspeed metrics, remain
  excluded by the curated-policy prerequisite until their fixture review passes.

## Rollback

Disable widget creation, UI and API flags; set `CORRELATION_WORKER_ENABLED=false`
to pause new queue claims. Existing saved widgets/insights continue to render
authorized successful evidence. Do not reverse the additive tables or change
the ingestion worker. Existing two-metric endpoints and saved relationships
remain available throughout rollback.
