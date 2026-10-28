import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, imports = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name), URLSearchParams, ...globals })
  return loaded.exports
}
const { legacyInsightsDestination } = load("../features/reports/legacy-insights-destination.ts")

test("old Insights links default to the multi dataset Reports workflow", () => {
  assert.equal(legacyInsightsDestination({}), "/dashboard/reports")
})

test("old dataset and metric links retain their exact scope through the redirect", () => {
  const url = new URL(legacyInsightsDestination({ dataset: "12", metric: "net sales & returns" }), "https://decisionate.ca")
  assert.equal(url.pathname, "/dashboard/reports/dataset")
  assert.equal(url.searchParams.get("dataset"), "12")
  assert.equal(url.searchParams.get("metric"), "net sales & returns")
})

test("saved report, weekly and advanced-run links take precedence over dataset hints", () => {
  for (const key of ["report", "weekly", "run"]) {
    const url = new URL(legacyInsightsDestination({ dataset: "12", [key]: "saved-id" }), "https://decisionate.ca")
    assert.equal(url.pathname, "/dashboard/reports")
    assert.equal(url.searchParams.get(key), "saved-id")
  }
})

test("redirect destinations are internal and ignore arrays and unknown return URLs", () => {
  assert.equal(legacyInsightsDestination({ dataset: ["1", "2"], returnTo: "https://attacker.example" }), "/dashboard/reports")
  assert.equal(legacyInsightsDestination({ report: "//attacker.example" }).startsWith("/dashboard/reports?"), true)
})

test("the Next route awaits searchParams and performs the server redirect", async () => {
  let destination
  const { default: Page } = load("../app/dashboard/insights/page.tsx", {
    "next/navigation": { redirect: value => { destination = value } },
    "@/features/reports/legacy-insights-destination": { legacyInsightsDestination },
  })
  await Page({ searchParams: Promise.resolve({ dataset: "5", metric: "orders" }) })
  assert.equal(destination, "/dashboard/reports/dataset?dataset=5&metric=orders")
})

test("Reports is the only navigation entry for both findings and saved analysis", () => {
  const source = read("../app/dashboard/dashboard-shell.tsx")
  const analysis = source.slice(source.indexOf('label: "Analysis"'), source.indexOf('label: "Data"'))
  assert.match(analysis, /href: "\/dashboard\/reports"/)
  assert.doesNotMatch(analysis, /label: "Insights"|dashboard\/insights/)
  assert.match(analysis, /label: "Forecasts"/)
  assert.match(analysis, /label: "Relationships"/)
})

test("single and multi routes share the same workspace, access checks and anomaly engine", () => {
  assert.match(read("../features/reports/single-dataset-report.tsx"), /<ReportPage scope="single"/)
  const page = read("../features/reports/report-page.tsx")
  assert.match(page, /scope = "multi"/)
  assert.match(page, /initialScope=\{scope\}/)
  assert.match(page, /canEditDecisions=\{access.canCreateDecisions\}/)
  const workspace = read("../features/reports/report-workspace.tsx")
  assert.match(workspace, /<ReportAnomalies analysis=\{report.anomaly_analysis\}/)
  assert.doesNotMatch(workspace, /analyzeMultipleDatasetMetrics|getDatasetAnomalies|generateInsights/)
})

test("single dataset selections replace another source; multi selections retain sources", () => {
  const source = read("../features/reports/report-workspace.tsx")
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "toggleMetric") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const single of [false, true]) {
    let patch
    const toggle = vm.runInNewContext(ts.transpileModule(declaration + "\ntoggleMetric", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      single, singleDatasetId: 2, setSelectedDatasetId() {}, datasetCount: 1, dateColumns: {}, definition: {
        metrics: [{ dataset_id: 1, metric_key: "spend" }], date_range: { start: "", end: "" },
      }, reportDateColumn: () => "date", edit: value => { patch = value },
    })
    toggle({ dataset_id: 2, metrics: [{ metric_key: "revenue", aggregation: "sum" }], availability: { date: { start: "2026-01-01", end: "2026-03-31" } } }, "revenue")
    assert.equal(patch.metrics.length, single ? 1 : 2)
    assert.equal(patch.metrics.at(-1).dataset_id, 2)
    assert.equal(patch.date_range.end, "2026-03-31")
  }
})

test("saved relationship insights remain accessible without entering the selected report evidence", () => {
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /<CorrelationInsights key=\{\x60\$\{userId\}:\$\{workspaceId\}\x60\}/)
  assert.match(read("../features/relationships/correlation-widgets.tsx"), /id="saved-relationship-insights"/)
  assert.match(read("../features/relationships/correlation-widgets.tsx"), /historicalEvidenceHref\(card.run_id, card.result_id\)/)
})

test("single dataset reports do not expose cross-source direction or weekly template controls", () => {
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /\{!single && !definition.impact && <section aria-label="Relationship analysis"/)
  assert.match(source, /!single && !weekly && canManage && report.report_id && <Link href=\{`\/dashboard\/reports\/weekly\?copy=/)
  assert.doesNotMatch(source, /saveWeeklyTemplate\(/)
})
