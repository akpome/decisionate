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
the selected decision. The decision's action and outcome metric are
reused, not entered as a second decision. If no outcome metric was recorded,
choose it in Decision Details first. Confirm when the action actually started;
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

The setup is arranged around choosing the decision, choosing one fair comparison,
and checking the analysis. The recorded action
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
The optional target is under Business target. The decision supplies the outcome;
the main setup has only one Comparison dataset and Result to compare. Its Date
column sits alongside Dimension column and Unique value. Unique value is a
searchable dropdown: type to filter choices, then select one. Searching alone
does not replace the selected comparison value. These controls belong to that
comparison, not to a second editable outcome dataset. All rows keeps the
comparison unfiltered; choosing a dimension without a value blocks the assessment.
Choosing another value replaces the current value rather than adding a segment.
Saved multi-value comparison filters remain visible and require an explicit
single-value choice before another assessment. A saved outcome segment is retained
and displayed beside the decision, with a clear control; it is not silently removed.

Business Analysis defaults to the period saved with the decision's report evidence.
A matching previous assessment keeps its recorded period. If no evidence period
was saved, the approved outcome dataset's available dates provide the default;
the decision's creation date is never used as its data period or action date.
The comparison's date column is preselected, but choosing a comparison or a date
column does not silently replace the decision's period.
The action's start date is the only date input visible in the main setup.
Analysis settings contains the outcome date-column override, one shared history
range and grouping. The comparison date column remains beside its dimension filter.
Datasets with no overlapping dates are blocked with an explicit message; a wider
date range cannot invent overlap. Comparisons outside the selected decision period
are also blocked. Saved snapshots keep their stored date choices.
Changing the selected comparison, date column or dimension filters requires the
comparison confirmation again. Weekly Business Review uses the same single
comparison controls, but retains its automatic weekly dates and grouping.
Existing extra selected results stay visible under Other selected results
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

The history must include dates before and after the change. At least 52 complete weeks before and
8 after are needed with weekly grouping; daily needs 90 before and 28 after,
and monthly needs 24 before and 6 after. A partial week or month, or a period crossing the
change date, is not counted. Missing comparison periods are not filled with zero.
The required later observations must also be available after the suggested
response window. For example, a two-week historical lead suggests a response
around two weeks after implementation. The real implementation date stays fixed;
those first two weeks are not discarded or treated as zero effect. Early results,
later results and the overall estimate are reported separately. A daily lag keeps
its original days even when impact is grouped weekly. Later weekly results start
at the first complete week after the suggested date.

Waiting for enough results means there are too few complete later observations to
assess the change yet. Future dates and today's incomplete day do not count. Check
that your analysis history includes newer results; choosing an old snapshot does
not automatically extend its saved dates. Weekly reviews use their automatic
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
impact are independent of the correlation settings. This applies to Business
Analysis and Weekly Business Review. Reopened older impact snapshots also omit their
old correlation findings from the preview; their stored calculations are not
rewritten or recalculated.
The original timing evidence is reused, not searched again against post-action
results. Timing, phase estimates and waiting status are included in weekly emails.
Saved assessments keep their historical evidence even if the source report is
later deleted; new calculations cannot reuse a deleted or inaccessible source.

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
