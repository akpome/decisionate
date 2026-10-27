# Unusual changes and seasonal businesses

Report anomaly detection assesses each selected metric separately. It runs
independently of whether relationship analysis finds an eligible or significant
pair. No unusual change detected is a valid outcome; it is not proof that a
worker failed.

Weekly reports assess the last completed Monday-Sunday in two ways: the whole
week against earlier complete weeks, and individual days against their daily
baseline. Each selected metric has separate results for both. A normal weekly
value can hide unusual daily ups and downs; a run of small daily changes can
produce an unusual week. Whole-week results include an expected range even
when the week is not unusual. Missing dates prevent a complete-week assessment;
they are not replaced with invented zero values.

## How expected behavior is built

The detector uses preceding history inside a rolling three-calendar-year cap.
An assessed block is held out of its own training data. It fits a robust trend
and, when Business has seasonal activity is enabled, considers supported calendar
patterns. Seasonal terms must improve past-only validation; the checkbox does
not force a seasonal model onto every metric.

Annual patterns need at least two preceding annual cycles plus validation data
and adequate coverage. Three years selected in a form does not guarantee that
three years of suitable observations exist. Missing source activity is not
automatically treated as measured zero, and holidays and promotions are not
automatically known events.

## MAD or standard deviation

The primary variability measure is scaled median absolute deviation of held-out
baseline residuals. Standard deviation of residuals is a fallback when MAD is
too small. If both are effectively constant, the method records a constant
residual rather than pretending that a reliable non-zero spread exists.
This is not simply calculating the standard deviation of all raw values.

## Read a finding

Review actual value, expected value, expected range, deviation, direction and
the history/model warnings. The displayed range is an exploratory anomaly
threshold, not a guaranteed confidence interval or proof of a business cause.
Limited history or unassessed observations must not be reported as no anomalies.

Check imports, filters, date choices and structural changes first. If the
change warrants action, create a human-reviewed decision and later record its
outcome. The lookback cap excludes old data from fitting; connector retention
is the separate process that can delete old source records.
