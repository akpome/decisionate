# Use dashboards for KPIs and charts

Dashboard and the selectable industry dashboards are supporting views of metrics
and trends. Use Reports for the integrated findings, anomalies and cross-dataset
analysis workflow. The removed dashboard Analysis tab is not a hidden setting.

## Configure a view

Select the dataset and measures, then review the chart and any manual metric
mappings. Industry dashboard names describe a view, not proof that a connector's
schema contains every expected column. Confirm the mapping and units before
interpreting a tile as revenue, cost or conversion performance.

The dataset field combines search and selection. Typing narrows its list; choose
an option to change the dashboard's dataset. Leaving the field without choosing
keeps the existing selection. Clear dataset selection removes it explicitly.

Open Filters for Date column and Dimension column. Unique values and Search
values narrow a segment. Date and dimension choices apply to the selected view;
closing the tab does not clear them. Change grouping and aggregation only when
appropriate to the actual measurement frequency and metric semantics.

## Date range

All dashboards use Start date and End date instead of an End date plus a Period
selector. A new or reset view starts on the same calendar date last year and
ends today, using the browser's local calendar. This is the past year through
today, not January 1 through today. On February 29 the previous-year start is
clamped to February 28. Both boundary dates are included.

Choose exact dates for a historical window. Charts, KPI totals, anomaly checks
and newly joined data use the same range; records outside it are excluded. An
empty range does not fall back to all-time totals. Group by and Aggregate still
control the summary of records inside the range. Reset view or Reset range
restores one year through today. Saved custom ranges reopen unchanged. Older
saved period choices become equivalent explicit dates; retired or invalid
preferences use the one-year default. An obsolete Start-only preference is not
treated as a new custom range. This applies to industry and shared dashboards.
Forecasts and Reports have their own date controls.

## Targets, PDFs and sharing

Targets are benchmarks, not proof that increasing a measure is desirable.
Compare the chart, KPI values and coverage within the same filtered window.
Save PDF exports the dashboard view where supported; it is not the same as a
weekly email or a saved report snapshot. Shared links have separate access and
refresh considerations. Do not publish a view until its active workspace,
filters, mappings and intended audience are correct.
