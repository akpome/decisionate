# Read and manage report evidence

## Read a business-change result

A report built with Assess a decision starts with a direct answer, its
estimated difference and range, and what to do next. A range including no effect
means the result is unclear. A failed comparison gives no impact amount at all.
This is not a guarantee that the action caused the result.

Estimated change in the chosen result is the leading number, with its estimated
range and the time after the change that it covers. Actual result and Without the
change (estimated) show what is being compared. Rates and averages are labeled
per period, not as totals. An unclear result is not presented as a win. What to
do next remains visible, while the full calculation narrative, checks, earlier
history and assumptions are under What we checked and what could change the answer.

Its main chart compares the actual result with the model's estimate without the
change, initially in the result's original units. Switch between Actual and
Indexed beside the chart title. Indexed uses the first positive estimated
without-change value after the change as 100 for both lines, keeping the
actual-versus-estimated gap visible rather than normalizing each line separately.
That same baseline is retained when changing the visible history. If no positive
estimated baseline exists, use Actual instead. The dashed estimate is not observed data,
and the effect range is not a prediction band around each chart point. Check the
dates: the estimated difference covers the complete periods after the change,
while the supporting metric cards can cover the full before-and-after window.
The chart opens with After the change. Full history can show the earlier records
without changing the calculation or the saved assessment. The legend names the
actual result and the estimate without the change separately. The start of the
first measured period is not presented as a guessed implementation date.

Supporting business results contains the selected-metric charts, unusual
changes and metric movements, not a second correlation analysis. Relationship
findings are available in Explore relationships instead. Older impact snapshots
also omit their old relationship findings when displayed, without changing the
stored snapshot. These results support the main answer rather than replacing
it. Decisions and outcomes remains the place to open the central
decision workflow with this report's evidence.
Create decision opens the central decision form; it does not record a decision
until that form is submitted. Continue decision opens an existing unfinished
decision instead of creating another. The action is a highlighted button when
available. If report coverage is incomplete, the disabled action states which
dates lack usable dataset values. Saving a report does not make missing data
usable; a strong correlation or previous-period baseline is not required.

Read the metric movements, unusual changes, impact checks, follow-up
actions and limitations together. In Explore relationships, read the relationship
findings alongside the other evidence. A significant relationship is not required for
a period comparison to be useful; nor does it establish that a change caused
the business outcome.

## Indexed and actual metric comparison

The combined chart identifies each selected dataset/metric with a colored line.
It opens in Indexed. Switch to Actual beside the chart title for original
values on one numeric scale, with each metric's units in the legend and tooltip.
Different units are not directly comparable, and a large-valued metric can
visually flatten smaller-valued metrics. Switching the scale changes only the
chart, not the calculations, KPI cards, saved evidence or selected metrics.

Indexed uses the displayed shared positive baseline date as index 100. The index is
value divided by that metric's baseline value, multiplied by 100. An index of
120 means 20 percent above its baseline, not 120 orders or currency units.

Use KPI cards and tooltip original values for actual business amounts. Equal
index levels across spend and orders do not mean equal units, profitability or
advertising return. Missing periods remain gaps. Zero, negative or unavailable
baselines can prevent indexing; warnings should not be removed by inventing
positive values or assigning unrelated baseline dates.
Actual can still plot available zero and negative values, or metrics without a
shared positive baseline. Missing observations remain gaps in either view.

## Save and update

On Analysis, Save snapshot stores the server-generated completed analysis. Reopening it does
not silently recalculate the data or update its narrative. Editing the settings
starts an unsaved analysis; preview again and save a new snapshot. Generated
names should be edited to describe the analysis, not treated as an overwrite key.

On Weekly Reports, preview first, then choose Save changes. This replaces the
workspace's one current weekly report and its setup for future weeks. It does
not add another active report, even when the name changes. Previewing alone does not
save the setup. There is no separate snapshot or settings save on the weekly
page. Saving does not send email or change delivery preferences.
Sent reports and decision evidence remain unchanged. Weekly history lists sent
reports and older saved reports; opening one does not change the active setup.

## Delete versus remove weekly settings

Delete saved report removes that snapshot, not its source datasets or linked
decisions. Independent weekly settings and delivery are unchanged. On Weekly Reports,
Remove weekly settings keeps saved snapshots and linked decisions while clearing
the weekly configuration and pausing delivery. Read the confirmation and use only
actions allowed by your workspace role.

Analysis uses Saved reports; Weekly Reports uses Weekly history. Deleting a historical report also
removes its associated temporary preview. An old link to a deleted or expired
analysis cannot restore it. Choose a saved report or generate a new preview;
this is different from an analysis failing.

Decisions and outcomes shows linked work, not a requirement for a fixed number
of decisions. A legacy editable draft is not a recorded business action.
