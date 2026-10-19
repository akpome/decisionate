# Decisionate MVP Consolidation Review

Specification: Decisionate_Codex_MVP_Consolidation_v2.docx.
Audit date: 2026-10-18, America/Halifax.
Baseline: main at 21fce6900ae4ded2c6a7b4f1a87e38a9c06feac4.

Status: audit checkpoint prepared. Application implementation has not started. Sections 2, 9, 12 and 14.6 of the supplied specification require findings and approval before PR 1, broad navigation rewrites or deletion. This document records proposed work, not authorization to commit, push, deploy, migrate, activate flags or send email.

## 1. Findings

Findings are ordered by engineering risk. The MVP direction largely matches the existing report engine; the gaps are consistency, discoverability, permissions and evidence presentation, not the absence of an analytical engine.

| ID | Priority | Finding and evidence | Smallest proposed change | Tests and risk |
| --- | --- | --- | --- | --- |
| F1 | P1 | V2 product routes miss subscription and request-budget middleware. apps/api/app/main.py:1624 lists legacy prefixes but not /api/v2. Reports perform source/workspace authorization, not the middleware's subscription/budget branch. | Extend the protected product boundary to the actual v2 routes, preserving legitimate exempt endpoints and route-local authorization. | Add expired/grace/active subscription, authentication, rate-budget, OPTIONS and tenant tests through the actual middleware. Risk: accidentally denying legitimate reads or exposing feature-gated routes. |
| F2 | P1 | Client-managed OAuth is inconsistent with data permissions. oauth/router.py:437, :518 and :609 require exactly owner; datasets/services/auth.py:101 and use-workspace-access.ts:229 allow explicit client roles to manage data. | Reuse the existing verified role/scope helpers for client connector operations, with a narrowly approved role matrix. Do not allow managed agency credentials merely because agency analysis access exists. | Owner/client_owner/client_user/member/managed_client/unauthorized and cross-workspace tests for start, cancel and Sage refresh. No live vendor authorization required for guard tests. |
| F3 | P2 | Report outcome validation differs between UI and server. decisions/new/page.tsx:235 and decision-report-evidence.tsx exclude metrics with null current values; reports/router.py:164 only checks ID membership. An isolated ready three-source report with one unavailable metric returned HTTP 200 for that null outcome. | Reject an unavailable/non-finite chosen outcome on the server while preserving baseline warnings and the independent central creation guard. | Add the exact ready-report/null-third-metric regression and zero-valued valid outcome case. No Decision was inserted by the reproduction. |
| F4 | P2 | Null finding semantics are lost. features/reports/types.ts:42 uses value.included_findings ?? [], converting null/default selection into an explicit empty selection. A direct transpiled-helper reproduction returned []. | Preserve omitted/null versus [] versus explicit IDs. Reset only stale analytical selections deliberately and keep the editor/preview/save selection state consistent. | Add three-state round-trip tests plus saved-run transfer and definition-change cases. Risk: silently changing what an existing report includes. |
| F5 | P2 | Client/server lag budgets disagree for positive minimum lag. report-workspace.tsx:52 counts maximum+1; reports/router.py:47 counts unique zero plus the requested range. With 90 cross-dataset pairs and lag 5..12, UI counts 1,170 and blocks; server counts 810 and permits. | Share the exact lag-count formula in a small frontend helper; keep backend validation authoritative. | Test zero-only, disabled, nonzero minimum, cap boundaries and transferred runs. Do not raise the 1,000-test limit. |
| F6 | P2 | Report metric exclusion reasons are not exposed. correlation/catalog.py:25 returns eligible metrics, dates and freshness but no structured exclusions; :32 silently clears unreviewed native connector selections. report-workspace.tsx:204 offers only Review dataset metric selection when no metrics qualify. | Add safe code/label explanations for the first exclusion layer, date/coverage/freshness labels, and empty/one-source/no-pair states. Never bypass curated policy or default opt-outs. | Test missing policy/fixture, opt-out, no dates, mixed/unresolved currency, invalid logical values and unavailable datasets without leaking rows or private metadata. |
| F7 | P2 | A saved report cannot directly hand off to the central form. report-workspace.tsx:180-184 and :246 contain save/weekly/linked-decision actions, but no report-to-new-decision navigation. Browser checks found zero such links at all three widths. The central form can manually select a saved report. | Add one role-appropriate Use in decision or Open Decisions navigation action carrying report ID; add scoped query prefill in the central evidence hook. No insertion until central submit. | Browser-test report handoff, workspace switch, revoked report, permission denial, retry and zero inserts before submit. Risk: stale report IDs surviving a workspace switch. |
| F8 | P2 | Main Reports computes adjusted significance/evidence but does not display it explicitly. reports/service.py produces adjusted_p_value and bounded evidence; report-workspace.tsx:261 displays summary/reliability/n/lag but no adjusted p-value or aligned evidence plot. | Reuse a report-compatible presentation of the existing relationship evidence component; label standardized points and reporting/calendar lag correctly. | Test p-value 0/null/non-significant, lead direction, insufficient overlap, constant series, missing periods and units. Do not copy advanced shared-period lag language onto Reports calendar lag. |
| F9 | P2 | Weekly status terminology and retry guarantees need qualification. alerts/email_delivery.py:949 increments delivered_count after transport acceptance, and :963 calls it delivered. alerts/router.py:1984 checks last_sent_at before sending and commits after sending at :2020; this is not an atomic per-recipient send claim. | Clarify accepted/sent versus webhook-delivered wording without breaking old response fields. Review/implement durable claim and recipient retry strategy only within the approved weekly phase. | Existing partial-recipient tests pass; concurrent due calls and retry-only-unsent behavior need explicit tests. No live sends. Risk: duplicate or skipped recipient mail. |
| F10 | P2 product gap | Overview and domain dashboards remain source-first. dashboard/page.tsx loads selected source/period/join state and offers Cross-dataset review at :3206; dashboard-definitions.ts contains 14 templates, 13 with dataset basis. They do not lead with saved cross-source reviews, missing coverage and linked follow-up. | Add a shared authorized report-context/coverage section and reframe source views as supporting detail. Preserve saved dashboard selection, charts, mappings, exports and share preferences. | Route-by-route browser/role regression is required after implementation. No broad theme redesign or deletion. |
| F11 | P2 requirement distinction | Existing joins are not arbitrary keyed joins. joins.py:35 fixes normalization to monthly; build_joined_dataset at :408 groups each source and then merges period buckets. Entity matching separately does exact identity resolution. | Label period comparison, time-series correlation and entity matching distinctly. Preserve existing join behavior; obtain approval for a new keyed/cardinality-preview contract if actually required for the MVP. | Existing period joins must not be presented as verified 1:1/1:many/many:many row joins. A new key-join feature needs its own financial grain/cardinality tests. |
| F12 | P3 | Preview and save recalculate independently without a general user-visible recalculation notice. report-workspace.tsx:143 and reports/router.py:114 save by regenerating the report. | Show the preview/save distinction and generated timestamp; retain frozen snapshot versus live follow-up semantics. | Simulate source changes between preview and save; don't claim the saved result is the original preview object. |

Additional evidence-integrity review for the central creation phase: decisions/router.py:1227 stores supplied recommendation_context after text cleanup. Dataset IDs are authorized, but this is not server-side canonical verification of a claimed business report snapshot. Treat client-supplied context as narrative unless the approved implementation resolves/revalidates its report reference. This is a source-level trust-boundary observation, not a reproduced cross-tenant data leak.

No finding implies that existing source authorization, saved report persistence or calculation tests all fail. The baseline tests passed while these particular gaps remained uncovered or unasserted.

## 2. Working Capabilities to Reuse

| Capability | Current implementation | Preserve |
| --- | --- | --- |
| Cross-dataset report definition/preview/save | reports/schemas.py, reports/router.py:43, reports/service.py:109 | At least two dataset IDs; approved metrics/date/aggregation; 25 metrics; 1,000 pair-lag tests. |
| Catalog authorization | correlation/service.py authorization helpers and reports/router.py:79 | Verified user/workspace scope and source authorization. |
| Period movements and missing baselines | reports/service.py:109 | Missing observations remain unavailable; incomplete comparisons are withheld. |
| Cross-source relationships | correlation/engine.py plus reports/service.py | Pearson/Spearman, adjusted significance, existing limits and report-specific calendar alignment. |
| Saved report evidence | BusinessReport model and allowed_report/detail | Frozen analytical snapshot, current source authorization, live linked decision follow-up. |
| Central decision submission | decisions/new/page.tsx:718; decisions/router.py:1138 | One form-to-POST insertion path with evidence dataset authorization. |
| Weekly report computation | alerts/router.py:854 and shared build_report | Latest completed reporting week, separate historical relationship window and safe template behavior. |
| Existing period comparisons | datasets/router.py:3795, :4691; joins.py | Aggregate before merging period buckets, reject unsafe curated nonadditive measures, saved join preferences. |
| Deterministic entity matching | datasets/services/entity_resolution.py:155 | Explicit identity columns, preview, canonical groups and unmatched counts. |
| Advanced evidence presentation | relationships/relationship-detail.tsx | Numeric coefficient, adjusted p-value, observations, history and explicit standardized chart labeling. |
| Source diagnostics | dataset detail, single-dataset report, Insights, Forecasts | Existing valid analysis, selected metric provenance, opt-outs, raw contextual dimensions and formula components. |
| Branding/sharing | workspace-brand helpers and public dashboard renderer | Agency identity and existing token/scope boundary; no private catalog requests from a public page. |

No provider fields, default metrics, currency conversions, forecast algorithms, new statistical engines, causal inference or automated decision execution are proposed merely to consolidate the MVP.

## 3. Current Navigation and Intended Treatment

Actual sidebar source: apps/web/app/dashboard/dashboard-shell.tsx:131.

- Workspace: Dashboard, Dashboards, Decisions, Action Needed, and role-dependent Workspace Access.
- Analysis: Reports, Insights, Forecasts, Alerts.
- Data: Datasets, Entity Matching, Connections.
- Manage: Settings and Billing, subject to existing role visibility.
- Support: Help & Support.
- Saved monitor and advanced explorer routes are discoverable from Reports; Relationships is not currently a standalone sidebar item.

Proposed after approval: present Overview and Reports as the primary business-review story, retain source-detail/domain diagnostics and compatibility URLs, and keep Decisions as the only creation destination. Do not conflate removal of a creation button with removal of the ability to navigate to Decisions.

## 4. Route by Route Surface Matrix

The static inventory contains 31 actual page routes: 20 under /dashboard and 23 dashboard-like routes when platform admin, sharing and demo are included. The other eight public/auth/onboarding routes are recorded but unchanged. There is no separately named finance or operations page to invent.

Every route below was located in the current source. Static enumeration and source review are not equivalent to a completed authenticated browser/role matrix.

| Actual route | Source file | Treatment after approval | Verification boundary |
| --- | --- | --- | --- |
| / | apps/web/app/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /auth/redirect | apps/web/app/auth/redirect/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /dashboard | apps/web/app/dashboard/page.tsx | reframe: Lead with authorized cross-source status and saved reports; preserve current source views, preferences, joins, exports and sharing. | Full authenticated route not browser-verified; source inspected. |
| /dashboard/action-needed | apps/web/app/dashboard/action-needed/page.tsx | keep: Preserve follow-up queue; link decisions without a second creation location. | Source inspected; browser not verified this pass. |
| /dashboard/alerts | apps/web/app/dashboard/alerts/page.tsx | keep and qualify delivery: Retain latest-complete-week cross-source engine and template safety; clarify acceptance status and retry/concurrency limits. | Source inspected; weekly unit/API baseline passed; no live sends. |
| /dashboard/billing | apps/web/app/dashboard/billing/page.tsx | keep: Preserve entitlement/renewal controls; restore consistent v2 server enforcement rather than changing prices. | Source located; billing checkout/renewal not executed. |
| /dashboard/connections | apps/web/app/dashboard/connections/page.tsx | keep and repair permissions: Preserve client-managed connections; fix OAuth guard consistency with an explicit operation matrix. | Source/backend guard audit only; live provider authorization not attempted. |
| /dashboard/dashboards | apps/web/app/dashboard/dashboards/page.tsx | de-emphasize: Keep all 14 saved templates as source/decision supporting views; clarify context and preserve selection/preferences. | All 14 declarations and shared renderer inspected; not 14 independent browser flows. |
| /dashboard/datasets | apps/web/app/dashboard/datasets/page.tsx | keep: Preserve uploads, statuses and list; contextual Reports entry must respect catalog eligibility. | Source inspected; browser not verified this pass. |
| /dashboard/datasets/[id] | apps/web/app/dashboard/datasets/[id]/page.tsx | reframe: Keep schema, metrics, charts, selection provenance; explain eligibility and offer a verified pairing where available. | Source inspected; browser not verified this pass. |
| /dashboard/decisions | apps/web/app/dashboard/decisions/page.tsx | keep: Preserve sole creation destination and portfolio filters; retain linked reports and follow-up. | Source/CTA inventory; central form separately browser checked. |
| /dashboard/decisions/[id] | apps/web/app/dashboard/decisions/[id]/page.tsx | keep: Preserve evidence, lifecycle, owners, outcomes and limitations. | Source inspected; browser not verified this pass. |
| /dashboard/decisions/new | apps/web/app/dashboard/decisions/new/page.tsx | keep and repair handoff: Preserve central submit; add safe report query prefill and server outcome parity. | Synthetic current form browser baseline; no forms submitted. |
| /dashboard/entity-matching | apps/web/app/dashboard/entity-matching/page.tsx | keep: Retain exact identity matching, previews and canonical records; do not call it a general cardinality-safe SQL join. | Source and service inspected; browser not verified this pass. |
| /dashboard/forecasts | apps/web/app/dashboard/forecasts/page.tsx | reframe: Retain forecasts as supporting predictions with model/caveat labels; no causal or automatic decision claims. | Source inspected; browser not verified this pass. |
| /dashboard/help | apps/web/app/dashboard/help/page.tsx | align copy only: Update terminology after approved navigation changes; do not invent unsupported behavior. | Source inspected; browser not verified this pass. |
| /dashboard/insights | apps/web/app/dashboard/insights/page.tsx | reframe: Keep source diagnostics, multi-metric analysis and saved correlation insights; link qualified cross-source report context. | Source inspected; browser not verified this pass. |
| /dashboard/relationships | apps/web/app/dashboard/relationships/page.tsx | reframe: Label saved time-series monitors and temporal relationships distinctly from entity matching/keyed joins; retain bookmarks. | Source inspected; browser not verified this pass. |
| /dashboard/relationships/explorer | apps/web/app/dashboard/relationships/explorer/page.tsx | keep as advanced: Reuse existing advanced engine, evidence and report transfer; keep flags and limits. | Source inspected; no rollout changes or full route browser flow. |
| /dashboard/reports | apps/web/app/dashboard/reports/page.tsx | keep and align: Retain ReportWorkspace; fix tri-state findings, eligibility explanations, lag budget, evidence display and decision navigation. | Synthetic real-component browser baseline at 320/390/1440. |
| /dashboard/reports/dataset | apps/web/app/dashboard/reports/dataset/page.tsx | keep as source detail: Preserve single-dataset inspection compatibility route; add eligible cross-source entry only after catalog checks. | Wrapper and SingleDatasetReport inspected; browser not verified this pass. |
| /dashboard/settings | apps/web/app/dashboard/settings/page.tsx | keep: Preserve agency/client/access/branding/email-preference boundaries. | SettingsClient wrapper/import located; full settings interaction not verified this pass. |
| /demo | apps/web/app/demo/page.tsx | reframe sample presentation: Keep SharedDashboardPage demo mode and label synthetic data; do not imply private production cross-source access. | Wrapper/shared renderer inspected; full demo flow not verified this pass. |
| /onboarding | apps/web/app/onboarding/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /platform-admin | apps/web/app/platform-admin/page.tsx | keep: Operational surface, not a customer dashboard rewrite; keep tables/statuses and clarify delivery vocabulary where touched. | Source inventory; no admin session or changes. |
| /privacy | apps/web/app/privacy/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /security | apps/web/app/security/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /share/dashboard | apps/web/app/share/dashboard/page.tsx | keep and restrict: Reuse authorized public payload only; no private report catalog or cross-tenant aggregation. | Sharing renderer and public route declarations inspected; no public-share mutation. |
| /sign-in/[[...sign-in]] | apps/web/app/sign-in/[[...sign-in]]/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /sign-up/[[...sign-up]] | apps/web/app/sign-up/[[...sign-up]]/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |
| /terms | apps/web/app/terms/page.tsx | keep unchanged: No consolidation change proposed; preserve current behavior. | Statically enumerated; not functionally browser-tested in this pass. |

## 5. Every Existing Dashboard Template

All fourteen templates are definitions served through the existing root dashboard and dashboard chooser, not fourteen invented routes.

Source: apps/web/features/dashboards/dashboard-definitions.ts:45.
Shared renderer: apps/web/features/dashboards/dashboard-registry.tsx:4358.
The generalBusiness registry entry delegates to the root page rather than rendering its own standalone implementation.

| Saved key | Current name | Basis | Proposed treatment |
| --- | --- | --- | --- |
| general-business | General Business Overview | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| marketing-performance | Marketing Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| sales-performance | Sales Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| decision-performance | Decision Performance | decision-records | Keep decision portfolio/outcome context; link report evidence, no causal claims. |
| retail-performance | Retail Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| restaurant-performance | Restaurant Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| hotels-hospitality-performance | Hotels & Hospitality Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| professional-services | Professional Services | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| healthcare-practice | Healthcare Practice | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| real-estate | Real Estate | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| nonprofit-performance | Nonprofit Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| construction-performance | Construction Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| law-firm-performance | Law Firm Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |
| auto-repair-shop-performance | Auto Repair Shop Performance | dataset | Keep valid source charts/mappings/preferences; add common cross-source context only from authorized eligible data and reframe as supporting source detail. |

No template deletion is proposed. No private cross-source report or unshared dataset may be injected into the public shared-dashboard renderer. The demo may use clearly labelled synthetic context; that is not permission to expose private workspace evidence.

## 6. Component and API Map

### Shared and Dashboard Components

- DashboardShell: responsive navigation, active workspace, role visibility and mobile drawer.
- DashboardPageHeader and WorkspaceAccessNotice: existing titles/actions and access/loading states.
- Dashboard registry: marketing/sales/industry views and decision-performance rendering.
- DatasetJoinPanel: existing period-aligned comparisons and saved result controls.
- ReportWorkspace and MetricTrends: authoritative current business-review editor and report presentation.
- SingleDatasetReport: compatibility source inspection, not the main product promise.
- CorrelationExplorer, RelationshipEvidence, RelationshipMatrix and correlation widgets: existing advanced analysis/discovery.
- DecisionReportEvidence: existing report picker, warning display and outcome selection in the central form.
- MetricSelector, MetricCard, MetricTrendChart, ForecastChart, InsightCard, RecommendationCard and MultiMetricAnalysisPanel: existing supporting widgets.

The machine-readable [surface inventory](MVP_CONSOLIDATION_V2_SURFACE_AUDIT.json) records actual imports, JSX components, call-name candidates, links and source locations per route. Call-name candidates include local helpers and are not a complete runtime network call graph. Wrapper pages delegate to the listed imported feature components.

### Actual Endpoints

| Workflow | Existing endpoints |
| --- | --- |
| Reports | GET /api/v2/business-reports/catalog; POST /api/v2/business-reports/preview; POST and GET /api/v2/business-reports; GET /api/v2/business-reports/{report_id}. |
| Transfer and evidence | GET /api/v2/business-reports/from-run/{run_id}; POST /api/v2/business-reports/{report_id}/decision-evidence. |
| Weekly | POST /api/v2/business-reports/{report_id}/weekly; GET /api/v2/business-reports/weekly-preview; existing /alerts/weekly-report preference/digest/send-test/send/send-due routes. |
| Central creation and outcome | POST /decisions/; GET /decisions/{decision_id}; GET /decisions/{decision_id}/outcome-analysis; POST /decisions/{decision_id}/outcome/measure. |
| Period comparison | GET /datasets/join/metadata; POST /datasets/join; GET and DELETE /datasets/join/cache. |
| Legacy statistical monitors | POST /datasets/relationships/preview; GET/POST /datasets/relationships; DELETE /datasets/relationships/{relationship_id}. |
| Advanced correlation | /api/v2/correlation-capabilities, correlation-analyses, correlation-runs, correlation-results, correlation-insights, correlation-widgets. Existing run, matrix, evidence and cancel routes remain authoritative. |
| Entity matching | GET /datasets/entity-matching/metadata; POST /datasets/entity-matching/preview; POST /datasets/entity-matching/run. |
| Forecast | GET /forecasting/{dataset_id}. |
| Public and sample | GET /public/dashboard/{dataset_id}; GET /public/demo. |

Full HTTP method/path/handler/line declarations remain in [Technical Inventory](CHATGPT_PROJECT_TECHNICAL_INVENTORY.json). A declaration is not proof of live availability or permission for a caller.

## 7. Decision CTA and Insertion Audit

| Location | Current result |
| --- | --- |
| /dashboard/decisions, page.tsx:1420 | Authorized CreateDecisionLink into the central form; required exception. |
| /dashboard/decisions/new, page.tsx:1194 | Central CreateDecisionButton submit; required exception. |
| /dashboard/decisions/new, page.tsx:718 | The one actual frontend createDecision invocation found in application source. |
| apps/web/lib/api.ts:7215 | API helper definition, not a second visible creation location. |
| decisions/router.py:1210 and :1264 | Central backend constructor and insertion. Keep backend API; navigation cleanup must not remove it. |
| Report/correlation evidence endpoints | Prepare payloads, not Decision rows. Preserve that boundary. |
| All other inspected page/feature source | No scattered live Create decision controls found. Remaining text/helper definitions/tests are not equivalent to rendered entry points. |
| Saved report UI | Missing navigation-only handoff to central creation; add a scoped link, not an embedded form or insertion. |

The existing centralization requirement is already largely satisfied. PR 1 should not spend time deleting functionality based on a stale assumption that those buttons still exist everywhere.

## 8. Role Matrix for Approval

This table summarizes current code-level operation boundaries, not a completed live-account test matrix.

| Role | Source data setup | Save report | Create decision | OAuth start/cancel/Sage refresh now | Proposed OAuth direction |
| --- | --- | --- | --- | --- | --- |
| owner | Yes in verified owner workspace | Yes | Yes | Yes | Preserve verified workspace ownership. |
| member | No | Yes for authorized sources | Yes | No | Remain denied. |
| client_owner | Yes in client workspace | Yes | No | No | Permit scoped client credential management after matrix approval. |
| client_user | Yes under existing client data-manager rule | Yes | No | No | Follow the explicitly approved client operation policy; do not silently invent a different role model. |
| managed_client | No direct client data setup under current helper | Yes for approved workspace access | Yes | No | Remain denied for credential management unless separately authorized. |
| unauthorized/unknown | No | No | No | No | Remain denied. |

Weekly alert management has its own owner/client/managed_client allowance; saving a report as a weekly template currently uses the data-manager guard. Do not flatten all roles into one canEdit boolean or silently change client-approved agency access.

Source reauthorization on saved report reads and workspace-switch state reset must survive all UX changes.

## 9. Proposed Small Reversible Phases

No commits or pushes are authorized by these phase names.

### PR 0 Audit Checkpoint

Completed: source inventory, CTA/insertion search, existing engine/API map, targeted baseline, three reproductions and synthetic component screenshots.

Remaining audit limitation: full authenticated rendering of every route/template and the real role/device matrix. The existing local Next previews redirected to authentication and the attempted authenticated-route navigation timed out. No account cookies or credentials were used.

### PR 1 Navigation and Central Handoff

- Promote the cross-source review workflow in the existing shell without breaking URLs.
- Keep source/domain templates and saved choices; label their supporting purpose.
- Add a navigation-only saved-report handoff into the central Decisions form.
- Preserve permitted central Create controls; no other page inserts records.
- Test role visibility, query validation and workspace switches.

### PR 2 Reports and Shared State

- Fix null/default/empty finding semantics and exact lag budget parity.
- Add safe structured catalog exclusions, freshness/timezone/coverage labels and empty states.
- Use the current build_report/catalog path, with unchanged metric/aggregation/currency/grain gates.
- State that saving recalculates and that the saved analytical payload is frozen.

### PR 3 Cross Source Dashboard Context and Evidence

- Add small reusable source/coverage/period/relationship/follow-up presentation.
- Make the Overview lead with authorized saved reports, usable source status, gaps and decisions needing review.
- Apply a shared, evidence-backed context section to each existing source template where supported.
- Keep single-source predictions/insights explicitly supporting, retain valid features and avoid new statistical engines.
- Show adjusted significance and clearly labelled aligned relationship evidence.
- Recommendations cite actual observed periods/measures and remain suggested investigations, not generated/auto-executed decisions.

### PR 4 Comparison and Matching Terminology

- Preserve current period comparison, monitors and exact entity matching.
- Explain join grain, date normalization and missing overlap using existing contracts.
- Do not claim arbitrary keyed joins or cardinality previews exist.
- A new general keyed-join capability remains an explicit separate approval decision if needed, because it is new contract work rather than a cosmetic consolidation.

### PR 5 Outcome and Security Parity

- Enforce usable finite outcome metric validation server-side, preserving valid zeros.
- Review canonical report evidence on central submission without breaking manual decisions.
- Fix the narrowly approved client OAuth operation matrix.
- Restore v2 billing/request-budget parity with actual middleware tests.
- Verify owner/member/client/managed-client and cross-tenant/source-revocation cases.

Security regressions can be prioritized ahead of cosmetic work after approval; they should not wait for a broad visual transformation to finish.

### PR 6 Weekly Alignment

- Keep latest-complete-week cross-source calculations and template disabled/recipient preservation.
- Clarify transport acceptance versus delivery and preserve backward-compatible response fields where needed.
- Add explicit concurrency and partial-recipient retry tests before promising exactly-once sends.
- No production sends or marketing/provider flag changes.

### PR 7 Acceptance and Release Gate

- Test two clearly labelled synthetic datasets with at least three approved metrics.
- Exercise current/prior comparisons, relationships/caveats, save, central prefill, no insertion before submit, central creation, and follow-up.
- Check all route/template entries in the inventory individually after changes.
- Test narrow/wide viewports, keyboard navigation, source access revocation, workspace switches and explicit roles.
- Run PostgreSQL integration when available; report skips precisely.
- Commit/push/deployment remain separate explicit authorization steps. No migration or production rollout just to complete the audit.

## 10. Baseline and Reproductions

### API Baseline

From apps/api:

~~~bash
PYTHONDONTWRITEBYTECODE=1 APP_ENV=development DATABASE_URL=sqlite:///:memory: \
  .venv/bin/python -B -m unittest \
  tests.test_business_reports tests.test_multi_metric_correlation \
  tests.test_metric_selection tests.test_connector_row_schema \
  tests.test_weekly_report_preferences
~~~

Result: 127 tests passed, 63.236 seconds in the completed run.

The initial restricted-sandbox run stalled at in-process HTTP tests and was interrupted. The completed rerun used the same isolated in-memory database configuration outside that sandbox restriction. Expected failure-path log messages and missing platform email settings warnings appeared in isolated fixtures; the suite result was OK. No live mail was sent.

This is not a full API suite or PostgreSQL integration result.

### Web Baseline

From apps/web:

~~~bash
npm test
~~~

Result: 22 test files passed, zero failed or skipped in the runner summary. These tests include source/SSR/helper checks; passing them is not a substitute for the full browser/device matrix.

### Focused Reproductions

- Transpiled editableDefinition({included_findings: null}) returned [].
- The positive-minimum lag example counted 1,170 client tests versus 810 actual server tests for 90 pairs and lag 5..12.
- A real in-process report route accepted a null-valued third-source outcome with HTTP 200 while the report remained ready from two other usable sources.

The outcome reproduction used isolated synthetic rows and the real report router. It did not call the central Decision insertion endpoint.

### Browser Baseline

Current real ReportWorkspace and central Decisions components were bundled with mocked identity/navigation and real report routes backed by an in-memory synthetic database.

Checked 320, 390 and 1440 pixel widths:

- Reports Explore and saved-report view render.
- Saved report selection loads in the central form.
- No page errors recorded.
- No horizontal page overflow recorded in these surfaces.
- Zero POST requests made by the screenshot script.
- Zero report-to-central-new-decision links found, confirming F7.

Screenshot folder: /tmp/decisionate-mvp-audit.
The temporary fixture server is stopped after the audit.

Screenshots:

- [Saved report at 1440](/tmp/decisionate-mvp-audit/report-1440.png)
- [Explore at 320](/tmp/decisionate-mvp-audit/explore-320.png)
- [Central form at 390](/tmp/decisionate-mvp-audit/decision-390.png)

The screenshot paths are local temporary evidence and may not survive a machine/session reset. This does not certify full-app authentication, every dashboard/template, real role accounts, keyboard/contrast completion, physical Android Chrome or production.

## 11. State and Limits

Application source edited: no.
Audit artifacts created: this review and MVP_CONSOLIDATION_V2_SURFACE_AUDIT.json.
Existing databases/WAL/SHM/bytecode/untracked sample work intentionally excluded.
New tests committed: no.
Commit: no.
Push: no.
Deployment: no.
Production verification: no.
Provider/marketing/correlation/AI flags changed: no.
Production email sent: no.
Database migration: no.

Source policy gates remain unchanged. Planned connector registration, implemented adapter, eligible semantic metric, actual stored values and deployed live behavior are explicitly different statuses.

No causal inference, automatic execution, general no-code ETL, universal connector work, arbitrary SQL eligibility bypass, inferred cross-provider ROAS or broad rewrite is included in the minimal plan.

## 12. Approval Requested

Approve the audit and the staged implementation scope before PR 1, as required by the supplied specification.

Recommended scope: preserve all working routes/templates/preferences, implement the confirmed parity defects and shared cross-source context, and keep arbitrary keyed joins/new unsupported contracts deferred pending a specific need and approval.

No deletion, commit, push, migration, live send or production rollout is included in that approval unless explicitly requested.
