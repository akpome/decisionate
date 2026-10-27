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

New multi-dataset reports start with **Correlation analysis**, with relationship
settings expanded. **Business impact analysis** is a separately labelled, explicit
choice in Analysis type; it is not decision review. Saved definitions retain
their original type and settings. Definitions without `impact` remain exploratory.
The optional impact study records a sustained change/date,
an outcome and one unaffected comparison from a different selected dataset,
business-context confirmations, desired direction and optional worthwhile target.
All inputs use approved metric/date/aggregation policies and dataset-local filters.

The existing supervised Reports worker fits a controlled interrupted time-series
level-change model using the installed statsmodels OLS implementation:
`outcome ~ intercept + time + comparison + post_change + seasonal_terms`.
Daily data includes weekday terms. Seasonal businesses add two annual Fourier
harmonics and need approximately two full years of pre-change coverage. This is
not the Bayesian CausalImpact algorithm, causal discovery, an experiment or a
generic attribution/marketing-mix model. No new service, migration or env flag is
required. A user confirmation is a recorded assumption, not independent proof.

### Checks and Uncertainty

- Minimum complete periods before/after: daily 90/28, weekly 52/8, monthly 24/6.
  Quarterly studies are unsupported. Drop partial boundary buckets and buckets
  crossing the change date. Require complete shared bucket coverage, finite data,
  varying earlier values and a full-rank, well-conditioned design. No imputation.
- Hold back the last 20% of earlier history (at least the post minimum). Require
  earlier prediction MAE <=25% of the typical absolute outcome and at least 10%
  better than predicting the training mean. These are product screening rules,
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
- The post indicator coefficient is the estimated constant effect per period.
  Multiply it and its interval by matched post periods only for approved additive
  metrics. Rates, averages, distinct/nonadditive measures and balances remain
  per-period estimates. The chart's no-change line sets the fitted post indicator
  to zero, keeping comparison/time/seasonal terms. It is not an observed series
  or an independently validated forecast. Intervals describe the modeled effect,
  not a probability of causation or a prediction range for every chart point.

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

### Method References

- [statsmodels OLS fitting](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLS.fit.html)
- [statsmodels HAC covariance and correction](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html)
- [Google CausalImpact assumptions](https://google.github.io/CausalImpact/), for
  the requirement of unaffected controls and stable relationships, not a claim
  that Decisionate implements that package.

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
- Values use the metric's approved aggregation, including distinct counts and
  component-weighted ratios. The combined trend chart uses an explicitly labelled
  indexed scale; KPI values keep their original units. Currency is
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

Use for weekly report selects a snapshot's question, metrics and finding pairs
as the workspace's template. It does not enable sending or change recipients.
Alerts continues to manage delivery preferences and manual previews.

Weekly values cover the latest complete Monday-Sunday week in the platform
reporting timezone, compared with the preceding complete week. Relationships
use a rolling historical window capped at three calendar years, anchored to the
current run date. Manual report dates do not constrain scheduled reporting or
its historical context. Saved templates preserve the selected finding
pairs even if the best current lag changes. Analysis grouping is independent of
the weekly summary: `ReportDefinition.grain` retains the saved relationship and
business-impact units, while `build_report(reporting_grain="daily")` selects daily
summary trends, coverage and anomaly checks inside the completed week. Results
expose `grain` for summary detail and `analysis_grain` for analytical units.
Without a template, analytical grouping uses the shared daily default. Saved
lags and minimum observation thresholds are retained, not disabled or relabeled
as days. Coarser analysis may lack enough observations within three years; it is
not silently replaced with a finer, statistically different analysis. Weekly
previews, bounded AI facts and email alternatives label the two groupings.
Changed or unavailable policies are
flagged; fewer than two usable datasets prevents delivery rather than sending a
misleading single-source report. Existing KPI targets remain visible without
assuming that an increase is always an improvement.

Both HTML and plain-text emails include the question, windows, movements,
per-metric anomaly findings, selected relationship evidence, limitations and decision follow-up. Existing
agency branding, logo rules, recipients, provider and delivery safeguards are
preserved. Review links open `/dashboard/reports?weekly=1`.

## Selected-Metric Anomalies

Anomaly detection runs automatically for each selected metric, independently of
correlation eligibility or lag settings. Both report tabs show anomaly evidence;
the single-dataset route uses the same detector and selected metric/date policy.
The `seasonal_business` checkbox defaults to false. It is stored in a report's
JSON definition and reused by its weekly template without changing recipients,
delivery permissions or the sending switch. No database migration is needed.

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
