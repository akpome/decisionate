# Get to your first useful analysis

Start with a business question, then choose the matching tool in Business
Analysis. For example, Return on spend compares recorded past revenue per dollar;
Compare metrics explores whether changes in spend and orders move together.
They answer different questions. Do not compare raw spend amounts and order
counts as equivalent units. The checklist below is for a multi-dataset comparison;
Customer retention, Sales conversion and Cash flow planning each use one dataset.

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
