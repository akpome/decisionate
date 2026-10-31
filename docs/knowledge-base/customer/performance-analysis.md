# Business Analysis tools for growing businesses

## Which advertising platform gave better value for my money?

Open Business Analysis, then Return on spend. This compares money already spent
with recorded revenue, not a future budget. It is available for any eligible
source, not only Meta, Google or Shopify.

Choose the historical dates and currency. With amounts in one dataset, choose
the revenue and spending columns and Compare by, such as channel or campaign.
With separate datasets, name each comparison and select its own revenue and
spending amounts. A dimension filter can select the channel's sales from a
shared sales dataset. Do not assign the entire store's revenue to every channel.

Daily totals need every date, including explicit zeros for no activity. Monthly
totals need complete months. Individual transactions may be sparse, but you must
confirm the selected period's records are complete. These controls are not time
groupings for a correlation analysis.

Revenue per dollar is total selected revenue divided by total spending. It is
not an average of daily returns, a correlation coefficient, a profit margin or
proof of incremental sales caused by advertising. Refunds and discounts should
already be accounted for in revenue, with tax excluded. All amounts must use
the same currency. Decisionate does not convert currencies here.

Sales assigned once using the same rule can be compared. With Each platform
reports its own sales, returns are displayed separately without an overall
winner because platforms can claim the same sale under different rules.
This release does not infer attribution from total store revenue or estimate
historical channel contributions from a model. Missing revenue links must be
resolved in the source records before a fair return comparison is available.

## Which products or services leave the most money?

Open Business Analysis, then Profitability. Select recorded revenue and one or
more non-overlapping total cost columns, and optionally Compare by product,
service, customer or location. Unit costs must first be converted into the
correct total cost for the recorded quantities. Do not include both a total cost
and its component costs.

Money left is revenue minus the selected costs. Margin is that amount divided
by positive revenue, expressed as a percentage. Neither is presented as net
profit unless all relevant costs have actually been included. Costs such as
delivery, payment fees or advertising are not automatically invented or allocated.
Negative results remain visible. The leading group is based on money left,
not automatically the highest margin or highest sales.

## Preview, evidence and decisions

Compare results generates a preview using the analytics worker. Save comparison
is available only after at least one complete result. Saved comparisons remain
historical snapshots; changing a selection requires another preview and
confirmation. Repeated saves of one preview do not create duplicate records.
Create decision is available after saving and records the user's action,
expected result and review date with the historical evidence. It does not change
advertising budgets or product prices. Deleting a comparison keeps its decision.

Missing dates or amounts, incompatible currencies, unavailable columns and
zero spending have explicit notes. Missing costs are not treated as zero.
Incomplete comparisons do not declare an overall winner. The chosen date
window applies to both spending and revenue; later sales outside that window
are not counted. Return on spend does not automatically shift revenue by a lag.

Business Analysis retains Compare metrics for trends and relationships. Budget
Planner addresses future spending choices. Business Impact assesses an actual
recorded business change. Weekly Reports is unchanged by saving a comparison.
Customer retention, Sales conversion and Cash flow planning use the same
preview, save and decision workflow. These five tools remain within Business
Analysis. On smaller screens, use the Analysis tool selector.

## Are customers coming back?

Choose Customer retention, a purchase dataset, its purchase-date column, a
stable customer ID and a unique purchase ID. A dimension filter can select a
store or another group. Include only completed purchases, excluding cancelled
purchases and duplicate exports. Multiple lines belonging to one purchase ID
count as one purchase; conflicting customers or dates for that ID are rejected.

First recorded purchases from sets the earliest first-observed purchase to
include. History through sets the last date to consider. Time to buy again
gives each customer 30, 60 or 90 days to make a second distinct purchase.
Only customers with the full follow-up window are included in the rate. Newer
customers are shown as Too early to tell, not lost. Follow-up cannot extend
beyond the last available purchase date, the selected end date or today.

The result compares first-purchase months and shows how many customers bought
again within the same window. It uses the first purchase in the available,
filtered records, not necessarily a person's first-ever purchase. A customer
who did not return within the window is not automatically lost. This tool
measures repeat purchases, not subscription cancellations. Customer IDs and
individual purchase IDs are not included in results or decision evidence.

## Where are potential sales being lost?

Choose Sales conversion and one dataset containing counts for the same group
of people or sales opportunities at successive steps. Name and order two to
five steps, for example Enquiries, Quotes and Sales. Choose each step's count,
the dates, and optionally compare a dimension such as channel or location.
Daily and monthly counts need complete dates or full months respectively.
One count per group accepts separate cohort summaries with confirmed coverage.

Each person or opportunity must be counted once at each step, under the same
follow-up window. Independent counts of sessions, orders and customers do not
automatically describe the same group. Decisionate does not link individual
customers across systems in this tool. Confirm that the chosen counts belong
together; a later step exceeding an earlier step is flagged, not forced into
a percentage. Rates, money amounts, negative and fractional counts are rejected.

The result shows the share reaching the final step and where the largest
number did not continue. Across groups, the overall rate uses total final-step
counts divided by total first-step counts, not an average of group percentages.
A drop-off identifies where to investigate, not its cause or a guaranteed
number of recoverable sales. Incomplete groups do not produce an overall conclusion.

## When might cash run short?

Choose Cash flow planning and a payment schedule with an expected-payment date,
expected money-in total and expected money-out total. Use a single currency.
Enter cash available before the plan begins, its start date and a length of
4, 8, 13 or 26 weeks. Each plan week is seven days from the selected start.
The schedule must include the actual cash receipts and obligations being planned,
not merely booked revenue or accounting profit. Explicit zeros are needed when
a row has no receipt or no payment; missing amounts are not guessed.

Cash buffer and what-if changes is optional. Minimum cash to keep sets the
warning level. Money in adjustment and Money out adjustment change selected
receipts and payments by a percentage, without changing source data. Receipts
arrive later shifts expected collection dates by the chosen number of days.
Collections moved past the plan's last date are excluded from the plan, not
counted as cash already received.

Weekly closing cash equals opening cash plus expected receipts minus expected
payments. The result shows the adjusted plan against the original schedule,
ending cash, the lowest planned balance including opening cash, and any gap
below the chosen minimum. Empty weeks mean no payments in the confirmed schedule.
A completely empty schedule cannot produce a reassuring cash plan.

This is a payment-schedule scenario, not an automated statistical cash forecast
or a guarantee. It only includes the selected obligations; tax, payroll, debt,
inventory and other payments must be included in the schedule when relevant.
Week-end balances can miss a shortfall within a week. No money is moved and no
payment date is changed by previewing or saving a plan.
