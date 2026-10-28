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
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name) })
  return loaded.exports
}
const state = load("../features/reports/impact-builder-state.ts")
const reference = (dataset_id, metric_key = "orders") => ({ dataset_id, metric_key, date_column: "date", aggregation: "sum" })
const outcome = reference(1), comparison = reference(2), extra = reference(3, "visits")
const definition = {
  name: "Staffing review", business_question: "Did adding staff help orders?", grain: "weekly", metrics: [outcome, comparison],
  date_range: { start: "2023-01-02", end: "2025-12-28" }, dimension_filters: [], seasonal_business: false,
  impact: { decision_id: 7, change: "Added one employee", change_date: "2025-02-10", outcome, comparison,
    comparison_reason: "Store B did not change its staffing.", comparison_unaffected: true, other_changes: "none_known", desired_direction: "increase", worthwhile_change: null },
}
const datasets = [1, 2, 3].map(dataset_id => ({ dataset_id, dataset_label: `Store ${dataset_id}`, connector: "csv",
  metrics: [{ metric_key: "orders", label: "Orders", aggregation: "sum" }, { metric_key: "visits", label: "Visits", aggregation: "sum" }],
  date_columns: ["date"], availability: { date: definition.date_range } }))
const imports = { "./report-metric-picker": { reportDateColumn: source => source.date_columns[0] || "" } }
const { ImpactBuilder } = load("../features/reports/impact-builder.tsx", {
  "./impact-builder-state": state, "./impact-setup": load("../features/reports/impact-setup.tsx", imports), ...imports,
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: () => React.createElement("span", null, "Dimension filter") },
})
const render = patch => renderToStaticMarkup(React.createElement(ImpactBuilder, {
  definition, datasets, userId: "owner", workspaceId: "owner", weekly: false, weeklySettings: null, decisionPicker: React.createElement("select", { "aria-label": "Decision to review" }),
  reportDetails: React.createElement("input", { "aria-label": "Report name" }), actions: React.createElement("button", { type: "submit" }, "Check this decision"),
  onChange() {}, onStudyChange() {}, onRetry() {}, onRetryDataset() {}, loading: false, catalogError: false, ...patch,
}))

test("changing a comparison selects its approved reference once and preserves the outcome and deliberate extra metrics", () => {
  const original = structuredClone({ ...definition, metrics: [outcome, comparison, extra] })
  const result = state.changeImpactComparison(original, reference(4))
  assert.deepEqual(Array.from(result.metrics, metric => metric.dataset_id), [1, 3, 4])
  assert.equal(result.impact.comparison.dataset_id, 4)
  assert.equal(result.impact.comparison_unaffected, false)
  assert.equal(result.impact.comparison_reason, "")
  assert.equal(original.impact.comparison_unaffected, true)
  assert.equal(original.impact.comparison_reason, definition.impact.comparison_reason)
  assert.equal(original.metrics.length, 3)
  assert.equal(state.changeImpactComparison(original, outcome).metrics, undefined)
  const removed = state.changeImpactComparison(original, null)
  assert.equal(removed.impact.comparison, null)
  assert.deepEqual(Array.from(removed.metrics, metric => metric.dataset_id), [1, 3])
  assert.equal(state.changeImpactComparison(original, extra).metrics.length, 2)
  assert.equal(state.changeImpactComparison(original, comparison).impact.comparison_reason, original.impact.comparison_reason)
})

test("setup states name the next missing choice rather than only disabling the action", () => {
  assert.equal(state.impactSetupIssue(definition, datasets), "")
  for (const [patch, phrase] of [
    [{ decision_id: null }, "Choose the decision"], [{ change: "" }, "what you changed"], [{ outcome: null }, "result to measure"],
    [{ change_date: "" }, "date you started"], [{ comparison: null }, "comparison dataset"], [{ comparison_reason: "short" }, "short explanation"],
  ]) assert.ok(state.impactSetupIssue({ ...definition, impact: { ...definition.impact, ...patch } }).includes(phrase))
  assert.match(state.impactSetupIssue({ ...definition, date_range: { start: "2025-03-01", end: "2025-04-01" } }), /before and after/)
  assert.match(state.impactSetupIssue({ ...definition, dimension_filters: [{ dataset_id: 1, column: "region", values: [] }] }), /at least one value/)
  assert.match(state.impactSetupIssue({ ...definition, business_question: "" }), /Report details/)
})

test("unconfirmed context remains truthful and unavailable source policies cannot become ready", () => {
  assert.equal(state.impactSetupIssue({ ...definition, impact: { ...definition.impact, comparison_unaffected: false, other_changes: "not_sure" } }), "")
  assert.match(state.impactSetupIssue(definition, [{ ...datasets[0], catalog_status: "pending" }, datasets[1]]), /Waiting/)
  assert.match(state.impactSetupIssue(definition, [datasets[0], { ...datasets[1], error_code: "dataset_unavailable" }]), /unavailable/)
  assert.match(state.impactSetupIssue(definition, [datasets[0], { ...datasets[1], metrics: [] }]), /unavailable/)
  assert.match(state.impactSetupIssue(definition, [datasets[0], { ...datasets[1], availability: {} }]), /unavailable/)
})

test("the impact builder presents three questions, direct comparison selectors and optional details without a nested scrolling sidebar", () => {
  const html = render()
  assert.match(html, /1\. Which decision are you checking/)
  assert.match(html, /2\. What can we fairly compare it with/)
  assert.match(html, /3\. Which dates should we check/)
  assert.match(html, /Comparison dataset/)
  assert.match(html, /Result to compare/)
  assert.match(html, /52 full weeks before the change and 8 weeks after/)
  assert.match(html, /<summary[^>]*>Date columns and filters/)
  assert.match(html, /<summary[^>]*>Report details/)
  assert.match(html, /<summary[^>]*>Business target \(optional\)/)
  assert.doesNotMatch(html, /report-builder-scroll|Maximum lag|Minimum historical observations|Select metrics/)
})

test("the first view starts with one decision choice and does not ask for a comparison prematurely", () => {
  const html = render({ definition: { ...definition, metrics: [], impact: { ...definition.impact, decision_id: null, comparison: null, outcome: null } } })
  assert.match(html, /Which decision are you checking/)
  assert.doesNotMatch(html, /Comparison dataset|History starts|Other selected results/)
  assert.match(html, /Choose the decision you want to check/)
})

test("weekly impact setup keeps automatic weekly history and never exposes manual email dates or grouping", () => {
  const html = render({ weekly: true, weeklySettings: { window: { start: "2025-12-22", end: "2025-12-28" }, history_window: { start: "2022-12-29", end: "2025-12-21" } } })
  assert.match(html, /Report week: 2025-12-22 to 2025-12-28/)
  assert.match(html, /compared week by week/)
  assert.doesNotMatch(html, /History starts|History ends|Compare results by/)
})
