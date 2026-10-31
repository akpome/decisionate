# Cross-Dataset Business Reports

## Product Flow

Reports is the unified analysis workspace. Insights is no longer a separate
sidebar destination or calculation workflow: metric findings, seasonal anomalies,
cross-source relationships, follow-up actions and decision links appear in the
report preview. Old `/dashboard/insights` links redirect to Reports; dataset/metric
links open the single-dataset view, while saved-report, weekly and advanced-run
identities take precedence and remain intact. Saved relationship insights remain
available below the multi-dataset workspace with their original evidence links.

Both report tabs use `ReportWorkspace` and the business-reports engine/catalogue.
Single-dataset definitions explicitly set `scope: single`; legacy definitions
without a scope remain multi-dataset. Single reports allow one or more approved
metrics from exactly one source, use the same period comparisons and seasonal
anomaly engine, and omit cross-source relationship controls. Selecting another
source replaces the single report's previous metrics. Advanced correlation still
requires at least two sources. Forecasts and saved relationship monitors remain
separate, unchanged workflows.

Weekly templates and delivery remain cross-dataset only. A single-dataset report
cannot replace an existing weekly template or enable delivery. Its snapshot and
selected decision evidence can still be saved. Existing report snapshots,
weekly recipients, seasonal settings and decision links are not migrated or
recomputed when opening a saved report. New calculations validate current source
access and run in the separate Reports analysis worker. Saving reuses its frozen,
server-generated preview result, not client-uploaded evidence. Legacy Insights APIs remain for backward compatibility
but are no longer used by either Reports tab.

AI interpretation is requested by default for exploratory reports, uses existing provider/credit
controls and deterministic fallback, and is stored in the saved snapshot when
requested. Interactive and weekly narratives share a bounded evidence projection:
selected metrics, included relationship findings and anomaly summaries only, with
no raw source rows, trend arrays or fitted baseline arrays. The narrative does not
change the deterministic analysis, expand metric selection or create decisions.

## Business Change Impact

New multi-dataset reports start with **Explore relationships** (correlation), with relationship
settings expanded. **Assess a decision** (business impact) is a separately labelled, explicit
choice in Analysis type and is the measurement step of an existing decision's
review. New submissions require `impact.decision_id`. Saved definitions retain
their original type and settings. Definitions without `impact` remain exploratory.
The optional impact study reuses the decision's action and outcome, records the
actual implementation date and one unaffected comparison from a different selected dataset,
business-context confirmations, desired direction and optional worthwhile target.
All inputs use approved metric/date/aggregation policies and dataset-local filters.

The existing supervised Reports worker uses installed statsmodels OLS. For new
decision-linked assessments, engine `controlled_change.v3` fits only pre-action
outcomes: `outcome ~ intercept + time + comparison + seasonal_terms`, then predicts
the no-change result at the actual contemporaneous comparison values. No post-action
outcome enters the baseline fit or chooses a favorable lag. Daily data includes
weekday terms. The model uses the
comparison as its primary baseline, without a manual seasonal-business switch.
It calibrates the outcome's level and relationship rather than forcing the two
series to share a raw baseline. Two annual Fourier harmonics are considered only
with at least 728 days of complete pre-action coverage and an initial training
span of at least 364 days. This is
not the Bayesian CausalImpact algorithm, causal discovery, an experiment or a
generic attribution/marketing-mix model. No new service or env flag is required.
The serialized API/bootstrap creates the new `decision_impact_reviews` table;
deploy the API and analytics worker together. A user confirmation is a recorded
assumption, not independent proof.

### Historical Response Timing

- The actual implementation date stays unchanged. There is no manual lag input.
  Timing comes from a directed driver-to-outcome finding in the decision's original,
  authorized, immutable saved correlation report, not the outcome/comparison pair.
- Original correlation runs qualify their selected lag using first differences
  in two chronological historical blocks. Each block needs at least
  `max(12, ceil(minimum_observations / 2)) + maximum_lag + 1` complete buckets.
  The same lag and sign must win both blocks, absolute correlation must be at least
  `max(0.3, configured threshold)`, separation from every competing lag at least
  0.05, and BH-adjusted p <= 0.05 across both blocks' candidate lags. The original
  finding must also pass its report-wide adjusted significance screen. This is
  a conservative historical consistency screen, not independent out-of-sample
  validation or evidence of an exact causal delay.
- Same-period-only comparisons do not establish zero delay. A zero winner can be
  reused only when a directed timing search and consistency checks actually tested
  competing delays. Gaps, unstable timing and insufficient history withhold advice.
- The source history must end strictly before implementation. Outcome identity,
  date column, aggregation, dimension filter and timezone must match. A changed
  driver cannot also be the unaffected comparison. Multiple supported drivers
  require choosing the relevant existing relationship, never a numeric delay.
- Client timing metadata is replaced from the authorized database record. Queue
  execution, calculation and assessment saving recheck its identity. The choice is
  frozen before post-action assessment; deleted/restricted/changed source evidence
  invalidates new work. Already saved snapshots remain historical, not recalculated.
- Add the original lag in its original calendar units to implementation: daily
  stays days, weekly stays weeks, monthly/quarterly use calendar offsets. Changing
  impact grouping never reinterprets a daily lag as weeks. The first complete later
  bucket starts on/after that date; a bucket straddling it stays in the early phase.
- Early effects are estimated rather than forced to zero or discarded. Reports
  retain all complete post-action buckets and show early, later and total results.
  Later observations must independently meet the post minimum. Otherwise the
  result says Waiting for enough results, without a success/failure amount.
  Future dates and the current incomplete local day do not count.
- Existing source snapshots without qualification cannot supply an invented lag;
  regenerate directed correlation evidence using pre-action history. Legacy
  standalone impact calculations remain compatible with their explicit immediate,
  constant-level-change assumption; all new decision-linked assessments require
  supported timing. No migration rewrites existing reports or decisions.

### Checks and Uncertainty

- Minimum complete periods before/after: daily 90/28, weekly 52/8, monthly 24/6.
  Quarterly studies are unsupported. Drop partial boundary buckets and buckets
  crossing the change date. Require complete shared bucket coverage, finite data,
  varying earlier values and a full-rank, well-conditioned design. No imputation.
- Hold back the last 20% of earlier history (at least the post minimum). Require
  earlier prediction MAE <=25% of the typical absolute outcome and at least 10%
  better than predicting the training mean and than the same trend/calendar
  model without the comparison. The comparison must contribute predictive value,
  even when an annual adjustment fits well.
- Within the remaining pre-action selection history, compare the base and annual
  designs at two expanding-window origins (70% and 85%, ending at 100% of that
  selection history). Select the annual design only when its average MAE improves
  by at least 15% and neither validation block worsens. No outcome observations
  from the reserved final holdout or after the action enter this choice. The
  selected design must then pass the separate final holdout and all other gates.
  Shorter histories retain a comparison baseline with an explicit warning that
  separate yearly differences could not be assessed. The old `seasonal_business`
  flag remains compatible for other report calculations but cannot force or
  disable the impact adjustment. These are product screening rules,
  not universal statistical guarantees or proof of causal identification.
- Test two earlier fake change dates (60% and 75% through pre-history), using
  99% intervals. A clear nonzero historical level change withholds the result.
- Reject comparison values more than one pre-history standard deviation beyond
  its earlier min/max. Repeat the fit after dropping the oldest quarter of
  pre-history; an effect change above max(2 standard errors, 50% of the original
  effect, 2% of typical outcome) withholds the result.
- statsmodels HAC/Bartlett covariance uses small-sample correction and t-based
  95% intervals. Maximum residual lags are daily 14, weekly 4, monthly 2, capped
  at one fifth of available observations. This allows short-range dependence;
  it does not remove unknown confounding, spillovers or model misspecification.
- For timed assessments the actual-minus-pre-action-prediction contrast is summed
  only for approved additive metrics. Rates, averages, distinct/nonadditive measures
  and balances use a mean, not a sum. Early/later totals reconcile to the overall
  total; phase means instead reconcile using observation weights. Their approximate
  conditional 95% intervals combine HAC baseline-parameter covariance with
  pre-action residual autocovariance/Bartlett weights for each contrast. This also
  gives a one-observation early phase nonzero uncertainty. Total intervals are
  calculated jointly, not by adding phase limits. They do not cover every model,
  timing, spillover or unknown-event uncertainty and are not pointwise chart bands.
  Both phase estimates are descriptive, not two independent causal discoveries.
  The legacy standalone model still uses a fitted constant post indicator.

Unknown/competing changes, an unconfirmed unaffected comparison or a failed check
produce no effect amount. Valid intervals spanning zero produce an unclear
verdict, not a no-effect claim. The desired increase/decrease and worthwhile
threshold determine business wording; no unprovided cost, profit or ROAS is inferred.
The authoritative narrative is built from computed fields, not generated by AI.
Other AI contexts are instructed to use everyday language and not upgrade evidence.
Impact previews lead with the business answer, an original-unit actual/no-change
chart and decision links. Supporting metric comparisons, anomalies and relationship
details sit behind one expandable section. Their prior-period warnings cannot
override an otherwise valid impact estimate or produce contradictory next steps.

Snapshots freeze the study. Decision evidence retains its bounded computed result
without training arrays; creation remains centralized and intentional. Weekly
templates update the original study through the completed week, preserve study
grouping, and cap history at rolling three years. Weekly KPI/anomaly windows remain
separate; a seven-day KPI window is not reused as the causal study. Aged-out
pre-history can withhold future updates without rewriting saved snapshots.

### Decision Review Integration

The decision page links to `/dashboard/reports?decision=<id>`. The builder selects
an existing canonical, workspace-authorized decision and locks its action and
outcome metric; it never treats record creation time as the implementation date.
`GET /review-decisions` provides bounded searchable choices; `/review-decisions/{id}`
provides authorized context and the latest compatible assessment. It also returns
the period and date column stored in business-report decision evidence, only if
that evidence includes the current outcome. Malformed or unrelated contexts do
not invent a period. A matching previous assessment retains its period; otherwise
the decision evidence period is preferred, with outcome-source availability as
the explicit fallback. Comparison/date-column changes never silently replace it.
The comparison date selector is next to its single-value dimension filter; the
outcome date override and explicit shared-range changes remain optional settings.
Weekly studies retain their automatic rolling weekly history rather than adopting
an instant-analysis evidence period. The source catalog continues to enforce the
approved date and aggregation policies.

The API stamps `impact.decision_revision` from the action, outcome selection,
expected outcome and evidence scope. The worker checks it before and after
calculation. Save checks it again under a decision-row lock. Changed actions,
outcomes, archived/cancelled decisions or revoked rights cannot receive a stale
assessment. Client/read-only roles cannot attach assessments. The action is
always copied from the server's decision record, including weekly settings.

Save assessment to decision reuses the completed job's idempotent save transaction.
One `DecisionImpactReview` per job retains immutable study/analysis data and the
existing decision ID, with an optional report link. An outcome activity records
the attachment; actual outcome, status, notes, lessons and creation evidence are
not overwritten or classified automatically. `/decision-reviews/{id}` returns
paginated, source-authorized history. Job expiry and report deletion keep the
assessment; source/workspace deletion removes derived data, and permanent
decision deletion removes its assessment records. Report snapshots remain
immutable. Old standalone snapshots and existing scheduled studies remain
readable/runnable; new interactive studies and changed settings require a decision.

Weekly delivery snapshots and loads only the datasets named by saved weekly
settings. Unrelated imports cannot invalidate that source snapshot. Insufficient
current-week coverage is a dated validation error and never moves the week to
match an old file. Job responses expose an explicit `retry_safe` flag: deliberate
retries may obtain a new request key only after a confirmed pre-delivery failure;
uncertain/provider-started sends retain duplicate-send protection and require
delivery-history review. No external email is automatically replayed.

### Method References

- [statsmodels OLS fitting](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLS.fit.html)
- [statsmodels HAC covariance and correction](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html)
- [statsmodels prediction variance](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_prediction.html)
- [statsmodels residual autocovariance](https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.acovf.html)
- [Prespecifying an interrupted-time-series impact model](https://pubmed.ncbi.nlm.nih.gov/29885427/),
  for separating impact/timing assumptions from post-hoc model selection.
- [Google CausalImpact assumptions](https://google.github.io/CausalImpact/), for
  the requirement of unaffected controls and stable relationships, not a claim
  that Decisionate implements that package.
- [Chronological time-series validation](https://otexts.com/fpp3/tscv.html), for
  held-out predictions using only preceding observations.
- [statsmodels deterministic seasonal terms](https://www.statsmodels.org/stable/examples/notebooks/generated/deterministics.html),
  for calendar effects and harmonic regressors; the installed OLS engine is retained.

Synthetic tests use known positive, zero and negative interventions, and include
missing data, seasonality, poor controls, context failures, permissions and queue,
snapshot, decision-evidence and weekly/email integration. These tests validate
implementation behavior, not real-world causal validity or competitive performance.

`/dashboard/reports` is the main business-review workspace. Explore selects a
business question, approved metrics from at least two datasets, date columns,
reporting dates and grouping. Report presents the same analysis as a shareable,
printable review, including combined findings, evidence limitations, follow-up
actions and recorded decision outcomes. Relationship findings are optional;
period comparisons remain useful without a significant correlation.

Saved snapshots are immutable. Editing a selection or finding creates an unsaved
analysis; saving creates a new snapshot. Decisions retain the report identity,
question, source metrics, reporting window, included findings and limitations.
Users supply their action, reasoning, expected measurable outcome, outcome
metric and review date. Existing decision permissions, ownership and outcome
tracking remain authoritative.

Decision creation is centralized under `/dashboard/decisions`: its one creation
entry opens `/dashboard/decisions/new`. That form can attach a saved report and
choose its outcome metric, or create a manual dataset-linked decision. Analysis
pages display evidence and existing decisions, without creation buttons or
one-click recommendation-to-decision handlers.

Single-dataset analysis remains at `/dashboard/reports/dataset`. The basic
two-metric relationship monitors remain under Relationships. The separate
advanced explorer, its rollout flags and dedicated worker have been retired.
Historical runs and saved findings remain readable at `/dashboard/reports/evidence`;
old explorer links redirect there. Completed historical analyses can seed a new
report within its existing limits, preserving a link to the original evidence.
The new report recalculates its inputs; it is not a reproduction of the original
run's frozen results. See [retirement and deployment cleanup](MULTI_METRIC_CORRELATION.md).

## Evidence Rules

- Only server-approved, saved metric selections are eligible. Date columns and
  aggregation policies are checked again on calculation.
- Single-dataset analysis uses a single dataset dropdown. Metric, date and dimension
  controls are scoped to that source. Switching sources clears the prior metrics,
  filters, dates and preview. The list loads metadata only; the selected metric
  catalog is loaded on demand, with cancellation on a source/workspace change.
- Values use the metric's approved aggregation, including distinct counts and
  component-weighted ratios. The combined trend chart defaults to an explicitly
  labelled indexed scale and can switch to Actual, showing original values on
  one numeric axis with units in the legend and tooltip. The impact chart
  defaults to Actual; its Indexed view uses a shared without-change baseline for
  both lines, preserving their difference. Scale switches are display-only;
  calculations and KPI values keep their original units. Currency is
  labelled, never converted or assumed equivalent.
- Previous-period comparisons use the immediately preceding equal-length date
  window. Incomplete coverage withholds changes; zero baselines withhold
  percentage changes. Missing buckets and all-empty values remain unavailable,
  not zero. Sparse transaction dates are therefore explicitly flagged rather
  than interpreted as proven zero-sales days.
- Relationships use at least 90 calendar days ending at the report's end date,
  at least 24 matched observations, and cross-dataset pairs only. Longer report
  windows use the longer history. Monthly or quarterly studies may require a
  longer window to meet the observation threshold.
- New report lags shift calendar buckets before dropping missing pairs. Legacy
  saved analyses retain their existing shared-period lag convention.
- Adjusted significance covers every tested pair and lag. The installed SciPy
  backend supplies significance for eligible inputs; older coefficients-only
  snapshots retain their original unavailable significance. Even significant
  findings are historical associations, not proof of causation, attribution,
  conversion delays, profit or ROAS.
- Reports are bounded to 25 metrics, 12 lag periods and 1,000 pair-lag tests.
  Larger studies must be narrowed or split into separate reports; no separate
  advanced queue is available.

## Weekly Delivery

Analysis (`/dashboard/reports`, single source at `/dashboard/reports/dataset`)
and Weekly Reports (`/dashboard/reports/weekly`, Weekly Reports in the sidebar)
are separate workflows, reached from the sidebar rather than a cross-workflow tab bar.
Analysis has Build analysis / Analysis preview, selectable dates and
daily grouping by default. Weekly Reports has Report setup / Report preview and stores
an independent JSON configuration on `WeeklyReportPreference.weekly_report_definition`,
read and removed through GET/DELETE `/api/v2/business-reports/weekly-settings`.
The weekly UI follows Preview report, then Save weekly report. Draft previews
use POST `/weekly-preview-jobs` with an authorized frozen definition and the
original saved configuration. The worker computes that draft without persisting
weekly settings or a report snapshot. POST `/jobs/{id}/save-weekly` atomically
saves the completed snapshot and weekly setup; repeated saves return the same
snapshot without reapplying older settings. It rechecks permissions, sources,
the reporting week/timezone and concurrent settings changes before saving.
Failed previews or saves preserve the previous configuration. The legacy PUT
settings endpoint remains compatible, but the weekly UI no longer uses it.
Saving does not enable sending or change recipients. Alerts retains delivery settings.
Copy selection to Weekly Reports is an explicit editable copy, not a live template link.

Weekly values cover the latest complete Monday-Sunday week in the platform
reporting timezone, compared with the preceding complete week. Relationships
use a rolling historical window capped at three calendar years, anchored to the
current run date. Manual report dates do not constrain scheduled reporting or
its historical context. Report-week charts, coverage and anomaly checks use seven
daily periods; KPI values still aggregate the full completed week and compare
with the preceding full week. A separate `weekly_anomaly_analysis` assesses each
selected metric's full-week value against earlier complete weekly observations;
`anomaly_analysis` retains the daily checks. Both hold out the full report week
from their own baselines and honor the rolling three-year cap and seasonal
setting. Full-week expected ranges are retained even for normal results, in a
bounded `assessments` list. Weeks with missing daily observations, including a
partial week at the historical cutoff, are excluded instead of assuming zeros.
Weekly values preserve raw/curated aggregation policies, not sums of daily
averages or ratios. Both assessments reach preview, HTML/plain-text email and
bounded interpretation facts; legacy snapshots are not retroactively relabeled.
Earlier relationship history uses complete weekly
buckets ending before the report week. Raw daily history remains available for
seasonal anomaly baselines; weekly and daily observations are never mixed in
one relationship series. Business-impact studies retain weekly grouping.
Weekly relationship defaults are
Spearman, 52 matched weeks (floor 24), same-period comparison, maximum lag 12 weeks.
The worker enforces this split, including legacy fallback paths. A non-weekly
legacy template keeps its selected metrics/date columns/dimension filters/question,
but resets directional timing to same-period; a numeric daily lag never becomes
the same number of weeks. Deliberate weekly timing is retained. Startup backfills
existing template definitions into independent settings without changing sending.
Saved snapshots are immutable and listed separately by workflow. Removing settings
pauses delivery; deleting an independent snapshot does not alter weekly settings.
Source deletion clears affected weekly settings and pauses sending. Configuration
changes invalidate queued weekly jobs under the existing worker checks.
Changed or unavailable policies are
flagged; fewer than two usable datasets prevents delivery rather than sending a
misleading single-source report. Existing KPI targets remain visible without
assuming that an increase is always an improvement.

Both HTML and plain-text emails include the question, windows, movements,
per-metric anomaly findings, selected relationship evidence, limitations and decision follow-up. Existing
agency branding, logo rules, recipients, provider and delivery safeguards are
preserved. Review links open `/dashboard/reports/weekly?weekly=1`; legacy
`/dashboard/reports?weekly=1` links redirect to the weekly page.

The weekly page's Send report now action uses `POST /weekly-owner-jobs` to submit
a durable `weekly_owner_send` job after preview and save, with `preview_job_id`
to recheck that the saved preview still matches the current reporting week and
weekly definition. Sending does not implicitly save pending edits.
Its distinct route and kind fail closed on
older API/worker deployments instead of sending to scheduled recipients.
The server resolves the workspace owner's email through the
existing identity/organization model, freezes it and rechecks it before sending.
The client cannot supply an arbitrary recipient. The manual action works with
scheduled delivery paused and does not change schedule preferences, recipient
lists or the scheduled last-send marker. It uses the existing worker, email
provider, delivery logs, permission checks and no-automatic-resend boundary.

## Selected-Metric Anomalies

Anomaly detection runs automatically for each selected metric, independently of
correlation eligibility or lag settings. Both report tabs show anomaly evidence;
the single-dataset route uses the same detector and selected metric/date policy.
The `seasonal_business` checkbox defaults to false. It is stored in a report's
JSON definition, independently in instant and weekly settings, without changing recipients,
delivery permissions or the sending switch. Startup adds the nullable weekly settings
column to existing installations; deploy the API and analysis worker together.

For each evaluated block, the detector uses only preceding observations inside
a rolling three-calendar-year maximum lookback. A complete weekly report is
held out of its own baseline. Longer manual reports are assessed chronologically
in bounded blocks, with no future observations available to a block's fit.
Historical data older than the cap is excluded, not deleted. Saved anomaly
evidence is immutable along with its report snapshot.

Statsmodels robust linear regression fits trend and, when enabled, weekday
effects and annual calendar Fourier terms. Daily data can support weekly and annual components; coarser
grains can support annual components. Leap-year annual phase is calendar based.
This approach accepts observed timestamps without filling missing measurements.
Coverage is checked against observed weekdays for daily business calendars;
absent weekends are not invented as trading days or zero activity. Weekly
baselines do not score a weekday they have never observed.
Annual candidates require at least two preceding cycles plus validation history
and adequate coverage; having a three-year cap alone is not proof of reliability.
Past-only holdout errors select the model and compare full-cap and recent-history
trend baselines. Seasonal terms must improve held-out error, rather than being
forced onto every metric of a seasonal business.
Long daily reports reuse the selected candidate family for up to four blocks
between model-selection passes, while still refitting and recalibrating each
block independently on preceding data. Weekly reports always select afresh.

Thresholds use median-centred, normally scaled MAD of historical prediction
errors, with sample-standard-deviation and constant-residual fallbacks. They are
exploratory detection bands, not guaranteed confidence intervals or causal
conclusions. The assessed values cannot inflate their own error scale. Missing
measurements are neither zero-filled nor labelled anomalies. Stale, sparse,
unavailable or short histories get explicit per-metric limitations, and missing
annual support is disclosed even when a shorter-cycle baseline is usable.

Report previews, weekly previews and both email alternatives include dates,
actual values, expected values/ranges and deviations. Ordinary period changes
remain separate from anomaly findings. Per-block training dates, observation
counts, validation counts and scale methods are retained in the saved evidence.
AI receives bounded anomaly summaries, not raw training frames or baseline arrays.
Unavailable anomaly evidence does not prevent delivery of an otherwise valid
cross-dataset review. No connector history is fabricated or automatically
backfilled beyond what its stored data actually contains.

Method references:
- [Statsmodels robust linear models](https://www.statsmodels.org/stable/rlm.html)
- [Fourier terms for long seasonal periods](https://otexts.com/fpp3/dhr.html)
- [NIST scale measures and robust alternatives](https://itl.nist.gov/div898/handbook/eda/section3/eda356.htm)

## Season-Aware Forecasts

`GET /forecasting/{dataset_id}` also accepts `seasonal_business` (default false).
Forecasts and report anomalies share the same calendar-baseline implementation
in `datasets/services/seasonal_baseline.py`; their scoring purposes remain
distinct. Forecasts return point projections, not the anomaly detector's bands
or purported confidence intervals.

The existing forecast date window chooses the forecast origin. At most three
calendar years ending at its latest observation are eligible for training;
older observations are excluded before aggregation, never deleted. A saved
historical date window does not silently pull in later observations. Period
labels follow the requested daily, weekly, monthly or quarterly calendar rather
than extrapolating an arbitrary last-row gap. Edge buckets not fully spanned by
the observed transaction date range are excluded; period-labelled exports are retained.
Missing measurements are not zero-filled. Daily business-day projections follow
observed weekdays and disclose this restriction.

When sufficient coverage exists, two chronological validation folds compare the
calendar baselines with linear, last-value and moving-average alternatives on
the same held-out observations. Seasonal terms need at least a 10% improvement
over the best non-seasonal alternative to be selected. Annual candidates require
two preceding cycles plus validation history within the three-year cap. Daily
data can use weekday patterns even when annual history is not yet sufficient.
The model is refit on each request. Insufficient history, unsupported seasonal
patterns and fitting failures retain an explicitly limited or non-seasonal
forecast. Quarterly validation may cover fewer periods ahead than the projection;
this is disclosed and reliability is capped.

The Forecasts page has the same opt-in seasonal-business checkbox and displays
the actual training dates, count, validation horizon, selected calendar patterns
and warnings. The option participates in the scoped API cache key and resets on
dataset/workspace changes. Seasonal peaks alone do not produce an investment
increase recommendation. Holidays, promotions, structural changes and causal
effects are not inferred by this calendar regression.

Method references are the Statsmodels and forecasting-textbook sources above.
`tests.test_seasonal_forecasts` covers calendar projections, opt-in behavior,
past-only validation, rolling expiry, partial/missing periods, fallback behavior
and the route contract. Web tests cover basis rendering and cache separation.

## Storage and Access

The API lives at `/api/v2/business-reports` and requires no correlation rollout
flags or dedicated correlation worker. Every source and saved snapshot is checked
against the authenticated active workspace, including on subsequent reads.
Saving shared reports requires an existing writable workspace role; selecting
weekly templates requires the existing workspace data-manager permission.

Bootstrap adds `business_reports` and nullable
`weekly_report_preferences.business_report_id` through the existing serialized
schema initialization. It also adds `report_analysis_jobs` for the separate
PostgreSQL-backed analysis worker. Source data, existing saved relationships and
connector selections are not migrated or rewritten. Deploy
`python scripts/run_analysis_worker.py` as a persistent service, independently
of ingestion. The scheduler start command does not change; its weekly endpoint
now queues delivery. See [worker setup and deployment order](railway-scheduling.md#persistent-reports-analysis-worker).
Deleting a source removes snapshots that reference it and clears their weekly
template links. Workspace deletion and expiry purges remove its report data and
analysis jobs. Job execution and subsequent result reads recheck source access.

`POST /jobs` returns HTTP 202 and a job identity; `GET /jobs/{id}` reports its
phase and completed result. `POST /jobs/{id}/cancel` stops queued/running work,
and `POST /jobs/{id}/save` persists the completed snapshot exactly once. Reloads
reconnect using the job URL. The worker rejects source revisions changing during
calculation instead of mixing different versions into a report. Queued weekly
jobs freeze their reporting date, preserve the three-year seasonal lookback,
and cannot silently use changed preferences or send an expired reporting week.
Schema bootstrap runs in a short-lived subprocess. Ordinary queue supervision
does not retain the API or numerical libraries, and error monitoring is
initialized separately in the persistent supervisor.
Unexpected exits record the child return code and last job phase; the customer
interruption message is not a diagnosis of memory exhaustion. Reloads preserve
failed-job state; a deliberate new preview is required to retry.
Saved reports is the only report-history selector; report pages do not fetch or
display recent-analysis history. Active job progress, cancellation and URL-based
reload recovery remain available. Deleting a snapshot also removes its linked
jobs and clears the selected analysis in the client. Missing or expired job links
show an availability message and return to the builder without replaying analysis
or recreating data.

## Verification

`tests.test_business_reports` covers date windows, missing/all-null data, weighted
ratios, currencies, calendar lag, scope, immutable snapshots, changed policies,
decision evidence and weekly template/preview behavior. Existing weekly,
relationship, permissions and email-branding suites provide regression coverage.
The web tests cover the report definition contract and decision handoff.
`tests.test_report_anomalies` covers seasonality, spikes/drops, trend, zero spread,
missing/stale history, expired/future data, weekly date independence and escaped
email alternatives. The workflow suite covers seasonal template persistence,
single-dataset scope enforcement and unchanged saved anomaly snapshots.

Production rollout still requires a deployed API and web build, PostgreSQL
bootstrap verification, a healthy analysis worker, and a preview of a current two-source weekly report.
No production email should be triggered merely to verify deployment.
