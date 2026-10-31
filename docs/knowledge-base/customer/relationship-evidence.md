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
