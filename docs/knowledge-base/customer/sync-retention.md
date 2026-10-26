# Initial sync, historical imports and retention

Connector ingestion prioritizes the latest 90 days. It then backfills up to a
rolling three years of history that the provider actually makes available.
These are requests and limits, not a guarantee of three years of usable records.

## Why history arrives progressively

Historical work is checkpointed and split into chunks, with background history
chunks capped at 30 days. Manual connector requests longer than 90 days are also
chunked. This bounds each ingestion task rather than making a single unbounded
historical request. The worker resumes its recorded progress; repeatedly
reconnecting or starting full overlapping imports is not a way to speed it up.

A recent dataset can be visible before backfill is complete. Check connection
progress and the dataset's actual dates before evaluating a three-year forecast
or concluding that older activity is missing from the provider.

## Retention is a separate operation

Connector records older than the rolling three-calendar-year cutoff are removed
by the connector retention flow. Records with unusable dates cannot safely be
classified as old and may be retained. A historical summary cannot recreate
discarded transaction-level details.

The anomaly model's three-year lookback only excludes older observations from a
fit; it does not itself delete rows. Uploaded files, subscription expiry and
backup copies have separate retention rules. Do not extend the connector rule
into a promise about every data type or immediate deletion from all backups.

## If a sync is incomplete

Check status, authorization, selected source account and dates. Wait for queued
work to finish before retrying. If it remains stuck, provide the connection and
workspace context through support, without tokens or raw private payloads.
