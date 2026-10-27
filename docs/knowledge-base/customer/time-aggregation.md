# Dates, grouped periods and aggregation

Date selection, grouping and aggregation answer different questions. A Date
column identifies when source activity occurred. Start and End bound a manual
report. Group by chooses the calendar buckets used for comparison.

## Grouping versus historical observations

Daily, weekly, monthly and quarterly grouping collect observations into those
periods. One year of monthly records gives twelve monthly buckets. Choosing daily
grouping does not manufacture daily activity from monthly totals or fill missing
dates with trustworthy zeros.

Minimum historical observations counts usable matched grouped observations for
relationship testing. Reports and Relationships default to 52 observations and
weekly grouping; valid saved settings are retained. A long form date range can still
have too few observations because the source is sparse, dates do not overlap,
filters remove rows, values do not vary or lagging removes matched pairs.

## Aggregation policy

Sum, average, minimum, maximum, count and curated policies have different
meanings. Use the policy appropriate to the measure. Ratios, distinct users,
opportunity probabilities, balances and document totals are not interchangeable
with additive sales amounts. Do not sum rates or repeated header totals just
because a chart can show a number.

Reports compare the selected window with the immediately preceding equal-length
window. Missing coverage may withhold a change; a zero comparison baseline may
make the percentage undefined. That is different from a measured zero change.

## Comparing pages

Check that both pages use the same workspace, metric policy, date column, range,
dimension filter and grouping before comparing their values. Dashboards,
Forecasts, manual Reports and scheduled weekly Reports have separate time
controls. Weekly reporting follows completed weeks rather than retaining the
dates of the snapshot used as its template.
