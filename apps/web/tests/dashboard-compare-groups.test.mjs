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
    return React.createElement("div", {
      "data-element": name, "data-value": props.name || props.y, "data-color": props.stroke ?? props.fill,
      "data-curve": props.type, "data-connect-nulls": props.connectNulls?.toString(), "data-stack": props.stackId,
    }, props.children)
  }
}
const charts = Object.fromEntries(["Area", "Bar", "CartesianGrid", "ComposedChart", "Legend", "Line", "ReferenceLine", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, reactChartElement(name)]))
const modules = {
  "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
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
const selectionRows = load("../features/dashboard/components/dashboard-selection-row.tsx")
modules["@/features/dashboard/components/dashboard-selection-row"] = selectionRows
const metricSelectors = load("../features/dashboard/components/metric-selector.tsx")
modules["@/features/dashboard/components/metric-selector"] = metricSelectors
const dashboardChart = load("../features/dashboard/components/dashboard-chart.tsx")
modules["@/features/dashboard/components/dashboard-chart"] = dashboardChart
modules["@/features/datasets/components/dimension-filter"] = load("../features/datasets/components/dimension-filter.tsx")
const { alignDashboardGroupPoints, CompareGroupsEditor, DashboardGroupChart } = load("../features/dashboard/components/compare-groups.tsx")

const filter = { column: "channel", values: ["Online", "In-store"] }
const comparison = { filter, metric: "Revenue", active: true }
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

function editorProps(overrides = {}) {
  return {
    ...comparison, datasetId: 17, userId: "owner", metrics: ["Revenue", "Orders"],
    metricTarget: 700, onFilter() {}, onMetric() {}, onTargetChange() {}, ...overrides,
  }
}

function renderEditor(overrides) {
  return renderToStaticMarkup(React.createElement(CompareGroupsEditor, editorProps(overrides)))
}

test("one target field accompanies the metric and none appear on dimension value rows", () => {
  const html = renderEditor()
  assert.equal((html.match(/<select/g) || []).length, 2)
  assert.match(html, /Metric to compare.*<\/select>.*Dimension column.*<\/select>.*Groups to compare/)
  assert.match(html, /value="Revenue" selected=""/)
  assert.match(html, /type="checkbox" aria-label="Online"[^>]*checked=""/)
  assert.match(html, /type="checkbox" aria-label="In-store"[^>]*checked=""/)
  assert.equal((html.match(/type="number"/g) || []).length, 1)
  assert.match(html, /Metric target<\/span><input[^>]*value="700"[^>]*>.*Dimension column/)
  assert.match(renderEditor({ metric: "" }), /Metric target<\/span><input[^>]*disabled=""[^>]*value=""/)
  assert.doesNotMatch(html, /aria-label="Target: (Online|In-store)"/)
})

test("the target field changes and clears only the chosen metric's target", () => {
  const updates = []
  const tree = metricSelectors.DashboardMetricTargetFields({
    metrics: ["Revenue", "Orders"], metric: "Orders", metricLabel: "Target metric", target: 0,
    onMetricChange() {}, onTargetChange: (metric, target) => updates.push([metric, target]),
  })
  function visit(node) {
    if (!React.isValidElement(node)) return
    if (node.type === "input") {
      for (const amount of [42.5, NaN]) node.props.onChange({ target: { valueAsNumber: amount } })
    }
    React.Children.forEach(node.props.children, visit)
  }
  visit(tree)
  assert.deepEqual(updates, [["Orders", 42.5], ["Orders", null]])
})

test("individual metric rows keep their checkbox without a target field", () => {
  const html = renderToStaticMarkup(React.createElement(selectionRows.DashboardSelectionRow, {
    label: "Revenue", color: "#2563eb", checked: true, onToggle() {},
  }))
  assert.match(html, /type="checkbox" aria-label="Revenue"[^>]*checked=""/)
  assert.doesNotMatch(html, /type="number"|Target:/)
})

test("members can select a metric but its target is read-only", () => {
  const html = renderToStaticMarkup(React.createElement(metricSelectors.DashboardMetricTargetFields, {
    metrics: ["Revenue", "Orders"], metric: "Orders", metricLabel: "Target metric", target: 500, onMetricChange() {},
  }))
  assert.match(html, /<select aria-label="Target metric"(?![^>]* disabled="")/)
  assert.match(html, /type="number"[^>]*readOnly=""[^>]*value="500"/i)
})

test("group colors match regardless of result order and saved group targets are not plotted", () => {
  const swatches = [...renderEditor().matchAll(/style="background-color:(#[\da-f]{6})"/g)].map(match => match[1])
  assert.equal(new Set(swatches).size, 2)
  const html = renderToStaticMarkup(React.createElement(DashboardGroupChart, {
    comparison: { ...comparison, targets: [500, null] }, metricTarget: 700, state: { data: { series: [...series].reverse() } },
  }))
  assert.ok(html.includes(`data-element="Line" data-value="Online" data-color="${swatches[0]}"`))
  assert.ok(html.includes(`data-element="Line" data-value="In-store" data-color="${swatches[1]}"`))
  assert.deepEqual([...html.matchAll(/data-element="ReferenceLine" data-value="([^"]+)"/g)].map(match => match[1]), ["700"])
  assert.match(html, /full screen/)
  const noTarget = renderToStaticMarkup(React.createElement(DashboardGroupChart, { comparison, state: { data: { series } } }))
  assert.doesNotMatch(noTarget, /data-element="ReferenceLine"/)
})

test("Compare Groups supports smooth lines and areas with gaps, and grouped bars", () => {
  const swatches = [...renderEditor().matchAll(/style="background-color:(#[\da-f]{6})"/g)].map(match => match[1])
  for (const [chartType, element] of [["line", "Line"], ["area", "Area"], ["bar", "Bar"]]) {
    const html = renderToStaticMarkup(React.createElement(DashboardGroupChart, {
      comparison, chartType, metricTarget: 700, state: { data: { series } },
    }))
    assert.equal((html.match(new RegExp(`data-element="${element}"`, "g")) || []).length, 2)
    assert.ok(html.includes(`data-element="${element}" data-value="Online" data-color="${swatches[0]}"`))
    assert.ok(html.includes(`data-element="${element}" data-value="In-store" data-color="${swatches[1]}"`))
    assert.equal((html.match(/data-element="ReferenceLine"/g) || []).length, 1)
    if (chartType === "bar") assert.doesNotMatch(html, /data-stack=/)
    else assert.equal((html.match(/data-curve="monotone" data-connect-nulls="false"/g) || []).length, 2)
  }
})

test("indexed charts use the first nonzero point per series and preserve gaps and recorded zero", () => {
  const { indexDashboardChartRows } = dashboardChart
  const rows = [{ period: "Jan", a: 0, b: null, c: null }, { period: "Feb", a: 12, b: 3, c: 0 }, { period: "Mar", a: 18, b: 0, c: null }]
  assert.deepEqual(JSON.parse(JSON.stringify(indexDashboardChartRows(rows, ["a", "b", "c"], "period"))), [
    { period: "Jan", a: 0, b: null, c: null }, { period: "Feb", a: 100, b: 100, c: null }, { period: "Mar", a: 150, b: 0, c: null },
  ])
  const html = renderToStaticMarkup(React.createElement(DashboardGroupChart, {
    comparison, state: { data: { series } }, scaleMode: "indexed", metricTarget: 700,
  }))
  assert.doesNotMatch(html, /data-element="ReferenceLine"/)
})
