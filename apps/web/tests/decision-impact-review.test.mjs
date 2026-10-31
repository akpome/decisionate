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
const state = load("../features/reports/impact-builder-state.ts")
const { decisionReviewDefinition, decisionReviewDetails, automaticImpactDefinition } = load("../features/reports/decision-review.ts", { "./impact-types": impact, "./types": types, "./impact-builder-state": state })
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
  assert.equal(value.name, "Business impact: Improve staffing (#7)")
  assert.equal(value.business_question, 'Did the action in "Improve staffing" improve its recorded outcome?')
})

test("later reviews preserve their recorded period and study choices while rechecking the comparison", () => {
  const previous = decisionReviewDefinition(types.editableDefinition({ name: "Earlier report" }), context, source)
  previous.impact.change_date = "2025-04-01"
  previous.impact.comparison_unaffected = true
  previous.date_range.end = "2025-12-31"
  const value = decisionReviewDefinition(types.editableDefinition({ name: "Next report" }), { ...context,
    latest_review: { matches_current_decision: true, definition: previous } }, source)
  assert.equal(value.impact.change_date, "2025-04-01")
  assert.equal(value.impact.comparison_unaffected, false)
  assert.equal(value.date_range.end, "2025-12-31")
  assert.equal(value.name, "Business impact: Improve staffing (#7)")
  const stale = decisionReviewDefinition(types.editableDefinition({ name: "New review" }), { ...context,
    latest_review: { matches_current_decision: false, definition: previous } }, source)
  assert.equal(stale.impact.change_date, "")
})

test("impact titles and questions always follow the chosen decision, not an unrelated or earlier report", () => {
  const current = types.editableDefinition({ name: "Other report", business_question: "Is ad spending related to orders?" })
  const before = JSON.stringify(current)
  const first = decisionReviewDefinition(current, context, source)
  const next = decisionReviewDefinition(first, { ...context, decision: { ...context.decision, id: 8, title: "Reduce returns" } }, source)
  assert.equal(next.name, "Business impact: Reduce returns (#8)")
  assert.equal(next.business_question, 'Did the action in "Reduce returns" improve its recorded outcome?')
  assert.equal(JSON.stringify(current), before)
  const previous = { ...first, name: "Old saved name", business_question: "Old custom question" }
  const savedBefore = JSON.stringify(previous)
  const renamed = decisionReviewDefinition(current, { ...context, decision: { ...context.decision, title: "Staff the evening shift" },
    latest_review: { matches_current_decision: true, definition: previous } }, source)
  assert.equal(renamed.name, "Business impact: Staff the evening shift (#7)")
  assert.match(renamed.business_question, /Staff the evening shift/)
  assert.equal(JSON.stringify(previous), savedBefore)
})

test("derived report metadata fits API limits and distinguishes decisions with identical names", () => {
  for (const title of ["", "   ", "A", "A".repeat(2000), "Same decision name"]) {
    const first = decisionReviewDetails({ id: 7, title })
    const second = decisionReviewDetails({ id: 8, title })
    assert.ok(first.name.length > 0 && first.name.length <= 120)
    assert.ok(first.business_question.length >= 8 && first.business_question.length <= 1000)
    assert.match(first.name, /\(#7\)$/)
    assert.notEqual(first.name, second.name)
  }
  assert.match(decisionReviewDetails({ id: 7, title: "   " }).name, /Untitled decision/)
})

test("the default period and outcome date column come from decision evidence rather than comparison availability or creation time", () => {
  const period = { start: "2024-01-01", end: "2025-12-31" }
  const value = decisionReviewDefinition(types.editableDefinition({ date_range: { start: "2000-01-01", end: "2000-12-31" } }),
    { ...context, decision_period: period, outcome_date_column: "paid_date" }, { ...source, date_columns: ["sale_date", "paid_date"], availability: { ...source.availability, paid_date: source.availability.sale_date } })
  assert.deepEqual(JSON.parse(JSON.stringify(value.date_range)), period)
  assert.notEqual(value.date_range, period)
  assert.equal(value.metrics[0].date_column, "paid_date")
  assert.equal(value.impact.change_date, "")
  const missing = decisionReviewDefinition(types.editableDefinition({ date_range: period }), context, { ...source, availability: {} })
  assert.deepEqual(JSON.parse(JSON.stringify(missing.date_range)), { start: "", end: "" })
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
  const calculate = workspace.slice(workspace.indexOf("async function calculate()"), workspace.indexOf("async function saveSnapshot()"))
  assert.match(calculate, /if \(!weekly && payload.impact\?\.decision_id\)/)
  assert.match(calculate, /\/review-decisions\/\$\{payload.impact.decision_id\}/)
  assert.match(calculate, /Object.assign\(payload, automaticImpactDefinition\(payload, context, datasets\), decisionReviewDetails\(context.decision\)\)/)
  assert.doesNotMatch(calculate, /saveSnapshot\(|\/save|\/decisions\/from-report/)
  assert.doesNotMatch(workspace, /reportDetails=|Check this decision|Checking decision/)
})

const comparison = { ...source, dataset_id: 2, availability: { sale_date: { start: "2023-03-01", end: "2026-09-30" } } }
const assessment = () => {
  const value = decisionReviewDefinition(types.editableDefinition({}), context, source)
  return { ...value, metrics: [...value.metrics, { ...value.metrics[0], dataset_id: 2 }],
    date_range: { start: "2025-01-01", end: "2025-12-31" },
    impact: { ...value.impact, change_date: "2025-02-01", comparison: { dataset_id: 2, metric_key: "orders" }, comparison_reason: "An unchanged store", comparison_unaffected: true } }
}
const automaticContext = { ...context, decision_period: { start: "2024-01-01", end: "2024-12-31" }, decision_grain: "weekly", available_through: "2026-10-30" }

test("new calculations use source history and grouping and extend through the latest shared data without changing snapshots or timing", () => {
  const saved = assessment(), before = JSON.stringify(saved)
  const value = automaticImpactDefinition(saved, automaticContext, [source, comparison])
  assert.deepEqual(JSON.parse(JSON.stringify(value.date_range)), { start: "2024-01-01", end: "2026-09-30" })
  assert.equal(value.grain, "weekly")
  assert.equal(value.impact, saved.impact)
  assert.equal(value.metrics, saved.metrics)
  assert.equal(JSON.stringify(saved), before)
  assert.equal(state.impactSetupIssue(value, [source, comparison]), "")
})

test("automatic history is capped by the server's completed-day cutoff, not future source dates", () => {
  const value = automaticImpactDefinition(assessment(), { ...automaticContext, available_through: "2026-08-20" }, [source, comparison])
  assert.equal(value.date_range.end, "2026-08-20")
  assert.equal(value.impact.change_date, "2025-02-01")
})

test("extending an old source period cannot exceed the API's ten-year history limit", () => {
  const sources = [source, comparison].map(dataset => ({ ...dataset, availability: { sale_date: { start: "2000-01-01", end: "2026-10-30" } } }))
  const value = automaticImpactDefinition(assessment(), { ...automaticContext, decision_period: { start: "2000-01-01", end: "2005-12-31" } }, sources)
  assert.equal(value.date_range.end, "2026-10-30")
  assert.equal((Date.parse(value.date_range.end) - Date.parse(value.date_range.start)) / 86400000, 3653)
  assert.equal(value.impact.change_date, "2025-02-01")
})

test("comparison and date-column changes align both series but do not permanently discard the original history start", () => {
  const later = { ...comparison, availability: { sale_date: { start: "2024-06-01", end: "2026-01-31" }, paid_date: { start: "2024-09-01", end: "2026-02-28" } } }
  const first = automaticImpactDefinition(assessment(), automaticContext, [source, later])
  assert.equal(first.date_range.start, "2024-06-01")
  assert.equal(first.date_range.end, "2026-01-31")
  const paid = automaticImpactDefinition({ ...first, metrics: first.metrics.map(metric => metric.dataset_id === 2 ? { ...metric, date_column: "paid_date" } : metric) }, automaticContext, [source, later])
  assert.equal(paid.date_range.start, "2024-09-01")
  assert.equal(paid.date_range.end, "2026-02-28")
  const restored = automaticImpactDefinition(first, automaticContext, [source, comparison])
  assert.equal(restored.date_range.start, "2024-01-01")
})

test("missing data and missing before or after history cannot be bypassed by automatic dates", () => {
  const saved = assessment()
  const pending = automaticImpactDefinition(saved, automaticContext, [source])
  assert.equal(pending.date_range.end, "")
  assert.match(state.impactSetupIssue(pending, [source]), /Waiting/)
  for (const [range, message] of [
    [{ start: "2020-01-01", end: "2020-12-31" }, /no overlapping dates/],
    [{ start: "2025-06-01", end: "2026-01-31" }, /history before/],
    [{ start: "2023-03-01", end: "2025-01-31" }, /No matching results.*after/],
  ]) {
    const sources = [source, { ...comparison, availability: { sale_date: range } }]
    assert.match(state.impactSetupIssue(automaticImpactDefinition(saved, automaticContext, sources), sources), message)
  }
})

test("automatic grouping does not inherit unrelated controls or reinterpret source lag units", () => {
  const saved = { ...assessment(), grain: "monthly", impact: { ...assessment().impact, timing_evidence: { grain: "quarterly", lag: 1 } } }
  assert.equal(automaticImpactDefinition(saved, context, [source, comparison]).grain, "daily")
  const quarterly = automaticImpactDefinition(saved, { ...automaticContext, decision_grain: "quarterly" }, [source, comparison])
  assert.equal(quarterly.grain, "weekly")
  assert.equal(quarterly.impact.timing_evidence.grain, "quarterly")
  assert.equal(quarterly.impact.timing_evidence.lag, 1)
  assert.equal(automaticImpactDefinition(saved, { ...context, decision: { ...context.decision, id: 9 } }, [source, comparison]), saved)
})
