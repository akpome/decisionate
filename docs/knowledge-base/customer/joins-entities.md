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
interpreting the chart. After joining, use Review joined data to inspect the
selection. Use Reset joined data in that panel to release the join and return
to the original datasets.

No overlapping normalized dates, invalid date values or overly narrow filters
can prevent a useful joined comparison. A join does not create missing business
activity or make different currencies equivalent. Use Reports for a broader
multi-metric review and a frozen analysis snapshot.

In Compare Groups, the dimension dropdown lists available dimensions from
each original dataset first, then columns saved in the join, even before you
choose a metric. The dataset name identifies the source of each dimension. A dimension from the
metric's own dataset can split the original rows into groups. A dimension from
another dataset can only group the metric's monthly totals: a shared month must
have a single known group value in that dataset. Months with missing or mixed
groups are skipped. This does not match individual records or assign sales to
specific ads. A column labeled "joined months" groups the saved monthly labels.
For example, to compare Online and Store sales in a month, choose the original
sales dataset's Channel, not the Channel labeled "joined months". Use the
latter only to group whole monthly totals by their saved labels.

Joined datasets are excluded from both Compare metrics report tabs in
Business Analysis and from Weekly Reports. Use original datasets for Multi-dataset
report and Single dataset report.
Existing saved report snapshots remain readable. An older report setup
with joined sources must remove them before running again.

## Match customer or product identities

Use Entity Matching when two systems record the same customers or products.
For example, a shopper may have different IDs online and in-store but the same
email. For products, a shared SKU (product code) can link both sets of records.
If you only want to compare ad spend with orders by date, use Business Analysis
> Compare metrics instead. You do not need to match identities first.

1. Open Entity Matching in the sidebar. Under Choose source datasets, choose
   Customers or Products in Entity type and select at least two sources.
2. In Identity columns by dataset, choose the fields that identify the same
   person or product across sources. Select each Record date column, then check
   the amounts or counts you need under Metrics for analysis.
3. Select Preview matches. Check the proposed groups and unmatched counts.
   Under Matches needing confirmation, approve only groups you know are the
   same entity. Exact shared identifiers are stronger than matching names.
4. Choose Save linked history. This creates a separate dataset with every
   original row, including unmatched rows. The source datasets are unchanged.
   Include entity summary by source is optional; it adds a summary to the
   results, not another dataset.
5. Find the linked dataset in Datasets. For a report, open Business Analysis
   > Compare metrics > Single dataset report and choose it. Use its shared
   record date and approved metrics. Saving linked history makes a snapshot;
   rerun matching to include new source records.

Decisionate matches exact values after standardizing their format. It does not
guess that two different spellings, names or local IDs are the same person.

Preview matches shows any missing identity or metric selections before a run.
If dataset columns cannot be loaded, Retry dataset columns keeps the chosen
sources and valid column selections. After saving, Linked history saved prevents
another identical save. Changing match approvals or the optional summary allows
an updated save; changing source or column selections requires another preview.

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

## Does Entity Matching create a dataset?

Yes. In Entity Matching, Preview matches lets you check the proposed links
without creating a dataset. Save linked history creates a separate dataset
in Datasets. The originals stay unchanged, and every original row is kept.

The linked dataset keeps separate columns for each source and adds shared
fields such as the customer or product ID, record date and where the row came
from. You can use it in Business Analysis > Compare metrics > Single dataset
report once it has usable dates and selected metrics. It is not a live sync;
rerun matching and save again to include newer source records.

## Combine sales from two datasets

If you want one sales total, put distinct transactions from both systems into
one table with the same columns, for example Date, Order ID, Channel and Net
sales. This is stacking rows. If both sources are mapped to those four columns,
stacking 100 and 80 rows gives 180 rows and still four columns. If you keep extra
columns from either source, the stacked table can have more columns.

1. Prepare the combined CSV, Parquet file or read-only database query upstream.
   Match the column meanings and currency, and handle discounts, refunds and
   taxes the same way in each source. Use a reliable transaction key to avoid
   counting the same sale twice.
2. For a file, use Datasets > Add data > Upload file. For a database query, set
   it up through Connections. Check the imported dates and sales column.
3. In Business Analysis > Compare metrics > Single dataset report, select the
   combined dataset and Net sales with Sum aggregation. To show totals separately
   by channel in the dashboard, use Edit dashboard > Compare Groups with Net sales
   as the metric and Channel as the dimension.

A $100 online purchase and a separate $80 in-store purchase can total $180.
A $100 sale and its $100 accounting invoice are one sale, not $200. Entity
Matching links customer or product identities; it does not merge sales columns,
standardize amounts, or deduplicate transactions for you.

## Does stacking rows add columns?

Not if you align the columns first. If both sources use Date, Channel and Net
sales, stacking 100 and 80 rows gives 180 rows and still three columns. Keeping
extra fields from just one source can add columns, with blanks for other rows.
Entity Matching is different: it keeps each source's fields separate and adds
shared identity and source fields. For a combined sales total, use an aligned
stack of distinct transactions instead.
