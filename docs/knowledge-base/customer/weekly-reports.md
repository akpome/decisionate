# Configure Weekly Reports

Weekly reports are cross-dataset reviews, not a repeated single-metric screenshot.
Open Weekly Reports in the sidebar. It requires usable metrics from at least
two datasets for delivery. Business Analysis is a separate page and does not
control the weekly report's dates or time grouping.
The pages do not share a workflow tab bar. Weekly Reports uses Report
setup and Report preview; Business Analysis uses Build analysis and Analysis preview.

## Configure weekly analysis and sending separately

Open Analysis -> Weekly Reports. Select metrics, date columns, dimension filters,
seasonal setting and relationship pairs. Report details contains the editable
name and optional business question. If the question is blank, the report asks
what changed last week and what needs attention next. Choose Preview report.
Previewing calculates the draft without changing the saved weekly setup or sending email.
After a successful preview, choose Save changes. Each workspace has one current
weekly report. Saving replaces that report and its setup for future weeks,
even if you change its name; it does not create another active report.
The default name is Weekly Business Report, not a random identifier. You can
use a custom name; it stays the same when the report is updated. Existing
generated names are replaced in the current setup and future reports, while
historical reports and decision evidence keep their original names.
There is no separate Save snapshot or Save weekly settings action on this page.
Changing the setup requires another preview before saving. A failed preview or
save leaves the previously saved setup unchanged. If the reporting week, source
data or saved setup changes before saving, generate a fresh preview.
Weekly history contains sent reports and previously saved legacy reports, not
alternative active setups. Opening history does not replace the current setup.
Reports already sent and evidence attached to decisions stay unchanged when
the current report is replaced. Sent-report history is recorded automatically
for new deliveries; old delivery logs cannot reconstruct missing report contents.
Removed pairs remain excluded
from weekly relationship analysis, while their selected metrics still receive
KPI and anomaly analysis. Saving settings does not enable sending or change recipients.

In the preview, This week at a glance is followed by What deserves attention,
before the detailed charts. Each priority finding includes its supported next
step and result to track. Create decision opens the central form with that
finding's evidence; it does not execute an action or assume improvement.
View existing decision opens an already-linked decision instead of duplicating it.
Supporting evidence and Expected result and limitations remain available with
the finding. An incomplete report states its coverage problem at the top and
does not offer new decision creation or email delivery. Detailed metric charts,
relationship evidence, decision progress and source quality remain available.

A saved business analysis offers Copy selection to Weekly Reports. This is an
editable copy, not a live link. Non-weekly timing choices reset to same-period
comparison, with a default maximum of 12 weeks; a three-day lag is not converted
to three weeks. Preview and save the independent weekly setup before use.

Use Scheduled email (also available from Alerts) to check recipients, delivery day,
timezone, email readiness and delivery history. Save email settings updates only
delivery preferences, not report selections. The status reflects the saved
schedule; unsaved changes are labeled separately. Enable delivery only after
confirming the intended audience. Opening this page does not run another analysis.
A test email is a delivery check without report results, sent to saved recipients.
Save recipient changes before testing. Successful saves clear their notice after
five seconds; failures remain visible. Earlier metric-email selections and targets
are preserved; new report content is configured and previewed in Weekly Reports.
A successful scheduler invocation means a job was queued, not that an email was
delivered. Check terminal analysis status and delivery history separately.

Email workspace owner (previously Send report now) emails the current weekly report only to the workspace owner,
including the client owner in a managed client workspace. First preview and save
the current weekly report. Sending does not save unsaved changes. This one-time
send can run while scheduled delivery is paused;
it does not change recipients, enable delivery or replace a scheduled send.
Only authorized workspace managers can use it. If the owner's account has no
usable email address, sending is blocked rather than using another recipient.

Sending requires usable data from at least two selected datasets in the last
completed week. If the preview has insufficient coverage, Send report now is
disabled and shows the exact dates needed. Sync or upload data for that week,
then preview again. Historical demo files belong in Business Analysis; weekly
reports do not shift to the most recent dates in an old file. Saved weekly
settings load only their selected datasets, not unrelated workspace sources.

After a confirmed failure before delivery starts, a deliberate retry starts a
fresh attempt. If delivery might have started, check delivery history before
trying again. Uncertain status reads keep the same request to avoid duplicates.
When the server confirms report preparation stopped before delivery, the page
explicitly says no email was sent. Older attempts without that confirmation
remain conservative; they are not silently resent.

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
defaults are Spearman, 30 minimum matched weeks, same-period comparison, and a
maximum directional lag of 12 weeks. The minimum can be changed independently
within allowed bounds. Lag zero compares the same week. The selected metric's
approved aggregation policy is preserved: weekly grouping does not turn every
metric into a sum. Per-metric anomaly results include seasonal support and history warnings.

Changing Business Analysis dates, daily/weekly/monthly/quarterly grouping, or timing
settings does not change the saved weekly settings. Changing weekly settings does
not alter Business Analysis or either workflow's saved snapshots.

## Follow up on a business change

Weekly Reports has no **Business impact analysis** tab or assessment setup form. Configure
assessments in Business Analysis under Business impact, or open Assess business impact from Decision Details.
Weekly Reports focuses on selected metrics, unusual changes and relationships.
Old weekly decision links open Business impact within Business Analysis. Older explicit copy links copy
only metrics and dimension filters, not the assessment; the Business impact tool
does not offer a Copy selection to Weekly Reports action.

Existing weekly assessment configurations are preserved, not silently converted
or deleted. Their setup is read-only, with an Open Business impact link.
Set up metric monitoring explicitly starts an unsaved monitoring setup using the
same selected metrics. The existing weekly configuration is replaced only after
preview and Save changes; saved decision assessments and report history remain.
Simply opening the page, following the link or previewing does not change the saved
weekly configuration. Changes in Business Impact do not silently update that configuration.

An existing assessment's weekly preview includes a short Decision update with
the assessment period and a link to the decision, when available. Its evidence
remains available under Assessment evidence. The weekly email retains its answer,
estimated range when available, and next steps. It keeps the original change date,
result and unaffected comparison. Its study uses weekly grouping, starting at the rolling
three-year cutoff and ending with the latest completed week. It needs at least
52 complete weeks before the change and 8 after, plus the other comparison checks.
This is separate from the email's seven-day KPI totals; it does not attempt to
estimate a business impact from seven days alone.
An impact report keeps its own comparison checks and anomaly detection, but
does not also run an exploratory correlation or include Relationship findings
in its preview or email. A monitoring configuration checks selected relationships.
Previewing or emailing a weekly report does not create a decision or overwrite
its outcome. Explicitly saving a linked assessment attaches it to the selected
decision. Existing standalone weekly studies can continue under their original
saved configuration; new assessments require selecting a decision on Business Impact.

As old history leaves the three-year window, the study can lose enough earlier
data to support an estimate. The email then explains the missing evidence rather
than repeating an old number. The original saved snapshot remains unchanged.

## Stop or remove a template

In Report setup, Report options -> Remove weekly report setup pauses delivery while retaining saved snapshots and linked
decisions. Deleting a saved snapshot does not delete the independent weekly
settings or change delivery. Neither action deletes source datasets or creates a
business decision. Removing a selected source dataset clears its weekly settings
and pauses delivery so a different report is not silently substituted.

For failures or unexpected recipients, do not send repeated test emails. Confirm
the current preferences and ask support to review delivery history first.

## Can I monitor weekly metrics without correlation?

Yes. Keep the metrics you want and remove all unwanted relationship pairs,
including all pairs if you only want metric monitoring. The selected metrics
still receive weekly values, previous-week comparisons and daily and whole-week
unusual-change checks where history supports them. Removing a pair does not
remove its metrics. Weekly delivery still requires usable metrics from at least
two datasets in the latest completed week.

Preview report, review the results, then Save changes to update the workspace's
single current weekly report. Saving does not enable delivery or send an email.
For an on-demand report about one dataset or older dates, use Business Analysis.
For routine delivery, check Scheduled email separately. A seasonal setting
affects supported unusual-change baselines, not proof that two metrics are related.

## Why did saving my weekly report not send an email?

Saving updates the current report and future weekly setup, but leaves delivery
settings unchanged. Weekly report saved / Automatic email off means the report
is saved and automatic sending is off. Use Scheduled email to review the
schedule and recipients before enabling it.

An authorized manager can choose Email workspace owner after a successful preview and
save with usable data for the required week. That one-time send goes to the
workspace owner, can work while scheduled delivery is paused, and does not
change the schedule or recipients. Unsaved selections are not silently saved.
If delivery is uncertain, check delivery history before sending again. A queued
job is not proof of inbox delivery, and Ask Decisionate cannot inspect your
current delivery status from documentation.
