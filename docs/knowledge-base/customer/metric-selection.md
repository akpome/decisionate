# Choose relevant metrics

Dataset metric selection determines which measures can participate in analytical
workflows. Report metric selection is a further subset chosen for a particular
business question. A date column or dimension does not need to be a selected
numeric metric to serve its own purpose.

## Automatic defaults and manual choices

Business objectives shape automatic recommendations. When using system defaults,
changing the objective should resolve recommendations for the new objective,
rather than keeping unrelated automatic choices from the previous objective.
Deliberate manual selections, including an explicitly empty selection, must not
be silently overwritten by default-policy updates.

Accounting, commerce and payment defaults are restricted to reviewed
receipt/invoice measures emitted by that specific source/resource. This does not
mean every numeric field is a default, that every connector emits the same
receipt, or that internal costs and exchange rates must become metrics.

## Change a selection

Open dataset details, review the Business objective and recommendation/profile
information, choose the desired columns and save. Use Reset to system defaults
only when you intend to replace a manual selection. If a save is unconfirmed,
keep the draft and use the provided recovery control; do not assume a success
message or a failed request means the opposite without checking the saved state.

## When a metric does not appear

Check the actual column name, numeric values, source resource, currency metadata
and saved policy. Empty values are not fabricated into a numeric field. A new
policy or missing normalized source field may require an explicit defaults reset
or successful resync, but those steps should follow diagnosis rather than be
promised as a universal fix.

Selection reduces the analytical surface. It is not a promise that every raw
unselected source field is absent from ingestion or memory at all stages.
