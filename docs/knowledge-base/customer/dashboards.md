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

Open Filters for the Date column. In General Business Overview, use Edit
dashboard > Select Metrics for the shared dimension filter. On other
dataset-based dashboards, use the dimension control in Filters or Dataset.
Unique values and Search values narrow a segment. Closing the controls does
not clear the date or dimension choices.

## How do I choose metrics and add a target?

1. Open General Business Overview, choose a dataset, and select Edit dashboard
   > Select Metrics. Check the measures to show in the main chart.
2. For a narrower view, choose a Dimension column and one or more values. For
   example, show Orders and Net sales just for the Downtown location. This
   filters all checked metrics together; it does not draw a separate series
   per location.
3. To show the KPI gauge, choose a Target metric and enter its target. Leave
   Target metric on Choose a metric to hide the gauge. This choice is separate
   from the metric checkboxes; the main chart only draws the target line in
   Actual scale when the target metric is among its series.
4. Choose Executive or Performance for the layout. These are two arrangements
   of the dashboard. Compare Groups is a separate way to plot the data, not a
   third layout.

Targets belong to metrics, not individual dimension values. If you set a target
for the same metric in Compare Groups, the target value is shared.

## How do I compare groups on a dashboard?

1. Open General Business Overview, choose a dataset, and select Edit dashboard
   > Compare Groups.
2. Choose one Metric to compare. Choose the Dimension column that contains the
   groups, such as channel, region or product category.
3. Search or check the values in that column. For example, choose Net sales
   and check Online and Store under Channel. Each checked value gets its own
   colour and series. The regular Select Metrics chart is not shown while the
   group selection is incomplete.
4. Review the saved dates and grouping. Pick Line, Bar or Area and Actual or
   Indexed scale as appropriate. Indexed scale compares relative movement; it
   is not the amount in the original units. A group with no usable records is
   not filled with zero. If a group is missing, check the date range and
   dimension selection.
5. Use Share link to email the displayed comparison, or Save PDF where
   available. Recipients see the shared groups without adjustment controls.

For joined data, choose an original dimension from the metric's own source to
split its underlying records. If the dimension is from another source, the
chart groups shared monthly totals only where each month has one known group.
It does not match individual records across sources.

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
treated as a new custom range. Shared dashboards show the saved dates without
date or grouping controls. Forecasts and Reports have their own date controls.

## Targets, PDFs and sharing

Targets are benchmarks, not proof that increasing a measure is desirable.
Compare the chart, KPI values and coverage within the same filtered window.
Save PDF exports the dashboard view where supported; it is not the same as a
weekly email or a saved report snapshot. Shared links have separate access and
refresh considerations. Do not publish a view until its active workspace,
filters, mappings and intended audience are correct.
