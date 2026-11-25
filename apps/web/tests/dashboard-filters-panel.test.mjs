import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate) {
  let found
  function visit(node) {
    if (predicate(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found)
  return found
}
function attribute(node, name) {
  return node.openingElement?.attributes.properties.find(item => item.name?.getText(ast) === name)?.initializer?.text
}
const toggle = find(node => ts.isJsxElement(node) && attribute(node, "id") === "dashboard-filters-toggle")
const controls = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "dimensionControls")
const icon = () => React.createElement("span", { "aria-hidden": true })
function load(code, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require, ...globals })
  return loaded.exports
}
function panel(overrides = {}) {
  const filter = React.createElement("fieldset", null,
    React.createElement("label", null, "Dimension column"), React.createElement("span", null, "region: East"))
  return load(`export function Panel() { return (${controls.initializer.getText(ast)}) }`, {
    selectedDashboardNeedsDataset: true, selectedDatasetId: 1, userId: "owner", activeWorkspaceId: "workspace",
    showFiltersPanel: false, dashboardDateColumns: ["date", "paid_date"], xKey: "paid_date", loading: false,
    joinedDatasetResult: null, dimensionContext: "workspace:1", dimensionFilter: { column: "region", values: ["East"] },
    dimensionData: { data: { id: 1 } }, allRows: [{ spend: 10 }], handleDateColumnChange() {}, setDimensionSelection() {},
    metricDimensionFilter: filter, showGroupComparison: false, canCompareGroups: true, dashboardEditMode: false,
    Settings2: icon, RefreshCw: icon, ...overrides,
  }).Panel
}

test("Filters sits alongside the existing toolbar controls and toggles an accessible panel", () => {
  let parent = toggle.parent
  while (parent && !ts.isVariableDeclaration(parent)) parent = parent.parent
  assert.equal(parent?.name.getText(ast), "dashboardManagementActions")
  assert.match(source, /\[showFiltersPanel, setShowFiltersPanel\]\s*=\s*useState\(false\)/)
  for (const open of [false, true]) {
    let next = open
    const { Toggle } = load(`export function Toggle() { return (${toggle.getText(ast)}) }`, {
      showFiltersPanel: open, setShowFiltersPanel: update => { next = update(next) }, SlidersHorizontal: icon,
    })
    const element = Toggle(), html = renderToStaticMarkup(element)
    assert.match(html, new RegExp(`aria-expanded="${open}"`))
    assert.match(html, /aria-controls="dashboard-filters-panel"/)
    assert.match(html, /h-9 items-center/)
    element.props.onClick()
    assert.equal(next, !open)
  }
})

test("the closed Filters panel preserves the selected date and dimension without duplicate selectors", () => {
  for (const open of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(panel({ showFiltersPanel: open })))
    assert.match(html, /role="region" aria-labelledby="dashboard-filters-toggle"/)
    assert.equal(html.includes('hidden=""'), !open)
    assert.match(html, /value="paid_date" selected=""/)
    assert.match(html, /Dimension column/)
    assert.match(html, /region: East/)
    assert.equal((html.match(/id="dashboard-date-column"/g) || []).length, 1)
  }
})

test("filter failures and pending reads stay visible even while the selector panel is closed", () => {
  for (const [state, expected] of [
    [{ pending: true }, "Loading filtered dashboard..."],
    [{ error: "Filtered read failed" }, "Filtered read failed"],
    [{ data: { id: 1 } }, "No rows match the selected dimension values."],
  ]) {
    const html = renderToStaticMarkup(React.createElement(panel({ dimensionData: state, allRows: [] })))
    assert.match(html, /hidden=""/)
    assert.ok(html.indexOf(expected) > html.indexOf("</section>"))
  }
})

test("dashboards without a dataset do not expose date and dimension controls", () => {
  for (const scope of [{ selectedDashboardNeedsDataset: false }, { selectedDatasetId: undefined }, { userId: "" }]) {
    assert.equal(renderToStaticMarkup(React.createElement(panel(scope))), "")
  }
})

test("the normal dimension control appears in Select Metrics without duplicating the date filter", () => {
  for (const scope of [{ dashboardEditMode: true }, { showGroupComparison: true }]) {
    const html = renderToStaticMarkup(React.createElement(panel({ showFiltersPanel: true, ...scope })))
    assert.match(html, /Date column/)
    assert.doesNotMatch(html, /Dimension column/)
  }
  assert.match(source, /<CompareGroupsEditor[\s\S]+?\{metricDimensionFilter\}/)
})

test("Compare Groups is visible in Edit dashboard with a joined dataset selected", () => {
  const panels = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "generalDashboardManagementPanels")
  const { Editor } = load(`export function Editor() { return (${panels.initializer.getText(ast)}) }`, {
    dimensionControls: null, canCompareGroups: false, dashboardEditMode: true, groupPreference: null,
    groupTabActive: true, showJoinPanel: false, canConfigureWorkspace: true, t: text => text,
  })
  const html = renderToStaticMarkup(React.createElement(Editor))
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Compare Groups<\/button>/)
  assert.match(html, /role="tab"[^>]*aria-selected="false"[^>]*>Select Metrics<\/button>/)
  assert.match(html, /role="tabpanel" aria-labelledby="dashboard-groups-tab"/)
  assert.match(html, /Choose a source dataset instead of a joined dataset to compare groups\./)
})

test("the General Business target metric picker is in Select Metrics, not beside the dataset", () => {
  const panels = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "generalDashboardManagementPanels")
  const primaryMetricFields = React.createElement("input", { "aria-label": "Target metric" })
  const { Editor } = load(`export function Editor() { return (${panels.initializer.getText(ast)}) }`, {
    dimensionControls: null, dashboardEditMode: true, groupPreference: null, groupTabActive: false, showJoinPanel: false,
    canConfigureWorkspace: true, primaryMetricFields, t: text => text, metricDimensionFilter: null, metrics: [],
  })
  const html = renderToStaticMarkup(React.createElement(Editor))
  assert.match(html, /role="tabpanel" aria-labelledby="dashboard-metrics-tab".*aria-label="Target metric"/)
  assert.match(html, /class="@container [^"]*"[^>]*>.*class="[^"]*@min-\[28rem\]:grid-cols-2 @min-\[46rem\]:grid-cols-4"/)
  const header = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "header" &&
    node.getText(ast).includes("Open dataset details"))
  assert.doesNotMatch(header.getText(ast), /MetricSelector|primaryMetricFields/)
})

test("the KPI picker defaults to no metric and clearing it leaves chart selection alone", () => {
  const target = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "targetMetric")
  for (const [selection, expected] of [
    [undefined, ""],
    [{ context: "dataset:1", value: "orders" }, "orders"],
    [{ context: "dataset:2", value: "orders" }, ""],
    [{ context: "dataset:1", value: "removed" }, ""],
  ]) {
    const { targetMetric } = load(`export const ${target.getText(ast)}`, {
      dimensionContext: "dataset:1", availableMetricColumns: ["revenue", "orders"], targetMetricSelection: selection,
    })
    assert.equal(targetMetric, expected)
  }
  const handler = find(node => ts.isFunctionDeclaration(node) && node.name?.getText(ast) === "handleTargetMetricChange")
  const changes = []
  const { handleTargetMetricChange } = load(`export ${handler.getText(ast)}`, {
    availableMetricColumns: ["revenue", "orders"], dimensionContext: "dataset:1",
    setTargetMetricSelection: selection => changes.push([selection.context, selection.value]),
  })
  handleTargetMetricChange("orders")
  handleTargetMetricChange(undefined)
  handleTargetMetricChange("removed")
  assert.deepEqual(changes, [["dataset:1", "orders"], ["dataset:1", ""]])
  assert.match(source, /metric=\{targetMetric\}\s+metricLabel="Target metric"\s+placeholder="Choose a metric"/)
})

test("executive, performance, and PDF layouts keep the main chart and only show the gauge after a target metric is chosen", () => {
  function Panel({ children, className }) { return React.createElement("section", { className }, children) }
  function GaugeMarker() { return React.createElement("span", { "data-target-gauge": true }) }
  function ChartMarker({ metrics, target }) {
    return React.createElement("div", { "data-chart-metrics": metrics.join(","), "data-chart-target": target })
  }
  function Title({ title }) { return React.createElement("h3", null, title) }
  function Value({ value }) { return React.createElement("span", null, value) }
  const globals = {
    getDashboardChartDescription: () => "Chart", getDashboardDatasetDescription: () => "Dataset",
    formatMetricName: value => value, formatNumber: value => value, getTargetInsight: () => "",
    ResponsiveContainer: Panel, FullscreenChartArea: Panel, DashboardCard: Panel,
    TargetGauge: GaugeMarker, MainChart: ChartMarker, CardHeader: Title, SnapshotRow: Value, PrintMetricLine: Value,
    DashboardControls: icon, KpiCarousel: icon, IconBadge: icon, Gauge: icon, LineChartIcon: icon,
    WorkspaceBrandMark: icon, maxDashboardKpiCards: 8,
  }
  for (const name of ["ReportSection", "PerformanceTemplate", "DashboardPrintPage"]) {
    const template = find(node => ts.isFunctionDeclaration(node) && node.name?.getText(ast) === name)
    const Component = load(`export ${template.getText(ast)}`, globals)[name]
    for (const targetMetric of ["", "orders"]) {
      const props = {
        primaryMetric: "revenue", targetMetric, selectedMetrics: ["revenue"], metrics: [], chartRows: [{}],
        scaleMode: "actual", dateRange: { start: "2026-01-01", end: "2026-12-31" }, selectedTarget: targetMetric ? 100 : 0, chartTarget: 0,
      }
      const html = renderToStaticMarkup(React.createElement(Component,
        name === "DashboardPrintPage" ? { brand: { name: "Test" }, props } : props))
      assert.match(html, /data-chart-metrics="revenue" data-chart-target="0"/, name)
      assert.equal(html.includes("data-target-gauge"), Boolean(targetMetric), name)
      assert.equal(html.includes("dashboard-print-target-card"), Boolean(targetMetric), name)
      assert.match(html, /revenue (Trend|Performance)/, name)
      if (targetMetric) assert.match(html, />orders</, name)
    }
  }
})

test("the view switch keeps only Executive and Performance", () => {
  const templates = load(readFileSync(new URL("../features/dashboard/lib/dashboard-template.ts", import.meta.url), "utf8"))
  const toggle = find(node => ts.isJsxElement(node) && attribute(node, "aria-label") === "Dashboard template")
  const changes = []
  const { Switch } = load(`export function Switch() { return (${toggle.getText(ast)}) }`, {
    dashboardViewOptions: templates.dashboardViewOptions, dashboardTemplate: "executive",
    setDashboardTemplate: value => changes.push(value),
  })
  const ui = Switch()
  const html = renderToStaticMarkup(ui)
  assert.equal((html.match(/<button/g) || []).length, 2)
  assert.match(html, /aria-pressed="true"[^>]*>Executive<\/button>/)
  assert.match(html, /aria-pressed="false"[^>]*>Performance<\/button>/)
  assert.doesNotMatch(html, /Comparison/)
  React.Children.toArray(ui.props.children).at(-1).props.onClick()
  assert.deepEqual(changes, ["performance"])
  assert.equal(templates.resolveDashboardTemplate("comparison"), "executive")
  assert.equal(templates.resolveDashboardTemplate("performance"), "performance")
})

test("legacy shared Comparison links keep their dataset and token and use Executive instead", () => {
  const { resolveDashboardTemplate } = load(readFileSync(new URL("../features/dashboard/lib/dashboard-template.ts", import.meta.url), "utf8"))
  const sharedSource = readFileSync(new URL("../app/share/dashboard/page.tsx", import.meta.url), "utf8")
  const shared = ts.createSourceFile("shared.tsx", sharedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const parse = shared.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getSharedDashboardConfig")
  assert.ok(parse)
  const { getSharedDashboardConfig } = load(`export ${parse.getText(shared)}`, {
    URLSearchParams, resolveDashboardTemplate, getQueryDatasetId: Number, isDashboardKey: value => value === "general-business",
  })
  const config = getSharedDashboardConfig("dataset=73&dashboard=general-business&template=comparison&token=example")
  assert.equal(config.datasetId, 73)
  assert.equal(config.selectedDashboard, "general-business")
  assert.equal(config.token, "example")
  assert.equal(config.dashboardTemplate, "executive")
  assert.match(sharedSource, /resolveDashboardTemplate\(effectDashboardTemplate \?\? dashboardPreference.dashboardTemplate\)/)
  assert.doesNotMatch(sharedSource, /effectiveDashboardTemplate === "comparison"/)
})

test("Compare Groups uses the shared controls and carries chart type and scale into its PDF", () => {
  const renders = []
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "DashboardGroupChart") renders.push(node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(renders.length, 2)
  for (const render of renders) {
    assert.match(render, /chartType=\{chartType\}/)
    assert.match(render, /scaleMode=\{scaleMode\}/)
  }
  assert.match(renders[0], /print/)
  assert.match(renders[1], /<DashboardControls.*scaleMode=\{scaleMode\}/)
})

test("General Business keeps its toolbar and Filters panel accessible when dimension data is blocked", () => {
  const toolbar = find(node => ts.isJsxElement(node) && attribute(node, "className") === "dashboard-management-toolbar print:hidden")
  let condition = toolbar.parent
  while (condition && !ts.isJsxExpression(condition)) condition = condition.parent
  assert.match(condition.getText(ast), /dataset && !loading/)
  assert.doesNotMatch(condition.getText(ast), /dimensionBlocked/)
  assert.match(condition.getText(ast), /generalDashboardManagementPanels/)
  const panels = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "generalDashboardManagementPanels")
  assert.match(panels.getText(ast), /\{dimensionControls\}/)
  assert.match(source, /managementPanels=\{<>\{dimensionControls\}\{dashboardManagementPanels\}<\/?>\}/)
  assert.match(source, /dataset && !loading && !showGroupComparison && !dimensionBlocked &&/)
})
