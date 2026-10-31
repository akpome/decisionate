# Joining periods and matching entities

Dashboard joins, entity matching and relationship tests serve different purposes.
A join combines evidence on a key such as a normalized period. Entity matching
groups records describing the same customer or product. Correlation studies
whether metric values vary together; neither other operation proves causation.

## Compare dashboard data

Open Compare data on a dataset dashboard with at least two available sources.
Choose datasets, source metrics and date columns, and apply each source's own
dimension filter if needed. Join selected data normalizes dates into comparable
periods. Check overlap, coverage, joined metric choices and mappings before
interpreting the chart. Reset joined data releases the joined analysis context;
review the restored selection before continuing.

No overlapping normalized dates, invalid date values or overly narrow filters
can prevent a useful joined comparison. A join does not create missing business
activity or make different currencies equivalent. Use Reports for a broader
multi-metric review and a frozen analysis snapshot.

## Match customer or product identities

Entity Matching selects source datasets, customer or product type, matching-key
columns and analytical measures. The current resolver uses exact normalized
identifiers, emails, phones, SKUs and names; it is not a general fuzzy or
AI-inferred identity service. Choose the record date column for each source,
preview the matches, then save linked history. Each original row is retained,
including unmatched rows. Original source datasets are not modified.

Linked history is a separate dataset with a shared record date, customer or
product identity, source dataset and source row. Original columns are kept with
source-specific names. Approved analytical measures keep their source's units,
currency and aggregation rules. Same-named amounts from different sources are
never automatically added together: a sale and an accounting invoice may be
the same transaction. Matching is not transaction deduplication.

The linked dataset is available for analysis when it has usable dates and
approved metrics. Select it as one dataset, including in Single dataset report;
it does not count as two datasets in Multi dataset report. Filter by identity or
source dimensions as needed. Missing
dates, unapproved metrics and gaps remain unavailable; matching does not create
missing data. Aggregated source history cannot be used as individual source
records. Entity Matching is optional for reports, forecasts and relationships.

Shared emails and SKUs are stronger exact keys. Matches that depend on names,
phone numbers, custom columns or reused local IDs need confirmation in the
preview. Unconfirmed links remain separate; independently supported links and
all source rows are retained. The preview displays up to 100 uncertain groups
and 20 records per group. Larger groups cannot be confirmed in this view; refine
the identity columns. Additional unreviewed groups remain separate.

Include entity summary by source optionally shows a summary for the first 100
identified entities after saving. It uses approved metric rules, not blanket
addition of every numeric field. It does not replace the dated history or
create a second analysis dataset. Unidentified rows remain in linked history,
but are not assigned to a customer or product summary.

Saving again with the same source datasets and entity type updates the linked
output. It is a saved snapshot, not a live connector; rerun matching to include
source updates. Other source combinations and older unified datasets are not
overwritten. Older unified datasets are labeled legacy summaries and cannot be
used as dated analytical history. Rebuild from original source records to create
the linked dataset; a first retained date on an old total is not transaction
history.

Exact normalized names are weaker evidence than a trustworthy shared identifier.
Two unrelated source systems can reuse a local customer or product ID. Confirm
that a selected key really denotes the same entity across sources rather than
assuming equal strings prove an identity. Do not submit personal identifiers to
a public chatbot for matching; use authorized workspace controls.
