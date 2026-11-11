# Unusual changes and seasonal businesses

Anomaly detection checks whether a metric is unusually high or low compared with
its expected range based on earlier history. It is not simply the percentage
change from the previous period and does not establish why a change happened.

Relationships report, Combined metrics report and Single dataset report each have
an Anomaly detection section. Detect unusual changes is checked by default for
new reports and when editing older reports without an explicit choice. Clear it
to skip the detection calculations while retaining totals, trends, earlier-period
comparisons and any requested relationship analysis. Preview again after changing
it, then save; saved reports and copies to Weekly Reports retain the choice.

Business has seasonal activity is a separate, opt-in setting under Business
context, above the Anomaly detection section. It remains selectable when
detection is off, and its preference is retained. It affects anomaly checks
when they run; it does not adjust correlations. An off report says Anomaly detection is off for this report;
it does not claim No unusual changes detected or hide the choice as missing data.

When enabled, report anomaly detection assesses each selected metric separately. It runs
independently of whether relationship analysis finds an eligible or significant
pair. No unusual change detected is a valid outcome; it is not proof that a
worker failed.

When detection is enabled, weekly reports assess the last completed Monday-Sunday in two ways: the whole
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

## Why did sales suddenly fall, and is that unusual?

Select the sales metric in Business Analysis for a chosen period, or Weekly
Reports for the last completed week. Unusual-change detection compares each
selected metric with its expected behavior, even if no relationship pair is
tested. Check actual value, expected range and history warnings. A change may
be unusual without its cause being known.

First check incomplete imports, date and dimension filters, closures, promotions
and other known changes. Seasonal activity can help account for supported
recurring patterns, but it does not automatically know a holiday or campaign.
Relationship findings can suggest another metric to investigate; they do not
prove why sales changed. No unusual change detected differs from Not assessed:
the latter means evidence was insufficient, not that sales were normal.

## Why is the week normal when one day had an unusual change?

Weekly Reports checks the full week's value against earlier complete weeks and
also checks the individual days. A sharp rise and fall can cancel out over the
week. Conversely, several small daily increases can add up to an unusual week.
Both assessments are useful and neither should be substituted for the other.

Missing dates prevent a complete-week assessment; they are not assumed to be
days with zero business. Read the history and seasonal warnings before acting.
The expected range describes usual behavior under the available evidence, not
a sales target or a promise. An unusual change does not by itself send an
immediate alert; weekly email delivery is controlled separately.
