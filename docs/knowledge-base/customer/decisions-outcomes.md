# Create decisions and track outcomes

A decision records a concrete action, its reasoning, expected result and later
outcome. Reading a report, finding a correlation or generating an AI recommendation
does not automatically create an accountable decision.

## Central creation workflow

Open Decisions and use its creation entry. Name the decision for the actual
business action, replacing the generated unique starting label. Supply the
required action and evidence, expected outcome and review information shown by
the form. Attach a saved report when it provides the justification, or use the
supported manual dataset-linked workflow.

A report-linked decision should retain the selected evidence metrics, report
identity and relevant limitations, not expand to every metric in its datasets.
An outcome metric is a measurement choice within the supported evidence scope,
not a reason to include unrelated source columns.

## Updates and duplicate-looking drafts

Edit an existing decision to update that record; do not create a new one merely
to change its wording. A shared default name is not evidence that two records
are identical. Report linkage, action, selected evidence, ownership and recorded
outcomes matter. Do not merge distinct decisions or discard outcomes because
their titles look similar.

Legacy Review joined evidence placeholders may be editable drafts with no actual
action recorded. A draft is not evidence that a business action occurred.
Decisions and outcomes is not supposed to contain a fixed number of records.

## Review, learning and lifecycle

Business impact review is an assessment of this decision, not another decision.
Choose Assess business impact on the decision page. The report builder reuses
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

At review time, record the actual outcome, its status and a specific lesson.
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
