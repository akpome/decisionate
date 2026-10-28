import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(relative, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name), Intl, Date, Number })
  return loaded.exports
}
const trends = load("../features/reports/impact-trends.ts"), { impactChartTrends } = trends
const pairModule = load("../features/reports/pair-directions.ts")
const defaults = load("../features/relationships/defaults.ts")
const types = load("../features/reports/types.ts", { "./pair-directions": pairModule, "@/features/relationships/defaults": defaults })
const language = { useDecisionateText: () => ({ t: value => value }) }
const controls = load("../features/reports/chart-scale-control.tsx", { "@/app/use-decisionate-language": language })
const trend = [
  { period: "2026-01-01", actual: 900, without_change: 880, after_change: false },
  { period: "2026-01-02", actual: 1200, without_change: 1000, after_change: true },
  { period: "2026-01-03", actual: 0, without_change: 800, after_change: true },
  { period: "2026-01-04", actual: -50, without_change: 500, after_change: true },
]
const analysis = { trend, estimate: { effect: 50 }, outcome: { label: "Revenue", currency: "CAD" }, grain: "daily", summary: "An estimated difference, not proof." }

test("impact indexing uses one shared denominator so actual and estimated differences remain visible", () => {
  const original = structuredClone(trend), { rows, baseline } = impactChartTrends(trend, "indexed", "after")
  assert.equal(baseline.period, "2026-01-02")
  assert.equal(rows[0].actual, 120)
  assert.equal(rows[0].without_change, 100)
  assert.equal(rows[0].raw_actual, 1200)
  assert.equal(rows[1].actual, 0)
  assert.equal(rows[2].actual, -5)
  assert.deepEqual(trend, original)
})

test("switching full history keeps the same index baseline and does not invent earlier counterfactuals", () => {
  const after = impactChartTrends(trend, "indexed", "after"), all = impactChartTrends(trend, "indexed", "all")
  assert.equal(after.baseline.period, all.baseline.period)
  assert.equal(all.rows[0].actual, 90)
  assert.equal(all.rows[0].without_change, null)
  assert.equal(all.rows[0].raw_without_change, null)
  assert.equal(all.rows[1].actual, after.rows[0].actual)
})

test("unusable index denominators do not stop actual zero and negative values from rendering", () => {
  const values = trend.map(item => ({ ...item, without_change: 0, actual: -100 }))
  const actual = impactChartTrends(values, "actual", "after"), indexed = impactChartTrends(values, "indexed", "after")
  assert.equal(indexed.baseline, null)
  assert.ok(indexed.rows.every(row => row.actual === null && row.without_change === null))
  assert.ok(actual.rows.every(row => row.actual === -100 && row.without_change === 0))
})

test("non-finite observations remain gaps, with index overflow flagged without altering actual values", () => {
  const values = [
    { ...trend[1], actual: 1e-300, without_change: 1e-300 },
    { ...trend[2], actual: 1e300, without_change: Infinity },
    { ...trend[3], actual: NaN, without_change: null },
  ]
  const indexed = impactChartTrends(values, "indexed", "after"), actual = impactChartTrends(values, "actual", "after")
  assert.equal(indexed.overflow, true)
  assert.equal(indexed.rows[1].actual, null)
  assert.equal(actual.rows[1].actual, 1e300)
  assert.equal(actual.rows[1].without_change, null)
  assert.equal(actual.rows[2].actual, null)
  assert.equal(actual.rows[2].without_change, null)
})

let scale = "actual", period = "after"
const recorded = { charts: [], lines: [], references: [], tooltips: [], controls: [] }
const { ImpactChart } = load("../features/reports/impact-chart.tsx", {
  "./types": types, "./impact-trends": trends,
  "./chart-scale-control": { ChartScaleControl: props => { recorded.controls.push(props); return React.createElement(controls.ChartScaleControl, props) } },
  "@/app/use-decisionate-language": language,
  react: { ...React, useState: initial => initial === "after" ? [period, value => { period = value }] : [scale, value => { scale = value }] },
  recharts: {
    ResponsiveContainer: props => React.createElement(React.Fragment, null, props.children),
    LineChart: props => { recorded.charts.push(props); return React.createElement("svg", null, props.children) },
    Line: props => { recorded.lines.push(props); return React.createElement("path", { stroke: props.stroke }) },
    ReferenceLine: props => { recorded.references.push(props); return null },
    Tooltip: props => { recorded.tooltips.push(props); return null },
    CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
  },
})
function render(value = analysis, mode = "actual", range = "after") {
  scale = mode; period = range
  for (const key of Object.keys(recorded)) recorded[key] = []
  return renderToStaticMarkup(React.createElement(ImpactChart, { analysis: value }))
}

test("the impact chart defaults to actual values and switches to indexed without hiding the estimated effect", () => {
  const html = render()
  assert.match(html, /Values are in original units, not an indexed scale/)
  assert.match(html, /Chart scale/)
  assert.equal(recorded.charts[0].data[0].actual, 1200)
  recorded.controls[0].onChange("indexed")
  const indexed = render(analysis, scale)
  assert.match(indexed, /Indexed scale: 2026-01-02 = 100/)
  assert.match(indexed, /for both lines/)
  assert.match(indexed, /100 = CA\$1,000\.00/)
  assert.doesNotMatch(indexed, /Values are in original units, not an indexed scale/)
  assert.equal(recorded.charts[0].data[0].actual, 120)
  assert.equal(recorded.charts[0].data[0].without_change, 100)
  assert.equal(recorded.references[0].y, 100)
  assert.equal(recorded.lines[1].strokeDasharray, "6 4")
  assert.ok(recorded.lines.every(line => line.connectNulls === false))
  const formatter = recorded.tooltips[0].formatter, row = recorded.charts[0].data[0]
  assert.match(formatter(120, "Actual result", { dataKey: "actual", payload: row })[0], /Index: 120 \/ Original value: CA\$1,200\.00/)
  assert.match(formatter(100, "Without the change (estimate)", { dataKey: "without_change", payload: row })[0], /Index: 100 \/ Original value: CA\$1,000\.00/)
  render(analysis, "indexed", "all")
  assert.equal(recorded.charts[0].data[0].without_change, null)
  assert.ok(recorded.references.some(line => line.x === "2026-01-02"))
})

test("unavailable impact indexing explains the limitation and keeps switching back to actual possible", () => {
  const value = { ...analysis, trend: trend.map(item => ({ ...item, without_change: 0 })) }
  const html = render(value, "indexed")
  assert.equal(recorded.charts.length, 0)
  assert.match(html, /no positive estimated baseline after the change/)
  recorded.controls[0].onChange("actual")
  render(value, scale)
  assert.equal(recorded.charts.length, 1)
  assert.equal(recorded.charts[0].data[0].actual, 1200)
  assert.equal(render({ ...analysis, estimate: null }), "")
})
