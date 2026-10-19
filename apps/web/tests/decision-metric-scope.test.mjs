import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function load(relativePath) {
  const loaded = { exports: {} }
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => name.includes("metric-selector")
    ? { formatMetricLabel: column => column.replaceAll("_", " ") } : require(name) })
  return loaded.exports
}

const { selectedReportMetrics } = load("../features/decisions/lib/report-metric-scope.ts")
const { DecisionEvidenceContext } = load("../features/decisions/components/decision-evidence-context.tsx")
const fields = [
  { dataset_id: 1, metric_key: "spend", label: "Spend" }, { dataset_id: 1, metric_key: "clicks", label: "Clicks" },
  { dataset_id: 2, metric_key: "orders", label: "Orders" }, { dataset_id: 2, metric_key: "sales", label: "Sales" },
]

test("decision report metrics are the chosen references, not every cached metric from selected datasets", () => {
  const report = { metrics: fields, definition: { metrics: [fields[0], fields[2]] } }
  const selected = selectedReportMetrics(report)
  assert.deepEqual(Array.from(selected, item => `${item.dataset_id}:${item.metric_key}`), ["1:spend", "2:orders"])
  assert.equal(report.metrics.length, 4)
})

test("empty or missing report choices never fall back to all metrics", () => {
  for (const definition of [{ metrics: [] }, {}]) {
    assert.equal(selectedReportMetrics({ metrics: fields, definition }).length, 0)
  }
})

test("scope distinguishes identically named metrics in different datasets", () => {
  const report = { metrics: [{ dataset_id: 1, metric_key: "total" }, { dataset_id: 2, metric_key: "total" }],
    definition: { metrics: [{ dataset_id: 2, metric_key: "total" }] } }
  assert.equal(selectedReportMetrics(report)[0].dataset_id, 2)
})

test("report choices preserve selection order without duplicate options", () => {
  const report = { metrics: [...fields, fields[0]], definition: { metrics: [fields[2], fields[0], fields[2]] } }
  assert.deepEqual(Array.from(selectedReportMetrics(report), item => `${item.dataset_id}:${item.metric_key}`), ["2:orders", "1:spend"])
})

const render = props => renderToStaticMarkup(React.createElement(DecisionEvidenceContext, {
  context: JSON.stringify({ metrics: fields }), loading: false, unavailable: false,
  metrics: [{ dataset_id: 1, metric_column: "spend", file_name: "Ads.csv" }, { dataset_id: 2, metric_column: "orders", file_name: "Sales.csv" }],
  ...props,
}))

test("only selected evidence is listed; the full original snapshot is collapsed and escaped", () => {
  const html = render({ context: '<script>original evidence</script>' })
  const listing = html.match(/<ul[^>]*>([\s\S]*?)<\/ul>/)?.[1]
  assert.match(listing, /Ads\.csv \/ spend/)
  assert.match(listing, /Sales\.csv \/ orders/)
  assert.doesNotMatch(listing, /clicks|impressions|discounts/)
  assert.match(html, /<summary[^>]*>Original evidence record<\/summary>/)
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;original evidence/)
})

test("loading, unavailable and empty metric states never render an unfiltered list", () => {
  for (const props of [{ loading: true }, { unavailable: true }, { metrics: [] }]) {
    assert.doesNotMatch(render(props), /<ul/)
  }
})

test("decision details use scoped options without a dataset-wide fallback or duplicate raw context", () => {
  const source = readFileSync(new URL("../app/dashboard/decisions/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(source, /getDecisionMetricOptions\(/)
  assert.match(source, /options=\{joinedEvidenceMetricOptions\}/)
  assert.match(source, /metrics=\{\[\]\}/)
  assert.doesNotMatch(source, /getDatasetMetrics\(|metricColumns|Context: \{decision\.recommendation_context\}/)
  assert.equal((source.match(/context=\{decision\.recommendation_context\}/g) || []).length, 1)
})

test("selected metric requests use the decision id and workspace authorization without stale read caching", async () => {
  const source = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getDecisionMetricOptions")
  assert.ok(declaration)
  let request
  const lookup = vm.runInNewContext(ts.transpileModule(`${declaration.getText(ast).replace(/^export /, "")}\ngetDecisionMetricOptions`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    API_URL: "https://api.decisionate.test", cleanPositiveIntegerId: Number,
    decisionHeaders: async () => ({ Authorization: "Bearer test", "X-Workspace-Id": "workspace" }),
    apiFetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ metrics: [fields[0], fields[2]] }) } },
  })
  const response = await lookup(55, "owner", "workspace")
  assert.equal(request.url, "https://api.decisionate.test/decisions/55/metric-options")
  assert.equal(request.options.cache, "no-store")
  assert.equal(request.options.headers.Authorization, "Bearer test")
  assert.equal(request.options.headers["X-Workspace-Id"], "workspace")
  assert.equal(response.metrics.length, 2)
})
