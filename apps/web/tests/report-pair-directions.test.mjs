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
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name) })
  return loaded.exports
}
const pairs = load("../features/reports/pair-directions.ts")
const { reportPairDirections, reportPairKey, reportTestCount } = pairs
const { editableDefinition } = load("../features/reports/types.ts", { "./pair-directions": pairs })
const key = (dataset_id, metric_key) => ({ dataset_id, metric_key })
const metrics = [key(1, "spend"), key(2, "revenue"), key(4, "clicks")].map(item => ({ ...item, date_column: "date", aggregation: "sum" }))
const lag = { enabled: true, minimum: 0, maximum: 3, direction: "a_leads_b" }
const json = value => JSON.parse(JSON.stringify(value))

test("new reports use named pair choices rather than assigning direction by selection order", () => {
  const first = reportPairDirections(metrics, [])
  const reverse = reportPairDirections([...metrics].reverse(), [])
  assert.deepEqual(json(first), json(reverse))
  assert.equal(first.length, 3)
  assert.ok(first.every(pair => pair.direction === "both"))
  assert.equal(reportTestCount(metrics, first, lag), 21)
})

test("a middle metric can independently follow both neighbours", () => {
  const configured = reportPairDirections(metrics, []).map(pair => ({ ...pair, direction: pair.metric_a.dataset_id === 2 ? "b_leads_a" : "a_leads_b" }))
  const retained = reportPairDirections([...metrics].reverse(), configured)
  assert.deepEqual(json(retained), json(configured))
  assert.equal(retained.find(pair => pair.metric_a.dataset_id === 2).direction, "b_leads_a")
})

test("reversed endpoints preserve which actual metric leads", () => {
  const configured = [{ metric_a: key(4, "clicks"), metric_b: key(2, "revenue"), direction: "a_leads_b" }]
  assert.equal(reportPairDirections(metrics, configured).find(pair => pair.metric_a.dataset_id === 2).direction, "b_leads_a")
})

test("removing metrics prunes stale pairs while keeping retained choices and defaults for new pairs", () => {
  const configured = reportPairDirections(metrics, []).map(pair => ({ ...pair, direction: "same_period" }))
  const pruned = reportPairDirections(metrics.slice(0, 2), configured)
  assert.equal(pruned.length, 1)
  assert.equal(pruned[0].direction, "same_period")
  const expanded = reportPairDirections(metrics, pruned)
  assert.equal(expanded[0].direction, "same_period")
  assert.equal(expanded.filter(pair => pair.direction === "both").length, 2)
})

test("legacy report direction is translated without changing its original selection-order meaning", () => {
  const definition = editableDefinition({ metrics: [...metrics].reverse(), lag })
  assert.ok(definition.pair_directions.every(pair => pair.direction === "b_leads_a"))
  assert.equal(reportTestCount(definition.metrics, definition.pair_directions, lag), 12)
  assert.equal(reportTestCount(metrics, null, lag), 12)
  assert.ok(editableDefinition({ metrics, pair_directions: [] }).pair_directions.every(pair => pair.direction === "both"))
})

test("unique-test estimates agree with the backend for mixed modes and lag bounds", () => {
  const mixed = reportPairDirections(metrics, []).map((pair, index) => ({ ...pair, direction: ["a_leads_b", "same_period", "both"][index] }))
  assert.equal(reportTestCount(metrics, mixed, lag), 12)
  assert.equal(reportTestCount(metrics, mixed, { ...lag, enabled: false }), 3)
  assert.equal(reportTestCount(metrics, [], { ...lag, maximum: 0 }), 3)
  assert.equal(reportTestCount(metrics, [], { ...lag, minimum: 2 }), 15)
  const large = Array.from({ length: 25 }, (_, index) => ({ ...metrics[0], dataset_id: index + 1 }))
  assert.equal(reportTestCount(large, [], { ...lag, maximum: 12 }), 7500)
  const onlySamePeriod = reportPairDirections(large, []).map(pair => ({ ...pair, direction: "same_period" }))
  assert.equal(reportTestCount(large, onlySamePeriod, { ...lag, maximum: 12 }), 300)
})

test("metrics from the same dataset do not create a pair and structural keys avoid delimiter collisions", () => {
  assert.equal(reportPairDirections([...metrics, { ...metrics[0], metric_key: "orders" }], []).length, 5)
  assert.notEqual(reportPairKey({ metric_a: key(1, "a|2:b"), metric_b: key(3, "c") }), reportPairKey({ metric_a: key(1, "a"), metric_b: key(2, "b|3:c") }))
})

test("pair controls use actual metric and dataset names and offer all four timing modes", () => {
  const { ReportPairDirections } = load("../features/reports/report-pair-directions.tsx", {
    "react": { ...React, useState: () => ["", () => {}] }, "./pair-directions": pairs,
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: value => value }) },
  })
  const datasets = metrics.map(metric => ({ dataset_id: metric.dataset_id, dataset_label: `Source ${metric.dataset_id}`, metrics: [{ ...metric, label: metric.metric_key }] }))
  const opened = [], props = { pairs: reportPairDirections(metrics, []), datasets, onChange: (...value) => opened.push(value) }
  const html = renderToStaticMarkup(React.createElement(ReportPairDirections, props))
  for (const label of ["spend leads", "revenue leads", "clicks leads", "Source 1", "Source 2", "Source 4", "Test both directions", "Same-period comparison only"]) assert.ok(html.includes(label))
  assert.doesNotMatch(html, /Earlier selected|Later selected/)
  assert.match(html, /max-h-80 overflow-y-scroll overscroll-contain/)
  assert.match(html, /tabindex="0"/)
  assert.match(html, /\[scrollbar-gutter:stable\]/)
  assert.match(html, /\[scrollbar-width:thin\]/)
  assert.match(html, /\[scrollbar-color:var\(--color-gray-400\)_var\(--color-gray-100\)\]/)
  assert.doesNotMatch(html, /md:grid-cols/)
  const selects = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (node.type === "select") selects.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(ReportPairDirections(props))
  assert.equal(selects.length, 3)
  selects[2].props.onChange({ target: { value: "b_leads_a" } })
  assert.equal(opened[0][0].metric_a.dataset_id, 2)
  assert.equal(opened[0][1], "b_leads_a")
  const sameLabels = datasets.map(dataset => ({ ...dataset, metrics: dataset.metrics.map(metric => ({ ...metric, label: "Total" })) }))
  const ambiguous = renderToStaticMarkup(React.createElement(ReportPairDirections, { ...props, datasets: sameLabels }))
  assert.match(ambiguous, /Source 1 \/ Total leads/)
  assert.match(ambiguous, /Source 2 \/ Total leads/)
})

test("the builder renders pair directions only for timing and invalidates results on policy changes", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /const taskCount = reportTestCount/)
  assert.match(source, /const showPairDirections = definition\.lag\.enabled && definition\.pair_directions\.length > 0/)
  const settings = source.slice(source.indexOf('aria-label="Analysis settings"'), source.indexOf('id="report-report"'))
  assert.match(settings, /showPairDirections && <ReportPairDirections/)
  assert.ok(settings.indexOf("Maximum lag") < settings.indexOf("<ReportPairDirections"))
  assert.ok(settings.indexOf("<ReportPairDirections") < settings.indexOf("</details>"))
  assert.ok(settings.indexOf("</details>") < settings.indexOf("{previewButton}"))
  assert.ok(settings.indexOf("{previewButton}") < settings.indexOf("</section>"))
  assert.equal((source.match(/<ReportPairDirections /g) || []).length, 1)
  assert.equal((source.match(/\{previewButton\}/g) || []).length, 1)
  assert.match(source, /"filters", "lag", "pair_directions"/)
  assert.doesNotMatch(source, /Earlier selected metric leads|Later selected metric leads/)
  const translations = readFileSync(new URL("../lib/language.ts", import.meta.url), "utf8")
  assert.match(translations, /"\{metric\} leads": "\{metric\} précède"/)
  assert.doesNotMatch(translations, /"leads": "précède"/)
})
