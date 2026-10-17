import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../features/dashboards/dashboard-registry.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("registry.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function containsJsx(node) {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
    || Boolean(ts.forEachChild(node, child => containsJsx(child)))
}
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && !containsJsx(node))
const salesConfig = ast.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "salesDashboardConfig"))
assert.ok(salesConfig)
function load(code, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: loaded, exports: loaded.exports, ...globals })
  return loaded.exports
}
const summary = load(readFileSync(new URL("../features/dashboard/lib/summary-aggregation.ts", import.meta.url), "utf8"))
const { getDashboardAutoMetricMapping, buildMappedIndustryDashboard, salesDashboardConfig } = load([
  salesConfig.getText(ast), ...functions.map(node => node.getText(ast)),
  "export { buildMappedIndustryDashboard, salesDashboardConfig }",
].join("\n"), {
  ...summary, industryDashboardConfigs: {}, dashboardChartPalette: ["blue", "green", "red"],
})
const row = {
  ExpectedRevenue: 6000, TotalOpportunityQuantity: 3, CreatedDate: "2026-10-01",
  OwnerId: "005-owner", AccountId: "001-account", Amount: 12000,
  CloseDate: "2026-11-01", StageName: "Proposal", LeadSource: "Web",
  Probability: 50, __metric_record_count: 1,
}
const dataset = { preview: [row], chart: { x_key: "CreatedDate" } }

test("Opportunity defaults map value, forecast, close date, stage and source regardless of column order", () => {
  const mapping = getDashboardAutoMetricMapping("salesPerformance", dataset)
  assert.deepEqual(JSON.parse(JSON.stringify(mapping)), {
    primary: "Amount", secondary: "ExpectedRevenue", operationsValue: "Amount",
    category: "LeadSource", stage: "StageName", date: "CloseDate",
  })
})

test("Opportunity values are not labelled booked revenue and probability is not a win rate", () => {
  const mapped = buildMappedIndustryDashboard(salesDashboardConfig, dataset)
  assert.equal(mapped.metrics[0].label, "Opportunity Value")
  assert.equal(mapped.metrics[1].value, "1")
  assert.equal(mapped.metrics[2].value, "Needs mapping")
  assert.equal(mapped.metrics[3].label, "Expected Revenue")
  assert.equal(mapped.secondaryTrendLabel, "ExpectedRevenue")
  assert.equal(mapped.trendDateLabel, "CloseDate")
  assert.doesNotMatch(mapped.mixDescription, /closed revenue/i)
})

test("manual chart mappings still take precedence over Salesforce defaults", () => {
  const mapped = buildMappedIndustryDashboard(salesDashboardConfig, dataset, {
    primary: "ExpectedRevenue", date: "CreatedDate", category: "OwnerId", stage: "LeadSource",
  })
  assert.equal(mapped.trendLabel, "ExpectedRevenue")
  assert.equal(mapped.trendDateLabel, "CreatedDate")
  assert.equal(mapped.secondaryTrendLabel, undefined)
  assert.match(mapped.mixDataLabel, /OwnerId/)
  assert.match(mapped.operationsDataLabel, /LeadSource/)
})

test("missing monetary fields do not turn product quantity into revenue", () => {
  const withoutMoney = { ...row }
  delete withoutMoney.Amount
  delete withoutMoney.ExpectedRevenue
  const mapping = getDashboardAutoMetricMapping("salesPerformance", { preview: [withoutMoney] })
  assert.equal(mapping.primary, undefined)
  assert.equal(mapping.secondary, undefined)
  const mapped = buildMappedIndustryDashboard(salesDashboardConfig, { preview: [withoutMoney] })
  assert.equal(mapped.metrics[0].label, "Data readiness")
})

test("expected revenue alone is not mapped to both sides of the trend", () => {
  const forecastOnly = { ...row }
  delete forecastOnly.Amount
  const mapped = getDashboardAutoMetricMapping("salesPerformance", { preview: [forecastOnly] })
  assert.equal(mapped.primary, "ExpectedRevenue")
  assert.equal(mapped.secondary, undefined)
})

test("restricted Opportunity schemas still avoid mapping quantity as revenue", () => {
  const mapping = getDashboardAutoMetricMapping("salesPerformance", {
    preview: [{ object_type: "Opportunity", TotalOpportunityQuantity: 3, CreatedDate: "2026-10-01" }],
  })
  assert.equal(mapping.primary, undefined)
  assert.equal(mapping.secondary, undefined)
  assert.equal(mapping.date, "CreatedDate")
})

test("other sales datasets keep their existing name-based mappings", () => {
  const mapping = getDashboardAutoMetricMapping("salesPerformance", {
    preview: [{ booked_revenue: 100, pipeline: 200, date: "2026-10-01", source: "Web", status: "Won" }],
  })
  assert.equal(mapping.primary, "booked_revenue")
  assert.equal(mapping.secondary, "pipeline")
  assert.equal(mapping.date, "date")
})
