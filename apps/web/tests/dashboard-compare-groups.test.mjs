import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function reactChartElement(name) {
  return function ChartElement(props) {
    return React.createElement("div", { "data-element": name, "data-value": props.name || props.y, "data-color": props.stroke }, props.children)
  }
}
const charts = Object.fromEntries(["CartesianGrid", "Line", "LineChart", "ReferenceLine", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, reactChartElement(name)]))
const modules = {
  "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
  "@/features/dashboard/components/metric-selector": { formatMetricLabel: column => column },
  "@/features/dashboard/lib/chart-palette": { dashboardChartPalette: ["#2563eb", "#14b8a6"] },
  "@/lib/api": { ApiError: Error },
  "@/components/searchable-select": {},
  recharts: charts,
}
function load(path) {
  const loaded = { exports: {} }
  const file = readFileSync(new URL(path, import.meta.url), "utf8")
  vm.runInNewContext(ts.transpileModule(file, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => modules[name] ?? require(name) })
  return loaded.exports
}
modules["@/features/dashboard/components/dashboard-selection-row"] = load("../features/dashboard/components/dashboard-selection-row.tsx")
modules["@/features/datasets/components/dimension-filter"] = load("../features/datasets/components/dimension-filter.tsx")
const { alignDashboardGroupPoints, CompareGroupsEditor, DashboardGroupChart } = load("../features/dashboard/components/compare-groups.tsx")

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

function renderEditor() {
  return renderToStaticMarkup(React.createElement(CompareGroupsEditor, {
    ...comparison, datasetId: 17, userId: "owner", metrics: ["Revenue", "Orders"],
    onFilter() {}, onMetric() {}, onTarget() {},
  }))
}

test("metric and dimension dropdowns are stacked above group checkboxes and inline targets", () => {
  const html = renderEditor()
  assert.equal((html.match(/<select/g) || []).length, 2)
  assert.match(html, /Metric to compare.*<\/select>.*Dimension column.*<\/select>.*Groups to compare/)
  assert.match(html, /value="Revenue" selected=""/)
  assert.match(html, /type="checkbox" aria-label="Online"[^>]*checked=""/)
  assert.match(html, /type="checkbox" aria-label="In-store"[^>]*checked=""/)
  assert.match(html, /aria-label="Target: Online"[^>]*value="500"/)
  assert.match(html, /aria-label="Target: In-store"[^>]*value="750"/)
})

test("group swatches, lines, and targets match even if the chart returns the groups in a different order", () => {
  const swatches = [...renderEditor().matchAll(/style="background-color:(#[\da-f]{6})"/g)].map(match => match[1])
  assert.equal(new Set(swatches).size, 2)
  const html = renderToStaticMarkup(React.createElement(DashboardGroupChart, {
    comparison: { ...comparison, targets: [500, null] }, state: { data: { series: [...series].reverse() } },
  }))
  assert.ok(html.includes(`data-element="Line" data-value="Online" data-color="${swatches[0]}"`))
  assert.ok(html.includes(`data-element="Line" data-value="In-store" data-color="${swatches[1]}"`))
  assert.ok(html.includes(`data-element="ReferenceLine" data-value="500" data-color="${swatches[0]}"`))
  assert.equal((html.match(/data-element="ReferenceLine"/g) || []).length, 1)
})
