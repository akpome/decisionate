import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(path, imports = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { module, exports: module.exports, Intl, require: name => imports[name] || require(name) })
  return module.exports
}
const pairs = load("../features/reports/pair-directions.ts")
const types = load("../features/reports/types.ts", { "./pair-directions": pairs })
const { ReportAnomalies } = load("../features/reports/report-anomalies.tsx", { "./types": types })
const metric = {
  metric_id: "1:spend", label: "Spend", dataset_label: "Advertising", currency: "CAD", status: "ready",
  observations: 7, evaluated_observations: 7, missing_observations: 0, anomaly_count: 1,
  seasonalities: ["annual", "weekly"], warnings: [], method: ["residual_mad"],
  anomalies: [{ period: "2026-10-13", value: 150, expected: 100, lower: 90, upper: 110, deviation: 50, deviation_percent: 50, direction: "high" }],
  baselines: [{ start: "2026-10-12", end: "2026-10-18", history_start: "2023-10-21", history_end: "2026-10-11", observations: 1000, calibration_observations: 14, method: "residual_mad", spread: 3 }],
}
const analysis = { lookback_years: 3, seasonal_business: true, metrics: [metric], limitations: ["Exploratory thresholds, not proof of causation."] }
const render = value => renderToStaticMarkup(React.createElement(ReportAnomalies, { analysis: value }))

test("anomaly findings name the selected metric and disclose actual, expected, range, date and deviation", () => {
  const html = render(analysis)
  for (const value of ["Advertising / Spend", "Above expected", "2026-10-13", "Actual", "Expected range", "Deviation", "50.0%", "annual + weekly", "residual mad", "14 past-only validation observations"]) assert.ok(html.includes(value), value)
  assert.match(html, /aria-label="Selected metric anomaly results"/)
  assert.match(html, /scope="col"/)
  assert.match(html, /min-w-\[760px\]/)
  assert.doesNotMatch(html, /<input|Create decision|checkbox/)
})

test("every selected metric has its own result without claiming insufficient history means no anomalies", () => {
  const html = render({ ...analysis, metrics: [metric, { ...metric, metric_id: "2:orders", label: "Orders", dataset_label: "Shop", status: "insufficient_history", observations: 7, evaluated_observations: 0, anomaly_count: 0, anomalies: [], baselines: [], warnings: ["Annual seasonality could not be validated."] }] })
  assert.match(html, /Shop \/ Orders/)
  assert.match(html, /Insufficient history/)
  assert.match(html, /Assessed: 0\/7/)
  assert.match(html, /Annual seasonality could not be validated/)
  assert.doesNotMatch(html, /No unusual changes detected/)
})

test("no-anomaly, partial, unavailable and legacy snapshots are distinguished", () => {
  for (const [status, expected] of [["ready", "No unusual changes detected"], ["limited_history", "Partial assessment"], ["unavailable", "Unavailable"]]) {
    assert.ok(render({ ...analysis, metrics: [{ ...metric, status, anomaly_count: 0, anomalies: [] }] }).includes(expected))
  }
  assert.match(render(undefined), /not recorded in this saved report/)
})

test("zero expected values retain their units without inventing percentage changes", () => {
  const html = render({ ...analysis, metrics: [{ ...metric, anomalies: [{ ...metric.anomalies[0], value: 0, expected: 0, lower: -1, upper: 1, deviation: 0, deviation_percent: null, direction: "low" }] }] })
  assert.match(html, /Below expected/)
  assert.match(html, /0\.00/)
  assert.doesNotMatch(html, /NaN|Infinity|\(0\.0%\)/)
})

test("small rate values and their ranges are not rounded to misleading zeros", () => {
  const html = render({ ...analysis, metrics: [{ ...metric, unit: "rate", currency: null, anomalies: [{ ...metric.anomalies[0], value: .0001, expected: .00005, lower: .00004, upper: .00006, deviation: .00005 }] }] })
  for (const value of ["1E-4", "5E-5", "4E-5 to 6E-5", "Units: rate"]) assert.ok(html.includes(value), value)
})

test("source names and warnings are escaped and all results remain printable", () => {
  const html = render({ ...analysis, metrics: [{ ...metric, dataset_label: "<script>unsafe</script>", warnings: ["<img src=x>"] }] })
  assert.match(html, /&lt;script&gt;unsafe/)
  assert.match(html, /&lt;img src=x&gt;/)
  assert.doesNotMatch(html, /<script>|<img|print:hidden/)
})

test("seasonality is opt-in, survives editing a saved definition, and is not inferred from other report settings", () => {
  assert.equal(types.editableDefinition({}).seasonal_business, false)
  assert.equal(types.editableDefinition({ seasonal_business: true }).seasonal_business, true)
  assert.equal(types.editableDefinition({ seasonal_business: false }).seasonal_business, false)
})

test("both report tabs and weekly delivery use the shared anomaly display", () => {
  const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const single = readFileSync(new URL("../features/reports/single-dataset-report.tsx", import.meta.url), "utf8")
  const weekly = readFileSync(new URL("../app/dashboard/alerts/page.tsx", import.meta.url), "utf8")
  assert.match(workspace, /checked=\{definition.seasonal_business\}/)
  assert.match(workspace, /edit\(\{ seasonal_business: event.target.checked \}\)/)
  assert.match(workspace, /<ReportAnomalies analysis=\{report.anomaly_analysis\}/)
  assert.match(single, /<ReportPage scope="single"/)
  assert.match(weekly, /<ReportAnomalies analysis=\{digest.cross_dataset_report.anomaly_analysis\}/)
})

test("anomaly table labels remain readable inside their mobile horizontal scroll region", () => {
  const source = readFileSync(new URL("../features/reports/report-anomalies.tsx", import.meta.url), "utf8")
  assert.match(source, /min-w-\[760px\].*\[overflow-wrap:normal\]/)
  assert.match(source, /scope="col" className="whitespace-nowrap/)
  assert.match(source, /overflow-auto.*tabIndex=\{0\} role="region"/)
})
