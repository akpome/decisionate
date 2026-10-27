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
where applicable, 24 minimum historical observations, a maximum lag of 12 grouped
periods, and same-period comparison. Correlation method, Minimum historical
observations and Maximum lag are visible in Relationship analysis rather than
hidden in advanced options. Valid deliberately saved settings are retained.

Leave Timing at Same-period comparison only to avoid positive-lag tests. Choose
Dataset A leads (timing search) to evaluate zero through Maximum lag, or use
Left metric leads by for a fixed-lag hypothesis. A fixed lag must not exceed
Maximum lag. The 12-period maximum is the same for daily, weekly, monthly and
quarterly grouping; it is not an automatic conversion into days.

The observation minimum is enforced after filtering, grouping and lagging.
Insufficient observations produce insufficient data, not a usable correlation.
Observation and lag limits persist with each monitor and are reused for its
scheduled evaluation. Existing monitors without a saved history threshold use
24, so a short-history monitor that formerly showed a coefficient can now be
insufficient. Read the matched periods, timing, strength and credibility before
saving. Shared defaults do not make the two workflows identical: the saved
monitor retains its fixed/automatic timing and stability scoring, while Reports
supports multiple pairs and its report-specific calendar alignment and testing
limits. Neither workflow proves causation.

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
