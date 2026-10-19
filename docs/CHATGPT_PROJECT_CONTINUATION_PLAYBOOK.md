# Decisionate Continuation Contracts and Recovery Playbook

Snapshot: 21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4.
Date: 2026-10-18, America/Halifax.
Purpose: practical implementation contracts and operational details not sufficiently covered by the previous handoffs.

Read in this order:

1. [Main project handoff](CHATGPT_PROJECT_HANDOFF.md) for product decisions and history.
2. [Corrections and additional context](CHATGPT_PROJECT_HANDOFF_ADDENDUM.md) for platform behavior and limitations.
3. This playbook for request/response semantics, incident diagnosis, and continuation checks.
4. [Technical inventory](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json) for exact route/table navigation.
5. [Deep implementation reference](CHATGPT_PROJECT_DEEP_IMPLEMENTATION_REFERENCE.md) and [connector contracts](CHATGPT_CONNECTOR_METRIC_CONTRACTS.json) for policy coverage, provenance truth tables, OAuth/client guards, and distinct sync/report/email clocks.

The complete handoff index is [Start Here](CHATGPT_HANDOFF_START_HERE.md). The deeper reference adds source-level qualifications; it does not claim a new production rollout.

This document records current source behavior, not fresh production certification. Described checks are proposed verification steps unless explicitly marked as performed. No application feature, provider flag, permission, production data, or mail-sending setting was changed to prepare it.

## 1. Additional Findings That Change How to Continue

### Reports being available does not make every source eligible

The business-report route is not hidden behind the advanced correlation feature flag. It still uses the server-approved metric catalog.

Current metric_catalog contains a stronger restriction than the earlier handoff implied:

- If source_type is in IMPLEMENTED_CONNECTOR_TYPES and the analytical frame has no curated policy, the selected set is cleared for catalog eligibility.
- That set includes postgresql, mysql, and sql_server.
- Therefore explicit SQL selections alone do not make those source metrics eligible for v2 correlation/reports.
- Native provider connector selections also do not become eligible merely because receipt defaults were narrowed or the checkboxes are saved.
- Curated policy availability, reviewed emitted schema, and supported semantics still matter.

This is a code-level finding from correlation/catalog.py and datasets/services/sources.py. Some earlier documentation speaks more broadly about explicit file/database metrics; the current code is narrower. The main handoff has been corrected. No eligibility behavior was changed during this audit.

Do not "fix" an empty catalog by bypassing metric policy or setting every numeric field selected. Inspect the actual exclusion first.

### Ready has a narrow meaning

For the current report builder, ready means at least two distinct datasets have a non-null metric value in the reporting window.

It does NOT mean:

- Every period is complete.
- Previous-period comparisons are available.
- Every selected metric has a value.
- A relationship is statistically established.
- Currencies are economically comparable.
- The report proves an intervention worked.
- A consequential business decision is automatically safe.

A ready report can still contain coverage warnings and exploratory findings. limited_coverage means the two-source usable-value condition was not met.

### Frozen analytical evidence and live follow-up coexist

The saved analytical snapshot does not change when sources later change. The read endpoint nevertheless adds the current matching decision follow-up list.

The whole HTTP response is therefore not permanently byte-identical. Distinguish:

- Frozen values, findings, definition, and evidence.
- Newly queried decision status/outcome/review information.
- Current source authorization, rechecked when reading.

### Preview and save are separate calculations

POST /preview calculates an unsaved report.

POST /api/v2/business-reports calls the calculation path again before saving. It does not simply persist the last preview response.

If a source changes between preview and save, the saved evidence can differ from the preview. This report workflow does not have the advanced run queue's full frozen-watermark execution contract.

Do not promise preview-to-save equality without controlling source changes and testing that condition.

## 2. The Product State Transitions

| Stage | Persisted result | What it does not establish |
| --- | --- | --- |
| Authorize connector | Credential/connection state | That usable data was ingested |
| Queue sync/upload | Ingestion job | That the job succeeded |
| Complete usable import | Dataset/source data and relevant readiness | That every numeric field is a safe metric |
| Save metric selection | Selection/provenance configuration | That every selected metric qualifies for v2 reports |
| Preview report | No saved report ID required | A durable snapshot |
| Save snapshot | New BusinessReport | Paid access, email activation, or a decision |
| Select weekly template | Preference linked to report | Delivery enabled or recipients replaced |
| Prepare decision evidence | decision_payload response | A Decision row inserted |
| Submit central decision | Decision with evidence/outcome focus | A verified causal effect |
| Record/measure outcome | User outcome or measurement fields | Counterfactual or multivariate attribution |

A new ChatGPT session should preserve these boundaries when explaining status or adding automation.

## 3. Exact Business Report Request Shape

Schemas live in:

- app/modules/correlation/schemas.py
- app/modules/reports/schemas.py

The following is a synthetic shape example. Dataset IDs and metrics are illustrative, not known customer records. A real request must use IDs, date columns, and aggregations returned by that workspace's catalog.

### Report Definition Example

~~~json
{
  "name": "Advertising and sales review",
  "business_question": "How did advertising spending and store sales move together?",
  "metrics": [
    {
      "dataset_id": 101,
      "metric_key": "spend",
      "date_column": "date",
      "aggregation": "sum"
    },
    {
      "dataset_id": 202,
      "metric_key": "net_sales",
      "date_column": "date",
      "aggregation": "sum"
    }
  ],
  "method": "spearman",
  "grain": "daily",
  "date_range": {
    "start": "2025-12-01",
    "end": "2025-12-31"
  },
  "lag": {
    "enabled": false,
    "minimum": 0,
    "maximum": 12,
    "direction": "a_leads_b"
  },
  "filters": {
    "minimum_abs_coefficient": 0.3,
    "minimum_observations": 30
  },
  "correction": "benjamini_hochberg",
  "advanced": false,
  "included_findings": [],
  "source_run_id": null
}
~~~

Important validation details:

- Extra unknown fields are forbidden by StrictModel.
- name has length bounds and must not be blank.
- business_question is trimmed and must be 8-1000 characters.
- At least two metric references from at least two datasets are required.
- Dataset/metric identity must be unique, even if different date/aggregation choices are proposed.
- The inherited schema allows advanced requests up to 50 metrics; the report router still caps reports at 25.
- Date windows are ordered and limited to 3,653 days.
- grain is daily, weekly, monthly, or quarterly; supported singular aliases normalize.
- method is pearson or spearman.
- Aggregation must be the server-approved value, not whatever produces the desired chart.
- Policy-managed catalog entries use aggregation=policy.
- The report router caps lag maximum at 12 even if lag is disabled in the supplied request.
- The backend controls reporting_timezone. Do not echo that server-only field into a strict editable request.
- included_findings accepts at most 300 IDs; source_run_id has its own length limit.
- The example requests no included relationship findings. It still requests cross-dataset period analysis.

Schema acceptance alone does not prove that a source exists, is authorized, or has eligible values.

## 4. Catalog Eligibility in Detail

GET /api/v2/business-reports/catalog returns:

- datasets
- next_offset

Each dataset record can include:

- dataset_id and dataset_label.
- connector/source type.
- date_columns.
- availability for each recognized date field.
- metrics with approved identity/aggregation/unit/currency/components.
- freshness metadata and reporting timezone.
- A safe dataset_unavailable error code if loading fails.

The catalog pages 25 datasets at a time. The optional dataset_id query supports hydration of a directly linked dataset. A full page can return a next offset even when the next page will be empty.

### Reasons a field can be absent

1. It was not saved as selected.
2. Its column is unavailable.
3. It is recognized as an identifier.
4. Its source is a native implemented connector/SQL source without a frame policy.
5. It has no suitable reviewed descriptor or eligible registry semantics.
6. It is an unreviewed derived ratio/rate in the legacy path.
7. Its historical summary cannot support the requested semantics.
8. Currency values are missing, malformed, or mixed where the currency checks apply.
9. Fewer than two finite numeric source values exist.
10. The source failed to load.

Constant fields with at least two valid values can appear in the catalog, but a relationship involving a constant series can still be unusable. Catalog presence and useful variance are separate questions.

A restored source schema or newly synced amount column must pass these checks too. Restoring automatic receipt defaults does not automatically apply a curated policy to an old dataset.

### Freshness is not a universal sync certificate

The catalog's freshness field is derived from source configuration's end_date. Availability describes observed dates.

Neither guarantees:

- A successful sync happened today.
- The provider returned every object.
- Provider history access covered the whole requested period.
- A date field has no duplicates or time ambiguity.

Inspect the actual ingestion job and connection state when freshness is in question.

## 5. Relationship Selection, Limits, and Interpretation

### Pair budget

For cross-dataset reports, same-dataset pairs do not consume the report's pair calculation count.

If dataset i contributes n_i metrics, the number of cross-dataset pairs is:

~~~text
pairs = sum(n_i * n_j for each distinct dataset pair i < j)
tests = pairs * number_of_tested_lags
~~~

Enabled lag testing always includes zero. For example:

- minimum=3, maximum=5 tests 0, 3, 4, 5.
- It does not test only three lags.
- Disabled lag testing uses zero only.

A report with 12 metrics from one dataset and 13 from another has 156 cross-source pairs. Testing lags 0-12 means 2,028 tests and exceeds the 1,000-test report cap, even though 25 metrics is within the metric cap.

The appropriate response is a smaller definition or the gated advanced workflow, not silently dropping tests.

### How a best lag is selected

compute_pair selects among eligible candidates using:

1. Largest absolute coefficient.
2. More matched observations for a tie.
3. Smaller lag for a further tie.

A strong negative association can outrank a weaker positive one. "Best" does not mean most positive, most profitable, or causal.

The minimum coefficient threshold is also a quality/reliability consideration; do not assume every below-threshold row is physically absent from all response evidence.

### Evidence preview is standardized

The bounded evidence chart retains at most the last 200 aligned points. It standardizes using the aligned series' mean and standard deviation.

Those a/b values are not original CAD amounts, order totals, or receipt prices. Do not label a standardized point as revenue or calculate ROAS from it.

The coefficient can be based on more observations than the 200 points returned for display.

### Significance and strength labels

Current report strength language uses absolute coefficient thresholds:

- At least 0.7: strong.
- At least 0.4: moderate.
- Otherwise: weak.
- Missing coefficient: unavailable.

These labels are implementation categories, not externally validated decision thresholds.

passes_adjusted_test additionally needs eligible observations, the configured coefficient threshold, and an available adjusted p-value at most 0.05.

When significance is unavailable or not established, an eligible result remains exploratory. Insufficient overlap or variance is different from an exploratory coefficient.

Benjamini-Hochberg correction uses all available valid tested p-values, not just the final displayed winning lags. Null p-values remain unavailable; they are not zero.

The statistical backend identifier contributes to the advanced engine version. Installing/changing an optional statistics package can change cache/result provenance and requires verification.

## 6. Included Findings Are an Explicit Selection

The backend distinguishes:

- included_findings=null: default selection of computed findings.
- included_findings=[]: include none.
- A list of IDs: include only those exact findings.

An ID typically contains both dataset/metric identities and the selected lag. Recalculation can change which lag wins and therefore change a finding's ID.

The editor:

- Preserves explicit empty selection.
- Clears included findings when the analysis definition changes.
- Normalizes server-derived data into editable fields.
- Clamps transferred lag bounds to report limits.
- Keeps source-run provenance when relevant.

Do not reuse IDs from another definition or keep stale IDs through a metric/date/grain change. Unknown selected IDs are rejected rather than silently substituted.

Selecting no correlation findings does not remove period movements or make the cross-dataset report invalid.

## 7. Snapshot Read Behavior and List Limits

### Saved report retrieval

GET /api/v2/business-reports/{report_id}:

- Checks workspace membership/scope.
- Reauthorizes every referenced source.
- Loads stored analytical JSON.
- Queries current linked decisions/outcomes.
- Returns report_id alongside the evidence.

The route does not recalculate the saved analytics on read. It also does not promise a complete current policy recertification of old frozen evidence; calculation and source-access reauthorization are different checks.

### Saved list

The list endpoint considers at most the 100 newest workspace report records, then omits those the caller cannot read.

It does not currently expose an arbitrary report-search/pagination contract.

A report missing from that list is not by itself proof it was deleted. Consider list bounds, source access, wrong workspace, and source cleanup.

No general report PATCH, DELETE, sharing-token, export-job, or scheduled-attachment endpoint should be invented from the currently declared report routes.

### Decision follow-up list

decisions_for_report:

- Starts with at most the 100 newest decisions in that workspace.
- Requires the decision's evidence datasets to be within the report's dataset set.
- When reading a saved report, requires matching report_id in structured context.
- Returns at most 20 follow-up items.

The preview can therefore show relevant dataset-associated decisions that are not yet tied to that exact newly saved report. Saved detail is more specific.

A missing decision from this bounded list does not prove no such decision exists in the portfolio.

## 8. Exact Decision Evidence Request

This is a synthetic request body for POST /api/v2/business-reports/REPORT_ID/decision-evidence. REPORT_ID must be a real authorized saved report; the example is not an instruction to submit a live decision.

### Decision Evidence Example

~~~json
{
  "title": "Investigate the advertising and sales relationship",
  "action": "Run a bounded experiment after checking stock and seasonality",
  "reasoning": "The historical association may share seasonal causes and needs validation",
  "expected_outcome": "Compare incremental net sales against an agreed baseline without reducing margin",
  "outcome_metric": "202:net_sales",
  "review_date": "2027-01-15"
}
~~~

Current schema rules:

- title: 3-200 characters.
- action and reasoning: 3-5,000 characters.
- expected_outcome: 3-3,000 characters.
- outcome_metric: 3-220 characters.
- review_date: a valid ISO date.
- Relevant narrative fields are trimmed.

A valid date is not the same thing as an API-enforced future review date. String-length validation does not prove that an expected outcome is actually measurable or that the reasoning is sound.

### Evidence response

The route returns decision_payload, not a created decision.

The payload includes:

- Dataset and outcome dataset matching the selected outcome metric.
- Metric key.
- Action/title/description.
- Expected outcome and review date.
- Evidence dataset IDs and metric records.
- recommendation_source=rules.
- Structured recommendation_context containing business_report provenance.

Trend arrays and the per-finding standardized evidence arrays are omitted from the compact decision context. Do not add unbounded arrays or raw transaction rows to that context to make it look more detailed.

The central form then calls the existing decision creation API, merging its priority/category/confidence without dropping evidence.

### Remaining validation distinction

The shown evidence endpoint checks that the outcome metric exists in the snapshot and the report has ready status. The central UI additionally restricts outcome choices to usable values.

Do not claim the endpoint itself rejects every null-valued selected outcome merely because the UI hides it. Server/UI parity is a follow-up check, not a new guarantee supplied by this handoff.

Existing decision permissions still apply to actual insertion. Knowing a report ID or obtaining a draft payload does not grant client users decision-creation authority.

## 9. Weekly Templates and Actual Reporting Dates

Selecting a template:

- Saves business_report_id.
- Derives metric_focus.
- Preserves recipients and enabled state.
- Creates a disabled preference if no preference exists.

A weekly report recalculates current weekly evidence. It is not just the old saved snapshot emailed repeatedly.

### Complete week example

The engine's tests establish that:

- On 2026-04-01, the latest complete Monday-Sunday window is 2026-03-23 through 2026-03-29.
- On Sunday 2026-03-29, that same week is not yet treated as complete; the prior week is used.
- The reporting timezone matters when local time and UTC lie on different days.

The application does not infer a Canadian or workspace timezone from the customer's address. Use the configured reporting timezone consistently on the relevant processes.

### Why the 2025 demo can produce an empty weekly preview

The synthetic CSVs end on 2025-12-31. A current weekly report in a later year can have no values in its required latest complete week, even though a manually selected 2025 report works.

Do not backfill a current weekly report with stale all-time totals just to make the demo display numbers.

Use a deliberately appropriate dated fixture in isolated testing, or describe the historical report honestly. Changing the machine clock or production reporting dates is not a routine demo fix.

## 10. Import Limits Not Previously Specified

Separate limits operate at different stages:

| Boundary | Current source limit |
| --- | --- |
| Uploaded file | 100 MiB |
| Multipart request envelope | Upload cap plus 1 MiB allowance |
| Other HTTP request bodies | 10 MiB |
| Signed file download | 100 MiB |
| Validated tabular dataset | At most 1,000,000 rows and 500 columns |
| Validated dataframe memory | At most 512 MiB |
| Expanded XLSX content | Checked against 512 MiB |
| Parquet metadata checks | Rows, columns, and expanded bytes checked |
| Partitioned Parquet load | Combined metadata/column limits checked |

A small compressed file can expand beyond the dataframe limit. A 100 MiB upload limit is not a promise of a 100 MiB in-memory representation.

The partitioned loader can read multiple files and concatenate them. The presence of metric selection does not prove every source/storage operation is streaming or column-projected.

Do not promise that every import's peak memory is exactly bounded by the final dataframe check; parsers, query clients, copies, and transforms can allocate memory before or beyond that validation.

## 11. Signed Cloud File Imports

POST /datasets/import-url is not a general arbitrary-URL fetch endpoint.

Current rules include:

- HTTPS only.
- No embedded URL username/password.
- Port absent or 443.
- Allowed Google/Microsoft cloud-file hostname suffixes.
- DNS resolution must produce public addresses.
- Redirect destinations are validated before following.
- The connection uses the checked destination rather than an unchecked second lookup.
- Proxy environment routing is not simply inherited by the shown downloader.
- Streamed size is bounded.
- Provider/download errors become safe import errors.
- Queued signed URLs are protected instead of logged as public links.

Supported downloadable file handling includes CSV, JSON/JSONL, Parquet, XLS, and XLSX where the reader/dependencies support it. A sharing-page URL returning HTML is not necessarily a directly downloadable dataset.

An expiring signed URL can become invalid before a queued worker fetches it. Diagnose expiry and a failed terminal job; do not print the signed query token into a support message or disable URL protections.

## 12. Customer SQL Connectors Need Real Database Privileges

The code validates a single SELECT or WITH statement and rejects semicolons plus selected mutation keywords.

This is a lexical validation mechanism, not a complete SQL parser or proof that every allowed expression has no side effects.

The bound_database_query helper currently returns the validated query unchanged and explicitly does not impose a row cap.

Therefore:

- Use genuinely read-only, least-privilege customer credentials.
- Do not rely on the keyword filter instead of server-enforced privileges.
- Scope query output to the columns, date range, and scale actually needed.
- Do not claim the source query is automatically rewritten with LIMIT.
- Do not infer a provider-side query timeout or streaming memory guarantee without tracing the actual driver path.
- Preserve the documented password encryption and connection validation.

This import capability is separate from SQL-source eligibility for the newer v2 metric catalog.

## 13. Connector Storage and Historical Compatibility

Current connector code defines:

~~~text
CONNECTOR_HOT_MONTHS = CONNECTOR_DATA_RETENTION_MONTHS
CONNECTOR_DATA_RETENTION_MONTHS = 36
~~~

Do not describe the present implementation as automatically keeping only 12 months raw and always summarizing the next two years. That is not the current hot-month constant.

Monthly raw partition handling and yearly historical-summary compatibility code coexist. Old summary data can still lack row-level information needed for:

- Distinct populations.
- LAST snapshots.
- Weighted ratios.
- Exact transaction-level dimensions.
- Currency-specific signed amounts.

A data source being retained is not proof that every requested daily analytic can be reconstructed from its historical representation.

Summary grouping is bounded and excludes certain high-cardinality/personal identifier-like fields. The code does not retain every possible dimension in old summaries.

When a metric is unavailable only for old history, inspect its stored representation and sufficient statistics before treating it as a UI selection bug.

## 14. Queue Liveness, Timeouts, and Retry Differences

### Ingestion readiness

The current ingestion heartbeat is considered fresh within 30 seconds.

A new deployment waiting for the existing worker lock does not refresh that owner heartbeat. It retries lock acquisition every five seconds and rate-limits repeated wait warnings.

A fresh heartbeat can belong to the older owner. Confirm the intended deployment owns the queue before declaring a new runtime configuration active.

### Supervised ingestion jobs

- Default execution timeout: 900 seconds.
- Configurable effective timeout is clamped from 30 to 7,200 seconds.
- Job child has parent-death protection on Linux.
- The entrypoint applies its memory/BLAS bounds.
- Interrupted running work is failed rather than blindly retried after possible partial writes.
- Staging/payload cleanup is part of terminal handling.

Do not turn failed ingestion jobs back into running by manually editing their database status.

### Marketing shares the supervisor but not unconditional priority

The supervisor chooses queued root ingestion work first. Marketing batch processing is reached in the idle branch, on its interval.

Webhook/contact/workspace priorities operate within marketing processing. They do not mean a marketing webhook batch always preempts a continuously busy ingestion queue.

If marketing remains pending while ingestion jobs keep arriving, check that scheduling condition in addition to consent, sync revision, and send gates.

### Advanced correlation differs

The separate correlation queue has its own leases/tokens and bounded transient retries. Stale running leases and explicit cancellation are treated through that worker's rules.

Do not generalize its retry behavior to ingestion or marketing. "All jobs retry automatically" is not the current application contract.

## 15. Configuration Precedence and Environment Mismatches

get_runtime_configuration resolves some aliases by first nonempty value:

- AUTH_JWKS_URL before CLERK_JWKS_URL.
- AUTH_JWT_AUDIENCE before CLERK_JWT_AUDIENCE.
- AUTH_JWT_ISSUER before CLERK_JWT_ISSUER.
- AI_API_KEY before OPENAI_API_KEY.
- AI_MODEL before OPENAI_MODEL.
- AI_API_URL before OPENAI_API_URL.
- Generic object-storage settings before their supported provider aliases.

AI_PROVIDER is still its own required provider choice; compatibility key/model aliases do not themselves activate a model service.

A stale nonempty generic value can mask a corrected compatibility value. Diagnose precedence without printing either secret.

Staging also requires an explicit non-SQLite database and remote storage through the runtime configuration boundary. It is not just development with another hostname.

The production guard's stricter R2/S3 restriction is described in the earlier addendum. Provider adapters and deployment acceptance remain distinct.

API, worker, scheduler, optional correlation worker, frontend build, and saved platform settings do not all read identical variables or at the same time. Check the correct process rather than assuming one saved variable updates every deployed service.

## 16. Restore and Migration Tools Have Narrower Guarantees

### Restore verifier

scripts/verify_backup_restore.py requires these core tables:

- organizations
- datasets
- decisions
- auth_identities

The SQLite backup-file mode checks integrity and foreign keys read-only. The database-URL mode checks connectivity, table presence, and core counts.

A successful verified=true does not assert:

- All 52 current tables exist.
- Every new column/index/constraint exists.
- Business-report and marketing evidence is complete.
- PostgreSQL has undergone a full logical integrity audit.
- Remote objects are restored.
- Every account/tenant can read exactly the right files.

Extend the release check with the actual feature tables/columns and representative authorized application reads.

### Object-storage migration dry-run caveat

The migration calls _ensure_dataset_storage_provider_column before iterating the catalog.

If a legacy database lacks datasets.storage_provider, that helper issues ALTER TABLE and commits even when the caller requested dry-run.

Consequently, do not present the tool as an absolutely non-mutating database inspection in every legacy state. Use an isolated copy first and inspect the current tool before targeting production.

This handoff records that behavior; it does not change the migration code.

### Copy verification

Normal verification compares file manifests and content hashes, including directory contents. It updates references after copy verification and keeps source data by default.

--no-verify weakens the evidence. --delete-source is an explicit destructive option. Neither belongs in a default "check whether migration is configured" command.

A code-level migration result is also not a provider-created backup snapshot. Snapshot creation, secure key retention, restore targets, and access controls remain operational responsibilities.

## 17. Diagnostic Matrix for Repeated User Reports

| Symptom | Check first | Do not assume |
| --- | --- | --- |
| Reports exists but no metrics appear | Saved selection, source type, frame policy, registry, finite-value count, date fields | The route is still feature-hidden |
| SQL dataset has selected fields but no v2 metrics | Native SQL no-policy catalog exclusion | Explicit numeric selection bypasses policy |
| Lightspeed still has only quantity | Successful latest Sales sync, actual amount/currency columns, recommended versus manual selection | Documentation adds values to an old file |
| Salesforce quantity stays unavailable | Exact TotalOpportunityQuantity field and nonempty numeric values | ProductQuantity exists or missing quantity means zero |
| Report has no relationship | Observation count, variance, grain, history, date matching | Cross-source report failed |
| Report says ready but changes are absent | Metric-level coverage and previous baseline | ready means all comparisons are complete |
| Correlation is negative | Actual coefficient and business definitions | Best lag must be positive |
| Different result after Save | Source changes between two calculations | Save stores the exact preview response |
| Saved report metrics stay old | Immutable snapshot contract | Detail read should recalculate source totals |
| Saved report decision status changes | Live follow-up supplement | Frozen analytics were overwritten |
| Old saved report not in selector | Latest-100 bound, workspace, revoked source access | Database deletion |
| Weekly preview empty for demo | Latest completed week versus CSV's 2025 dates | Use lifetime totals as current week |
| /ready returns 503 | Database and 30-second ingestion heartbeat | Restarting the scheduler drains work |
| New worker waits indefinitely | Existing owner/duplicate deployment and old logs | Remove PostgreSQL advisory locks |
| Marketing pending with healthy ingestion | Idle-branch scheduling plus marketing gates/sync state | Webhook priority preempts all imports |
| Contact delivery test deferred | Frequency cap, sync revision, suppression, allowlist | The mailbox necessarily rejected it |
| Upload fails below 100 MiB | Expanded memory, rows/columns, reader dependencies | Network file size is the only limit |
| Signed file import fails after queueing | URL expiry, actual downloadable response, allowlist/DNS, terminal job | Permit arbitrary URLs |
| "Readonly" SQL import is too large | Source query scope and real database privileges | Query was automatically capped |
| Restore verifier passes but reports fail | New model columns, remote objects, source permissions | All feature data was verified |
| Dry-run touched an old database | Storage-provider-column compatibility helper | Every dry-run is universally side-effect-free |
| Changes not visible online | Built revision, correct service, domain, workspace, frontend build-time config | A push guarantees deployment |
| Page crashes on Chrome only | Exact device/browser evidence and shared startup logs | A thumbnail/in-app-browser result proves the same renderer path |
| 503 looks like CORS | Actual response, backend logs, worker/storage/policy errors | Every transport-looking failure is a CORS setting |

These are diagnostic paths, not claims that every row was reproduced in production.

## 18. Release and Continuation Check Matrix

The following is a verification plan. It is not a statement that all checks passed during this documentation task.

| Area | Required check | Evidence to retain |
| --- | --- | --- |
| Revision | Web/API/worker use intended compatible commits | Deployment IDs and revision strings |
| Schema | New tables and weekly template column exist after serialized bootstrap | Non-secret schema inspection/startup result |
| Public health | API responds and /ready reflects database/worker state | Timestamped non-secret status |
| Authentication | Real owner/member/client/managed-client behavior | Role-scoped request results |
| Catalog | One eligible file pair and intended native connector policy | Selected fields and safe catalog metadata |
| SQL catalog | Confirm intended current exclusion or an authorized tested change | Explicit regression result |
| Report periods | Window/prior window, missing buckets, zero baseline | Expected versus returned values |
| Report semantics | Policy ratio/count/LAST behavior | Fixture calculation, not screenshot alone |
| Currency | Mixed/unresolved cases withheld or labeled appropriately | Semantic/warning checks |
| Correlation | Constant, short, incomplete, and lagged cases | Coefficient, observations, flags |
| Findings | Explicit [] remains empty; stale IDs rejected | Request/response assertion |
| Snapshot | Sources change after save; stored metrics do not | Reopened evidence comparison |
| Save timing | Preview/save with a source change is understood | Documented recalculation behavior |
| Access revocation | Old snapshot/run cannot expose revoked source | Unauthorized read result |
| Central decision | Multiple sources preserved; one usable outcome selected | Decision payload and stored provenance |
| Null outcome | Server/UI parity explicitly reviewed | Negative test, not UI visibility alone |
| Decision follow-up | Live updates scoped and bounded | Correct linked decision identity |
| Weekly | Two usable datasets; latest complete week | Preview without a live send |
| Weekly settings | Template does not enable delivery/change recipients | Before/after preference assertion |
| Mail branding | Client agency versus owner Decisionate | Rendered HTML/plain-text checks |
| Worker handover | One owner; successor waits and takes over | Isolated PostgreSQL integration logs |
| Recovery | Interrupted jobs fail and clean up safely | Terminal job and staging result |
| Capacity | Queue/request/pair limits stay distinct | Relevant 4xx/deferral results |
| Browser | Narrow/wide, keyboard, errors/retry, workspace reset | Browser screenshots and assertions |
| Physical mobile | Original Chrome failure path if it recurs | Device/browser version and remote console |
| Backup | Isolated DB plus remote objects and new feature records | Verifier plus application-read evidence |
| Migration | Legacy dry-run behavior understood before production | Isolated-copy test and operator approval |
| Privacy | No secrets/raw customer data in logs/artifacts | Sanitized evidence review |

Do not combine per-commit test counts into an invented whole-project pass count. Record the exact command, revision, database target class, result, and skipped tests for each run.

## 19. What the Existing Tests Actually Establish

The web suite is not one homogeneous end-to-end browser suite.

Examples reviewed:

- business-reports.test.mjs executes transpiled helper logic and also checks source contracts.
- create-decision-actions.test.mjs uses static rendering, transpiled modules, source/AST checks, and targeted assertions.
- Responsive Playwright verification was a separate workflow and used synthetic identity/transport arrangements as documented earlier.

Therefore, "232 web tests passed" must not be rewritten as "232 production browser journeys passed."

The API report tests include real builder calculations and TestClient endpoints on isolated SQLite, with identity/storage collaborators patched as appropriate. They do not verify a live Clerk tenant or provider API.

Some PostgreSQL integration suites skip unless DECISIONATE_TEST_POSTGRES_URL is set. SQLite success cannot establish advisory-lock and concurrent-claim behavior in a real PostgreSQL deployment.

CI defines a disposable PostgreSQL service, but a workflow definition or pushed commit is not proof a particular remote run completed successfully.

No latest full API-suite pass, production delivery test, live provider audit, or physical-device result is added by this documentation.

## 20. How to Explain the Product Without Overclaiming

Use:

"Decisionate brings approved metrics from multiple sources into one business review, compares reporting windows, surfaces historical relationships and limitations, and lets a user attach that evidence to a decision in the central Decisions workspace."

Do not turn that into:

- Automatically identifies the cause of sales changes.
- Proves which ad created each order.
- Calculates profit from spend and revenue alone.
- Makes business decisions automatically.
- Supports every numeric field from every connector in cross-source reports.
- Sends weekly reports automatically without configuration.
- Guarantees a known conversion lag.
- Certifies every provider's live invoice schema.

An honest explanation of a limitation is more useful here than a stronger invented benefit. Akpome explicitly required primary documentation, actual schema checks, and direct acknowledgement of uncertainty after prior field-name mistakes.

## 21. Minimal Continuation Sequence for a New Session

1. Read the main handoff's product direction and latest two commits.
2. Read the addendum's role, outcome, billing, and middleware caveats.
3. Check current git status; preserve runtime DB/bytecode and untracked demo work.
4. Confirm whether the task is documentation, diagnosis, implementation, or an explicitly authorized push.
5. Inspect the exact route/catalog/loader involved, using the inventory as a locator.
6. Choose an isolated test that matches the disputed behavior.
7. Fix only the authorized behavior; do not switch on provider/email/rollout flags to hide a failed test.
8. Verify affected contracts plus browser behavior where applicable.
9. Distinguish code completion, push, deployment, and real-provider validation in the close-out.
10. Update the relevant handoff section if its contract changed.

If ChatGPT has only these documents and not repository/tool access, it must not claim to have inspected live code, run tests, changed files, pushed commits, or queried production.

## 22. Source References for This Pass

| Topic | Source |
| --- | --- |
| Report request validation | ../apps/api/app/modules/reports/schemas.py and ../apps/api/app/modules/correlation/schemas.py |
| Eligibility and source policy | ../apps/api/app/modules/correlation/catalog.py and ../apps/api/app/modules/datasets/services/sources.py |
| Pair limits, save/read, evidence, weekly template | ../apps/api/app/modules/reports/router.py |
| Coverage, dates, findings, bounded follow-up | ../apps/api/app/modules/reports/service.py |
| Lag selection and normalized evidence | ../apps/api/app/modules/correlation/engine.py |
| Editor serialization and findings reset | ../apps/web/features/reports/types.ts and report-workspace.tsx |
| Upload/dataframe bounds | ../apps/api/app/modules/datasets/services/file_loader.py and datasets/router.py |
| Signed file protections | ../apps/api/app/modules/datasets/router.py |
| SQL query validation | ../apps/api/app/modules/datasets/services/connectors.py |
| Worker ordering/heartbeat/timeouts | ../apps/api/app/infrastructure/ingestion_worker.py |
| Runtime alias precedence | ../apps/api/app/configuration.py |
| Storage migration compatibility changes | ../apps/api/scripts/migrate_object_storage.py |
| Restore verifier scope | ../apps/api/scripts/verify_backup_restore.py |
| Restore procedure | backup-restore-verification.md |
| Test categories | ../apps/web/tests/business-reports.test.mjs, create-decision-actions.test.mjs, ../apps/api/tests/test_business_reports.py |
| PostgreSQL test gates | ../apps/api/tests/test_ingestion_worker_postgres.py and test_marketing_postgres.py |
| Release job definitions | ../.github/workflows/ci.yml |

Relative paths in this table are navigation hints within the same repository. They are not links to external provider documentation or evidence of current production state.

## 23. Status of This Document

This pass reviewed additional source and existing tests and corrected the earlier SQL-eligibility statement. The report-definition and decision-evidence JSON examples are synthetic contract examples, not customer data.

Performed checks for this documentation pass:

- Both JSON examples validated against the actual ReportDefinition and ReportDecision Pydantic schemas.
- Four negative checks confirmed rejection of a server-only editable timezone field, a single-dataset definition, blank reasoning, and an invalid calendar date.
- A valid past review date was accepted by the schema, confirming that calendar validity alone does not enforce a future date.
- Documentation links, code-fence balance, and whitespace checks passed.
- A credential-pattern scan found no matching credential values in the handoff documents. This is a limited automated check, not a general secret-detection certification.

Schema validation used development settings, an in-memory database URL, and bytecode-disabled execution. It did not call application endpoints, import application bootstrap, send email, or query production. The full API/web suites were not rerun for these documentation-only changes.

No feature implementation or production fix is implied by an identified limitation. In particular, SQL catalog eligibility, v2 middleware parity, null-outcome validation parity, migration dry-run behavior, and broader outcome-policy support remain explicit review items unless a later authorized code change resolves them.

The handoff documents remain local documentation artifacts. No commit or push was requested for this pass.
