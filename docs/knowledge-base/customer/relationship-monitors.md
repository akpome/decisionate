# Saved relationships versus report relationships

Relationships is a separate page for a saved monitor comparing two metrics from
different datasets. Multi dataset report is the broader review workflow with
multiple metrics, period movements, anomalies and cross-source findings.

## Set up a two-metric monitor

Choose the left and right datasets and their metrics. Review both Date columns
and apply each side's Dimension column and Unique values independently when
needed. Set the period and aggregation to fit the business question, then check
the actual overlapping source dates.

New analyses on both pages default to Spearman, daily grouping, Sum aggregation
where applicable, 52 minimum historical observations, a maximum lag of 12 grouped
periods, and same-period comparison. Correlation method, Minimum historical
observations and Maximum lag are visible in Relationship analysis rather than
hidden in advanced options. Valid deliberately saved settings are retained.

Leave Relationship direction at Same-period comparison only to avoid positive-lag
tests. Choose either named metric as the leader to evaluate zero through Maximum
lag. Maximum lag is shown only for a directional search. Dataset labels and each
source's dimension filter retain their original identities when the second
metric leads. The 12-period maximum is the same for daily, weekly, monthly and
quarterly grouping; it is not an automatic conversion into days.

There is no new fixed-lag editor. Existing saved fixed-lag monitors retain their
original timing, shown as Saved fixed lag, until the user explicitly chooses a
new direction. Saved grouping and observation thresholds, including weekly
grouping and a 24-observation threshold, are not overwritten by the new defaults.

The observation minimum is enforced after filtering, grouping and lagging.
Insufficient observations produce insufficient data, not a usable correlation.
Observation and lag limits persist with each monitor and are reused for its
scheduled evaluation. Existing monitors without a saved history threshold use
24 for backward compatibility; newly created analyses default to 52. Read the
matched periods, timing, strength and credibility before
saving. Shared defaults do not make the two workflows identical: the saved
monitor retains its fixed/automatic timing and stability scoring, while Reports
supports multiple pairs and its report-specific calendar alignment and testing
limits. Neither workflow proves causation.

## Read an opened saved relationship

The Correlation coefficient panel names the result being measured. More history needed
means there are fewer matching grouped periods than this monitor requires; for
example, 12 matching monthly periods do not meet a saved minimum of 24. Overlapping
dates alone do not satisfy that minimum. The panel shows the matched and required
counts. Correlation unavailable can also mean the matched values cannot produce a
score, such as a metric that does not vary. Analysis unavailable instead indicates
that the source data or a saved filter could not be used; check the accompanying
message.

The coefficient and lag are visible in the opened result. Lag (observed) shows the
selected delay with its grouping unit and the metric order when the delay is
positive. A valid same-period comparison shows 0 (same period). A computed lag
with limited timing evidence remains visible with a tentative-timing warning;
insufficient evidence shows Not established rather than implying a zero lag.
A manual comparison shows Lag (selected comparison), not an estimated delay.
Detailed timing candidates remain available under View timing evidence.

Delete a saved relationship with its trash button in Saved relationships. Opening
the evidence does not add a second delete control. Deletion requires confirmation
and also removes the opened evidence if it belongs to that relationship.

## When to use Reports instead

Use Multi dataset report when several sources or metrics need to be analyzed
together, or you need anomalies, a frozen report snapshot and related decision
outcomes. A saved two-metric monitor is not a multivariate causal model, and a
report's collection of pairs is not one either.

## Historical advanced analysis

The former advanced matrix/explorer, its separate worker and rollout variables
have been retired. Historical completed evidence can remain readable, and old
links may redirect to the evidence viewer. That does not mean new advanced runs
can be submitted there. A new report seeded from historical evidence recalculates
current authorized inputs and retains its source reference; it does not recreate
the original frozen run automatically.

If a saved monitor is removed, review weekly alert selections that referenced it
instead of assuming the deleted relationship continues to provide current data.
