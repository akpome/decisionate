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
const dimensionProps = []
const datasetSelectProps = []
const searchableModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/searchable-select.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
}).outputText, { module: searchableModule, exports: searchableModule.exports, require })
const loadedModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
}).outputText, {
  module: loadedModule, exports: loadedModule.exports,
  require: name => {
    if (name === "next/link") return { __esModule: true, default: props => React.createElement("a", props) }
    if (name === "@/app/use-decisionate-language") return { useDecisionateText: () => ({ t: value => value }) }
    if (name === "@/features/relationships/types") return { metricIdentity: metric => `${metric.dataset_id}:${metric.metric_key}` }
    if (name === "@/components/searchable-select") return { SearchableSelect: props => {
      datasetSelectProps.push(props)
      return React.createElement(searchableModule.exports.SearchableSelect, props)
    } }
    if (name === "@/features/datasets/components/dimension-filter") return { DatasetDimensionFilter: props => {
      dimensionProps.push(props)
      return React.createElement("label", null, "Dimension column", React.createElement("select", { "data-dataset-id": props.datasetId }))
    } }
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

test("a single report at the metric limit can switch sources without widening a multi report's limit", () => {
  const metrics = Array.from({ length: 25 }, (_, index) => reference(`metric_${index}`))
  const datasets = [dataset({ dataset_id: 2, metrics: [metric("sales", 2)] })]
  assert.doesNotMatch(render({ metrics, datasets, singleDataset: true, selectedDatasetId: 2 }), /disabled=""/)
  assert.match(render({ metrics, datasets }), /disabled=""/)
})

test("search and date selection are visibly labelled before any metrics are selected", () => {
  const html = render()
  assert.match(html, /htmlFor="report-metric-search"|for="report-metric-search"/)
  assert.match(html, />Search datasets and metrics</)
  assert.match(html, /placeholder="Dataset or metric name"/)
  assert.doesNotMatch(html.match(/<label[^>]*for="report-metric-search"[^>]*>.*?<\/label>/)?.[0] || "", /<input|<button/)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2)
  assert.match(html, /for="report-date-column-1"[^>]*>Date column<\/label>/)
  assert.match(html, /<select id="report-date-column-1"/)
  assert.match(html, /<option value="date" selected="">date<\/option>/)
  assert.ok(html.indexOf('<select id="report-date-column-1"') < html.indexOf('type="checkbox"'))
  assert.doesNotMatch(html, /Selected metrics/)
})

test("single reports expose only the chosen source's dimension selector while multi reports retain all sources", () => {
  for (const singleDataset of [true, false]) {
    dimensionProps.length = 0
    const calls = []
    const html = render({ singleDataset, selectedDatasetId: singleDataset ? 2 : null, userId: "owner", workspaceId: "workspace", datasets: [dataset(), dataset({ dataset_id: 2, metrics: [metric("orders", 2)] })],
      onDimensionFilterChange: (identity, value) => calls.push({ identity, value }) })
    assert.equal((html.match(/Dimension column/g) || []).length, singleDataset ? 1 : 2)
    assert.ok(html.indexOf("Dimension column") < html.indexOf('type="checkbox"'))
    assert.deepEqual(dimensionProps.map(item => item.datasetId), singleDataset ? [2] : [1, 2])
    assert.ok(dimensionProps.every(item => item.deferLoad && item.embedded && item.workspaceId === "workspace"))
    const filter = { column: "region", values: ["East", "West"] }
    dimensionProps.at(-1).onChange(filter)
    assert.deepEqual(calls, [{ identity: 2, value: filter }])
  }
})

test("date and dimension columns share a top-aligned responsive row in single and multi reports", () => {
  for (const singleDataset of [true, false]) {
    const html = render({ singleDataset, selectedDatasetId: singleDataset ? 1 : null, userId: "owner", workspaceId: "workspace", onDimensionFilterChange() {} })
    assert.match(html, /@min-\[28rem\]:grid-cols-\[minmax\(0,1fr\)_minmax\(0,3fr\)\]/)
    assert.match(html, /grid min-w-0 items-start gap-3/)
    assert.ok(html.indexOf("Date column") < html.indexOf("Dimension column"))
    assert.ok(html.indexOf("Dimension column") < html.indexOf('type="checkbox"'))
    assert.match(html, /2026-01-01 \/ 2026-03-31/)
  }
})

test("both report sections have identical fixed minimum and maximum heights with internal scrolling", () => {
  const html = render()
  const report = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  assert.match(html, /<section[^>]*class="report-builder-section"/)
  assert.match(html, /role="group"[^>]*tabindex="0"[^>]*class="report-builder-scroll /)
  assert.match(report, /<section className="report-builder-section gap-4" aria-label="Analysis settings"/)
  assert.match(report, /role="group" aria-label="Analysis settings" tabIndex=\{0\} className="report-builder-scroll /)
  const sectionStyle = css.match(/\.report-builder-section\s*\{([^}]+)\}/)?.[1] || ""
  assert.match(sectionStyle, /display:\s*flex/)
  assert.match(sectionStyle, /flex-direction:\s*column/)
  assert.match(sectionStyle, /(?:^|;)\s*height:\s*40rem/)
  assert.match(sectionStyle, /min-height:\s*40rem/)
  assert.match(sectionStyle, /max-height:\s*40rem/)
  const scrollStyle = css.match(/\.report-builder-scroll\s*\{([^}]+)\}/)?.[1] || ""
  assert.match(scrollStyle, /overflow-y:\s*auto/)
  assert.match(scrollStyle, /flex:\s*1/)
  assert.match(scrollStyle, /min-height:\s*0/)
  assert.match(scrollStyle, /scrollbar-gutter:\s*stable/)
  assert.doesNotMatch(source, /max-h-\[480px\]/)
})

test("the dataset heading has its own top row above search to align with Analysis settings", () => {
  const html = render()
  assert.match(html, /class="mb-4 shrink-0 space-y-4"><h2 class="text-base font-semibold">Datasets and metrics<\/h2><div/)
  assert.doesNotMatch(html, /items-end justify-between/)
})

test("empty states remain in the scroll area rather than being pushed to the bottom", () => {
  const html = render({ datasets: [] })
  assert.match(html, /class="report-builder-scroll [^"]*"><div[^>]*><p role="status">No datasets available\./)
})

test("catalog pagination stays inside the section and outside its scroll area", () => {
  const html = render({ footer: React.createElement("button", { type: "button" }, "Load more datasets") })
  assert.match(html, /<div class="mt-3 shrink-0"><button type="button">Load more datasets<\/button><\/div><\/section>$/)
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /const catalogFooter = nextOffset !== null && <button/)
  assert.match(source, /footer=\{catalogFooter\}/)
})

test("a single date column remains a preselected selector with its available range", () => {
  const html = render({ metrics: [reference()] })
  assert.match(html, /Selected metrics.*1/)
  assert.match(html, /Date column/)
  assert.match(html, /2026-01-01 \/ 2026-03-31/)
  assert.equal((html.match(/<select/g) || []).length, 1)
  assert.match(html, /<option value="date" selected="">date<\/option>/)
})

test("multiple valid date fields are configurable before and after metric selection", () => {
  const datasets = [dataset({ date_columns: ["date", "paid_date"], availability: {
    date: { start: "2026-01-01", end: "2026-03-31" }, paid_date: { start: "2026-01-02", end: "2026-04-01" },
  } })]
  for (const metrics of [[], [reference()]]) {
    const html = render({ datasets, metrics })
    assert.match(html, /<select/)
    assert.match(html, /<option value="date" selected="">date<\/option>/)
    assert.match(html, /<option value="paid_date">paid_date<\/option>/)
  }
})

test("date defaults skip unusable columns without offering them for analysis", () => {
  const html = render({ datasets: [dataset({ date_columns: ["empty_date", "date"] })] })
  assert.match(html, /<option value="date" selected="">date<\/option>/)
  assert.doesNotMatch(html, /value="empty_date"/)
})

test("a date chosen before metric selection is preselected and shows its own range", () => {
  const html = render({ dateColumns: { 1: "paid_date" }, datasets: [dataset({ date_columns: ["date", "paid_date"], availability: {
    date: { start: "2026-01-01", end: "2026-03-31" }, paid_date: { start: "2026-01-02", end: "2026-04-01" },
  } })] })
  assert.match(html, /<option value="paid_date" selected="">paid_date<\/option>/)
  assert.match(html, /2026-01-02 \/ 2026-04-01/)
  assert.doesNotMatch(html, /Selected metrics/)
})

test("each dataset gets a separately labelled date selector", () => {
  const html = render({ datasets: [dataset(), dataset({ dataset_id: 2, dataset_label: "Orders.csv", metrics: [metric("orders", 2)] })] })
  for (const identity of [1, 2]) {
    assert.match(html, new RegExp(`for="report-date-column-${identity}"[^>]*>Date column<\\/label>`))
    assert.match(html, new RegExp(`<select id="report-date-column-${identity}"`))
  }
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

test("sources keep catalog order as metrics finish loading so controls do not jump", () => {
  const html = render({ datasets: [dataset({ dataset_id: 2, dataset_label: "Empty.csv", metrics: [] }), dataset()] })
  assert.ok(html.indexOf("Empty.csv") < html.indexOf("Advertising.csv"))
  const pending = render({ datasets: [dataset({ dataset_id: 2, dataset_label: "Empty.csv", catalog_status: "pending" }), dataset()] })
  assert.ok(pending.indexOf("Empty.csv") < pending.indexOf("Advertising.csv"))
})

test("source retries are individually labelled and show progress without hiding healthy choices", () => {
  const datasets = [dataset({ dataset_id: 2, dataset_label: "Failed.csv", metrics: [], error_code: "dataset_unavailable" }), dataset()]
  const retry = render({ datasets, onRetryDataset() {} })
  assert.match(retry, /aria-label="Retry: Failed.csv"/)
  assert.equal((retry.match(/type="checkbox"/g) || []).length, 2)
  const pending = render({ datasets, onRetryDataset() {}, retryingDataset: 2 })
  assert.match(pending, /Loading metrics/)
  assert.doesNotMatch(pending, /Dataset temporarily unavailable|Retry: Failed.csv/)
  assert.equal((pending.match(/type="checkbox"/g) || []).length, 2)
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

test("date defaults prefer usable values and restored report selections over older overrides", () => {
  const data = dataset({ date_columns: ["empty_date", "date"] })
  assert.equal(reportDateColumn(data, [], {}), "date")
  assert.equal(reportDateColumn(data, [reference("spend", "paid_date")], {}), "paid_date")
  assert.equal(reportDateColumn(data, [], { 1: "override" }), "override")
  assert.equal(reportDateColumn(data, [reference()], { 1: "override" }), "date")
  assert.equal(reportDateColumn(data, [], { 2: "override" }), "date")
  assert.equal(reportDateColumn(dataset({ date_columns: [], availability: {} }), [], {}), "")
})

test("single dataset analysis starts with one dataset dropdown and no unrelated metric or dimension controls", () => {
  dimensionProps.length = 0
  const html = render({ singleDataset: true, datasets: [dataset(), dataset({ dataset_id: 2, dataset_label: "Orders.csv" })],
    userId: "owner", onDimensionFilterChange() {} })
  assert.match(html, /Dataset and metrics/)
  assert.match(html, /for="report-dataset"[^>]*>Dataset<\/label>/)
  assert.match(html, /Choose or search datasets/)
  assert.deepEqual(Array.from(datasetSelectProps.at(-1).options, option => option.label), ["Choose a dataset", "Advertising.csv / csv", "Orders.csv / csv"])
  assert.match(html, /No dataset selected/)
  assert.equal((html.match(/role="combobox"/g) || []).length, 1)
  assert.equal((html.match(/<select/g) || []).length, 0)
  assert.doesNotMatch(html, /multiple=""|type="checkbox"|Dimension column|Date column|Search metrics/)
  assert.equal(dimensionProps.length, 0)
})

test("choosing one dataset shows only its metrics, dates and dimension filter before metrics are selected", () => {
  dimensionProps.length = 0
  const html = render({ singleDataset: true, selectedDatasetId: 2, userId: "owner", workspaceId: "workspace", onDimensionFilterChange() {},
    datasets: [dataset(), dataset({ dataset_id: 2, dataset_label: "Orders.csv", metrics: [metric("orders", 2)] })],
    dimensionFilters: [{ dataset_id: 2, column: "region", values: ["East"] }] })
  assert.match(html, /id="report-dataset"[^>]*value="Orders\.csv \/ csv"/)
  assert.equal((html.match(/<legend/g) || []).length, 1)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1)
  assert.doesNotMatch(html, /report-metric-search|Search metrics|placeholder="Metric name"/)
  assert.match(html, /report-date-column-2/)
  assert.doesNotMatch(html, /report-date-column-1|>spend<|>revenue</)
  assert.deepEqual(dimensionProps.map(item => item.datasetId), [2])
  assert.deepEqual(dimensionProps[0].value, { dataset_id: 2, column: "region", values: ["East"] })
})

test("saved single-dataset metrics restore the dataset selector without choosing another source", () => {
  const html = render({ singleDataset: true, metrics: [{ ...reference("orders"), dataset_id: 2 }],
    datasets: [dataset(), dataset({ dataset_id: 2, dataset_label: "Orders.csv", metrics: [metric("orders", 2)] })] })
  assert.match(html, /id="report-dataset"[^>]*value="Orders\.csv \/ csv"/)
  assert.match(html, /type="checkbox"[^>]*checked=""/)
  assert.doesNotMatch(html, /report-metric-search|Search metrics/)
  assert.doesNotMatch(html, /report-date-column-1|>spend<|>revenue</)
})

test("an unavailable saved dataset does not expose or automatically select another dataset", () => {
  const html = render({ singleDataset: true, selectedDatasetId: 99, metrics: [{ ...reference(), dataset_id: 99 }] })
  assert.match(html, /id="report-dataset"[^>]*value="Selected dataset unavailable\./)
  assert.doesNotMatch(html, /type="checkbox"|report-date-column-1/)
})

test("pending and failed single datasets stay selected and have source-local retry controls", () => {
  const pending = render({ singleDataset: true, selectedDatasetId: 1, datasets: [dataset({ catalog_status: "pending" }), dataset({ dataset_id: 2 })] })
  assert.match(pending, /Loading metrics/)
  assert.doesNotMatch(pending, /type="checkbox"|No dataset selected/)
  const failed = render({ singleDataset: true, selectedDatasetId: 1, datasets: [dataset({ error_code: "dataset_unavailable" }), dataset({ dataset_id: 2 })], onRetryDataset() {} })
  assert.match(failed, /Retry: Advertising\.csv/)
  assert.doesNotMatch(failed, /type="checkbox"|report-date-column-2/)
})

test("report builder uses the picker and still clears calculated results on edits", () => {
  const report = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(report, /<ReportMetricPicker/)
  assert.match(report, /reportDateColumn\(dataset, definition.metrics, dateColumns\)/)
  assert.match(report, /setReport\(null\)/)
  assert.doesNotMatch(report, /Review dataset metric selection/)
})

test("dataset search forwards the query without choosing, and only approved choices change the selected source", () => {
  const searches = [], changes = []
  render({ singleDataset: true, onDatasetSearch: value => searches.push(value), onDatasetChange: value => changes.push(value) })
  const control = datasetSelectProps.at(-1)
  control.onSearchChange("advertising")
  assert.deepEqual(searches, ["advertising"])
  assert.deepEqual(changes, [])
  control.onChange("1"); control.onChange("999"); control.onChange("")
  assert.deepEqual(changes, [1, null])
})
