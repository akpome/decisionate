import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const React = require("react"), ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
function compile(path, imports = {}) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 } }).outputText
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => imports[name] ?? require(name) })
  return loaded.exports
}
const types = compile("../features/relationships/types.ts")
const { RelationshipMatrix } = compile("../features/relationships/relationship-matrix.tsx", { "./types": types })
const metric = (id, label = "Revenue") => ({ id: `${id}:revenue`, dataset_id: id, metric_key: "revenue", label, dataset_label: `Source ${id}`, unit: "CAD", currency: "CAD" })

test("metric identity includes source dataset", () => {
  assert.notEqual(types.metricIdentity(metric(1)), types.metricIdentity(metric(2)))
})
test("zero coefficients are not represented as insufficient", () => {
  assert.equal(types.heatmapColor(null), "#e5e7eb")
  assert.equal(types.heatmapColor(0), "#ffffff")
  assert.equal(types.coefficientText(null), "Not available")
  assert.equal(types.coefficientText(0), "0.00")
})
test("matrix exposes source, lag, n and reliability to keyboard and hover", () => {
  const matrix = { metrics: [metric(1), metric(2)], cells: [{ a: "1:revenue", b: "2:revenue", result_id: "pair-1", coefficient: .75, n: 40, lag: 2, reliability: "exploratory" }], method: "pearson", grain: "daily", window: { start: "2026-01-01", end: "2026-02-01" } }
  const html = renderToStaticMarkup(React.createElement(RelationshipMatrix, { matrix, onSelect() {} }))
  assert.ok(html.includes("Pairwise correlation coefficients"))
  assert.ok(html.includes("lag 2 shared periods, n=40, exploratory"))
  assert.equal((html.match(/<button/g) ?? []).length, 2)
  assert.ok(html.includes("Filter matrix"))
  assert.ok(html.includes("Coefficient legend"))
})
test("large historical matrices virtualize rows", () => {
  const matrix = { metrics: Array.from({ length: 50 }, (_, i) => metric(i)), cells: [], method: "spearman", grain: "monthly", window: { start: "2026-01-01", end: "2026-02-01" } }
  const html = renderToStaticMarkup(React.createElement(RelationshipMatrix, { matrix, onSelect() {} }))
  assert.ok(html.includes('aria-rowcount="51"'))
  assert.equal((html.match(/role="rowheader"/g) ?? []).length, 16)
  assert.ok((html.match(/<button/g) ?? []).length < 1000)
})
test("basic preview remains while advanced job submission has no frontend entry point", () => {
  const old = readFileSync(new URL("../app/dashboard/relationships/page.tsx", import.meta.url), "utf8")
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  assert.ok(old.includes("previewDatasetRelationship"))
  assert.ok(!old.includes("CorrelationEntry"))
  assert.ok(api.includes("/api/v2${path}"))
  const archive = readFileSync(new URL("../features/reports/historical-relationship-evidence.tsx", import.meta.url), "utf8")
  assert.ok(!archive.includes('method: "POST"'))
  assert.ok(!archive.includes("/correlation-capabilities"))
})
test("saved widget rollback does not clear previous results", () => {
  const source = readFileSync(new URL("../features/relationships/correlation-widgets.tsx", import.meta.url), "utf8")
  assert.ok(source.includes("Previous results retained."))
  assert.ok(!source.slice(0, source.indexOf("export function CorrelationInsights")).includes("setItems([])"))
  assert.ok(!source.includes("if (!capabilities.ui)"))
  assert.ok(source.includes("Saved relationship insights"))
  assert.ok(source.includes("Historical snapshot"))
  assert.ok(!source.includes("Refresh relationship analysis"))
  assert.ok(!source.includes("/correlation-analyses/"))
  assert.ok(!source.includes("setTimeout"))
})
