import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(path, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, Intl, require: name => imports[name] || require(name) })
  return loaded.exports
}
const impact = load("../features/reports/impact-types.ts")
const types = load("../features/reports/types.ts", { "./pair-directions": load("../features/reports/pair-directions.ts"),
  "@/features/relationships/defaults": load("../features/relationships/defaults.ts") })
const { decisionReviewDefinition } = load("../features/reports/decision-review.ts", { "./impact-types": impact, "./types": types })
const context = { decision: { id: 7, title: "Improve staffing", action: "Add one employee to the store", created_at: "2025-01-01" },
  outcome: { dataset_id: 1, metric_key: "orders" }, decision_revision: "current-revision", latest_review: null }
const source = { dataset_id: 1, dataset_label: "Store A", date_columns: ["sale_date"],
  metrics: [{ metric_key: "orders", aggregation: "sum" }], availability: { sale_date: { start: "2023-01-01", end: "2026-10-25" } } }

test("review setup reuses the existing decision without treating its creation date as the action date", () => {
  const value = decisionReviewDefinition(types.editableDefinition({ name: "New report" }), context, source)
  assert.equal(value.impact.decision_id, 7)
  assert.equal(value.impact.change, context.decision.action)
  assert.equal(value.impact.change_date, "")
  assert.equal(value.impact.decision_revision, "current-revision")
  assert.equal(value.metrics[0].metric_key, "orders")
  assert.equal(value.metrics[0].date_column, "sale_date")
  assert.equal(value.impact.comparison, null)
  assert.equal(value.impact.comparison_unaffected, false)
  assert.equal(value.impact.other_changes, "not_sure")
  assert.equal(value.date_range.start, "2023-01-01")
})

test("later reviews reuse confirmed action dates and study choices but recheck the comparison and extend available history", () => {
  const previous = decisionReviewDefinition(types.editableDefinition({ name: "Earlier report" }), context, source)
  previous.impact.change_date = "2025-04-01"
  previous.impact.comparison_unaffected = true
  previous.date_range.end = "2025-12-31"
  const value = decisionReviewDefinition(types.editableDefinition({ name: "Next report" }), { ...context,
    latest_review: { matches_current_decision: true, definition: previous } }, source)
  assert.equal(value.impact.change_date, "2025-04-01")
  assert.equal(value.impact.comparison_unaffected, false)
  assert.equal(value.date_range.end, "2026-10-25")
  assert.equal(value.name, "Next report")
  const stale = decisionReviewDefinition(types.editableDefinition({ name: "New review" }), { ...context,
    latest_review: { matches_current_decision: false, definition: previous } }, source)
  assert.equal(stale.impact.change_date, "")
})

test("missing outcomes are not replaced by a guessed metric", () => {
  const value = decisionReviewDefinition(types.editableDefinition({}), { ...context, outcome: null })
  assert.equal(value.impact.outcome, null)
  assert.equal(value.metrics.length, 0)
  assert.equal(impact.impactReady(value.impact, value.metrics), false)
})

test("a new review prefers a usable date field rather than an empty date column", () => {
  const value = decisionReviewDefinition(types.editableDefinition({}), context,
    { ...source, date_columns: ["empty_date", "sale_date"] })
  assert.equal(value.metrics[0].date_column, "sale_date")
  assert.equal(value.date_range.start, "2023-01-01")
})

test("choosing a decision does not carry unrelated correlation metrics into a new impact study", () => {
  const existing = types.editableDefinition({ metrics: [{ dataset_id: 3, metric_key: "visits", aggregation: "sum", date_column: "date" }] })
  const result = decisionReviewDefinition(existing, context, source)
  assert.equal(result.metrics.length, 1)
  assert.equal(result.metrics[0].metric_key, "orders")
  assert.equal(existing.metrics[0].metric_key, "visits")
})

test("impact reports link back to the same decision instead of exposing another decision draft", () => {
  const scopes = load("../features/decisions/lib/report-metric-scope.ts")
  const titles = load("../features/decisions/lib/decision-title.ts")
  const { ReportDecisions } = load("../features/reports/report-evidence-sections.tsx", {
    "@/features/decisions/lib/report-metric-scope": scopes, "@/features/decisions/lib/decision-title": titles,
  })
  const html = renderToStaticMarkup(React.createElement(ReportDecisions, { report: {
    definition: { impact: { decision_id: 7 } }, review_decision: { id: 7, title: "Improve staffing", action: context.decision.action },
    decision_review_id: "assessment-1", decisions: [], decision_drafts: [],
  }, onOpenDraft: () => { throw new Error("Never create a decision") } }))
  assert.match(html, /Decision under review|Improve staffing/)
  assert.match(html, /\/dashboard\/decisions\/7#business-impact-review/)
  assert.match(html, /Assessment attached/)
  assert.doesNotMatch(html, /Decision draft|Create decision/)
})

test("decision detail and the report builder share the linked review entry and explicit assessment save", () => {
  const page = readFileSync(new URL("../app/dashboard/decisions/[id]/page.tsx", import.meta.url), "utf8")
  const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(page, /<DecisionImpactReviews/)
  assert.match(page, /Compare before and after/)
  assert.match(workspace, /Save assessment to decision/)
  assert.match(workspace, /params.get\("decision"\)/)
  assert.match(workspace, /<ImpactDecisionPicker/)
})
