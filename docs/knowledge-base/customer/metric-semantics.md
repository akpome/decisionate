# CRM and financial metric caveats

Use exact fields from the selected dataset. Provider documentation describes
possible fields; only inspection of an authorized dataset establishes which
fields and values that customer actually has.

## Salesforce opportunities

Reviewed Opportunity defaults include numeric Amount, ExpectedRevenue,
Probability and TotalOpportunityQuantity when present and eligible for the
selected objective/policy. Amount is estimated opportunity value, not necessarily
booked revenue. ExpectedRevenue is a weighted expected amount. Probability is
an estimated percentage, not an observed win rate and not a value to sum.

TotalOpportunityQuantity is the exact supported source name. Do not invent
ProductQuantity as an equivalent field. Quantity is opportunity-level context,
not proof that a per-product breakdown exists. A missing or entirely empty field
cannot be selected as a usable numeric metric; valid zeros and constants are not
the same as an absent field.

## Transaction items and totals

Connector normalization can expand line items vertically rather than creating a
new horizontal set of columns for every item's position. This improves schema
stability but does not make an invoice-header total additive across every line.
Approved metric policies distinguish line amounts, document totals, distinct
counts and component-weighted ratios to avoid unsafe double counting.

A product filter that splits a transaction cannot arbitrarily allocate its
header total to the remaining lines. Choose a line-item measure or a
transaction-level dimension if the filter is rejected for splitting totals.

## Currency and receipt fields

Unresolved or mixed currencies can make a monetary metric ineligible. Do not
assume all money uses two decimal minor units, convert an already normalized
amount again, or infer profit/ROAS from unrelated totals. For Lightspeed, Zoho,
Sage or any other provider, inspect the exact series/resource and returned fields
before explaining a narrow default selection.
