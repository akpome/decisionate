# Build single and multi dataset reports

Reports is the main analysis workspace. Multi dataset report opens by default;
Single dataset report is available separately for one source. Both use approved
dataset metrics, date policies, anomaly detection and report snapshots.

## Build an analysis

1. Select the intended report tab and name the business question.
2. Replace the generated report name with a useful description. Its unique
   starting label prevents name collisions; it is not a business conclusion.
3. In Datasets and metrics, select only relevant approved measures. Multi dataset
   reports require at least two sources. Single dataset reports use exactly one.
4. Review each preselected Date column. Apply a dataset-local Dimension column
   filter and Unique values if you want a segment rather than all eligible rows.
5. Set Start, End and Group by. Request seasonal activity only when appropriate.
6. For multi dataset analysis, configure Relationship analysis. Remove unwanted
   pairs and set each remaining pair's direction. Evaluate timing is always
   available above the pairs; set Maximum lag for directional tests. Pairs left
   at Same-period comparison only do not test positive lags. Single dataset
   reports omit cross-source relationships.
7. Choose Preview report and wait for analysis to finish before saving.

## Limits and evidence

New analyses share their defaults with Relationships: Spearman, daily grouping,
Sum aggregation where applicable, 24 minimum historical observations, maximum
lag 12 grouped periods and same-period comparison. Valid saved choices are
retained rather than replaced simply because the defaults changed.

A report supports at most 25 selected metrics, a maximum of 12 lag periods and
1,000 cross-dataset pair/lag tests. Reduce metrics or timing complexity if the
analysis exceeds these limits. Removed pairs do not consume relationship tests;
they can be restored without removing the selected metrics. The default
relationship observation threshold is 24 matched periods; selecting more calendar
dates is not equivalent to having more observations.

New report previews request AI interpretation automatically, with a clearly
labeled rules-based fallback if the provider or credits are unavailable.
The computed report does not require a successful external AI response. A saved snapshot
retains its original result; changing a filter, metric, date, pair selection or
timing setting requires a new preview to calculate new evidence.

Reports show evidence and linked decisions. Create a new business decision in
the central Decisions workflow rather than expecting Preview report to execute
an action or create a decision automatically.
