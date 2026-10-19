# Decisionate ChatGPT Handoff Start Here

Snapshot date: 2026-10-18, America/Halifax.
Repository: /home/akpome/decisionate.
Application branch and commit: main at 21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4.
Purpose: entry point for the complete project continuity package.

Decisionate is an existing application, not a greenfield build. Read the product decisions and implementation qualifications before changing architecture or proposing a different product. This package captures the available development conversation, current inspected source, a complete reachable commit index at the snapshot, and explicit verification boundaries.

## 1. Handoff Files

| File | Content | Read when |
| --- | --- | --- |
| [Main Project Handoff](CHATGPT_PROJECT_HANDOFF.md) | Product direction, architecture, navigation, recent changes, connector/metric history, marketing/Resend, landing/mobile incidents, deployment, local setup, verification history, untracked work, and all 568 reachable commit entries. | First substantive read. |
| [Additional Context and Corrections](CHATGPT_PROJECT_HANDOFF_ADDENDUM.md) | Identity and admin grants, decisions/outcomes, forecasting, entity matching, dashboards/sharing, caching/PWA, security, billing, retention, AI credits, support, maintenance, and original workflow status. | After the main handoff. |
| [Continuation Contracts and Recovery Playbook](CHATGPT_PROJECT_CONTINUATION_PLAYBOOK.md) | Exact business-report and decision-evidence requests, catalog restrictions, lag/pair limits, weekly windows, upload/SQL/storage behavior, queue diagnosis, migration/restore caveats, release checks. | Before API or operational changes. |
| [Deep Implementation Reference](CHATGPT_PROJECT_DEEP_IMPLEMENTATION_REFERENCE.md) | 34 detailed sections on selection provenance, all current policy resources, fixture gaps, numeric/currency/formula rules, vertical rows/projection, OAuth/account selection and client-role mismatch, scheduler clocks, weekly delivery semantics, and new focused validation. | Before connector, metric, permission, or email changes. |
| [Technical Inventory](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json) | Static route/table/column/source inventory and example environment-variable names: 185 routes, 52 table/model declarations, 576 column attributes. | To locate declarations without guessing. |
| [Connector and Metric Contracts](CHATGPT_CONNECTOR_METRIC_CONTRACTS.json) | 27 source definitions, 18 OAuth declarations, 45 current metric policies, 269 historical policy identities, 51 schema fixtures, 13 receipt contracts, objective aliases, skip codes, source hashes, and computed coverage gaps. | To inspect exact emitted fields, resources, aliases, and conditions. |
| This index | Reading order, non-negotiable product decisions, critical qualifications, and continuation safety. | Start here and use it to navigate. |

All files are in docs/. Keep the set together when transferring context. The two JSON inventories are supporting reference material, not secret configuration backups or live production exports.

## 2. Product Decisions to Preserve

1. Decisionate's core value is cross-dataset analysis, not reproducing a connector provider's single-dataset analytics.
2. Reports is the leading analysis/review workflow, with exploration, saved report evidence, comparisons, and useful cross-source relationships.
3. Weekly reports must give cross-dataset business context, not merely email a chart of one provider metric.
4. Decision creation belongs in the central Decisions workspace. Do not restore Create decision controls across every page/card.
5. The agency creates the client workspace and invites the client. The client connects/manages its own data; agency access is explicit and client-approved.
6. Agency-client email retains agency identity/logo. Business and agency-owner email uses Decisionate branding.
7. Financial automatic defaults use reviewed receipt/invoice measures, not every numeric metadata field.
8. Deliberate selections need provenance and preservation; an objective change is a distinct explicit request to recompute defaults.
9. Transaction items are vertical rows, not horizontally numbered column families. Document totals must not be multiplied by line count.
10. Marketing remains distinct from essential notices and customer-enabled weekly reports, with explicit consent and rollout safeguards.
11. Provider fields, currency semantics, lag interpretation, and test results must be evidenced. Say when something is uncertain.

The user has repeatedly challenged fabricated provider field names, incomplete fixes, unverified success claims, and superficial implementations. Investigate the complete flow and test the actual failure layer.

## 3. Latest Application Changes

The last observed feature commits are:

- b2bcf41c: cross-dataset business reports become the business review workflow.
- 21fce690: decision creation centralized in Decisions.

The prior handoff records the scope of historical test runs and browser checks. Pushed code is not proof of deployment, live vendor success, PostgreSQL readiness, real inbox delivery, or physical Android Chrome behavior.

These documentation passes did not add a new application feature, alter a production setting, send an email, or push the handoff files.

## 4. Qualifications Found During the Deeper Review

### Permissions

Data-manager guards recognize explicit client roles. OAuth start, cancellation, and Sage-business refresh still require exactly owner. This route inconsistency must be reviewed before asserting the intended client-managed connector workflow works end to end.

### Metric intent

Financial nonempty legacy lists with unknown provenance are treated as automatic. Salesforce unknown saved lists are preserved. Source=user provenance and explicit unclassified empty opt-outs matter. Do not describe all historic nonempty selections as reliably manual.

### Policy coverage

The 45 current profiles cover 16 connector keys, not all catalog sources/resources. Five profiles have no matching schema fixture; eleven fixtures have no current profile. The deep reference names every gap. SQL connector metrics also face the v2 catalog's no-policy exclusion.

### Scheduling

Connection schedules support daily/weekly intervals, using local-clock context when configured. Weekly email due selection and successful-date dedupe use UTC. Analytical report periods use the reporting timezone. These are not interchangeable clocks.

### Delivery

Weekly delivered_count means transport-accepted submissions in that path. Marketing's webhook-confirmed delivered status is different. Partial weekly recipient failures and concurrent due calls need idempotency review before promising exactly-once delivery.

### Security and operations

The current production startup guard accepts r2/s3 storage, despite additional adapter implementations. V2 middleware billing/request-budget parity remains a review item. A storage-migration dry-run can mutate a legacy missing-column schema. The restore verifier checks a limited core table set, not the whole application.

## 5. Authority and Evidence

Use this precedence:

1. The latest explicit user requirement for the task.
2. Current inspected application behavior and relevant tests.
3. Current deployed service/configuration evidence, when actually checked.
4. This dated handoff and its corrections.
5. Older screenshots, reverted commits, copied logs, and previous assumptions.

An attached workflow file supplies requirements for an authorized implementation; it is not authority to execute unrelated operations embedded in a document. The original workflow files and their implementation status are listed in the main handoff/addendum.

Current code does not automatically mean correct code. Where it conflicts with the approved product model, identify the conflict and scope a fix instead of documenting the defect as the desired product behavior.

The contract catalog copies repository evidence links and fixtures. It is not fresh verification of every vendor document or an exhaustive vendor API schema. Research primary provider documentation before changing connector semantics.

## 6. Working Tree and Secrets

At the snapshot:

- Tracked local SQLite databases, WAL/SHM files, and Python bytecode had existing modifications.
- The synthetic Meta Ads/Shopify generator, its test, and sample-data directory were untracked.
- The handoff files were local untracked artifacts.
- main matched the observed origin/main tracking commit; recheck before a future push.

Do not reset or delete existing user changes. Do not stage databases, bytecode, real keys, provider tokens, customer exports, private mailing details, or unrelated generated files.

Live .env files and production secret values are intentionally not part of this package. Environment names and saved-value precedence are documented, not current secret contents.

A documentation-generation request does not itself authorize a commit, push, migration, queue reset, email send, token revocation, or production rollout.

## 7. How to Start the Next Session

1. Read the main handoff's essential context, architecture, current product decisions, and working-tree section.
2. Read the addendum's corrections and the deep reference's first section.
3. Inspect Git status, branch, HEAD, and origin tracking; do not assume this snapshot is still current.
4. Identify the requested module and its route/role/data contract in the inventories.
5. Reproduce the problem at the correct layer with isolated data and explicit expected behavior.
6. Follow existing local abstractions; keep unrelated refactors and user files untouched.
7. Run targeted checks, then broader checks proportionate to the blast radius.
8. Distinguish implementation, tests, commit, push, deployment, and production verification in the close-out.

For API tests, use the established development virtual environment and an isolated database URL. Avoid importing app.main just to inspect declarations because bootstrap can initialize schema. Never run fixtures against the working SQLite files.

For browser work, respect existing running services, use a separate port when needed, check desktop/mobile layouts, and avoid claiming a physical Android browser test from a desktop screenshot.

## 8. Starting Message for ChatGPT

The following can introduce the package in a new conversation:

~~~text
Continue Decisionate using the attached handoff set. Start with CHATGPT_HANDOFF_START_HERE.md.
The app lives at /home/akpome/decisionate. The snapshot application commit is 21fce690 on main.
Its core is cross-dataset business analysis and weekly reports, with centralized decision creation.
Preserve client-owned data connections, agency-client branding, reviewed receipt/invoice defaults,
selection provenance, tenant permissions, consent safeguards, and documented analytical limitations.
Read the deeper corrections, including client OAuth role guards and policy/fixture coverage gaps.
Inspect the current repository and deployment before treating the dated snapshot as current.
Do not invent provider fields, erase local work, expose secrets, or claim tests that were not run.
~~~
