# Build single and multi dataset reports

Business Analysis is the on-demand analysis workspace. Multi dataset report opens by
default; Single dataset report is available separately for one source. Weekly Review
in the sidebar opens Weekly Business Review, with its own page and settings, automatic dates, whole-week and daily checks,
and earlier relationship history grouped weekly.
Use the sidebar to move between these separate workflows; neither page has tabs
for the other workflow. Business Analysis has Build analysis and Analysis preview;
Weekly Business Review has Report setup and Report preview.
Business Analysis uses approved
dataset metrics, date policies, anomaly detection and report snapshots.

New multi dataset reports open with **Correlation analysis**. The correlation
method, minimum historical observations, timing and relationship-pair settings
are available under the expanded Relationship analysis section. Under Analysis
type, choose **Business impact analysis** to review an existing decision.
Saved reports keep their original analysis type. Neither mode replaces
decision creation or decision review on the Decisions page.

## Did my business change help?

Open an existing decision and choose Assess business impact, or select Decision
to review in the report builder. The decision's action and outcome metric are
reused, not entered as a second decision. If no outcome metric was recorded,
choose it in Decision Details first. Confirm when the action actually started;
the decision creation date is not assumed to be the implementation date.

The setup is arranged around three questions: which decision you are checking,
what you can fairly compare it with, and which dates to check. The recorded action
and result appear together. Choose Success means to say whether more or less is
better. A new decision review starts with its recorded outcome, not unrelated
metrics from a previous correlation analysis. A matching earlier saved assessment
can retain its deliberate study choices and extra results.

Choose Comparison dataset and Result to compare directly from the available
approved dataset results; there is no separate metric-checkbox selection first.
If you do not have a fair comparison, Explore relationships instead switches back
to Correlation analysis without creating a decision or inventing an impact amount.
Missing choices are named beside Check this decision. If a selected result or
date is unavailable, review that dataset or choose another comparison.

Choose an unaffected comparison from another dataset. A similar store that did
not make the change may help; increased ad
spending is not unaffected if the change was to increase that spending.

Explain why the comparison was unaffected, confirm you checked for indirect
effects, and say whether another major change happened at the same time. Choose
whether more or less of the result is better. An optional minimum worthwhile
improvement expresses your business target in the result's own units. Costs are
not automatically deducted.
The optional target is under Business target. Date column selectors and dataset-local
dimension filters remain under Date columns and filters. Changing the selected
comparison, date column or dimension filters requires the comparison confirmation
again. Existing extra selected results stay visible under Other selected results
and can be removed deliberately. Report name and business question are editable
under Report details. Weekly impact setup keeps automatic dates and weekly study
grouping; it does not expose manual weekly email dates.

Save assessment to decision attaches the calculated assessment to that same
decision and saves its report snapshot. It does not create a new decision or
mark an outcome successful. Return to decision to review the assessment and
record the actual outcome and lessons yourself. Later reviews retain earlier
assessments; changed actions or outcome metrics mark older results as historical.
Archived decisions can show their history but cannot receive new assessments.
Old standalone impact snapshots remain readable; new assessments require an
existing decision.

Include dates before and after the change. At least 52 complete weeks before and
8 after are needed with weekly grouping; daily needs 90 before and 28 after,
and monthly needs 24 before and 6 after. Seasonal businesses also need about two
years before the change. A partial week or month, or a period crossing the
change date, is not counted. Missing comparison periods are not filled with zero.

The report answers whether the change appears to have helped, worked against the
goal, or remains unclear. It shows the estimated difference and a range, checks
earlier predictions and false alarms, and explains the next step in ordinary
business language. If the comparison fails the checks or other changes prevent
a fair comparison, no impact amount is presented. A range including zero means
the effect is unclear, not that the action definitely had no effect.

This is a model-based estimate under stated assumptions, not a randomized test
or automatic proof of cause and effect. This first version measures an ongoing
level change with one comparison. It does not establish the impact of a one-off
event, a changing effect, an ad-spend correlation alone, or unknown concurrent
events. The main answer is calculated directly, so an AI provider cannot invent
an impact amount or upgrade weak evidence. Details are available under the checks.
Supporting charts and unusual-change tables are kept in Supporting business
results, rather than crowding the main answer and decision links.
Business impact analysis does not run a separate correlation or lag search and
does not show Relationship findings. Its own comparison checks and estimated
impact are independent of the correlation settings. This applies to Business
Analysis and Weekly Business Review. Reopened older impact snapshots also omit their
old correlation findings from the preview; their stored calculations are not
rewritten or recalculated.

Choose **Correlation analysis** for exploratory relationships without a recorded
business change. Existing saved reports keep their original workflow.

## Build an analysis

1. Open Business Analysis from the sidebar, select the intended dataset scope and name the business question.
2. Replace the generated report name with a useful description. Its unique
   starting label prevents name collisions; it is not a business conclusion.
3. In Datasets and metrics, select only relevant approved measures. Multi dataset
   reports require at least two sources. Single dataset reports use exactly one.
4. Review each preselected Date column. Apply a dataset-local Dimension column
   filter and Unique values if you want a segment rather than all eligible rows.
5. Set Start, End and Analysis group by. Request seasonal activity only when appropriate.
6. For exploratory multi dataset analysis, configure Relationship analysis. Remove unwanted
   pairs and set each remaining pair's direction. Evaluate timing is always
   available above the pairs; set Maximum lag for directional tests. Pairs left
   at Same-period comparison only do not test positive lags. Single dataset
   reports omit cross-source relationships.
7. Choose Preview analysis and wait for analysis to finish before saving.

## Limits and evidence

New analyses share their defaults with Relationships: Spearman, daily grouping,
Sum aggregation where applicable, 52 minimum historical observations, maximum
lag 12 grouped periods and same-period comparison. Valid saved choices are
retained rather than replaced simply because the defaults changed.

A report supports at most 25 selected metrics. Correlation analysis supports
a maximum of 12 lag periods and 1,000 cross-dataset pair/lag tests; those timing
and test-count limits do not apply to Business impact analysis, which does not
run those tests. Reduce metrics or timing complexity if the correlation
analysis exceeds these limits. Removed pairs do not consume relationship tests;
they can be restored without removing the selected metrics. The default
relationship observation threshold is 52 matched periods; selecting more calendar
dates is not equivalent to having more observations.

Exploratory report previews request AI interpretation automatically, with a clearly
labeled rules-based fallback if the provider or credits are unavailable.
The computed report does not require a successful external AI response. A saved snapshot
retains its original result; changing a filter, metric, date, pair selection or
timing setting requires a new preview to calculate new evidence.

Reports show evidence and linked decisions. Create a new business decision in
the central Decisions workflow rather than expecting Preview analysis to execute
an action or create a decision automatically.
