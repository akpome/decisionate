# Configure a meaningful weekly report

Weekly reports are cross-dataset reviews, not a repeated single-metric screenshot.
They reuse selected evidence from a saved multi dataset report and require usable
metrics from at least two datasets for delivery.

## Configure a template and sending separately

Generate and save the desired multi dataset report, then choose Use for weekly
report. Review selected metrics, date columns, dimension filters, business
question, seasonal setting and relationship pairs. Removed pairs remain excluded
from weekly relationship analysis, while their selected metrics still receive
KPI and anomaly analysis. Selecting this template does not enable sending or
change recipients.

Use Weekly delivery or Alerts to check recipients, schedule, delivery preferences
and email readiness. Enable delivery only after confirming the intended audience.
A successful scheduler invocation means a job was queued, not that an email was
delivered. Check terminal analysis status and delivery history separately.

KPI targets are benchmark context for the digest and interpretation. Setting a
target does not by itself create a separate immediate threshold-triggered alert.
Use the current delivery settings rather than assuming every metric anomaly
causes an instant email.

## Dates and historical context

Each run reviews the latest completed Monday-Sunday week in the platform
reporting timezone, compared with the preceding week. The manual report's Start
and End are not a permanent weekly window. Historical context rolls with the
current run date and is capped at three years where used for weekly analysis.

Analysis group by is separate from weekly delivery. Weekly totals cover the
completed week, with daily detail for coverage and anomaly checks. Relationship
analysis retains the template's daily, weekly, monthly or quarterly grouping,
minimum observations, pair directions and lag limits. A two-week lag remains
two weeks; sending weekly does not turn it into two days or disable timing.
Without a template, relationship analysis defaults to weekly grouping.

Changing the analysis grouping does not change the weekly summary window or
the metric's approved aggregation policy. Monthly and quarterly analyses may
still lack enough matched observations inside the rolling three-year limit;
daily summary detail does not create extra observations for them. Per-metric
anomaly results include seasonal support and history warnings. New weekly
previews and emails label the summary and analysis groupings separately.

## Follow up on a business change

A template built with **Did my change help?** also updates that business-change
study. The weekly email includes its answer, estimated range when available,
and what to do next. It keeps the original change date, result, unaffected
comparison and grouping. Its study starts no earlier than the saved study start
or the rolling three-year cutoff and ends with the latest completed week.
This is separate from the email's seven-day KPI totals; it does not attempt to
estimate a business impact from seven days alone.

As old history leaves the three-year window, the study can lose enough earlier
data to support an estimate. The email then explains the missing evidence rather
than repeating an old number. The original saved snapshot remains unchanged.

## Stop or remove a template

Remove weekly report template pauses its delivery role while retaining the saved
report and linked decisions. Deleting the saved report used as the template also
pauses delivery. Neither action deletes its source datasets or turns the report
into a newly created business decision.

For failures or unexpected recipients, do not send repeated test emails. Confirm
the current preferences and ask support to review delivery history first.
