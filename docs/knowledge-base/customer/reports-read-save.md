# Read and manage report evidence

## Read a business-change result

A report built with Business impact analysis starts with a direct answer, its
estimated difference and range, and what to do next. A range including no effect
means the result is unclear. A failed comparison gives no impact amount at all.
This is not a guarantee that the action caused the result.

Its main chart compares the actual result with the model's estimate without the
change, in the result's original units. The dashed estimate is not observed data,
and the effect range is not a prediction band around each chart point. Check the
dates: the estimated difference covers the complete periods after the change,
while the supporting metric cards can cover the full before-and-after window.

Supporting business results contains the selected-metric charts, unusual
changes and exploratory relationships. These support the main answer rather
than replacing it. Decisions and outcomes remains the place to open the central
decision workflow with this report's evidence.

Read the metric movements, unusual changes, relationship findings, follow-up
actions and limitations together. A significant relationship is not required for
a period comparison to be useful; nor does it establish that a change caused
the business outcome.

## Indexed metric comparison

The combined chart identifies each selected dataset/metric with a colored line.
It uses the displayed shared positive baseline date as index 100. The index is
value divided by that metric's baseline value, multiplied by 100. An index of
120 means 20 percent above its baseline, not 120 orders or currency units.

Use KPI cards and tooltip original values for actual business amounts. Equal
index levels across spend and orders do not mean equal units, profitability or
advertising return. Missing periods remain gaps. Zero, negative or unavailable
baselines can prevent indexing; warnings should not be removed by inventing
positive values or assigning unrelated baseline dates.

## Save and update

Save snapshot stores the server-generated completed analysis. Reopening it does
not silently recalculate the data or update its narrative. Editing the settings
starts an unsaved analysis; preview again and save a new snapshot. Generated
names should be edited to describe the analysis, not treated as an overwrite key.

## Delete versus remove weekly settings

Delete saved report removes that snapshot, not its source datasets or linked
decisions. Independent weekly settings and delivery are unchanged. On Weekly reports,
Remove weekly settings keeps saved snapshots and linked decisions while clearing
the weekly configuration and pausing delivery. Read the confirmation and use only
actions allowed by your workspace role.

Decisions and outcomes shows linked work, not a requirement for a fixed number
of decisions. A legacy editable draft is not a recorded business action.
