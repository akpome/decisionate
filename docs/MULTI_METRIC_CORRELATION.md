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

Implementation details, worker deployment, verification results and remaining
pilot gates are recorded below as each phase is completed.
