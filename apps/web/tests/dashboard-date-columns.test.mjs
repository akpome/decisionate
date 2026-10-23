import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, name)
  return found.getText(ast)
}
function load(code, globals = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loadedModule, exports: loadedModule.exports, require, ...globals })
  return loadedModule.exports
}
const { getDashboardDateColumns, getDashboardDateColumn } = load([
  declaration("getDashboardDateColumns"), declaration("getDashboardDateColumn"),
  "export { getDashboardDateColumns, getDashboardDateColumn }",
].join("\n"), { isInternalSummaryColumn: value => value.startsWith("__"),
  getDashboardAutoMetricMapping: () => ({ date: "CloseDate" }) })

test("date choices use validated metadata instead of every text dimension", () => {
  const dataset = { date_columns: ["date", "paid_date", "date", "", "__summary"], chart: { x_key: "date", data: [{ region: "East", date: "2026-01-01" }] } }
  assert.deepEqual([...getDashboardDateColumns(dataset)], ["date", "paid_date"])
  assert.deepEqual([...getDashboardDateColumns({ ...dataset, date_columns: [] })], [])
  assert.deepEqual([...getDashboardDateColumns({ chart: dataset.chart })], ["date"])
  assert.deepEqual([...getDashboardDateColumns({ chart: dataset.chart, metric_profile: { time_columns: ["date", "paid_date"] } })], ["date", "paid_date"])
  assert.deepEqual([...getDashboardDateColumns(null)], [])
})

test("saved dates override connector defaults and Salesforce defaults match the displayed trend", () => {
  const dataset = { chart: { x_key: "CreatedDate" } }, columns = ["CreatedDate", "CloseDate"]
  assert.equal(getDashboardDateColumn(dataset, columns, "salesPerformance", {}), "CloseDate")
  assert.equal(getDashboardDateColumn(dataset, columns, "salesPerformance", { date: "CreatedDate" }), "CreatedDate")
  assert.equal(getDashboardDateColumn(dataset, columns, "salesPerformance", { date: "region" }), "CloseDate")
})

test("the API preference cleaner preserves General Business dates without adding industry mappings", () => {
  const input = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const apiAst = ts.createSourceFile("api.ts", input, ts.ScriptTarget.Latest, true)
  const helpers = ["cleanDashboardPreference", "cleanDashboardPreferenceMapping"].map(name => apiAst.statements.find(node => node.name?.text === name).getText(apiAst))
  const no = () => false
  const { cleanDashboardPreference } = load(helpers.join("\n") + "\nexport { cleanDashboardPreference }", {
    defaultDashboardKey: "general-business", isDashboardKey: value => ["general-business", "sales-performance"].includes(value),
    dashboardUsesDatasetMetricMapping: value => value === "salesPerformance", getDashboardDefinition: () => ({ componentKey: "generalBusiness" }),
    getCleanDashboardPreferenceText: () => undefined, maxDashboardTitleLength: 120, maxDashboardSubtitleLength: 220,
    isChartType: no, isDashboardAggregation: no, isDashboardValueAggregation: no, isScaleMode: no, isPeriodFilter: no, isDashboardTemplate: no,
  })
  const cleaned = cleanDashboardPreference({ metricMappings: { "general-business": { date: "paid_date", primary: "spend" } } })
  assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), { metricMappings: { "general-business": { date: "paid_date" } } })
})

test("changing a date keeps other mappings and dashboard scopes, while clearing an old date window", () => {
  for (const [column, joined] of [["paid_date", false], ["region", false], ["paid_date", true]]) {
    let mappings = { other: { date: "created" } }, start = "2026-01-01"
    const { handleDateColumnChange } = load([
      declaration("getNextDashboardMetricMapping"), declaration("handleDateColumnChange"), "export { handleDateColumnChange }",
    ].join("\n"), { dashboardDateColumns: ["date", "paid_date"], joinedDatasetResult: joined ? {} : null,
      currentMetricMapping: { primary: "spend", category: "region" }, dashboardMappingKey: "retail-performance:1",
      setDashboardMetricMappings: update => { mappings = update(mappings) }, setStartDate: value => { start = value }, setTemporaryShareStatus() {} })
    handleDateColumnChange(column)
    assert.equal(mappings.other.date, "created")
    if (column === "paid_date" && !joined) {
      assert.deepEqual(JSON.parse(JSON.stringify(mappings["retail-performance:1"])), { primary: "spend", category: "region", date: "paid_date" })
      assert.equal(start, "")
    } else assert.equal(mappings["retail-performance:1"], undefined)
  }
})

test("the shared date selector is labelled, preselected, and disabled for missing or normalized joined dates", () => {
  let selector
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "select"
      && node.openingElement.attributes.properties.some(attribute => attribute.name?.getText(ast) === "id" && attribute.initializer?.text === "dashboard-date-column")) selector = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(selector)
  for (const [columns, joined, disabled] of [[["date", "paid_date"], false, false], [[], false, true], [["period"], true, true]]) {
    const { DateControl } = load(`export function DateControl() { return (${selector.parent.getText(ast)}) }`, {
      dashboardDateColumns: columns, xKey: joined ? "period" : "paid_date", joinedDatasetResult: joined ? {} : null,
      loading: false, handleDateColumnChange() {},
    })
    const html = renderToStaticMarkup(React.createElement(DateControl))
    assert.match(html, /for="dashboard-date-column"[^>]*>Date column<\/label>/)
    assert.equal(/disabled=""/.test(html), disabled)
    if (columns.includes("paid_date")) assert.match(html, /value="paid_date" selected=""/)
    if (!columns.length) assert.match(html, /No date columns available/)
  }
})

test("all dataset layouts share one aligned selector and chart toolbars do not duplicate it", () => {
  assert.match(source, /selectedDashboardNeedsDataset && selectedDatasetId && userId/)
  assert.ok((source.match(/\{dimensionControls\}/g) || []).length >= 2)
  assert.match(source, /@min-\[28rem\]:grid-cols-\[minmax\(0,1fr\)_minmax\(0,3fr\)\]/)
  assert.match(source, /value=\{dimensionFilter\} embedded/)
  assert.doesNotMatch(declaration("DashboardControls"), /Date column|setDateColumn|dateColumns/)
  assert.match(source, /dateColumn: analysisDateColumn/)
  assert.match(source, /ai_analysis_date_column: result.date_column/)
  assert.match(source, /dashboardAnomalies\?\.date_column === analysisDateColumn/)
})

test("joined source date and dimension controls share an aligned row before metric selection", () => {
  const join = readFileSync(new URL("../features/dashboard/components/dataset-join-panel.tsx", import.meta.url), "utf8")
  assert.match(join, /@min-\[28rem\]:grid-cols-\[minmax\(0,1fr\)_minmax\(0,3fr\)\]/)
  assert.match(join, /htmlFor=\{`join-date-column-\$\{item.dataset_id\}`\}/)
  assert.match(join, /embedded disabled=\{joining \|\| loadingMetadata\}/)
  assert.ok(join.indexOf("<DatasetDimensionFilter") < join.indexOf('{t("Metrics or columns to include")}'))
})
