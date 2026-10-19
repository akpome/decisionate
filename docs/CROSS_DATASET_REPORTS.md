# Cross-Dataset Business Reports

## Product Flow

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

Single-dataset inspection remains at `/dashboard/reports/dataset`. Existing
relationship monitors and advanced matrices remain available from Explore.
Completed advanced analyses can seed a report while preserving a link to the
original run. The new report recalculates its inputs; it is not a reproduction
of the original run's frozen results.

## Evidence Rules

- Only server-approved, saved metric selections are eligible. Date columns and
  aggregation policies are checked again on calculation.
- Values use the metric's approved aggregation, including distinct counts and
  component-weighted ratios. Different units have separate charts. Currency is
  labelled, never converted or assumed equivalent.
- Previous-period comparisons use the immediately preceding equal-length date
  window. Incomplete coverage withholds changes; zero baselines withhold
  percentage changes. Missing buckets and all-empty values remain unavailable,
  not zero. Sparse transaction dates are therefore explicitly flagged rather
  than interpreted as proven zero-sales days.
- Relationships use at least 90 calendar days ending at the report's end date,
  at least 30 matched observations, and cross-dataset pairs only. Longer report
  windows use the longer history. Monthly or quarterly studies may require a
  longer window to meet the observation threshold.
- New report lags shift calendar buckets before dropping missing pairs. Legacy
  saved analyses retain their existing shared-period lag convention.
- Adjusted significance covers every tested pair and lag. Without the optional
  statistical dependency, significance remains unavailable. Even significant
  findings are historical associations, not proof of causation, attribution,
  conversion delays, profit or ROAS.
- Guided reports are bounded to 25 metrics, 12 lag periods and 1,000 pair-lag
  tests. Larger studies use the existing asynchronous advanced matrix.

## Weekly Delivery

Use for weekly report selects a snapshot's question, metrics and finding pairs
as the workspace's template. It does not enable sending or change recipients.
Alerts continues to manage delivery preferences and manual previews.

Weekly values cover the latest complete Monday-Sunday week in the platform
reporting timezone, compared with the preceding complete week. Relationships
use the longer historical window. Saved templates preserve the selected finding
pairs even if the best current lag changes. A lag configured in weekly, monthly
or quarterly units is not silently reused as days: daily reviews disable that
lag with a warning and retain the original report for timing analysis.
Changed or unavailable policies are
flagged; fewer than two usable datasets prevents delivery rather than sending a
misleading single-source report. Existing KPI targets remain visible without
assuming that an increase is always an improvement.

Both HTML and plain-text emails include the question, windows, movements,
selected relationship evidence, limitations and decision follow-up. Existing
agency branding, logo rules, recipients, provider and delivery safeguards are
preserved. Review links open `/dashboard/reports?weekly=1`.

## Storage and Access

The API lives at `/api/v2/business-reports` and is available independently of the
advanced correlation rollout flags. Every source and saved snapshot is checked
against the authenticated active workspace, including on subsequent reads.
Saving shared reports requires an existing writable workspace role; selecting
weekly templates requires the existing workspace data-manager permission.

Bootstrap adds `business_reports` and nullable
`weekly_report_preferences.business_report_id` through the existing serialized
schema initialization. Source data, existing saved relationships and connector
selections are not migrated or rewritten. No additional worker is required for
the bounded synchronous report path, and no scheduler start command changes.
Deleting a source removes snapshots that reference it and clears their weekly
template links. Workspace deletion and expiry purges remove its report data.

## Verification

`tests.test_business_reports` covers date windows, missing/all-null data, weighted
ratios, currencies, calendar lag, scope, immutable snapshots, changed policies,
decision evidence and weekly template/preview behavior. Existing weekly,
relationship, permissions and email-branding suites provide regression coverage.
The web tests cover the report definition contract and decision handoff.

Production rollout still requires a deployed API and web build, PostgreSQL
bootstrap verification, and a preview of a current two-source weekly report.
No production email should be triggered merely to verify deployment.
