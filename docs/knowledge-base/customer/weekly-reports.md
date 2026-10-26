# Configure a meaningful weekly report

Weekly reports are cross-dataset reviews, not a repeated single-metric screenshot.
They reuse selected evidence from a saved multi dataset report and require usable
metrics from at least two datasets for delivery.

## Configure a template and sending separately

Generate and save the desired multi dataset report, then choose Use for weekly
report. Review selected metrics, date columns, dimension filters, business
question, seasonal setting and relationship pairs. Selecting this template does
not enable sending or change recipients.

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

Weekly reviews use daily periods. A template lag configured in weekly, monthly
or quarterly units is not silently relabeled as days; it is disabled for that
daily review with a warning. Keep the original report for the intended timing
study. Per-metric anomaly results include seasonal support and history warnings.

## Stop or remove a template

Remove weekly report template pauses its delivery role while retaining the saved
report and linked decisions. Deleting the saved report used as the template also
pauses delivery. Neither action deletes its source datasets or turns the report
into a newly created business decision.

For failures or unexpected recipients, do not send repeated test emails. Confirm
the current preferences and ask support to review delivery history first.
