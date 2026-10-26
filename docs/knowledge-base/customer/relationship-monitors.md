# Saved relationships versus report relationships

Relationships is a separate page for a saved monitor comparing two metrics from
different datasets. Multi dataset report is the broader review workflow with
multiple metrics, period movements, anomalies and cross-source findings.

## Set up a two-metric monitor

Choose the left and right datasets and their metrics. Review both Date columns
and apply each side's Dimension column and Unique values independently when
needed. Set the period and aggregation to fit the business question, then check
the actual overlapping source dates.

The Relationships page has its own Automatic and Advanced timing controls.
Do not substitute the Reports page's per-pair settings or test-count limit for
this monitor's controls. Read the resulting matched periods, timing, strength
and credibility/stability information before saving it.

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
