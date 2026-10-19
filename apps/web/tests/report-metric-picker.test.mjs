import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const React = require("react")
const ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../features/reports/report-metric-picker.tsx", import.meta.url), "utf8")
const loadedModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
}).outputText, {
  module: loadedModule, exports: loadedModule.exports,
  require: name => {
    if (name === "next/link") return { __esModule: true, default: props => React.createElement("a", props) }
    if (name === "@/app/use-decisionate-language") return { useDecisionateText: () => ({ t: value => value }) }
    if (name === "@/features/relationships/types") return { metricIdentity: metric => `${metric.dataset_id}:${metric.metric_key}` }
    return require(name)
  },
})
const { ReportMetricPicker, reportDateColumn, filterReportDatasets } = loadedModule.exports
const metric = (key, id = 1) => ({ dataset_id: id, metric_key: key, label: key.replaceAll("_", " "), aggregation: "sum", unit: "currency", currency: "CAD" })
const dataset = (updates = {}) => ({ dataset_id: 1, dataset_label: "Advertising.csv", connector: "csv", metrics: [metric("spend"), metric("revenue")],
  date_columns: ["date"], availability: { date: { start: "2026-01-01", end: "2026-03-31" } }, ...updates })
const reference = (key = "spend", date = "date") => ({ dataset_id: 1, metric_key: key, date_column: date, aggregation: "sum" })
const render = (updates = {}) => renderToStaticMarkup(React.createElement(ReportMetricPicker, {
  datasets: [dataset()], metrics: [], dateColumns: {}, onToggleMetric() {}, onDateColumnChange() {}, ...updates,
}))

test("search has a visible label and placeholder and metrics appear before date settings", () => {
  const html = render()
  assert.match(html, /htmlFor="report-metric-search"|for="report-metric-search"/)
  assert.match(html, />Search datasets and metrics</)
  assert.match(html, /placeholder="Dataset or metric name"/)
  assert.doesNotMatch(html.match(/<label[^>]*for="report-metric-search"[^>]*>.*?<\/label>/)?.[0] || "", /<input|<button/)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2)
  assert.doesNotMatch(html, /<select|Date field|Selected metrics/)
})

test("selecting a metric reveals its date and range without a redundant one-option selector", () => {
  const html = render({ metrics: [reference()] })
  assert.match(html, /Selected metrics.*1/)
  assert.match(html, /Date field/)
  assert.match(html, /2026-01-01 \/ 2026-03-31/)
  assert.doesNotMatch(html, /<select/)
  assert.ok(html.indexOf('type="checkbox"') < html.indexOf("Date field"))
})

test("multiple valid date fields remain configurable after selection", () => {
  const html = render({ datasets: [dataset({ date_columns: ["date", "paid_date"], availability: {
    date: { start: "2026-01-01", end: "2026-03-31" }, paid_date: { start: "2026-01-02", end: "2026-04-01" },
  } })], metrics: [reference()] })
  assert.match(html, /<select/)
  assert.match(html, /<option value="paid_date"|<option>paid_date</)
})

test("empty selection, unsaved selection and calculation issues are not conflated", () => {
  for (const [code, message] of [["selection_not_saved", "Metric selection not saved."], ["no_eligible_defaults", "No supported metric defaults match this dataset."], ["no_metrics_selected", "No metrics selected for this dataset."], ["transaction_policy_required", "Transaction totals are not configured for analysis."]]) {
    const html = render({ datasets: [dataset({ metrics: [], metric_issues: [{ code }] })] })
    assert.ok(html.includes(message))
    assert.match(html, /No report-ready metrics/)
    assert.match(html, /href="\/dashboard\/datasets\/1"/)
    assert.doesNotMatch(html, /<select|Date field/)
  }
})

test("partial availability shows eligible choices and exact excluded field diagnostics", () => {
  const html = render({ datasets: [dataset({ metrics: [metric("spend")], metric_issues: [{ metric_key: "revenue", code: "insufficient_values" }] })] })
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1)
  assert.match(html, /Unavailable metrics.*1/)
  assert.match(html, /Fewer than two valid numeric values/)
  assert.match(html, /revenue/)
})

test("usable datasets appear before empty and unavailable sources", () => {
  const html = render({ datasets: [dataset({ dataset_id: 2, dataset_label: "Empty.csv", metrics: [] }), dataset()] })
  assert.ok(html.indexOf("Advertising.csv") < html.indexOf("Empty.csv"))
})

test("unavailable datasets and old API responses do not invent selection diagnoses", () => {
  const unavailable = render({ datasets: [dataset({ metrics: [], error_code: "dataset_unavailable" })] })
  assert.match(unavailable, /Dataset temporarily unavailable/)
  assert.doesNotMatch(unavailable, /Metric selection not saved|No metrics selected/)
  const old = render({ datasets: [dataset({ metrics: [] })] })
  assert.match(old, /No report-ready metrics/)
  assert.doesNotMatch(old, /Metric selection not saved|No metrics selected/)
})

test("a timed-out list shows recovery, never a claim that the workspace has no datasets", () => {
  const html = render({ datasets: [], error: true, onRetry() {} })
  assert.match(html, /Dataset list could not be loaded/)
  assert.match(html, /Your selections are unchanged/)
  assert.match(html, /<button[^>]*>.*Retry/s)
  assert.doesNotMatch(html, /No datasets available|Open datasets/)
})

test("pending lists and individual datasets are not labelled empty or unavailable", () => {
  const initial = render({ datasets: [], loading: true })
  assert.match(initial, /Loading datasets/)
  assert.doesNotMatch(initial, /No datasets available|Open datasets/)
  const pending = render({ datasets: [dataset({ metrics: [], date_columns: [], availability: {}, catalog_status: "pending" })], loading: true })
  assert.match(pending, /Advertising\.csv/)
  assert.match(pending, /Loading metrics/)
  assert.doesNotMatch(pending, /No report-ready metrics|temporarily unavailable|Review dataset|No usable date/)
})

test("genuinely empty successful lists still offer the dataset library", () => {
  const html = render({ datasets: [] })
  assert.match(html, /No datasets available/)
  assert.match(html, /Open datasets/)
})

test("date-less metrics cannot be added and existing selections can always be removed", () => {
  const data = dataset({ date_columns: [], availability: {} })
  assert.equal((render({ datasets: [data] }).match(/disabled=""/g) || []).length, 2)
  assert.equal((render({ datasets: [data], metrics: [reference()] }).match(/disabled=""/g) || []).length, 1)
  const stale = render({ datasets: [dataset()], metrics: [reference("spend", "old_date")] })
  assert.match(stale, /Selected date field unavailable/)
  assert.match(stale, /<select/)
})

test("metric limit does not prevent deselection", () => {
  const metrics = [reference(), ...Array.from({ length: 24 }, (_, i) => ({ ...reference(`metric_${i}`), dataset_id: 2 }))]
  const html = render({ metrics })
  assert.equal((html.match(/disabled=""/g) || []).length, 1)
})

test("search filters names, connector types and metric names without changing selections", () => {
  const data = [dataset(), dataset({ dataset_id: 2, dataset_label: "Invoices", connector: "xero", metrics: [metric("net_sales", 2)] })]
  assert.equal(filterReportDatasets(data, " advertising ").length, 1)
  assert.equal(filterReportDatasets(data, "XERO")[0].dataset_id, 2)
  const result = filterReportDatasets(data, "SPEND")
  assert.deepEqual(Array.from(result[0].metrics, item => item.metric_key), ["spend"])
  assert.equal(data[0].metrics.length, 2)
  assert.equal(filterReportDatasets(data, "missing field").length, 0)
  assert.equal(filterReportDatasets(data, " ").length, 2)
})

test("date defaults prefer usable values and preserve deliberate selections", () => {
  const data = dataset({ date_columns: ["empty_date", "date"] })
  assert.equal(reportDateColumn(data, [], {}), "date")
  assert.equal(reportDateColumn(data, [reference("spend", "paid_date")], {}), "paid_date")
  assert.equal(reportDateColumn(data, [reference()], { 1: "override" }), "override")
})

test("report builder uses the picker and still clears calculated results on edits", () => {
  const report = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(report, /<ReportMetricPicker/)
  assert.match(report, /reportDateColumn\(dataset, definition.metrics, dateColumns\)/)
  assert.match(report, /setReport\(null\)/)
  assert.doesNotMatch(report, /Review dataset metric selection/)
})
