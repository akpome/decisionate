import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const page = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
const registry = readFileSync(new URL("../features/dashboards/dashboard-registry.tsx", import.meta.url), "utf8")

function load(source, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] ?? require(name) })
  return loaded.exports
}
const definitions = load(readFileSync(new URL("../features/dashboards/dashboard-definitions.ts", import.meta.url), "utf8"))
const { dashboardRegistry } = load(registry, {
  "@/lib/api": { getDecisionSummary: () => assert.fail("Rendering a dashboard must not request analysis") },
  "@clerk/nextjs": { useUser: () => ({ user: { id: "owner" } }) },
  "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: "workspace", workspaceVersion: 0 }) },
  "@/app/dashboard/workspace-brand-mark": { WorkspaceBrandMark: () => React.createElement("span", null, "Decisionate") },
  "@/features/dashboard/lib/chart-palette": load(readFileSync(new URL("../features/dashboard/lib/chart-palette.ts", import.meta.url), "utf8")),
  "@/features/dashboard/lib/summary-aggregation": load(readFileSync(new URL("../features/dashboard/lib/summary-aggregation.ts", import.meta.url), "utf8")),
})
const analysis = {
  summary: "REMOVED_ANALYSIS_CONTENT", metric: "revenue", risks: ["REMOVED_ANALYSIS_RISK"],
  recommendations: ["REMOVED_ANALYSIS_RECOMMENDATION"], confidence: "high",
}
const rows = [
  { date: "2026-01-01", revenue: 100, spend: 20, orders: 5, region: "East", stage: "Won" },
  { date: "2026-02-01", revenue: 200, spend: 40, orders: 10, region: "West", stage: "Open" },
]
const dataset = {
  row_count: 2, preview: rows, chart: { data: rows, x_key: "date" }, ai_analysis: analysis,
  metrics: ["revenue", "spend", "orders"].map(column => ({ column, total: rows.reduce((sum, row) => sum + row[column], 0) })),
}
const decisionSummary = {
  total: 4, outcomes_evaluated: 2, outcomes_pending: 2, outcomes_recorded: 2, outcomes_planned: 4,
  learning_captured: 1, learning_pending: 3, reviews_overdue: 1, attention_required: 2,
  by_outcome_status: { successful: 1, partially_successful: 1 }, by_category: { marketing: 4 },
  by_created_month: { "2026-01": 4 }, ai_analysis: analysis,
}

test("the dashboard page removes Analysis controls, their content, state and background AI fetches", () => {
  assert.doesNotMatch(page, /getDatasetAIAnalysis|AIAnalysisPanel|AnalysisStatus|DashboardIntelligence/)
  assert.doesNotMatch(page, /showAnalysisPanel|showGeneralDecisionatePanel|metricAnalysis/)
  assert.doesNotMatch(page, /general-dashboard-decisionate-panel|industry-dashboard-analysis-panel/)
  assert.match(page, /includeAIAnalysis: false/)
  assert.match(page, /getDatasetAnomalies\(/)
  assert.match(page, /\{dimensionControls\}/)
  assert.match(page, /<DatasetJoinPanel/)
  assert.match(page, /"Metrics & Targets"/)
})

test("the shared dashboard renderer has no Analysis panels or analysis-only props", () => {
  assert.doesNotMatch(registry, /AIAnalysisPanel|AnalysisStatus|SalesDecisionateAnalysis|ai_analysis/)
  assert.doesNotMatch(registry, /showAnalysisPanel|analysisLoading|analysisMetric|analysisError|onRetryAnalysis/)
  const shared = readFileSync(new URL("../app/share/dashboard/page.tsx", import.meta.url), "utf8")
  assert.match(shared, /dashboardRegistry/)
  assert.doesNotMatch(shared, /AIAnalysisPanel|Decisionate Analysis/)
})

for (const definition of definitions.dashboardDefinitions.filter(item => item.componentKey !== "generalBusiness")) {
  for (const mode of ["private", "shared", "export"]) {
    test(`${definition.name} keeps charts and appropriate controls without Analysis content (${mode})`, () => {
      const privateView = mode === "private"
      const html = renderToStaticMarkup(React.createElement(dashboardRegistry[definition.componentKey], {
        ...definition, dataset, decisionSummary, showActions: privateView, exportMode: mode === "export",
        controls: React.createElement("div", null, "PRESERVED_DASHBOARD_CONTROLS"),
        managementPanels: privateView ? React.createElement("div", null, "PRESERVED_DATASET_FILTERS") : null,
      }))
      assert.match(html, new RegExp(definition.name.replaceAll("&", "&amp;")))
      assert.match(html, /dashboard-export-chart-grid/)
      assert.doesNotMatch(html, /Decisionate Analysis|Decisionate intelligence|REMOVED_ANALYSIS_/)
      assert.equal(html.includes("PRESERVED_DASHBOARD_CONTROLS"), privateView)
      if (definition.componentKey === "decisionPerformance") {
        assert.match(html, /Total Decisions/)
        assert.match(html, /Outcome Results/)
      } else {
        assert.equal(html.includes("PRESERVED_DATASET_FILTERS"), privateView)
      }
    })
  }
}
