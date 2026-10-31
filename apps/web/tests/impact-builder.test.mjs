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
const picker = load("../features/reports/report-metric-picker.tsx", {
  "@/app/use-decisionate-language": {}, "@/features/relationships/types": {},
  "@/features/datasets/components/dimension-filter": {}, "@/components/searchable-select": {},
})
const imports = { "./report-metric-picker": picker,
  "./impact-timing": load("../features/reports/impact-timing.tsx") }
const dimensionProps = new Map()
const { ImpactBuilder } = load("../features/reports/impact-builder.tsx", {
  "./impact-builder-state": state, "./impact-setup": load("../features/reports/impact-setup.tsx", imports), ...imports,
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: props => {
    dimensionProps.set(props.datasetId, props)
    return React.createElement("span", null, "Dimension filter")
  }, dimensionFilterLabel: filter => `${filter.column}: ${filter.values.join(", ")}` },
})
const render = patch => {
  dimensionProps.clear()
  return renderToStaticMarkup(React.createElement(ImpactBuilder, {
    definition, datasets, userId: "owner", workspaceId: "owner", weekly: false, weeklySettings: null, decisionPicker: React.createElement("select", { "aria-label": "Decision to review" }),
    reportDetails: React.createElement("input", { "aria-label": "Report name" }), actions: React.createElement("button", { type: "submit" }, "Check this decision"),
    onChange() {}, onStudyChange() {}, onRetry() {}, onRetryDataset() {}, loading: false, catalogError: false, ...patch,
  }))
}

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

test("the impact builder keeps the comparison date column beside its one dimension filter without a seasonality checkbox", () => {
  const html = render()
  assert.match(html, /1\. Which decision are you checking/)
  assert.match(html, /2\. What can we fairly compare it with/)
  assert.match(html, /3\. Check the analysis/)
  assert.match(html, /Comparison dataset/)
  assert.match(html, /Comparison metric/)
  assert.match(html, /52 full weeks before the change and 8 weeks after/)
  const comparisonSection = html.match(/<section aria-labelledby="impact-comparison-heading"[\s\S]*?<\/section>/)?.[0]
  assert.match(comparisonSection, /Dimension filter/)
  assert.match(comparisonSection, /Date column/)
  assert.match(comparisonSection, /@min-\[40rem\]:grid-cols-\[minmax\(0,1fr\)_minmax\(0,3fr\)\]/)
  assert.doesNotMatch(comparisonSection, /<details|type="date"/)
  assert.deepEqual([...dimensionProps.keys()], [2])
  assert.equal(dimensionProps.get(2).singleValue, true)
  const settings = html.match(/<details[^>]*><summary[^>]*>Analysis settings<\/summary>[\s\S]*?<\/details>/)?.[0]
  assert.match(settings, /History starts/)
  assert.doesNotMatch(settings, /Date column|Minimum history/)
  const decisionSection = html.match(/<section aria-labelledby="impact-decision-heading"[\s\S]*?<\/section>/)?.[0]
  assert.match(decisionSection, /Outcome metric[\s\S]*aria-label="Outcome date column"/)
  assert.doesNotMatch(settings, /^<details[^>]*\sopen/)
  const main = html.replace(/<details[\s\S]*?<\/details>/g, "")
  assert.equal((main.match(/type="date"/g) || []).length, 1)
  assert.doesNotMatch(main, /History starts|History ends|busy and quiet seasons|Seasonal businesses need/)
  assert.match(main, /Analysis period: 2023-01-02 to 2025-12-28/)
  assert.match(main, /Expected result without the action/)
  assert.match(html, /<summary[^>]*>Report details/)
  assert.match(html, /<summary[^>]*>Improvement target \(optional\)/)
  assert.doesNotMatch(html, /report-builder-scroll|Maximum lag|Minimum historical observations|Select metrics/)
})

test("the first view starts with one decision choice and does not ask for a comparison prematurely", () => {
  const html = render({ definition: { ...definition, metrics: [], impact: { ...definition.impact, decision_id: null, comparison: null, outcome: null } } })
  assert.match(html, /Which decision are you checking/)
  assert.doesNotMatch(html, /Comparison dataset|History starts|Other selected results|Date column|Minimum history/)
  assert.equal(dimensionProps.size, 0)
  assert.match(html, /Choose the decision you want to check/)
})

test("the decision fixes the outcome without adding a second dataset filter picker", () => {
  const html = render({ definition: { ...definition, metrics: [outcome], impact: { ...definition.impact, comparison: null } } })
  assert.match(html, /Outcome metric/)
  assert.match(html, /aria-label="Decision data period"/)
  assert.match(html, /aria-label="Outcome date column"/)
  assert.doesNotMatch(html, /Dimension filter|3\. Check the analysis/)
  assert.equal(dimensionProps.size, 0)
})

test("the comparison filter restores saved choices without silently changing a saved outcome segment", () => {
  const filters = [{ dataset_id: 1, column: "region", values: ["East", null] }, { dataset_id: 2, column: "store", values: ["B"] }]
  let patch
  const html = render({ definition: { ...definition, dimension_filters: filters }, onChange: value => { patch = value } })
  const comparisonFilter = dimensionProps.get(2)
  assert.match(html, /Outcome segment: region: East/)
  assert.match(html, /Clear outcome filter/)
  assert.equal(dimensionProps.has(1), false)
  assert.deepEqual(comparisonFilter.value, filters[1])
  assert.equal(comparisonFilter.userId, "owner")
  assert.equal(comparisonFilter.workspaceId, "owner")
  assert.equal(comparisonFilter.embedded, true)
  comparisonFilter.onChange({ column: "store", values: ["C"] })
  assert.deepEqual(JSON.parse(JSON.stringify(patch.dimension_filters)), [filters[0], { dataset_id: 2, column: "store", values: ["C"] }])
  comparisonFilter.onChange(undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(patch.dimension_filters)), [filters[0]])
  assert.equal(definition.impact.comparison_unaffected, true)
  assert.deepEqual(filters[0].values, ["East", null])
})

test("weekly impact setup keeps automatic weekly history and never exposes manual email dates or grouping", () => {
  const html = render({ weekly: true, weeklySettings: { window: { start: "2025-12-22", end: "2025-12-28" }, history_window: { start: "2022-12-29", end: "2025-12-21" } } })
  assert.match(html, /Report week: 2025-12-22 to 2025-12-28/)
  assert.match(html, /compared week by week/)
  assert.deepEqual([...dimensionProps.keys()], [2])
  assert.doesNotMatch(html, /Analysis settings|History starts|History ends|Compare results by/)
  assert.equal((html.match(/aria-label="Outcome date column"/g) || []).length, 1)
  assert.match(html, /role="status"[\s\S]*Minimum history: 52 full weeks before the change and 8 weeks after/)
  assert.doesNotMatch(html.match(/<section aria-labelledby="impact-history-heading"[\s\S]*?<\/section>/)?.[0], /Minimum history/)
  assert.equal((html.match(/Check this decision/g) || []).length, 1)
  assert.doesNotMatch(html, /Save weekly settings|Save and preview|Save weekly report|Save snapshot/)
})

test("outcome date restores the saved column beside the metric and changes only that dataset's references", () => {
  const sources = [{ ...datasets[0], date_columns: ["date", "paid_date"], availability: { date: definition.date_range, paid_date: definition.date_range } }, datasets[1]]
  const original = { ...definition, metrics: [{ ...outcome, date_column: "paid_date" }, reference(1, "visits"), comparison],
    dimension_filters: [{ dataset_id: 1, column: "region", values: ["East"] }] }
  const before = structuredClone(original)
  const html = render({ definition: original, datasets: sources })
  assert.match(html, /aria-label="Outcome date column"[\s\S]*?<option value="paid_date" selected="">paid_date/)
  let patch
  const tree = ImpactBuilder({ definition: original, datasets: sources, onChange: value => { patch = value } })
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return undefined
    if (predicate(node)) return node
    for (const child of React.Children.toArray(node.props?.children)) {
      const match = find(child, predicate)
      if (match) return match
    }
  }
  const change = find(tree, node => node.props?.outcomeDate)
  const select = find(change.props.outcomeDate, node => node.props?.["aria-label"] === "Outcome date column")
  assert.equal(select.props.value, "paid_date")
  select.props.onChange({ target: { value: "date" } })
  assert.deepEqual(Object.keys(patch), ["metrics"])
  assert.deepEqual(Array.from(patch.metrics, metric => metric.date_column), ["date", "date", "date"])
  assert.equal(patch.metrics[2], comparison)
  assert.deepEqual(original, before)
})

test("unavailable saved outcome dates and sources remain explicit instead of silently selecting another column", () => {
  const html = render({ definition: { ...definition, metrics: [{ ...outcome, date_column: "removed_date" }, comparison] } })
  assert.match(html, /aria-label="Outcome date column"[\s\S]*?<option value="removed_date" disabled="" selected="">Selected date unavailable/)
  const missing = render({ datasets: [datasets[1]] })
  assert.match(missing, /Dataset 1 is not available yet/)
  assert.doesNotMatch(missing, /aria-label="Outcome date column"/)
})

test("history requirements remain visible beside readiness for every analysis grouping", () => {
  for (const [grain, requirement] of [["daily", "90 days before the change and 28 days after"], ["weekly", "52 full weeks before the change and 8 weeks after"], ["monthly", "24 full months before the change and 6 months after"]]) {
    const html = render({ definition: { ...definition, grain } }).replace(/<details[\s\S]*?<\/details>/g, "")
    assert.ok(html.includes(requirement))
    assert.match(html, /role="status"[\s\S]*Minimum history/)
    assert.match(html, /The required later periods start after the timing reference date/)
  }
})

test("comparison changes preserve the decision period while checking overlap separately", () => {
  const sources = [{ ...datasets[0], availability: { date: { start: "2023-01-02", end: "2025-12-28" } } },
    { ...datasets[1], availability: { date: { start: "2024-01-01", end: "2026-06-30" } } },
    { ...datasets[2], availability: { date: { start: "2000-01-01", end: "2000-12-31" } } }]
  const original = { ...definition, metrics: [outcome, comparison, extra] }
  assert.deepEqual(JSON.parse(JSON.stringify(state.impactHistoryWindow(original, sources))), { start: "2024-01-01", end: "2025-12-28" })
  const changed = state.changeImpactComparison(original, comparison)
  assert.equal(changed.date_range, undefined)
  assert.equal(state.changeImpactComparison(original, comparison).date_range, undefined)
  assert.equal(state.impactHistoryWindow(original, [sources[0]]), null)
  assert.deepEqual(original.date_range, definition.date_range)
})

test("nonoverlapping sources are rejected without silently changing the decision period", () => {
  const sources = [{ ...datasets[0], availability: { date: { start: "2000-01-01", end: "2000-12-31" } } }, datasets[1]]
  const changed = state.changeImpactComparison(definition, comparison)
  assert.equal(changed.date_range, undefined)
  assert.match(state.impactSetupIssue({ ...definition, ...changed }, sources), /no overlapping dates/)
})

test("overlapping sources outside the selected decision period cannot be reported as usable", () => {
  assert.match(state.impactSetupIssue({ ...definition, date_range: { start: "2000-01-01", end: "2000-12-31" } }, datasets), /no data in the decision's analysis period/)
  assert.match(state.impactSetupIssue({ ...definition, date_range: { start: "", end: "" } }, datasets), /Choose the history start and end dates/)
})

test("shared history follows each result's configured date column and saved multi-value comparisons need an explicit choice", () => {
  const sources = [datasets[0], { ...datasets[1], date_columns: ["date", "paid_date"], availability: { ...datasets[1].availability, paid_date: { start: "2024-02-01", end: "2025-10-31" } } }]
  const selected = { ...definition, metrics: [outcome, { ...comparison, date_column: "paid_date" }] }
  assert.deepEqual(JSON.parse(JSON.stringify(state.impactHistoryWindow(selected, sources))), { start: "2024-02-01", end: "2025-10-31" })
  assert.match(state.impactSetupIssue({ ...definition, dimension_filters: [{ dataset_id: 2, column: "store", values: ["A", "B"] }] }, datasets), /one unique value/)
  assert.equal(state.impactSetupIssue({ ...definition, dimension_filters: [{ dataset_id: 1, column: "store", values: ["A", "B"] }] }, datasets), "")
})
