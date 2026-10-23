import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../app/dashboard/relationships/page.tsx", import.meta.url), "utf8")
function declarations(source, names) {
  const tree = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = []
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.push(node.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(found.length, names.length)
  return found.join("\n")
}
function functions(names, globals = {}, input = source) {
  return vm.runInNewContext(ts.transpileModule(`${declarations(input, names)}\n({ ${names.join(", ")} })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: {}, require, ...globals })
}
const plain = value => JSON.parse(JSON.stringify(value))
const selection = { column: "region", values: ["East", null, "", "null"] }
function payloadHarness(extra = {}) {
  const errors = []
  const globals = { incompleteFilter: false, leftDatasetId: "1", rightDatasetId: "2", resolvedLeftDateColumn: "date",
    resolvedRightDateColumn: "paid_date", resolvedLeftMetric: "spend", resolvedRightMetric: "revenue", name: "Filtered monitor",
    period: "monthly", aggregation: "sum", method: "pearson", lagMode: "manual", lagPeriods: "0",
    leftFilter: undefined, rightFilter: undefined, setError: error => errors.push(error), ...extra }
  return { ...functions(["buildPayload"], globals), errors }
}

test("each relationship side submits its exact independent column and value filter", () => {
  const right = { column: "channel", values: ["Web"] }
  const result = plain(payloadHarness({ leftFilter: selection, rightFilter: right }).buildPayload())
  assert.deepEqual(result.left.dimension_filter, selection)
  assert.deepEqual(result.right.dimension_filter, right)
  assert.equal(result.left.dataset_id, 1)
  assert.equal(result.right.dataset_id, 2)
})

test("all-rows relationships preserve their original payload and incomplete selections cannot submit", () => {
  const original = payloadHarness().buildPayload()
  assert.equal(original.left.dimension_filter, undefined)
  assert.equal(original.right.dimension_filter, undefined)
  const pending = payloadHarness({ incompleteFilter: true })
  assert.equal(pending.buildPayload(), null)
  assert.match(pending.errors[0], /unique value/)
})

test("each dataset side renders the shared dropdown control with current workspace and disabled state", () => {
  const controls = []
  const { RelationshipSide } = functions(["RelationshipSide", "SelectField"], {
    useDecisionateText: () => ({ t: value => value }),
    useId: React.useId,
    DatasetDimensionFilter: props => { controls.push(props); return React.createElement("span", null, "Dimension column") },
  })
  const html = renderToStaticMarkup(React.createElement(RelationshipSide, { label: "Dataset A", datasets: [], datasetId: "7",
    dateColumn: "date", metric: "revenue", onDatasetChange() {}, onDateChange() {}, onMetricChange() {}, userId: "owner",
    workspaceId: "workspace", filterContext: "context-7", dimensionFilter: selection, onDimensionFilterChange() {}, disabled: true }))
  assert.match(html, /<fieldset disabled="" aria-label="Dataset A"/)
  assert.match(html, /Dimension column/)
  assert.equal(controls.length, 1)
  assert.equal(controls[0].datasetId, 7)
  assert.equal(controls[0].workspaceId, "workspace")
  assert.equal(controls[0].value, selection)
  assert.equal(controls[0].disabled, true)
})

test("opening a saved monitor restores both filters without overwriting another workspace", () => {
  let filters = { "old-workspace": { column: "region", values: ["Private"] } }, result
  const globals = { filterKey: identity => `owner:workspace:${identity}`, setDimensionFilters: update => { filters = update(filters) },
    setResult: value => { result = value }, setStatusMessage() {}, setError() {} }
  for (const name of ["setLeftDatasetId", "setRightDatasetId", "setLeftDateColumn", "setRightDateColumn", "setLeftMetric", "setRightMetric", "setName", "setPeriod", "setAggregation", "setMethod", "setLagMode", "setLagPeriods"]) globals[name] = () => {}
  const record = { name: "Saved", period: "daily", aggregation: "sum", method: "pearson", lag_periods: 0,
    left: { dataset_id: 1, date_column: "date", metric_column: "spend", dimension_filter: selection },
    right: { dataset_id: 2, date_column: "date", metric_column: "revenue", dimension_filter: { column: "channel", values: ["Web"] } } }
  functions(["openSavedRelationship"], globals).openSavedRelationship(record)
  assert.deepEqual(filters["owner:workspace:1"], selection)
  assert.deepEqual(filters["owner:workspace:2"], record.right.dimension_filter)
  assert.equal(filters["old-workspace"].values[0], "Private")
  assert.equal(result, record)
})

test("late previews cannot replace evidence after the workspace or filter changes", async () => {
  for (const changed of [true, false]) {
    let complete, result
    const currentSetup = { current: "original" }
    const view = functions(["handlePreview"], { user: { id: "owner" }, activeWorkspaceId: "workspace", setupScope: "original", currentSetup,
      buildPayload: () => payloadHarness({ leftFilter: selection }).buildPayload(), setBusy() {}, setError() {}, setStatusMessage() {},
      previewDatasetRelationship: () => new Promise(resolve => { complete = resolve }), setResult: value => { result = value } })
    const pending = view.handlePreview()
    if (changed) currentSetup.current = "new-workspace-or-filter"
    complete({ id: 3 }); await pending
    assert.equal(result?.id, changed ? undefined : 3)
  }
})

test("filter changes clear old evidence and source keys include user, workspace and dataset", () => {
  let result = { id: 1 }, filters = {}
  functions(["changeDimensionFilter"], { filterKey: identity => `scope:${identity}`, setDimensionFilters: update => { filters = update(filters) },
    setResult: value => { result = value }, setStatusMessage() {}, setError() {} }).changeDimensionFilter("7", selection)
  assert.equal(result, null)
  assert.deepEqual(filters["scope:7"], selection)
  assert.match(source, /JSON.stringify\(\[user\?\.id, activeWorkspaceId, workspaceVersion, identity\]\)/)
})

test("preview and save send scope unchanged and reject an API that ignores filters", async () => {
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const names = ["verifyDatasetRelationshipFilters", "previewDatasetRelationship", "createDatasetRelationship"]
  const payload = plain(payloadHarness({ leftFilter: selection }).buildPayload())
  for (const name of ["previewDatasetRelationship", "createDatasetRelationship"]) {
    const calls = []
    let echo = payload
    const methods = functions(names, { API_URL: "https://example.test", workspaceJsonHeaders: async (user, workspace) => ({ user, workspace }),
      apiFetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => echo } },
      ApiError: class extends Error { constructor(message, status) { super(message); this.status = status } } }, api)
    await methods[name](payload, "owner", "workspace")
    assert.deepEqual(JSON.parse(calls[0].init.body), payload)
    assert.ok(calls[0].url.endsWith("/filtered"))
    assert.equal(calls[0].init.headers.workspace, "workspace")
    echo = { ...payload, left: { ...payload.left, dimension_filter: null } }
    await assert.rejects(methods[name](payload, "owner", "workspace"), error => error.status === 503)
  }
})
