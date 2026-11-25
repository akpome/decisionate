import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const file = readFileSync(new URL("../features/dashboard/components/compare-groups.tsx", import.meta.url), "utf8")
function reactChartElement(name) {
  return function ChartElement(props) {
    return React.createElement("div", { "data-element": name, "data-value": props.name || props.y }, props.children)
  }
}
const charts = Object.fromEntries(["CartesianGrid", "Line", "LineChart", "ReferenceLine", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, reactChartElement(name)]))
const modules = {
  "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
  "@/features/dashboard/components/metric-selector": { formatMetricLabel: column => column },
  "@/features/dashboard/lib/chart-palette": { dashboardChartPalette: ["blue", "green"] },
  "@/features/datasets/components/dimension-filter": {
    DatasetDimensionFilter: props => React.createElement("div", { "data-checkbox-limit": props.checkboxLimit }),
    dimensionValueLabel: value => value ?? "Missing",
  },
  "@/lib/api": {},
  recharts: charts,
}
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(file, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { module: loaded, exports: loaded.exports, require: name => modules[name] ?? require(name) })
const { alignDashboardGroupPoints, CompareGroupsEditor, DashboardGroupChart } = loaded.exports

const filter = { column: "channel", values: ["Online", "In-store"] }
const comparison = { filter, targets: [500, 750], metric: "Revenue", active: true }
const series = [
  { value: "Online", points: [{ period: "2026-02-01", amount: 0 }, { period: "2026-01-01", amount: 200 }] },
  { value: "In-store", points: [{ period: "2026-02-01", amount: 300 }] },
]

test("groups align by period, retain recorded zero, and never fill missing values with zero", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(alignDashboardGroupPoints(series))), [
    { period: "2026-01-01", group0: 200, group1: null },
    { period: "2026-02-01", group0: 0, group1: 300 },
  ])
})

test("group editing uses one metric dropdown and an optional target for each checked value", () => {
  const html = renderToStaticMarkup(React.createElement(CompareGroupsEditor, {
    ...comparison, datasetId: 17, userId: "owner", metrics: ["Revenue", "Orders"],
    onFilter() {}, onMetric() {}, onTarget() {},
  }))
  assert.equal((html.match(/<select/g) || []).length, 1)
  assert.match(html, /Metric to compare/)
  assert.match(html, /value="Revenue" selected=""/)
  assert.match(html, /aria-label="Target: Online"[^>]*value="500"/)
  assert.match(html, /aria-label="Target: In-store"[^>]*value="750"/)
})

test("the chart labels each group and renders only the targets that are set", () => {
  const html = renderToStaticMarkup(React.createElement(DashboardGroupChart, {
    comparison: { ...comparison, targets: [500, null] }, state: { data: { series } },
  }))
  assert.match(html, /data-element="Line" data-value="Online"/)
  assert.match(html, /data-element="Line" data-value="In-store"/)
  assert.match(html, /data-element="ReferenceLine" data-value="500"/)
  assert.equal((html.match(/data-element="ReferenceLine"/g) || []).length, 1)
})
