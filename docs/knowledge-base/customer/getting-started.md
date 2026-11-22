# Get to your first useful analysis

Start with a business question, then choose the matching tool in Business
Analysis. For example, Return on spend compares recorded past revenue per dollar;
Compare metrics explores whether changes in spend and orders move together.
They answer different questions. Do not compare raw spend amounts and order
counts as equivalent units. The checklist below is for a multi-dataset comparison;
Customer retention and Sales conversion each use one dataset. Cash flow planning
accepts one payment schedule or separate schedules for incoming and outgoing payments.

## First analysis checklist

1. Sign in, complete workspace setup if prompted and check the active workspace.
2. Upload a supported file in Datasets or configure an available connection.
3. Wait for a successful import. Inspect actual columns and available dates.
4. Review the dataset's saved metric selection and business objective. Keep the
   measures relevant to the question; date and dimension fields are separate.
5. Open Business Analysis, choose Compare metrics, then Multi dataset report.
6. Select approved metrics from at least two datasets. Review each Date column
   and any Dimension column filter.
7. Enter a useful report name and business question. Choose dates and grouping
   consistent with the actual frequency and overlapping history of the sources.
8. Choose Preview analysis. Read coverage, anomalies, relationships and limitations
   before treating a finding as actionable. Save a snapshot when appropriate.
9. Use Create decision from the report's Decisions and outcomes section, or open
   Decisions and attach the saved report. Record the actual action, expected result
   and review date. A preview or saved report alone does not record a business action.

## If you cannot continue

An empty metric list is not a reason to select arbitrary IDs or every numeric
column. Check the source import and dataset selection first. An unavailable
connector, incomplete backfill, insufficient observations or restricted role can
limit a workflow without meaning that the underlying business has no activity.

Twelve monthly source observations remain twelve observations even if you
select a year of dates or daily grouping. More historical data may be needed.

## From a new workspace to a dashboard you can trust

1. Check the workspace name. In Datasets, import a file with column headings, or
   open Connections, add your provider and finish its setup. Wait for the
   import to finish and open the resulting dataset. Check a few figures you
   recognize against your source before continuing.
2. Pick measures you want to track, such as sales and orders. Leave identifiers
   such as invoice numbers out of the metric list. Choose the date that describes
   the event you care about: order date and payment date answer different questions.
3. Open the dashboard, choose the dataset and map the measures to the chart.
   Use Filters to narrow the view, for example to one store. Set start and end
   dates inside the available data; a new dashboard initially shows the past year.
4. Set a target in the appropriate metric's units and compare it with the
   actual result. A missing mapping, empty date range or missing target is not a
   business result of zero. Check those settings before sharing the dashboard.

## From sales figures to a spending decision

1. For past performance, open Business Analysis and choose Return on spend.
   Select the same dates and currency for revenue and spending. Use one dataset
   grouped by channel, or define separate revenue and spend sources for each channel.
2. Use sales credited once under a consistent rule to compare channels. When
   every channel only has the same total store sales, you cannot rank them by
   return. With platform-reported sales, read the results separately.
3. Compare results. Four dollars of revenue for each dollar spent is not four
   dollars of profit. To compare money left after costs, use Profitability with
   revenue and non-overlapping total costs for the same period.
4. For a future spending split, use Budget Planner with one result and at least
   two spending options. Preview at the same total budget. If there is not enough
   history for a recommendation, the planner will not invent one.
5. When you decide to test a change, choose Create decision from a supported
   comparison or saved budget plan. Record the action, expected result and
   review date. You still make the actual spending change yourself.

## From a change in the chart to a weekly report

1. In Business Analysis, choose Compare metrics. Use Single dataset report for
   measures from one source or Multi-dataset report for multiple original sources.
   Select the date columns, metrics, optional filters, question and analysis dates.
2. Turn on anomaly detection to look for unusual changes in each metric. Select
   seasonal activity when busy and quiet seasons are relevant. Enable relationship
   analysis only to compare pairs. Choose which metric might lead and read how
   many periods actually match; a delay or strong relationship is not proof of cause.
3. Preview the analysis. Inspect missing history as well as the chart. To revisit
   a particular pair against fresh data, use Relationships and save its definition.
   To keep what you saw today, save the analysis snapshot instead.
4. To monitor those metrics routinely, copy the selection to Weekly Reports where
   offered, or select them there directly. Preview the last completed week and
   save the workspace's weekly report. This updates the recurring setup rather
   than sending an email immediately.
5. The owner is the default recipient when the report qualifies for delivery.
   Open Scheduled email to test delivery, add recipients, change its day or pause
   it. An email test checks delivery, not whether the data supports a finding.

## From repeat purchases to a sales follow-up

1. To see whether buyers return, open Business Analysis, Customer retention.
   Select completed purchases with a stable customer ID, purchase ID and date.
   Set the first-purchase period, history end and time allowed to buy again.
2. Compare customers who had the same time to return. Those marked Too early
   to tell are not lost customers. A repeat-purchase rate measures behavior
   after purchase; it does not tell you which prospect failed to buy.
3. To find where prospective buyers stop, use Sales conversion instead. Select
   one dataset and the count columns for successive steps taken by the same
   group, such as enquiries, quotes and orders. Order the steps and preview.
4. Use the largest drop to choose a step to investigate; it does not explain
   the cause. Create a decision from a complete result to test one follow-up,
   and use a review date that gives customers time to respond.

## From a forecast to a cash plan

1. To estimate where a recent trend might go, open Forecasts, choose a dated
   metric and a relevant group (for example, one store). Select enough history,
   choose a sensible grouping and check the forecast's range and limitations.
2. To find when you might run short of cash, use Business Analysis, Cash flow
   planning instead. Sales and profit are not cash in the bank. Start with cash
   available and the expected receipt and payment dates and amounts.
3. Choose one schedule or separate incoming and outgoing datasets. Set currency,
   first day and planning weeks. Include known bills and payroll, then preview.
4. Try a delayed receipt under Cash buffer and what-if changes. Compare the
   lowest weekly balance with your minimum. Use a supported result to record a
   decision, such as following up on an invoice. Saving a plan does not collect
   the invoice, move money or change the source records.

## From a decision to its review

1. Start from a result's Create decision button when available so its evidence
   follows the action. For a measured decision, select one action metric and one
   outcome metric. Set their directions, amounts or percentages, actual start
   date and review date. Preview the targets before saving.
2. For example, "raise ad spend by 10%" is an action; "increase orders by 20"
   is a result. They can succeed independently. If there are no suitable daily
   measures, choose a manual review and write what would count as success.
3. Open Decisions and check Needs attention or select the record under Your
   decisions. On or after the review date, open a measured decision to see both
   checks. Inspect baseline, target, measured dates and actual values for either
   one. Missing records mean the result is not known, not that the target failed.
4. For a manual review, follow the next action, enter what happened and save a
   lesson. To assess whether a recorded change plausibly helped, use Business
   impact with an unaffected comparison and actual start date. Save the
   assessment to the original decision. Hitting a target alone does not prove
   that the action caused it.

## From an internal report to something you can share

1. Check the workspace, dates, filters and figures. Share a dashboard view if
   the recipient needs its chart; share a Business Analysis report preview to
   show the saved findings. For recurring email use Weekly Reports instead.
2. Choose Share link, enter the recipients and send. Each new recipient link is
   read-only, but anyone it is forwarded to can open it. Do not send sensitive
   information to someone just to give them general workspace access.
3. To stop a particular share, choose Manage shared links, find the recipient
   and creation date, and confirm Stop this link. Other individual links still
   work. Stopping a link cannot recall a downloaded or printed copy.
4. For ongoing collaboration, use workspace invitations in Settings instead.
   The recipient signs in with the invited email and receives only the access
   their role allows. An emailed chart is not a membership invitation.

## From separate files to a useful comparison

1. Decide what needs to match. For "Did ad spend and orders move together?",
   use Compare metrics with the two original sources. Choose a date column on
   each, filters such as region and the same grouping. No join is required.
2. To put selected measures on one dashboard by date, use its Compare data
   control. Select the sources, metrics and dates. Check their overlap and map
   each chart to the intended metric before reading totals. A missing month in
   one file does not mean that business did nothing that month.
3. For "Which records belong to the same customer or product?", open Entity
   Matching. Select the source datasets, customer or product, identifier and
   date columns, and measures to include. Prefer a shared customer identifier
   or SKU to names that two different people or products might share.
4. Preview matches and inspect uncertain groups before approving them. Save
   linked history to use its dated records as one dataset. Unmatched rows remain
   separate and the originals are unchanged. A matched invoice and sale can
   still represent the same money; matching does not remove duplicate transactions.

## From an agency invitation to working with a client

1. For a hosted agency, open Settings, set up the branded portal, save a draft
   and preview it before activating. A preview alone does not publish the portal.
2. In Client Workspaces, enter a new client's workspace name and owner email.
   Choose Create and invite owner once. If the owner already has a workspace
   to link, use Link an existing workspace instead. The owner must agree.
3. The client opens the invitation, uses the invited address and verifies it
   if prompted. If delivery is unconfirmed, resend the existing invitation
   rather than creating another workspace.
4. To let the managing agency owner work with client data, the client owner
   opens Settings, Agency connection and turns on Allow agency access. Check
   the active workspace name before making changes. Turning access off does not
   unlink the account or delete data.
5. Use Billing for the agency subscription; use client management to pause,
   resume or remove an accepted client. Removal ends the agency relationship;
   it does not delete that client's workspace. Only its owner can delete it.
