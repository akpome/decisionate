# Upload and inspect datasets

The file workflow offers CSV, JSON, Excel and Parquet ingestion, subject to the
readers installed in the deployment. A dataset's real schema comes from its
file or connector output, not from a generic example shown in a conversation.

## Add and inspect data

1. Open Datasets and choose Add data. In Upload file, choose a supported
   file from your device. Use Import link for a supported data-file URL you
   are authorized to import, or Connections to set up a provider.
2. Wait for processing and check that the dataset appears in the list before
   sending the file again. Open it to review the preview, column names, row
   count and dates. Check a few amounts against your source.
3. In the dataset details, review the selected metrics and save any changes
   needed for analysis. Choose a real date column for time-based tools; keep
   categories such as location available for filters.
4. Open the tool you need, such as Dashboard, Forecasts or Business Analysis,
   and choose that dataset. Its available dates and saved metrics determine
   what the tool can use.

If Add data is unavailable in your workspace, ask its owner to check your
permissions. A file import is not a scheduled provider sync.

## Prepare a useful file

Use stable column names and a header row for CSV. Include a genuine date or
timestamp when you need trends, relationships or forecasts. Numeric measures
need consistent units. Categories such as campaign, product or region belong in
dimension fields rather than being forced into numeric measures.

After processing, inspect the dataset name, row count, preview, date fields,
detected numeric columns and selected metrics. A numeric-looking identifier is
not automatically a sensible metric. A file containing twelve monthly records
does not contain daily observations merely because a date selector offers days.

## Empty or surprising data

Check the file format, actual worksheet or payload, column headers and imported
date range. For connector datasets, also check sync and backfill status. A
provider may return no records for a valid query because the account, dates or
permissions differ from the intended source.

Do not invent missing values, automatically interpret absent rows as zero
activity, or rename an unknown column to a familiar vendor field. If a source
schema changed, review the saved metric and date selections before recalculating.

## Saved selections

Dataset-level metric selection controls eligible analytical measures; a report
then chooses a subset of those measures. Non-metric date, category and identifier
fields can remain available for inspection or filtering without being plotted as
metrics. Removing a measure from a chart is not a guarantee that its raw source
column has been deleted from storage.

## Slow or unconfirmed uploads

Uploading data file means the file is still being sent. Preparing your dataset
means the file was received and is being processed in the background. The file
name stays visible so you can identify which import is being checked.

The transfer has a five-minute window, separate from normal page requests.
Temporary failures when checking an accepted import are retried without sending
the file again. A timeout or lost confirmation does not prove the import failed:
check the dataset list before uploading the same file again. A confirmed import
failure still shows its error rather than being treated as success.

Files and signed links are limited to 100 MB per file. Ordinary JSON documents
have a 20 MB limit; CSV, JSON Lines, and Parquet can be used for larger files.
An import can contain up to 1 million rows, 500 columns and 10 million cells
(rows times columns). The whole dataset must fit under all three limits. Small
files can still be rejected if their contents expand beyond the processing limit.
Remove unused columns, shorten long text, or import a smaller separate dataset.

A workspace can start up to 50 file imports in 24 hours. If five imports are
already queued or the worker is unavailable, wait before retrying. After a
confirmed import, the dataset list is refreshed.

For large CSVs, a Parquet copy can be substantially smaller while preserving the
same rows and columns. Upload the actual data file, not a ZIP bundle. A daily
summary is not the same as the original order-level or line-level dataset;
choose the level of detail needed for your analysis.
