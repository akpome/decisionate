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

Disconnecting a provider does not stop retention on its stored dataset.
The anomaly model's three-year lookback only limits what is used in a calculation.
Uploaded files expire as whole files based on upload date. Saved reports,
decisions and other workspace history expire based on when the records were
saved or created. The rolling limit does not close the workspace. Subscription
expiry and backup copies still have separate rules.

## If a sync is incomplete

Check status, authorization, selected source account and dates. Wait for queued
work to finish before retrying. If it remains stuck, provide the connection and
workspace context through support, without tokens or raw private payloads.

Volume limits can stop a sync even when the dates are valid. Try a shorter date
range or request fewer fields or records from the provider. For a database query,
filter the source query itself, not just the dashboard. If the saved dataset has
reached its size limit, a smaller pull alone will not make room for more records.
When a chunk exceeds the limit, it is not saved; previously committed data remains.
