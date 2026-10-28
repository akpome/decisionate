# Configure a meaningful weekly report

Weekly reports are cross-dataset reviews, not a repeated single-metric screenshot.
They have their own Weekly reports page and require usable metrics from at least
two datasets for delivery. Instant analysis is a separate page and does not
control the weekly report's dates or time grouping.

## Configure weekly analysis and sending separately

Open Analysis -> Weekly reports. Select metrics, date columns, dimension filters,
business question, seasonal setting and relationship pairs. Save weekly settings,
or use Save and preview to save and calculate them. Removed pairs remain excluded
from weekly relationship analysis, while their selected metrics still receive
KPI and anomaly analysis. Saving settings does not enable sending or change recipients.

A saved instant report offers Copy selection to weekly reports. This is an
editable copy, not a live link. Non-weekly timing choices reset to same-period
comparison, with a default maximum of 12 weeks; a three-day lag is not converted
to three weeks. Check and save the independent weekly settings before use.

Use Delivery settings or Alerts to check recipients, schedule, delivery preferences
and email readiness. Enable delivery only after confirming the intended audience.
A successful scheduler invocation means a job was queued, not that an email was
delivered. Check terminal analysis status and delivery history separately.

Send report now emails the current weekly report only to the workspace owner,
including the client owner in a managed client workspace. Unsaved weekly changes
are saved first. This one-time send can run while scheduled delivery is paused;
it does not change recipients, enable delivery or replace a scheduled send.
Only authorized workspace managers can use it. If the owner's account has no
usable email address, sending is blocked rather than using another recipient.

Sending requires usable data from at least two selected datasets in the last
completed week. If the preview has insufficient coverage, Send report now is
disabled and shows the exact dates needed. Sync or upload data for that week,
then preview again. Historical demo files belong in Instant analysis; weekly
reports do not shift to the most recent dates in an old file. Saved weekly
settings load only their selected datasets, not unrelated workspace sources.

After a confirmed failure before delivery starts, a deliberate retry starts a
fresh attempt. If delivery might have started, check delivery history before
trying again. Uncertain status reads keep the same request to avoid duplicates.

KPI targets are benchmark context for the digest and interpretation. Setting a
target does not by itself create a separate immediate threshold-triggered alert.
Use the current delivery settings rather than assuming every metric anomaly
causes an instant email.

## Dates and historical context

Each run reviews the latest completed Monday-Sunday week in the platform
reporting timezone, compared with the preceding week. The manual report's Start
and End are not a permanent weekly window. Historical context rolls with the
current run date and is capped at three years where used for weekly analysis.

The last completed week's charts and unusual-change checks use daily detail:
one point for each Monday-Sunday date. KPI totals still cover the full week and
are compared with the preceding full week. A separate Whole-week assessment
checks each selected metric's full-week value against its expected weekly range,
using earlier complete weeks and seasonal adjustment when supported. Daily
changes and whole-week results can differ: opposing daily changes may cancel
out, or small daily changes may add up to an unusual week. Incomplete weeks are
excluded rather than treating missing dates as zero. If there is not enough
usable weekly history, the whole-week assessment is labeled unassessed.
Both views are included in the preview and email, and supplied as bounded facts
for interpretation. Earlier relationship history is
grouped into complete weekly periods, ending on the Sunday before the report
week; daily points are not mixed into the weekly relationship series.
There is no manual Start/End or Group by selector on the weekly page. Relationship
defaults are Spearman, 52 minimum matched weeks, same-period comparison, and a
maximum directional lag of 12 weeks. The minimum can be changed independently
within allowed bounds. Lag zero compares the same week. The selected metric's
approved aggregation policy is preserved: weekly grouping does not turn every
metric into a sum. Per-metric anomaly results include seasonal support and history warnings.

Changing Instant analysis dates, daily/weekly/monthly/quarterly grouping, or timing
settings does not change the saved weekly settings. Changing weekly settings does
not alter instant reports or either workflow's saved snapshots.

## Follow up on a business change

A weekly configuration using **Business impact analysis** also updates that business-change
study for its selected decision. Set up or select an existing decision rather
than recording a second action. The weekly email includes its answer, estimated range when available,
and what to do next. It keeps the original change date, result, unaffected
comparison. Its study always uses weekly grouping, starting at the rolling
three-year cutoff and ending with the latest completed week. It needs at least
52 complete weeks before the change and 8 after, plus the other comparison checks.
This is separate from the email's seven-day KPI totals; it does not attempt to
estimate a business impact from seven days alone.
Previewing or emailing a weekly report does not create a decision or overwrite
its outcome. Explicitly saving a linked assessment attaches it to the selected
decision. Existing standalone weekly studies can continue under their original
saved configuration; changing those settings requires selecting a decision.

As old history leaves the three-year window, the study can lose enough earlier
data to support an estimate. The email then explains the missing evidence rather
than repeating an old number. The original saved snapshot remains unchanged.

## Stop or remove a template

Remove weekly settings pauses delivery while retaining saved snapshots and linked
decisions. Deleting a saved snapshot does not delete the independent weekly
settings or change delivery. Neither action deletes source datasets or creates a
business decision. Removing a selected source dataset clears its weekly settings
and pauses delivery so a different report is not silently substituted.

For failures or unexpected recipients, do not send repeated test emails. Confirm
the current preferences and ask support to review delivery history first.
