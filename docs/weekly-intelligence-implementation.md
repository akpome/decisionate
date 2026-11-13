# Weekly intelligence implementation

## Repository audit (2026-11-13)

| Capability | Verified implementation | Reuse / extension | Missing work |
| --- | --- | --- | --- |
| Weekly generation | `alerts/router.py:build_weekly_cross_dataset_report`, `reports/weekly.py`, `reports/jobs.py`, `infrastructure/analysis_worker.py` | Existing completed Monday-Sunday week, daily detail, weekly preceding history, three-year cap | Versioned intelligence in existing JSON snapshot; workspace timezone |
| Metric semantics | `correlation/catalog.py`, `datasets/services/metric_policy.py`, `curated_metric_analytics.py`, `reports/service.py` | Approved selections, component ratios, distinct counts, last values, missing-data checks | Preserve per-source provenance; never add unrelated financial totals |
| Cross-dataset analysis | `reports/relationships.py`, `correlation/engine.py`, `reports/timing_validation.py` | Calendar-aligned lag, adjusted significance, minimum history and timing validation | Bound weekly investigations to relevant changes instead of every possible pair |
| Anomalies | `reports/anomalies.py`, `datasets/services/seasonal_baseline.py` | Past-only daily and complete-week assessments, optional validated seasons | Turn validated deviations into ranked findings |
| Forecasting | `forecasting/services.py` | Existing forecasting is separate from weekly evidence | No frozen prior forecast is currently supplied to weekly generation; disclose absence, do not invent deviations |
| AI explanation | `ai/service.py:generate_structured_analysis` | Configured provider/model, token reservations, usage settlement, cache, deterministic fallback | Evidence-constrained weekly narrative, one call rather than one per finding |
| Recommendations | `reports/service.py`, weekly digest | Existing deterministic recommendations | Structured references, stable scope keys, continuity and bounded investigations |
| Decision linking | `reports/router.py:decision_evidence`, `decisions/router.py`, `decisions/creation.py`, frontend `decisions/new` | Central form, explicit submit, immutable evidence, workspace locks and idempotency | Finding prefill, existing-active-decision detection |
| Outcome monitoring | `decisions/models.py`, `outcome_measurement.py`, `reports/decision_reviews.py` | Recorded outcomes, review dates, saved impact assessments | Frozen weekly progress; no automatic success or approval claims |
| Email delivery | `alerts/email_delivery.py`, `analysis_worker.py:run_weekly` | Existing scheduler, recipient checks, agency branding, archive before side effects, ambiguous-send protection | Concise intelligence email linked to its archived snapshot |
| Persistence | `BusinessReport`, `CurrentWeeklyReport`, `ReportAnalysisJob`, `WeeklyReportPreference` | Existing JSON payloads and retention | Add fields only; no new tables |
| Access | `applications.py`, job actor rechecks, dataset authorization, workspace lifecycle and billing gates | Existing app/workspace/agency restrictions | Regression tests, no bypasses |

## File-level plan

1. Add `reports/intelligence.py` to compose ranked, source-linked findings from
   existing results. Extend weekly `build_report` invocation with bounded pair
   selection, not a new correlation engine. No unselected datasets are loaded.
2. Extend `weekly.py`, weekly settings schemas/jobs and the existing worker to
   preserve an optional reporting timezone in the existing settings JSON and
   link email to the exact archived report. Old settings retain their default.
3. Add `reports/intelligence_decisions.py` for scoped continuity, timestamped
   recorded outcomes and validated adoption; extend existing evidence endpoint
   and central decision creation, preserving existing lifecycle and locks.
4. Add an optional evidence-constrained mode to `ai/service.py`. The model may
   select approved business statements, never introduce facts or recommendations.
   Keep the configured model, provider, credit accounting and fallback.
5. Extend the existing report types and weekly preview with a dedicated rendering
   component; reuse metric charts and evidence details. Prefill only inside the
   existing Decisions form. Extend email rendering, not the scheduler.
6. Test numeric policies, sparse data, bounded investigations, narrative
   validation, continuity, cross-workspace access, duplicate adoption, old
   snapshots, weekly delivery and responsive rendering.

## Confirmed boundaries

- Existing schedules use a deployment-wide timezone; a workspace-specific
  reporting timezone requires an additive settings field, not an assumed one.
- Decisions have planned/in-progress/outcome states, but no independent approval
  workflow. Deliberate creation in Decisions is adoption; no new approval state.
- Existing outcome measurement is explicit. Weekly reports can show recorded
  measurements and newly observed weekly values, not silently record an outcome.
- The existing weekly delivery contract requires two usable datasets. A report
  can still show useful single-source results with limited coverage; this does
  not make it eligible for cross-dataset delivery or change `ready` semantics.
- SMTP/provider acceptance is not inbox delivery. Existing unknown-send states
  require reconciliation; do not blindly retry them.
- No automatic ad attribution, currency conversion, financial consolidation,
  causal claims, decision creation or new forecast model.

## Implementation and contracts

The existing worker produces a normal cross-dataset report with an optional
`intelligence` object, version `weekly_intelligence.v1`. Legacy snapshots do not
gain this object when opened. Their original presentation remains available.

The object contains `as_of`, `reporting_timezone`, `window`, `summary`,
`narrative_source`, `findings`, `investigations`, `recommendations`, `decisions`,
`quality`, `sources`, `forecast_status` and `prioritization`. Existing top-level
metrics retain current/prior values, changes, daily trends and source provenance.

API additions, with existing authentication and role checks unchanged:

- Weekly settings and preview requests accept an optional IANA
  `reporting_timezone`. It is stored in the existing settings JSON and frozen in
  jobs. Omission retains the deployment default. Instant-analysis request
  contracts are unchanged.
- `POST /api/v2/business-reports/{report_id}/decision-evidence` accepts an optional
  `finding_id`. It prepares evidence; it never creates a decision. Missing or
  unsupported findings return 404, a mismatched outcome metric returns 400, and
  an already active finding decision returns 409 with its decision number.
- The existing central decision creation endpoint validates finding-backed
  evidence again under its creation lock, reconstructs provenance from the saved
  server snapshot, and reuses an active decision for repeated adoption attempts.
- Weekly delivery links contain the immutable archive ID and `workspace_id`.
  The linked report still requires an authorized login; the URL grants no access.

No database migrations, tables, dependencies, providers, queues or scheduled
tasks were added. API and worker should be deployed from the same revision,
followed by the frontend. No new environment variables are required. The model
continues to come from `AI_MODEL` (with the existing `OPENAI_MODEL` fallback),
not a hardcoded name. Production model/key configuration was not inspected.

## Generation and delivery

1. Existing API authorization and billing gates validate selected datasets and
   freeze settings in the existing report job.
2. The worker determines the completed Monday-Sunday in the reporting timezone;
   the preceding complete week is the value comparison. Daily observations are
   summarized with existing metric policies, not universal summation.
3. Existing anomaly engines assess daily changes and the whole completed week.
   Existing preceding weekly history remains capped at three years. Missing
   observations remain unavailable.
4. Up to 12 eligible cross-dataset pairs involving priority movements are chosen
   before correlation tests. User exclusions, direction choices, opt-outs,
   minimum history, aligned calendar lag and adjusted significance remain active.
   Missing or incompatible monetary units exclude a pair; no conversion occurs.
5. Structured findings are ranked by complete-week unusualness, daily
   unusualness, then percentage movement. Ordinary changes are explicitly not
   statistical-significance or profit claims. Stable data can yield no findings.
6. Same-workspace preceding snapshots and existing canonical decisions supply
   recurrence and frozen decision progress. Connector metadata supplies safe
   import/authorization warnings; raw provider errors and secrets are excluded.
7. One optional call uses the existing configured AI service, cache, limits and
   accounting. The model selects approved statement IDs; unknown text, invented
   actions, omitted reporting context, omitted top findings and oversized
   summaries are rejected. The deterministic summary survives provider failure,
   missing credentials and exhausted credits.
8. Preview alone creates no decision or saved weekly setup. Existing post-preview
   save and history behavior are retained. Delivery archives the report before
   calling the existing email sender, and links both email parts to that archive.
   The concise email uses the same summary, top three findings, associated
   investigations, decision updates and material limitations.
9. The existing scheduler checks each workspace's local delivery day. Existing
   weekly claims, role rechecks, paused-workspace rules and ambiguous-send
   reconciliation remain in place. Provider acceptance is not inbox confirmation.

## Decisions and continuity

`Review in Decisions` opens the existing central form with the finding, action,
reasoning and success metric prefilled. The user supplies success criteria and
a review date and explicitly submits. The outcome metric stays tied to its
validated finding. Owner assignment continues through existing Decision Details;
this release does not add an independent approval or assignment workflow.

Stable finding identifiers include dataset, metric, aggregation, date column,
currency, timezone and dimension filters. All lookups are workspace-scoped.
Active decisions are linked rather than recreated, including when the editable
title changes. Recurrence compares the preceding completed week and uses neutral
wording such as larger or smaller movement; it does not assume that more of an
arbitrary metric is good. Later reports show recorded outcomes and matching-scope
weekly observations without modifying earlier report evidence or declaring
causal success. Progress is capped at 20 relevant decisions.

## Exact changed files

Paths below are relative to the repository root. Pre-existing local database,
bytecode and sample-data changes are not part of this implementation.

| File | Reason |
| --- | --- |
| `apps/api/app/modules/reports/intelligence.py` | New evidence composition, bounded pair selection, ranking, approved narrative statements |
| `apps/api/app/modules/reports/intelligence_decisions.py` | New scoped recurrence, progress, ingestion warnings and adoption validation |
| `apps/api/app/modules/reports/service.py` | Optional weekly pair selection and source-quality evidence, existing calculations retained |
| `apps/api/app/modules/reports/schemas.py` | Optional weekly timezone and finding reference validation |
| `apps/api/app/modules/reports/weekly.py` | Local reporting context and exact archived-report email URL |
| `apps/api/app/modules/reports/jobs.py` | Freeze timezone in existing weekly jobs |
| `apps/api/app/modules/reports/router.py` | Timezone-aware preview/save/send checks and finding evidence handoff |
| `apps/api/app/infrastructure/analysis_worker.py` | Respect frozen timezone, link archived snapshot before delivery |
| `apps/api/app/modules/ai/service.py` | Optional approved-statement narrative validation and bounded-summary preservation |
| `apps/api/app/modules/alerts/router.py` | Assemble intelligence, one narrative call, local scheduler delivery day |
| `apps/api/app/modules/alerts/email_delivery.py` | Concise, escaped, branded HTML and plain-text intelligence email |
| `apps/api/app/modules/decisions/router.py` | Server-validated adoption and active-finding deduplication |
| `apps/web/features/reports/weekly-intelligence-types.ts` | Versioned additive frontend contract |
| `apps/web/features/reports/weekly-intelligence.tsx` | Seven-section weekly presentation, evidence expansion and central links |
| `apps/web/features/reports/weekly-timezone.tsx` | Reporting-zone selector and completed local week display |
| `apps/web/features/reports/types.ts` | Optional intelligence and timezone types |
| `apps/web/features/reports/weekly-settings.ts` | Preserve timezone in weekly settings only |
| `apps/web/features/reports/report-workspace.tsx` | Integrate weekly presentation and finding-specific central handoff |
| `apps/web/features/decisions/lib/intelligence-draft.ts` | Pure finding-backed form prefill |
| `apps/web/features/decisions/components/decision-report-evidence.tsx` | Preserve outcome identity and weekly archive links |
| `apps/web/app/dashboard/decisions/new/page.tsx` | Apply draft, block missing/existing findings, explicit submit |
| `apps/api/tests/test_weekly_intelligence.py` | New evidence, timezone, AI, connector and adoption acceptance tests |
| `apps/api/tests/test_business_reports.py` | New concise email and bounded AI evidence expectations |
| `apps/api/tests/test_weekly_owner_send.py` | Assert email/archive intelligence identity and workspace link |
| `apps/api/tests/test_email_branding.py` | Verify concise intelligence email preserves agency branding and safe archive URL |
| `apps/api/tests/test_weekly_report_settings.py` | Currency-qualified historical relationship fixture |
| `apps/api/tests/test_report_anomalies.py` | Preserve opt-out disclosure and detailed snapshot evidence with concise email |
| `apps/api/tests/test_weekly_report_preferences.py` | Updated branded intelligence subject expectations |
| `apps/web/tests/weekly-intelligence.test.mjs` | New presentation, provenance, escaping, timing, central draft and timezone tests |
| `apps/web/tests/weekly-report-settings.test.mjs` | Preserve independent weekly settings with timezone control |
| `apps/web/tests/decision-creation-submission.test.mjs` | Retain existing submission/idempotency regression harness |
| `apps/web/tests/indexed-report-trends.test.mjs` | Shared chart in mutually exclusive new/legacy views |
| `docs/weekly-intelligence-implementation.md` | Audit, implementation, contracts, verification and limitations |

## Limitations and deferred work

- No frozen pre-period forecast is currently supplied by weekly reporting, so
  forecast deviation is explicitly marked not calculated. Computing a forecast
  after the fact would not be valid evidence of a missed forecast.
- Findings use selected authorized metrics, not every available connector or a
  fabricated KPI catalog. Financial risk, margin, attribution and profitability
  are not inferred from unrelated totals or guessed business context.
- Generic metrics do not have a universal improvement direction. Recommendations
  therefore identify specific records to investigate, not unsupported budget
  percentages or guaranteed commercial improvements.
- Monetary sources stay separate; duplicates across sources are not automatically
  reconciled. This prevents consolidation double-counting but does not certify
  that each source's own transactions are unique.
- Recurrence looks at the current report and up to 100 recent same-workspace
  archives for the immediately preceding week. It is not a new longitudinal
  finding database. Older evidence is never silently recomputed.
- Single-source limited previews remain useful, but existing weekly cross-source
  send and decision-readiness requirements are not relaxed.
- Legacy weekly impact snapshots and non-intelligence emails retain their old
  readers. Historical delivery metadata can still be updated by the existing
  send lifecycle; analytical evidence remains frozen.
- Browser acceptance uses actual components and calculated test evidence with a
  mocked navigation boundary. Real customer login, production infrastructure,
  live OpenAI responses, SMTP/Resend inbox receipt and production data were not
  exercised. No customer email was sent during verification.

## Verification results

Final backend regression: **375 passed**, 167.540 seconds. From `apps/api`:

```bash
.venv/bin/python -B -m unittest \
  tests.test_weekly_intelligence tests.test_business_reports \
  tests.test_weekly_owner_send tests.test_weekly_report_settings \
  tests.test_weekly_report_preferences tests.test_ai_service \
  tests.test_decision_creation tests.test_agency_pause_authority \
  tests.test_agency_client_ownership tests.test_applications \
  tests.test_email_branding tests.test_analysis_jobs \
  tests.test_client_account_lifecycle tests.test_report_decision_links \
  tests.test_report_anomalies -q
```

This includes incomplete/failed ingestion, malformed legacy settings/evidence,
metric ratios and last-value policies, exclusions and opt-outs, seasonal
baselines, current/prior windows, three-year history, lag alignment, AI refusal
and invented-output fallback, cached narratives, source permissions, agency
pause/ownership, deleted sources, retry/idempotency and ambiguous-send handling.
Expected fault-injection warnings appear in test logs. The existing Starlette
test-client deprecation warning remains; no unrelated dependency upgrade was made.

Full frontend suite: **990 passed**. From `apps/web`:

```bash
node --test --test-concurrency=2 tests/*.test.mjs
```

Final focused rerun after the last presentation edits: **59 passed**:

```bash
node --test --test-concurrency=2 \
  tests/weekly-intelligence.test.mjs tests/weekly-report-settings.test.mjs \
  tests/weekly-owner-send.test.mjs tests/decision-creation-submission.test.mjs \
  tests/indexed-report-trends.test.mjs
```

TypeScript and ESLint passed:

```bash
npx tsc --noEmit
npx eslint features/reports/weekly-intelligence.tsx \
  features/reports/weekly-intelligence-types.ts features/reports/weekly-timezone.tsx \
  features/reports/report-workspace.tsx features/reports/types.ts \
  features/reports/weekly-settings.ts features/decisions/lib/intelligence-draft.ts \
  features/decisions/components/decision-report-evidence.tsx \
  app/dashboard/decisions/new/page.tsx
```

`git diff --check` passed. The local Next server at
`http://localhost:3100/dashboard/reports/weekly` responds and requires sign-in.
The authenticated production experience was not exercised.

Playwright checked the actual report components and calculated evidence at
1440px, 768px and 390px: two rendered chart lines, actual/indexed switching,
expandable finding and relationship evidence, daily/whole-week anomaly evidence,
the finding-specific recommendation callback, timezone selection, no horizontal
overflow and no browser errors. Screenshots were visually inspected. The manual
harness is `/tmp/decisionate-access-refresh-aU6N2t/weekly-intelligence.mjs`;
screenshots are `/tmp/weekly-intelligence-{1440,768,390}.png`.

### Acceptance scenario

The isolated test workspace uses two CAD datasets with daily observations from
2024-10-01 through 2026-04-07. The anchored report covers 2026-03-23 through
2026-03-29; subsequent evidence covers the next completed week. Tests verify
accurate period totals and changes, matched historical investigations, bounded
findings and actions, an authorized central draft/adoption, duplicate prevention
even with a changed title, later decision progress and recurrence, recorded
outcomes without causal claims, and unchanged reopened historical evidence.

The existing worker delivery tests additionally verify that the accepted-send
digest and archived report contain identical intelligence and that the email URL
contains that archive's ID and workspace. Transport, failure and branding tests
use mocks. No real API quota or customer email is consumed by this acceptance run.

These are local verification results. CI, deployment and live provider delivery
must be verified separately after publishing the changes.
