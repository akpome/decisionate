# Build single and multi dataset reports

Business Analysis is the on-demand analysis workspace. Multi dataset report opens by
default; Single dataset report is available separately for one source. Weekly Reports
has its own page and settings, automatic dates, whole-week and daily checks,
and earlier relationship history grouped weekly.
Use the sidebar to move between these separate workflows; neither page has tabs
for the other workflow. Business Analysis has Build analysis and Analysis preview;
Weekly Reports has Report setup and Report preview.
Business Analysis uses approved
dataset metrics, date policies, anomaly detection and report snapshots.

New multi dataset reports open with **Explore relationships**. The correlation
method, minimum matching periods, timing and metric-pair settings
are available under the expanded Relationship analysis section. Under Analysis
type, choose **Business impact analysis** to review an existing decision.
Saved reports keep their original analysis type. Neither mode replaces
decision creation or decision review on the Decisions page.

## Analyze one dataset

Open Business Analysis and choose Single dataset report. Under Dataset and
metrics, use the searchable Dataset dropdown to choose one source. Type its name
or connector to filter choices, including sources on later catalog pages. Search
does not select a dataset or load its data files. Before choosing, no source's
metrics or dimension controls are displayed. Afterward, select the metrics from
that dataset and review its preselected Date column. Choose Dimension column and
Unique values to restrict the rows included in the analysis. All rows keeps the
dataset unfiltered. A chosen dimension with no values blocks preview until values
are selected or the filter is cleared.

Changing Dataset clears the previous source's metrics, dimension filters, date
choices and calculated preview. Select the new source's metrics before previewing.
Removing all metrics leaves the chosen dataset visible. A saved single-dataset
analysis restores its dataset, selected metrics and dimension filter rather than
showing every workspace source. Unavailable sources remain explicit and retryable;
they are not replaced with another dataset. Dataset names load first, and only
the selected source's metric catalog is read in this workflow. More names can be
loaded with Load more datasets when the catalog is paginated.

## Did my business change help?

Open an existing decision and choose Assess business impact, or select Decision
to review in the report builder. This is one searchable dropdown: type a decision
name to filter its choices, then select the decision. Typing alone does not change
the selected decision. The dropdown lists only active decisions with a recorded
action and saved multi-dataset analysis evidence: the original selection must
contain metrics from at least two different datasets. Single-dataset decisions,
manual decisions without that evidence, and unfinished evidence placeholders
are not offered. Search and pagination use the same eligibility rule. Existing
decisions and saved assessments are not deleted by this filter. Being listed
does not establish reliable timing or an impact estimate; those checks still apply.
Each dropdown choice shows its evidence readiness and a reason. Ready to set up
impact analysis means the original saved analysis has a reliable relationship
and verified timing for this decision's outcome. It does not guarantee an impact
estimate: the implementation date, unaffected comparison and before-and-after
records still need checking. Missing relationship or timing evidence explains
what is unavailable, including a deleted or inaccessible original analysis.
Missing outcome metric means the decision needs a result selected in Decision
Details. Choose the supporting relationship means several reliable relationships
are available and one must be selected. These decisions stay visible and selectable
so their details can be inspected. The selected decision's status stays visible
below the selector. Older API responses without a check say Readiness not checked,
not Ready.
The decision's action and outcome metric are
reused, not entered as a second decision. The Edit decision pencil beside the
selected decision opens its Decision Details. Use it to update the original action
or outcome metric; it appears only after a decision is selected. If no outcome
metric was recorded, choose it in Decision Details first. Confirm when the action actually started;
the decision creation date is not assumed to be the implementation date.
When did you implement the change? means the real action date, not the date you
expect results. Do not shift it to make the result look better.

Timing from earlier analysis uses the decision's original saved correlation,
checking the changed driver and the result to measure. It does not use the
unaffected comparison to invent a delay. A timing guide is available only when
the same delay stands out across two separate earlier-history checks. The source
history must end before implementation and use matching outcome date, aggregation,
dimension filter and timezone settings. Same-period-only analysis does not prove
zero delay. Old snapshots without these checks cannot supply a verified delay.
If several earlier relationships qualify, choose which one informed the decision.
There is no numeric lag input. Unknown or inconsistent timing produces an
explanation and no impact amount, not an assumed immediate effect.
When a specific earlier report is linked, Open the earlier analysis opens that
evidence. Missing timing still shows its warning, without a generic relationship
navigation link.

The setup is arranged around choosing the decision, choosing one fair comparison,
and checking the analysis. The recorded action
and Outcome metric appear together. Desired improvement names that metric and
lets you choose Increase or Decrease. A new decision review starts with its recorded outcome, not unrelated
metrics from a previous correlation analysis. A matching earlier saved assessment
can retain its deliberate study choices and extra results.

Choose Comparison dataset and Comparison metric directly from the available
approved dataset results; there is no separate metric-checkbox selection first.
Without a fair comparison, the impact estimate remains unavailable. The form has
no shortcut that clears the assessment and switches to relationship analysis;
use the analysis-type tabs to deliberately change workflows.
Missing choices are named beside Analyze business impact. If a selected result or
date is unavailable, review that dataset or choose another comparison.

Choose an unaffected comparison from another dataset. A similar store that did
not make the change may help; increased ad
spending is not unaffected if the change was to increase that spending.

Explain why the comparison was unaffected, confirm you checked for indirect
effects, and say whether another major change happened at the same time. Choose
whether more or less of the result is better. An optional minimum worthwhile
improvement expresses your business target in the result's own units. Costs are
not automatically deducted.
The optional target is under Improvement target and labeled Minimum worthwhile
improvement. It is a total for values that can be added, and an average per period
for other metrics. The verdict checks the estimated range against this target,
not just the point estimate. It does not calculate costs, profit or break-even.
The decision supplies the outcome;
the main setup has only one Comparison dataset and Comparison metric. Its Date
column sits alongside Dimension column and Unique value. Unique value is a
searchable dropdown: type to filter choices, then select one. Searching alone
does not replace the selected comparison value. These controls belong to that
comparison, not to a second editable outcome dataset. All rows keeps the
comparison unfiltered; choosing a dimension without a value blocks the assessment.
Choosing another value replaces the current value rather than adding a segment.
Saved multi-value comparison filters remain visible and require an explicit
single-value choice before another assessment. A saved outcome segment is retained
and displayed beside the decision, with a clear control; it is not silently removed.

Business impact analysis sets its history period and grouping automatically.
The history starts from the decision's original report evidence, or the beginning
of shared data if that is later. The end extends to the latest available date
in both selected date columns, capped at yesterday in the reporting timezone.
The period also stays within the API's maximum ten-year history window.
Changing the comparison or date column recalculates this shared range. It cannot
create missing records; gaps within the period still prevent a reliable estimate.
If no source period was saved, a matching previous assessment's start or the
outcome dataset's available dates provide the starting point. The decision's
creation date is never used as its data period or action date.
Grouping follows the decision's source analysis. Legacy sources without grouping
use verified timing, a matching earlier assessment, or daily grouping, in that order.
Quarterly sources use weekly impact analysis because the impact model supports
daily, weekly and monthly periods. Historical lag always keeps its original units.
The action's implementation date is the only date input.
The outcome Date column is beside Outcome metric and starts with the decision's
saved selection. The comparison date column remains beside its dimension filter.
There is no editable Analysis settings section. The analysis period and grouping
are read-only; data availability and minimum-history warnings remain visible.
Business impact analysis is available only in Business Analysis, also accessible from Decision
Details. Weekly Reports has no assessment tab or setup form. Minimum history
requirements appear beside assessment readiness, outside the settings disclosures.
Datasets with no overlapping dates, no completed shared period, or no history
before or after implementation are blocked with an explicit message.
Opening a saved snapshot keeps its stored dates and results. Returning to Build
analysis prepares an updated period for a new calculation; it does not rewrite
the old snapshot or save an assessment automatically.
Changing the selected comparison, date column or dimension filters requires the
comparison confirmation again. Existing weekly assessment configurations remain
read-only in Weekly Reports, with a link to Business Analysis and an explicit option to
switch to metric monitoring after preview and save. Historical evidence is kept.
Existing extra selected results stay visible under Other selected results
and can be removed deliberately. Business impact analysis has no Report details
section: its title and question are derived from the selected decision. The title
includes the decision ID to distinguish decisions with the same name. Each new
calculation uses the current decision name; existing saved snapshots stay unchanged.
Existing weekly assessments keep automatic dates and weekly study
grouping; they do not expose manual weekly email dates.

Analyze business impact runs the assessment and opens its preview. It does not
create a decision, save the assessment, or change the decision's recorded outcome.
Save assessment to decision attaches the calculated assessment to that same
decision and saves its report snapshot. It does not create a new decision or
mark an outcome successful. Return to decision to review the assessment and
record the actual outcome and lessons yourself. Later reviews retain earlier
assessments; changed actions or outcome metrics mark older results as historical.
Archived decisions can show their history but cannot receive new assessments.
Old standalone impact snapshots remain readable; new assessments require an
existing decision.

The history must include dates before and after the change. At least 52 complete weeks before and
8 after are needed with weekly grouping; daily needs 90 before and 28 after,
and monthly needs 24 before and 6 after. A partial week or month, or a period crossing the
change date, is not counted. Missing comparison periods are not filled with zero.
The required later observations must also be available after the timing reference
date. For example, a two-week historical lead places this reference date two weeks
after implementation. This is not a promised date for results. The real implementation date stays fixed;
those first two weeks are not discarded or treated as zero effect. Early results,
later results and the overall estimate are reported separately. A daily lag keeps
its original days even when impact is grouped weekly. Later weekly results start
at the first complete week after the suggested date.

Waiting for enough results means there are too few complete later observations to
assess the change yet. Future dates and today's incomplete day do not count. Keep
both datasets up to date; a new impact analysis includes their latest shared dates,
while saved snapshots retain their original dates and results. Weekly reviews use their automatic
rolling history. Historical timing is advice, not a promise about when results
will arrive or proof of cause and effect.

## Usual ups and downs in impact assessments

There is no seasonal-business checkbox in Business impact analysis. The comparison
provides the expected baseline, with reliability checked on records before the action;
the two results are not forced to have equal levels or identical seasonal behavior.
Earlier records must show that the comparison helps explain the outcome beyond
ordinary trends and calendar effects. Otherwise no impact amount is presented.

An extra yearly adjustment is considered only with about two years of pre-action
history. It must improve two earlier prediction checks before being used, and
the chosen baseline must then pass a separate held-back earlier-period check.
Records after the action are not used to choose the adjustment. A supported yearly
pattern cannot bypass missing-data, false-alarm, business-context or stability checks.
With shorter history, the report explicitly says that separate yearly differences
could not be checked reliably. Existing seasonal settings do not force or disable
this automatic impact-baseline choice; other report and forecast settings are unchanged.

The report answers whether the change appears to have helped, worked against the
goal, or remains unclear. It shows the estimated difference and a range, checks
earlier predictions and false alarms, and explains the next step in ordinary
business language. If the comparison fails the checks or other changes prevent
a fair comparison, no impact amount is presented. A range including zero means
the effect is unclear, not that the action definitely had no effect.
The range assumes the selected baseline is appropriate and does not cover every
uncertainty from choosing that baseline.

This is a model-based estimate under stated assumptions, not a randomized test
or automatic proof of cause and effect. New timed assessments compare actual
results with a baseline fitted before implementation; early and later results
can differ. They do not establish an exact causal delay, attribute an ad-spend
correlation alone, or rule out unknown concurrent events. Old standalone snapshots
can retain their original immediate, ongoing-level-change assumption. The main
answer is calculated directly, so an AI provider cannot invent
an impact amount or upgrade weak evidence. Details are available under the checks.
Supporting charts and unusual-change tables are kept in Supporting business
results, rather than crowding the main answer and decision links.
Business impact analysis does not run a separate correlation or lag search and
does not show Relationship findings. Its own comparison checks and estimated
impact are independent of the correlation settings. This applies to Business Analysis
and Weekly Reports. Reopened older impact snapshots also omit their
old correlation findings from the preview; their stored calculations are not
rewritten or recalculated.
The original timing evidence is reused, not searched again against post-action
results. Timing, phase estimates and waiting status are included in weekly emails.
Saved assessments keep their historical evidence even if the source report is
later deleted; new calculations cannot reuse a deleted or inaccessible source.

Choose **Explore relationships** for exploratory relationships without a recorded
business change. Existing saved reports keep their original workflow.

## Build an analysis

1. Open Business Analysis from the sidebar, select the intended dataset scope and name the business question.
2. Replace the generated report name with a useful description. Its unique
   starting label prevents name collisions; it is not a business conclusion.
3. In Datasets and metrics, select only relevant approved measures. Multi dataset
   reports require at least two sources. Single dataset reports use exactly one.
4. Review each preselected Date column. Apply a dataset-local Dimension column
   filter and Unique values if you want a segment rather than all eligible rows.
5. Set Start, End and Group results by. Business has seasonal activity belongs to
   Unusual changes; it does not adjust correlations or prove matching seasonality.
6. For exploratory multi dataset analysis, configure Relationship analysis. Remove unwanted
   pairs and set each remaining pair's Timing to test. Delay to check is always
   available above the pairs; Maximum delay names the selected unit (days, weeks,
   months or quarters). Check whether a metric comes first is a hypothesis to
   test, not a conclusion. Same period only does not test positive delays. Single dataset
   reports omit cross-source relationships.
7. Choose Preview analysis and wait for analysis to finish before saving.

## Limits and evidence

New analyses share their defaults with Relationships: Spearman, daily grouping,
Sum aggregation where applicable, 52 minimum historical observations, maximum
lag 12 grouped periods and same-period comparison. Valid saved choices are
retained rather than replaced simply because the defaults changed.
Minimum matching days/weeks/months/quarters counts matched observations in the
chosen grouping, not just the length of the calendar window. Weekly Reports uses
weeks for its relationship history regardless of the grouping on Business Analysis.

A report supports at most 25 selected metrics. Explore relationships supports
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
