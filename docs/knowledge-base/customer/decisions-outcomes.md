# Create decisions and track outcomes

A decision records a concrete action, its reasoning, expected result and later
outcome. Reading a report, finding a correlation or generating an AI recommendation
does not automatically create an accountable decision.

## How do I follow through on a change I make?

Open Decisions > Create decision, or choose Create decision from your analysis
results. Record what you plan to change, when it will start, and the date
you'll review it.

1. Choose Measure an action and a result when both can be tracked from data.
   Pick the action metric (for example, ad spend) and a direction and target
   change, such as increase by 10%. Pick a separate result metric (for example,
   orders) and its direction and target, such as increase by 20 orders.
2. Choose Preview targets. Check the data, baseline, target values and dates
   before creating the decision. For a change you cannot track with two
   usable metrics, choose Review manually and record what you'll look for.
3. On or after the review date, open the decision. A measured decision with
   enough data shows what actually happened next to each target. The action
   can meet its target while the result misses. If data is missing, that is
   not evidence that a target was missed. Review and record your next step.

Meeting both targets does not prove that your action caused the result.

## Where can I create a decision?

You can create a decision without leaving Business Analysis. On a completed
Compare metrics report, choose Create decision. With two usable metrics, track
two metric targets or choose to review the result yourself. With one usable
metric, record your action, expected result and review date. The report keeps
the link to the decision. On Return on spend, Profitability, Customer retention,
Sales conversion and Cash flow planning, use Create decision on the results.
The comparison is saved as evidence automatically when you submit.

Business impact starts with an existing decision. Save an assessment to keep it
with that decision. If the assessment produces an estimate and you want to take
a different action, create a follow-up decision; this does not replace the first.
Weekly Reports, saved budget plans and the Decisions page also have creation
entries. Use the action you actually plan to take, not just the report name.

The form shows the next missing requirement beside Create decision. A
report-linked decision needs a ready report, an outcome metric, a meaningful
name, action, expected result, reasoning and a review date. Changing these fields
does not automatically submit the decision. If a request fails, the entered
details remain available for retry; an existing recommendation-linked decision
should be opened rather than created again.

A report-linked decision should retain the selected evidence metrics, report
identity and relevant limitations, not expand to every metric in its datasets.
An outcome metric is a measurement choice within the supported evidence scope,
not a reason to include unrelated source columns.

## How do I check whether spending more brought the orders I wanted?

In Create decision, use **Measure an action and a result**. For example, choose
ad spend as the action, Increase, Percentage, 10. Choose orders as the result,
Increase, Amount, 20. Enter the day the change starts and the date to review it.
Choose **Preview targets** to see the actual baseline, target and dates for
each metric. A baseline of 100 orders gives a target of 120 orders in this
example. A percentage target needs a nonzero baseline; use an amount instead
when starting from zero. If a comparable decision has already been measured in
this workspace, the preview links to its result before you commit to a new one.

You can choose metrics directly or use a saved report. Report-linked plans
keep its date columns, calculations, filters and timezone. If its earlier
relationship analysis supports a delay between this action and result, the
result window starts after that delay. Review compares each window with the
same number of days immediately before the change. The review date itself is
not counted: the last measurement day is the day before review.

Open decisions are checked on or after the review date, both in the background
and when opened. Missing days are not counted as zero. Each target is shown
separately: spending can reach its target even if orders do not. Complete
results appear in Action Needed and in matching weekly reports with a decision
link. The owner can close the decision to keep the last assessment. Meeting a
target does not prove that the action caused the change. Choose **Review
manually** for qualitative decisions or where daily records aren't available.

## Updates and duplicate-looking drafts

In Decisions, start with Needs attention for pending follow-ups, or choose a
record under Your decisions to see its action, expected result and review date.
A measured decision shows What you planned to change and What you wanted to
achieve separately. Expand Data and dates under either one to see its source,
filter and periods. For a manual review, follow the next action on the decision;
record the outcome and capture a lesson. Extra planning details are optional.

Edit an existing decision to update that record; do not create a new one merely
to change its wording. A shared default name is not evidence that two records
are identical. Report linkage, action, selected evidence, ownership and recorded
outcomes matter. Do not merge distinct decisions or discard outcomes because
their titles look similar.

Legacy Review joined evidence placeholders may be editable drafts with no actual
action recorded. A draft is not evidence that a business action occurred.
Decisions and outcomes is not supposed to contain a fixed number of records.

## Follow up in Action Needed

1. Open Action Needed in the workspace that owns the decision. Use All to
   see the queue, or select Results ready, Review overdue, Outcome pending
   or Learning pending to focus on that work.
2. Open the decision from its card. For a measured decision, compare actuals
   against the separate targets for the action and the result. For a manual
   decision, record the outcome and what you learned.
3. Decide what to do next. Update or close the existing decision when it is
   resolved; do not create another record just to log the result.

No action needed means the current follow-up queue is clear, not that every
past decision succeeded. If you have read-only access, you can inspect the
details but an authorized workspace manager must make updates.

## Review, learning and lifecycle

Business impact review is an assessment of this decision, not another decision.
Choose Assess business impact on the decision page, or open Business Analysis
and choose Business impact. The assessment setup reuses
the recorded action and outcome metric, and asks for the actual action start
date, an unaffected comparison from another dataset and the business context.
The action date is independent of when the decision record was created.

Choose Save assessment to decision after reviewing the calculation. It attaches
one assessment to the existing decision and preserves its report snapshot.
Saving the same completed analysis again does not duplicate the assessment or
create a second decision. Assessment history stays on Business impact review.
The model does not overwrite your actual outcome, outcome status, notes or lessons,
and does not automatically complete or mark the decision successful.

Compare before and after is the older simple metric comparison, not the
cross-dataset impact model. Its percentage change is not a causal impact estimate.
Keep that distinction when recording what actually happened.

For a manual decision, record the actual outcome, its status and a specific lesson at review time.
Document confounding factors instead of claiming a change was caused by the
decision solely because it followed it. Historical learning uses recorded
workspace evidence; it is not automatic retraining of the model.

Archiving retains history and differs from permanent deletion. Use the available
authorized lifecycle controls and read confirmations. Deleting a report does not
delete the decisions linked to that report.
Deleting a report snapshot also keeps its attached impact assessment on the
decision. Deleting a source dataset or workspace removes derived assessments
using that data. Permanently deleting a decision removes its attached assessment
records; archived decisions retain their history. Read-only users can view only
assessments whose source datasets they are authorized to access.
