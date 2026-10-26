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
AI-inferred identity service. Inspect the preview before saving the supported
canonical records and unified dataset.

Exact normalized names are weaker evidence than a trustworthy shared identifier.
Two unrelated source systems can reuse a local customer or product ID. Confirm
that a selected key really denotes the same entity across sources rather than
assuming equal strings prove an identity. Do not submit personal identifiers to
a public chatbot for matching; use authorized workspace controls.
