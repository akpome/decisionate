# Business Analysis tools for growing businesses

## Which advertising platform gave better value for my money?

For "which channel gave me more bang for my dollar?", open Business Analysis,
then Return on spend. This compares money already spent
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

## Can I compare channels with only ad spend and total store revenue?

Not as a fair revenue-per-dollar ranking. The total store revenue does not say
which channel earned each sale, and assigning that total to every channel counts
the same sales more than once. First provide consistently assigned channel
revenue, or keep platform-reported returns separate without declaring a winner.

Compare metrics in Business Analysis can show which spending series moves with
revenue, including observed timing when supported. A higher correlation is not
more revenue per dollar and does not prove one platform caused more sales.
Budget Planner is for future spending scenarios; it is not a substitute for
measuring the return on past spending. Ask Decisionate can explain these choices,
but cannot determine your winning channel from chat or inspect your account.

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
recorded business change within Business Analysis. Weekly Reports is unchanged by saving a comparison.
Customer retention, Sales conversion and Cash flow planning use the same
preview, save and decision workflow. These five tools remain within Business
Analysis. On smaller screens, use the Analysis tool selector.

## How do I reopen, change or delete a saved comparison?

Open the same tool in Business Analysis, expand Saved comparisons and choose a
Saved comparison. Search by name if needed; Load more shows additional records.
Each tool has its own list. Saving Return on spend does not replace a cash plan
or the workspace's current weekly report.

A saved comparison is a snapshot. Edit inputs to make a new preview; you must
confirm the records again before running it. New comparison starts a fresh setup.
Save comparison follows a supported preview, and Create decision follows saving.
Creating again from the same saved comparison opens its existing decision.
The delete button removes the saved comparison after confirmation when your role
allows it. Linked decisions are kept. Saving never changes the original dataset.

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

## Does a return of 3 mean I made 3 dollars of profit?

No. In Return on spend, 3 means three dollars of recorded revenue for each
dollar spent. For example, 300 dollars of assigned sales divided by 100 dollars
of advertising is a return of 3. That leaves product costs, fulfilment, fees and
other expenses uncounted. It does not mean three dollars of profit or three
dollars of extra sales caused by the advertising.

Use Profitability to subtract the relevant, non-overlapping total costs. A
high-return channel can still leave little money after those costs. To assess
whether an implemented change helped, use Business impact only when the decision
and comparison satisfy its evidence requirements. Ask Decisionate explains the
calculation; it cannot tell you your actual return without an account analysis.

## Why is there no winning channel or return figure?

Return on spend withholds an overall winner when comparisons are incomplete or
sales are independently claimed by platforms. Zero spending does not produce an
infinite return. Missing revenue, missing spending, gaps in daily totals, partial
months or incompatible currencies need resolving before a fair comparison.

Use the same dates and a consistent sales-assignment rule for every channel.
Do not convert missing amounts into zero unless the source actually records no
activity. Daily totals, monthly totals and individual transactions have different
coverage requirements; choose the option that describes the records, not the one
that removes a warning. Later sales outside the chosen window are not counted
automatically. A useful comparison may require better source records, not a
different chart or a lower evidence threshold.

## Why can a high-margin product leave less money?

Profitability shows both money left and margin. For illustration, 100 dollars
of revenue with 20 dollars left has a 20% margin. Another product with 1,000
dollars of revenue and 100 dollars left has a 10% margin but leaves more money
in total. The leading group is based on money left, not the margin percentage.

Compare by product, service or location using the same dates, currency and cost
definitions. Include total costs for the quantities sold, not a unit price used
as a total. Shared overhead is not allocated automatically. If it is missing,
describe the result as money left after selected costs, not final net profit.
This comparison does not determine the best selling price, stock order or
product assortment, and it cannot promise that dropping an item raises profit.

## Can retention tell me which customers will leave or their lifetime value?

Customer retention measures observed repeat purchases, not an individual's
likelihood of leaving, subscription churn or predicted lifetime value. It shows
whether customers made another distinct purchase within the same 30, 60 or
90-day window. Recent customers without that much follow-up are too early to
tell, not lost. Changing the window changes the question being measured.

Use stable customer and purchase identifiers in completed-purchase records.
Monthly totals alone cannot reveal who returned. Multiple product lines for one
purchase do not count as repeat visits. Filtering to a store or product changes
the observed purchase history: a purchase elsewhere may no longer count.
The first purchase in the available records is not necessarily the first-ever
purchase. Use the results to choose a follow-up test; the tool does not contact
customers or reveal their individual identifiers in the result.

## Can I combine advertising clicks and store orders into a sales funnel?

Not simply by dividing unrelated totals. Sales conversion needs one dataset
with two to five ordered count columns describing the same people or sales
opportunities, counted once at each step under the same follow-up window.
For example, 100 eligible enquiries, 40 quotes and 10 sales gives a 10% overall
conversion rate for that group. It does not show why the other enquiries stopped.

Clicks, sessions, customers and orders can describe different populations or
repeat events. Prepare comparable counts first; the tool does not match people
across platforms. Percentages are not valid count inputs. A later step greater
than an earlier step signals a definition or data problem. The biggest numerical
drop-off suggests where to investigate, not a proven cause or a guaranteed
number of sales that can be recovered.

## Can a profitable business still run out of cash?

Yes. Profitability compares recorded revenue and selected costs; Cash flow
planning follows expected payment dates and cash available at the start. A sale
recorded today may not be paid until next month, while wages or suppliers are
due sooner. Profit and available bank cash therefore answer different questions.

For cash planning, include expected receipts and obligations in one dated
payment schedule, including payroll, suppliers, tax and debt payments where
relevant. Enter starting cash and a minimum buffer. Review the lowest planned
balance as well as ending cash. The calculation does not connect to a bank to
verify that balance, automatically discover bills, arrange credit or move money.
Weekly closing cash can also miss a shortfall inside a week.

## What if customers pay late or expenses rise?

In Cash flow planning, open Cash buffer and what-if changes. Receipts arrive
later shifts expected money-in dates by up to 90 days. Money in adjustment and
Money out adjustment change the selected amounts by a percentage; Minimum cash
to keep sets the warning level. Compare the adjusted plan with the original
payment schedule. Use 4, 8, 13 or 26 weeks, in one currency.

For example, a payment pushed beyond the plan's last day no longer counts as
cash received during that plan. This is a scenario, not a prediction of which
customer will pay late. The controls do not change source records, invoice due
dates or payment instructions. Include all relevant obligations before drawing
conclusions; a missing payment is not automatically zero.
