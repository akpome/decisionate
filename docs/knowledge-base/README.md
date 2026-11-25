# Decisionate Support Knowledge Repository

This repository supplies reviewed product guidance for Ask Decisionate on
Help & Support, plus separate operational guidance for authorized support staff.
The chatbot implementation is in `apps/api/app/modules/support` and
`apps/web/features/support`. This repository is not an MCP server, production
configuration dump or authorization mechanism. Its offline tooling makes no AI
calls and sends no emails.

## Start here

- Read [the answer policy](assistant-policy.json) before implementing retrieval.
- Use [the article manifest](manifest.json) to find articles, questions, related
  topics, application routes and the code supporting each article.
- Index only the `customer` audience for customer-facing answers. Never ingest
  the entire repository, these operator instructions, historical handoffs, raw
  logs, source code or environment files into that index.
- Use [the generated connector inventory](connector-catalog.json) for the
  source-registry inventory, not a claim that a connector is enabled in production.
- Use [the evaluation cases](evaluation-cases.json) for chatbot review.
  Automated tests check exact landing-page questions, refusal on unverified
  requests, and customer-only document retrieval.
- Use the [business-question coverage matrix](analysis-question-coverage.json)
  to verify the intended article can be found for representative questions
  across the tools and workflows. Retrieval does not establish answer coverage.

Ask Decisionate returns factual text only for reviewed questions and approved
phrasings. It cites the corresponding section. It never asks a model to guess
which documentation answers a question. If no reviewed answer matches, it
states that limitation and may offer related reviewed questions as suggestions,
not as evidence for the unanswered question. Add new phrasings only after
checking that the approved answer directly addresses them.

## Step-by-step tool guides

Open a guide below or try its question in Ask Decisionate in Help & Support.
For the tools listed here, both `How do I use ...?` and `How to use ...?`
return the reviewed steps.
These guides explain how to use the tools; they do not inspect your workspace.

### Get Data Ready

| Guide | Ask Decisionate |
| --- | --- |
| [Getting started](customer/getting-started.md#first-analysis-checklist) | How do I use Decisionate? |
| [Upload or inspect a dataset](customer/uploads-datasets.md#add-and-inspect-data) | How do I use Datasets? |
| [Connect a data source](customer/connectors.md#connect-safely) | How do I use Connections? |
| [Import older connector records](customer/connectors.md#request-an-older-date-range) | How do I use Advanced date range? |
| [Choose dataset metrics](customer/metric-selection.md#change-a-selection) | How do I use dataset metric selection? |
| [Match identities across datasets](customer/joins-entities.md#match-customer-or-product-identities) | How do I use Entity Matching? |

### Dashboards

| Guide | Ask Decisionate |
| --- | --- |
| [Choose a dashboard](customer/dashboards.md#choose-a-dashboard) | How do I use Dashboards? |
| [Use the active dashboard](customer/dashboards.md#configure-a-view) | How do I use Dashboard? |
| [Select metrics and set a KPI target](customer/dashboards.md#how-do-i-choose-metrics-and-add-a-target) | How do I use Select Metrics? |
| [Compare categories on a chart](customer/dashboards.md#how-do-i-compare-groups-on-a-dashboard) | How do I use Compare Groups? |
| [Filter to a location, product or channel](customer/dimension-filters.md#apply-a-dimension-filter) | How do I use dimension filters? |
| [Join data on a dashboard](customer/joins-entities.md#compare-dashboard-data) | How do I use Compare data? |

### Business Analysis

| Guide | Ask Decisionate |
| --- | --- |
| [Build and save an analysis](customer/reports-build.md#build-an-analysis) | How do I use Business Analysis? |
| [Compare metrics](customer/reports-build.md#build-an-analysis) | How do I use Compare metrics? |
| [Build a multi-dataset report](customer/reports-build.md#build-an-analysis) | How do I use Multi-dataset report? |
| [Build a single-dataset report](customer/reports-build.md#analyze-one-dataset) | How do I use Single dataset report? |
| [Turn report correlation on or off](customer/reports-build.md#set-up-relationship-analysis) | How do I use Relationship analysis? |
| [Assess an implemented decision](customer/reports-build.md#where-is-business-impact-and-how-do-i-use-it) | How do I use Business impact? |
| [Save or reopen a report](customer/reports-read-save.md#save-and-update) | How do I use Saved reports? |
| [Check for unusual changes](customer/anomalies-seasonality.md#check-for-unusual-changes) | How do I use Anomaly detection? |
| [Request report interpretation](customer/ai-interpretation.md#request-an-interpretation) | How do I use AI interpretation? |
| [Compare recorded revenue per dollar](customer/performance-analysis.md#how-do-i-use-return-on-spend) | How do I use Return on spend? |
| [Compare revenue after selected costs](customer/performance-analysis.md#how-do-i-use-profitability) | How do I use Profitability? |
| [Check repeat purchases](customer/performance-analysis.md#how-do-i-use-customer-retention) | How do I use Customer retention? |
| [Find where potential sales drop off](customer/performance-analysis.md#how-do-i-use-sales-conversion) | How do I use Sales conversion? |
| [Plan cash and test late receipts](customer/performance-analysis.md#how-do-i-use-cash-flow-planning) | How do I use Cash flow planning? |

### Planning and Monitoring

| Guide | Ask Decisionate |
| --- | --- |
| [Test a future spending mix](customer/budget-planner.md#how-to-compare-advertising-spend-and-get-a-budget-recommendation) | How do I use Budget Planner? |
| [Preview and save a weekly report](customer/weekly-reports.md#configure-weekly-analysis-and-sending-separately) | How do I use Weekly Reports? |
| [Schedule, test or pause email](customer/email-branding.md#set-up-scheduled-weekly-email) | How do I use Scheduled email? |
| [Preview and save a relationship](customer/relationship-monitors.md#set-up-a-two-metric-monitor) | How do I use Relationships? |
| [Forecast a metric](customer/forecasts.md#generate-a-forecast) | How do I use Forecasts? |

### Decisions and Sharing

| Guide | Ask Decisionate |
| --- | --- |
| [Create and review a decision](customer/decisions-outcomes.md#how-do-i-follow-through-on-a-change-i-make) | How do I use Decisions? |
| [Follow up on decisions](customer/decisions-outcomes.md#follow-up-in-action-needed) | How do I use Action Needed? |
| [Share a dashboard or revoke one link](customer/sharing-exports.md#public-dashboard-links) | How do I use dashboard sharing? |
| [Share a report or revoke one link](customer/sharing-exports.md#email-a-business-analysis-report) | How do I use report sharing? |

### Workspace and Support

| Guide | Ask Decisionate |
| --- | --- |
| [Manage account access and workspace settings](customer/workspaces-access.md#manage-workspace-settings) | How do I use Settings? |
| [Invite or manage a teammate](customer/workspaces-access.md#invite-a-teammate) | How do I use Workspace Members? |
| [Set up a branded portal](customer/hosted-portals.md#how-do-i-set-up-my-portal) | How do I use Hosted portal settings? |
| [Create or link a client workspace](customer/agencies-clients.md#invitations-and-first-sign-in) | How do I use Client Workspaces? |
| [Grant or revoke agency access](customer/agencies-clients.md#working-with-a-client) | How do I use Agency connection? |
| [Manage a subscription](customer/billing-credits.md#subscription-changes) | How do I use Billing? |
| [Find product guidance](customer/troubleshooting-support.md#ask-decisionate) | How do I use Ask Decisionate? |
| [Ask for help or report a problem](customer/troubleshooting-support.md#send-a-useful-support-request) | How do I use the support form? |

## Customer articles

| Topic | Article |
| --- | --- |
| Product purpose and navigation | [Decisionate fundamentals](customer/product-overview.md) |
| Returns, profitability, repeat purchases, sales steps and cash | [Business Analysis tools](customer/performance-analysis.md) |
| First useful analysis | [Getting started](customer/getting-started.md) |
| Workspaces and permissions | [Accounts and access](customer/workspaces-access.md) |
| Client access and white labeling | [Agencies and clients](customer/agencies-clients.md) |
| Files, schemas and empty datasets | [Uploads and dataset inspection](customer/uploads-datasets.md) |
| Available versus planned sources | [Connector catalog](customer/connectors.md) |
| Initial import and older history | [Sync and retention](customer/sync-retention.md) |
| Receipt defaults and manual selections | [Metric selection](customer/metric-selection.md) |
| Salesforce and missing quantity | [CRM and financial metric caveats](customer/metric-semantics.md) |
| Dates, grouping and aggregation | [Time and aggregation](customer/time-aggregation.md) |
| Unique-value dropdowns and segments | [Dimension filters](customer/dimension-filters.md) |
| Charts, mappings and targets | [Dashboards](customer/dashboards.md) |
| Period joins and exact identity matching | [Joins and entities](customer/joins-entities.md) |
| Building an analysis | [Single and multi dataset reports](customer/reports-build.md) |
| Indexed trends and snapshots | [Reading and managing reports](customer/reports-read-save.md) |
| Pearson, Spearman and evidence | [Relationship interpretation](customer/relationship-evidence.md) |
| Pair direction and lag | [Timing and observations](customer/lag-observations.md) |
| Saved two-metric monitors | [Relationships page](customer/relationship-monitors.md) |
| MAD, seasonality and unusual changes | [Anomaly detection](customer/anomalies-seasonality.md) |
| Future estimates and validation | [Forecasts](customer/forecasts.md) |
| Spending allocation and channel mix | [Budget Planner](customer/budget-planner.md) |
| Weekly templates and delivery | [Weekly reports](customer/weekly-reports.md) |
| Email contents, sender and logo | [Report email format and branding](customer/email-branding.md) |
| Creating, updating and reviewing actions | [Decisions and outcomes](customer/decisions-outcomes.md) |
| AI versus statistics and fallback | [AI interpretation](customer/ai-interpretation.md) |
| Subscriptions and usage units | [Billing and AI credits](customer/billing-credits.md) |
| Public links and downloads | [Sharing and exports](customer/sharing-exports.md) |
| Safe next steps and escalation | [Troubleshooting and support](customer/troubleshooting-support.md) |
| Processing, retention and preferences | [Privacy and email preferences](customer/privacy-preferences.md) |

## Operator articles

These articles must not be retrievable by the customer chatbot.

- [System boundaries and deployment](operator/architecture.md)
- [Worker health and end-to-end verification](operator/worker-verification.md)
- [AI configuration diagnosis](operator/ai-configuration.md)
- [Email sender and delivery diagnosis](operator/email-delivery.md)
- [Incident curation and known failure patterns](operator/incident-curation.md)
- [Knowledge maintenance and chatbot integration](operator/maintenance-integration.md)

## Verify and export

Run from the repository root; the script uses only Python's standard library:

```bash
python -B apps/api/scripts/knowledge_repository.py check
python -B apps/api/scripts/knowledge_repository.py export --audience customer --output docs/knowledge-base/generated/customer.jsonl
python -B apps/api/scripts/knowledge_repository.py export --audience customer --output apps/api/app/modules/support/knowledge/customer.jsonl
python -B apps/api/scripts/knowledge_repository.py export --audience operator --output /tmp/decisionate-operator-knowledge.jsonl
python -B -m unittest discover -s apps/api/tests -p test_knowledge_repository.py -v
```

The committed customer JSONL contains independently retrievable Markdown
sections, stable article/section identities, route metadata and verification
dates. It contains neither source-file contents nor operator articles.
Articles covering multiple tools can specify `section_routes` in the manifest.
Each section link must reference an existing section heading and one of that
article's approved routes. The export puts that route first so Ask Decisionate's
Open page link goes to the relevant tool, not a different tool from the same article.
`section_questions` adds reviewed alternative phrasings for a specific section.
These help retrieval but are not additional factual answers. Do not attach all
article questions to every section: a section about cash should not be ranked as
the answer to an advertising-return question merely because both share an article.
Keep the question coverage matrix separate from these retrieval hints so tests
also exercise natural phrasing that is not copied from the hints.
`direct_questions` is a separate, explicit approval: the named section must answer
each entire question. Matching ignores only case, whitespace and punctuation,
not additional clauses, negation or account-specific qualifiers. Duplicate
questions after normalization fail validation. Add a regression for the actual
displayed answer, not just presence somewhere in the retrieved sources. Do not
promote retrieval hints or whole article question lists into direct answers.
An operator export requires an explicit audience choice and is not committed
to the customer export. The API image packages only the generated customer
bundle. Authenticated server-side retrieval never loads the operator corpus.

`check` validates article metadata, audience directories, links to related
articles, source references, inventory generation, evaluation references and
source fingerprints. The business-question matrix may reference only approved
customer sections; unknown, duplicate and operator targets fail validation.
It also checks that the committed customer export matches
the articles and matches the packaged API bundle. A changed fingerprint means review is needed; it does not prove
the corresponding behavior changed. Passing checks establishes structural
consistency, not correctness of a live deployment or an AI answer.

## Source authority and freshness

The manifest's verification date describes a source review. The generated
`source-snapshot.json` records the Git base revision, any referenced source
files modified locally, and hashes of the exact reviewed files. It makes no
claim that uncommitted changes are deployed or that production is on that SHA.

Use current implementation and regression tests over conflicting old handoffs.
In particular, do not restore the standalone Insights workflow or advanced
correlation explorer merely because an old manual describes one. Current
customer paths are documented in the articles below.

After reviewing a product change, update affected articles, metadata and
evaluation cases, then regenerate the source snapshot and customer export:

```bash
python -B apps/api/scripts/knowledge_repository.py snapshot --reviewed-on 2026-10-26
python -B apps/api/scripts/knowledge_repository.py export --audience customer --output docs/knowledge-base/generated/customer.jsonl
python -B apps/api/scripts/knowledge_repository.py export --audience customer --output apps/api/app/modules/support/knowledge/customer.jsonl
python -B apps/api/scripts/knowledge_repository.py check
```

Use the actual review date in Halifax for a later review. The snapshot command
does not review prose for you. Run it only after checking the cited behavior.
Connector inventory generation uses literal AST values from `sources.py`; it
never imports the application, reads credentials, or contacts a provider.

## Deliberately unverified here

This static repository cannot establish a customer's actual columns, imported
history, provider permissions, subscription prices, balance, worker health,
email sender, delivery result, active AI model or deployment revision. Answers
requiring those facts must use a separately authorized current read or say that
the fact is not known. Historical screenshots, synthetic fixtures and prior
successful deliveries do not certify the present production configuration.
