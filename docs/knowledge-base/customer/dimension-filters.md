# Filter metrics by category values

A dimension is contextual information such as channel, campaign, product,
customer, location or region. It filters the rows contributing to a metric; it
does not become a numerical outcome merely by being selected.

## Apply a dimension filter

1. On dashboards, open Filters beside the other controls. Analysis,
   Weekly Reports, Forecasts and Relationships provide their own date/dimension controls.
2. Review Date column and choose Dimension column.
3. Choose one or more Unique values from the dropdown. Search values narrows the
   list of choices; entering search text alone is not the selected-value filter.
4. Check the selected values and resulting data. Clear the dimension filter to
   return to all eligible rows. Closing a dashboard's Filters tab retains it.

The current report contract supports one dimension column per selected dataset,
with up to 50 selected values for that column. Report filters are dataset-local:
filtering one source's channel does not automatically find or filter equivalent
channels in another source. Relationships has independent filters for both sides.
Business impact setup instead offers one comparison dataset and one Unique value
for its dimension. Its Unique value control combines search and selection in one
dropdown. Type to filter choices, then select one; search alone does not change
the selected value. Selecting a different value replaces the current comparison
value. The decision supplies the outcome; any saved outcome segment is shown
read-only with a clear control. The comparison's Date column is beside Dimension
column; changing it preserves the decision's analysis period. The outcome Date
column is beside Outcome metric and starts with the saved selection. In Analysis,
deliberate history-range and grouping changes remain under Analysis settings.
Weekly Reports keeps its dates and weekly grouping automatic, without that section.

## Empty results and missing values

Distinct option values reflect available data, not a universal category taxonomy.
Missing and empty-string values are different. Structured objects are not safe
scalar filter options. If a historical summary did not retain a dimension, its
raw category detail cannot be reconstructed by the selector.

A filter can reduce the overlap and observation count available to correlations
and forecasts. An empty result is not automatically a system failure or proof of
no business activity. Check spelling, selected values, source coverage and dates.

## Transaction-level restrictions

If a dimension splits line items belonging to the same invoice/order, retaining
a header total on only some lines can misstate the result. A rejected filter may
require a line-level metric or transaction-level dimension, not a forced bypass.
