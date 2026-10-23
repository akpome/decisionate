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
  return load(`export function Panel() { return (${controls.initializer.getText(ast)}) }`, {
    selectedDashboardNeedsDataset: true, selectedDatasetId: 1, userId: "owner", activeWorkspaceId: "workspace",
    showFiltersPanel: false, dashboardDateColumns: ["date", "paid_date"], xKey: "paid_date", loading: false,
    joinedDatasetResult: null, dimensionContext: "workspace:1", dimensionFilter: { column: "region", values: ["East"] },
    dimensionData: { data: { id: 1 } }, allRows: [{ spend: 10 }], handleDateColumnChange() {}, setDimensionSelection() {},
    DatasetDimensionFilter: ({ value }) => React.createElement("fieldset", null,
      React.createElement("label", null, "Dimension column"), React.createElement("span", null, `${value.column}: ${value.values.join(", ")}`)),
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
  assert.match(source, /dataset && !loading && !dimensionBlocked &&/)
})
