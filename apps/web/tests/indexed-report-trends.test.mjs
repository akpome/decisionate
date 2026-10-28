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
const indexed = load("../features/reports/indexed-trends.ts")
const { indexedMetricTrends } = indexed
const pairModule = load("../features/reports/pair-directions.ts")
const defaults = load("../features/relationships/defaults.ts")
const types = load("../features/reports/types.ts", { "./pair-directions": pairModule, "@/features/relationships/defaults": defaults })
const json = value => JSON.parse(JSON.stringify(value))
function metric(id, values, updates = {}) {
  return { id: `${id}:amount`, dataset_id: id, dataset_label: `Source ${id}.csv`, metric_key: "amount", label: "Amount", currency: id === 2 ? "CAD" : null,
    unit: id === 2 ? "currency" : "count", aggregation: "sum", value: 30, previous_value: 25, change_percent: 20,
    observations: values.length, expected_periods: values.length, warnings: [],
    trend: values.map((value, index) => ({ period: `2026-01-${String(index + 1).padStart(2, "0")}`, value })), ...updates }
}

test("mixed units share one positive baseline and use value / baseline * 100 without changing source data", () => {
  const metrics = [metric(1, [10, 12, 8]), metric(2, [1000, 800, 1200])]
  const original = structuredClone(metrics), result = indexedMetricTrends(metrics)
  assert.equal(result.baselinePeriod, "2026-01-01")
  assert.deepEqual(json(result.rows.map(row => Object.values(row.indexed))), [[100, 100], [120, 80], [80, 120]])
  assert.deepEqual(json(result.rows[1].raw), { metric_0: 12, metric_1: 800 })
  assert.deepEqual(json(result.plotted.map(series => series.baseline)), [10, 1000])
  assert.deepEqual(metrics, original)
})

test("dates are aligned by calendar key, not array position, and missing observations remain null", () => {
  const first = metric(1, [], { trend: [{ period: "2026-01-03", value: 20 }, { period: "2026-01-01", value: 10 }] })
  const second = metric(2, [], { trend: [{ period: "2026-01-02", value: 100 }, { period: "2026-01-03", value: 200 }] })
  const result = indexedMetricTrends([first, second])
  assert.equal(result.baselinePeriod, "2026-01-03")
  assert.deepEqual(json(result.rows.map(row => [row.period, ...Object.values(row.indexed)])), [
    ["2026-01-01", 50, null], ["2026-01-02", null, 50], ["2026-01-03", 100, 100],
  ])
})

test("zero is never a denominator, while genuine zeros and negative observations still plot accurately", () => {
  const result = indexedMetricTrends([metric(1, [0, 10, -5, 0]), metric(2, [100, 200, 300, 0])])
  assert.equal(result.baselinePeriod, "2026-01-02")
  assert.deepEqual(json(result.rows.map(row => Object.values(row.indexed))), [[0, 50], [100, 100], [-50, 150], [0, 0]])
})

test("non-finite observations are gaps, not invented zeros or indexed points", () => {
  const result = indexedMetricTrends([metric(1, [null, NaN, Infinity, -Infinity, 10]), metric(2, [1, 2, 3, 4, 5])])
  assert.equal(result.baselinePeriod, "2026-01-05")
  assert.deepEqual(json(result.rows.slice(0, 4).map(row => row.indexed.metric_0)), [null, null, null, null])
  assert.deepEqual(json(result.rows.slice(0, 4).map(row => row.raw.metric_0)), [null, null, null, null])
})

test("unindexable metrics are explicitly excluded without preventing other available metrics from plotting", () => {
  const result = indexedMetricTrends([metric(1, [0, 0]), metric(2, [10, 20]), metric(3, [-1, -2]), metric(4, [null, null])])
  assert.equal(result.baselinePeriod, "2026-01-01")
  assert.equal(result.series.length, 4)
  assert.deepEqual(json(result.plotted.map(item => item.metric.dataset_id)), [2])
  assert.deepEqual(json(result.excluded.map(item => item.metric.dataset_id)), [1, 3, 4])
})

test("disjoint positive baselines do not silently index metrics to different dates", () => {
  const result = indexedMetricTrends([metric(1, [10, 0]), metric(2, [0, 20])])
  assert.equal(result.baselinePeriod, null)
  assert.equal(result.plotted.length, 0)
  assert.ok(result.rows.every(row => Object.values(row.indexed).every(value => value === null)))
})

test("empty and all-zero reports have no fabricated baseline or lines", () => {
  for (const metrics of [[], [metric(1, [])], [metric(1, [], { trend: undefined })], [metric(1, [0, 0]), metric(2, [0, 0])]]) {
    const result = indexedMetricTrends(metrics)
    assert.equal(result.baselinePeriod, null)
    assert.equal(result.plotted.length, 0)
  }
})

test("overflowing index values are flagged and kept out of chart coordinates", () => {
  const result = indexedMetricTrends([metric(1, [1e-300, 1e300]), metric(2, [1, 2])])
  assert.equal(result.rows[1].indexed.metric_0, null)
  assert.equal(result.plotted[0].overflow, 1)
  assert.equal(result.rows[1].raw.metric_0, 1e300)
})

test("all 25 supported metrics have distinct colors and safe data keys even with duplicate or path-like names", () => {
  const metrics = Array.from({ length: 25 }, (_, index) => metric(index + 1, [10, 20], { id: `${index + 1}:a.b[0]`, label: "Total", metric_key: "a.b[0]" }))
  const result = indexedMetricTrends(metrics)
  assert.equal(new Set(result.plotted.map(item => item.color)).size, 25)
  assert.equal(new Set(result.plotted.map(item => item.label)).size, 25)
  assert.ok(result.plotted.every(item => /^metric_\d+$/.test(item.key)))
  assert.ok(result.plotted.slice(8).every(item => item.dash))
  assert.deepEqual(Object.values(result.rows[0].indexed), Array(25).fill(100))
})

const language = { useDecisionateText: () => ({ t: value => value }) }
const controls = load("../features/reports/chart-scale-control.tsx", { "@/app/use-decisionate-language": language })
const recorded = { charts: [], lines: [], references: [], axes: [], controls: [] }
let currentScale = "indexed"
const { MetricTrends, IndexedTrendTooltip } = load("../features/reports/report-metric-trends.tsx", {
  "./types": types, "./indexed-trends": indexed,
  "./chart-scale-control": { ChartScaleControl: props => { recorded.controls.push(props); return React.createElement(controls.ChartScaleControl, props) } },
  react: { ...React, useState: () => [currentScale, value => { currentScale = value }] },
  "@/app/use-decisionate-language": language,
  recharts: {
    ResponsiveContainer: props => React.createElement(React.Fragment, null, props.children),
    LineChart: props => { recorded.charts.push(props); return React.createElement("svg", null, props.children) },
    Line: props => { recorded.lines.push(props); return React.createElement("path", { "data-indexed-line": props.name, stroke: props.stroke }) },
    ReferenceLine: props => { recorded.references.push(props); return null },
    CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: props => { recorded.axes.push(props); return null },
  },
})
function render(metrics, scale = "indexed") {
  currentScale = scale
  recorded.charts = []; recorded.lines = []; recorded.references = []; recorded.axes = []; recorded.controls = []
  return renderToStaticMarkup(React.createElement(MetricTrends, { report: { metrics } }))
}

test("the preview renders one explicitly indexed chart with named colored lines and unchanged original summaries", () => {
  const html = render([metric(1, [10, 12]), metric(2, [100, 80])])
  assert.equal(recorded.charts.length, 1)
  assert.equal(recorded.lines.length, 2)
  assert.equal((html.match(/<article/g) || []).length, 2)
  assert.match(html, /Indexed metric comparison/)
  assert.match(html, /Indexed scale: 2026-01-01 = 100/)
  assert.match(html, /Values are indexed, not original units/)
  assert.match(html, /Chart legend/)
  assert.match(html, /Source 1.csv \/ Amount/)
  assert.match(html, /Source 2.csv \/ Amount/)
  assert.match(html, /CA\$30\.00/)
  assert.match(html, /100 = CA\$100\.00/)
  assert.notEqual(recorded.lines[0].stroke, recorded.lines[1].stroke)
  assert.equal(recorded.lines[0].dataKey(recorded.charts[0].data[1]), 120)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[1]), 80)
  assert.ok(recorded.lines.every(line => line.connectNulls === false && line.isAnimationActive === false))
  assert.equal(recorded.references[0].y, 100)
  assert.equal(recorded.references[0].label.value, "100")
  assert.equal(recorded.charts[0].accessibilityLayer, true)
})

test("the tooltip separates indexed values from original currency and missing observations", () => {
  const data = indexedMetricTrends([metric(1, [10, null]), metric(2, [100, 80])])
  const html = renderToStaticMarkup(React.createElement(IndexedTrendTooltip, { active: true, row: data.rows[1], series: data.plotted }))
  assert.match(html, /Index \(base 100\)/)
  assert.match(html, /Index: 80/)
  assert.match(html, /Original value: CA\$80\.00/)
  assert.match(html, /Index: Unavailable/)
  assert.match(html, /Source 1.csv \/ Amount/)
  assert.match(html, /2026-01-02/)
  assert.equal(renderToStaticMarkup(React.createElement(IndexedTrendTooltip, { active: false, row: data.rows[0], series: data.plotted })), "")
  assert.equal(renderToStaticMarkup(React.createElement(IndexedTrendTooltip, { active: true, series: data.plotted })), "")
})

test("the scale control exposes the selected mode and sends changes without submitting a form", () => {
  const changes = [], element = controls.ChartScaleControl({ value: "indexed", onChange: mode => changes.push(mode) })
  assert.equal(element.props["aria-label"], "Chart scale")
  const [indexedButton, actualButton] = element.props.children
  assert.equal(indexedButton.props["aria-pressed"], true)
  assert.equal(actualButton.props["aria-pressed"], false)
  assert.equal(actualButton.props.type, "button")
  actualButton.props.onClick()
  indexedButton.props.onClick()
  assert.deepEqual(changes, ["actual", "indexed"])
})

test("switching to actual plots original values, changes labels and keeps colors, cards and dates unchanged", () => {
  const metrics = [metric(1, [10, 12]), metric(2, [1000, 800])], original = structuredClone(metrics)
  render(metrics)
  const colors = recorded.lines.map(line => line.stroke)
  recorded.controls[0].onChange("actual")
  const html = render(metrics, currentScale)
  assert.match(html, /Actual metric comparison/)
  assert.match(html, /Actual scale: original values, not indexed/)
  assert.match(html, /different units are not directly comparable/)
  assert.doesNotMatch(html, /100 =|Metrics not indexed|Indexed scale:/)
  assert.match(html, /CAD \/ sum/)
  assert.equal(recorded.axes[0].label.value, "Actual value")
  assert.equal(recorded.references.length, 0)
  assert.deepEqual(recorded.lines.map(line => line.stroke), colors)
  assert.equal(recorded.lines[0].dataKey(recorded.charts[0].data[1]), 12)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[1]), 800)
  assert.equal((html.match(/<article/g) || []).length, 2)
  recorded.controls[0].onChange("indexed")
  render(metrics, currentScale)
  assert.equal(recorded.lines[0].dataKey(recorded.charts[0].data[1]), 120)
  assert.equal(recorded.references[0].y, 100)
  assert.deepEqual(metrics, original)
})

test("actual plots zero and negative series without a positive baseline and preserves missing periods", () => {
  const html = render([metric(1, [0, 0]), metric(2, [-10, null, -20]), metric(3, [null, null])], "actual")
  assert.equal(recorded.charts.length, 1)
  assert.equal(recorded.lines.length, 2)
  assert.doesNotMatch(html, /An indexed comparison is unavailable|Metrics not indexed/)
  assert.equal(recorded.lines[0].dataKey(recorded.charts[0].data[0]), 0)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[0]), -10)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[1]), null)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[2]), -20)
  assert.ok(recorded.lines.every(line => line.connectNulls === false))
})

test("actual plots disjoint dates without inventing a shared baseline or dropping valid observations", () => {
  render([metric(1, [10, null]), metric(2, [null, 20])], "actual")
  assert.equal(recorded.lines.length, 2)
  assert.equal(recorded.lines[0].dataKey(recorded.charts[0].data[0]), 10)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[0]), null)
  assert.equal(recorded.lines[1].dataKey(recorded.charts[0].data[1]), 20)
})

test("actual tooltip shows original currency and units rather than index values", () => {
  const data = indexedMetricTrends([metric(1, [10, null]), metric(2, [100, 80])])
  const html = renderToStaticMarkup(React.createElement(IndexedTrendTooltip, { active: true, row: data.rows[1], series: data.actual, scale: "actual" }))
  assert.match(html, /Actual values/)
  assert.match(html, /Original value: CA\$80\.00 \/ CAD/)
  assert.match(html, /Original value: Unavailable \/ count/)
  assert.doesNotMatch(html, /Index \(base 100\)|Index:/)
})

test("actual-only large values survive index overflow and no-data reports remain explicit", () => {
  const html = render([metric(1, [1e-300, 1e300]), metric(2, [1, 2])], "actual")
  assert.equal(recorded.lines[0].dataKey(recorded.charts[0].data[1]), 1e300)
  assert.doesNotMatch(html, /outside the supported index range/)
  const empty = render([metric(1, [null, NaN, Infinity])], "actual")
  assert.equal(recorded.charts.length, 0)
  assert.match(empty, /No actual values are available/)
  assert.match(empty, /Chart scale/)
})

test("unavailable indexed comparisons retain all original summaries and an explicit limitation", () => {
  const html = render([metric(1, [0, 0]), metric(2, [0, 0])])
  assert.equal(recorded.charts.length, 0)
  assert.equal((html.match(/<article/g) || []).length, 2)
  assert.match(html, /An indexed comparison is unavailable/)
  assert.match(html, /Metrics not indexed/)
  assert.match(html, /Not indexed: no positive baseline value/)
  assert.match(html, /Original metric values remain above/)
})

test("a one-period report has visible points, and metric warnings and numerical overflow remain explicit", () => {
  render([metric(1, [10]), metric(2, [20])])
  assert.ok(recorded.lines.every(line => line.dot.r === 2))
  const html = render([metric(1, [1e-300, 1e300], { warnings: ["One period is missing."] }), metric(2, [1, 2])])
  assert.match(html, /Coverage notes/)
  assert.match(html, /One period is missing\./)
  assert.match(html, /Some values are outside the supported index range/)
  assert.match(html, /100 = 1E-300/)
})

test("only the combined trend component is wired into the report workspace", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /dynamic\(\(\) => import\("\.\/report-metric-trends"\)/)
  assert.doesNotMatch(source, /import \{ MetricTrends \} from/)
  assert.match(source, /view !== "report" \? null/)
  assert.equal((source.match(/<MetricTrends report=\{report\}/g) || []).length, 1)
  assert.doesNotMatch(source, /<LineChart|<ResponsiveContainer/)
  const translations = readFileSync(new URL("../lib/language.ts", import.meta.url), "utf8")
  for (const key of ["Indexed metric comparison", "Indexed values", "Index (base 100)", "Chart legend", "Metrics not indexed", "Chart scale", "Indexed", "Actual metric comparison", "Actual values"]) assert.ok(translations.includes(`"${key}":`))
})
