# Interpret relationships without assuming causation

Relationship analysis compares how selected metrics vary across matched calendar
periods. Pearson measures linear association. Spearman measures rank-based
monotonic association. Neither method proves causation or a complete business
explanation.

## Read the evidence

Business Analysis and Weekly Reports display the Correlation coefficient and Lag
(observed) directly on each included relationship finding, without opening the
detailed explanation. Relationships shows these values in the opened saved
result too. Positive lags include their time unit and metric order. A valid
same-period result shows 0 (same period); a missing coefficient is not displayed
as zero, and insufficient evidence does not imply zero lag.

Lag units follow the relationship analysis grouping, not the chart's detail:
weekly relationship history produces a lag in weeks even when the report week
is also shown day by day. A tentative lag is still an observed result, not a
dependable response time; check the accompanying timing warning.

Consider the sign and magnitude of the coefficient, matched observation count,
timing, significance information, coverage and warnings together. A coefficient
near zero is not proof that the systems are unrelated in every possible way.
A strong coefficient can reflect a shared trend, seasonality, duplicates or
mathematically related measures rather than an independent business influence.

Report relationships use historical context of at least 90 calendar days ending
at the report's end, or a longer requested window, with the matched-observation
threshold applied after grouping and filtering. Weekly relationships use their
own rolling history. The value being compared for last week's KPI is not simply
correlated across seven daily points without a historical check.

Significance is adjusted across tested pairs and lags where the supported
statistical backend and inputs permit it. An unavailable significance value must
not be described as a passing test. Time-series autocorrelation and selecting
the best observed lag still limit interpretation.

## Multiple sources

Reports test cross-dataset metric pairs, not an arbitrary causal network. Three
sources with one metric each yield three cross-source pairs. Selecting several
metrics from a source creates additional eligible pairs with the other sources;
within-source pairs are not added by the report relationship engine.

## Use a finding

A relationship may justify a measured experiment or a monitoring hypothesis.
Document confounding factors and a review date. Do not convert it directly into
attributed sales, a guaranteed conversion delay, an optimal budget, profit or
ROAS without the required separate evidence and definitions.

## Which spending moves with revenue, and which gives better value?

These are different questions. In Business Analysis, Compare metrics can compare
each selected spending metric with revenue across matched dates. Choose which
metric is expected to come first for each pair if you want to test delayed
movement. Review the coefficient, observed delay, shared history and warnings.
This shows historical association, not revenue earned for each dollar spent.

For better value from money already spent, use Return on spend with consistently
assigned channel revenue and spending. Do not rank channels by correlation and
call the result return on investment. A channel can move closely with revenue
but cost much more. For a future spending mix, use Budget Planner; for a
recorded action's estimated effect, use Business impact with a fair unaffected
comparison and the required earlier evidence. Chat cannot choose your winner
without running the relevant workspace analysis.

## What do positive, negative and zero correlation mean for my business?

A positive coefficient means higher values of one metric tended to accompany
higher values of the other at the tested timing. A negative coefficient means
they tended to move in opposite directions. Values run from -1 to 1; a value
near zero means little association of the kind tested, not proof of no business
connection. Not available is missing evidence, not a coefficient of zero.

Positive does not automatically mean good: costs and complaints can rise together.
Negative can be desirable, such as shorter waits accompanying higher satisfaction.
The coefficient is not a percentage revenue increase or a return per dollar.
Common seasons, overall growth or other changes can explain movement together.
Use the finding to decide what to investigate or test, not as proof of causation.

## Can I compare three or more datasets without joining them?

Yes. Business Analysis compares eligible metric pairs across different datasets
using matching calendar periods. Three datasets with one selected metric each
produce three pairs. More selected metrics create more cross-source pairs, not
a single model that separates every source's contribution. Within-source pairs
are not added by this report engine.

Choose direction independently for each pair. Visits can follow advertising
spend while leading orders. Remove pairs you do not want tested; their metrics
can still appear in the report and receive unusual-change checks. The sources
need compatible date columns, actual overlapping observations and suitable
measurements, not matching customer IDs. Entity Matching is a different workflow
for linking records; it is not required for time-based relationships.
