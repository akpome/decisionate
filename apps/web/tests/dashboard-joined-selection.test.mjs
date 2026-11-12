import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate) {
  let found
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit) }
  visit(ast)
  assert.ok(found)
  return found
}
const declaration = name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
const variable = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
const callback = name => variable(name).initializer.arguments[0].getText(ast)
const compile = (code, globals) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
  target: ts.ScriptTarget.ES2022,
} }).outputText, globals)
const helpers = ["isCurrentJoinedDatasetResult", "isJoinedDatasetResultForDataset", "findPersistedJoinedDatasetResult"].map(declaration).join("\n")
const joined = { join_version: 8, derived_dataset_id: 30, derived_dataset: { id: 30, source_type: "joined" },
  dataset_ids: [1, 2], datasets: [{ label: "sales / revenue", column_type: "numeric" }], rows: [{ period: "2026-01-01", revenue: 999 }] }
const defaults = { joinedDatasetResultVersion: 8, defaultDashboardKey: "business" }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test("join membership never substitutes joined rows for either original source or an unrelated dataset", () => {
  for (const datasetId of [1, 2, 3, 30]) {
    const globals = { ...defaults, datasetId, selectedDashboard: "business", joinCacheResult: { status: "fulfilled", value: joined },
      savedDashboardPreference: { joinedDatasetResult: joined }, locallyPersistedJoinedDatasetResult: joined,
      savedDashboardPreferences: { 1: { joinedDatasetResult: joined }, 2: { joinedDatasetResult: joined } },
      savedDashboardViews: { 1: { business: { joinedDatasetResult: joined } } } }
    const restored = compile(`${helpers}\nconst cachedJoinedDatasetResult = ${variable("cachedJoinedDatasetResult").initializer.getText(ast)};\n${variable("savedJoinedDatasetResult").initializer.getText(ast)}`, globals)
    assert.equal(restored, datasetId === 30 ? joined : null)
    const originalRows = [{ period: "2026-01-01", revenue: datasetId * 10 }]
    const rows = compile(`(${callback("allRows")})()`, { joinedDatasetResult: restored,
      dimensionData: { data: { chart: { data: originalRows } } }, dataset: {}, filterDashboardRowsToSelectedMetrics: rows => rows })
    assert.equal(rows, datasetId === 30 ? joined.rows : originalRows)
  }
})

test("older saved source-level copies can restore the joined dataset itself, never its sources", () => {
  const resolve = compile(`${helpers}\nfindPersistedJoinedDatasetResult`, defaults)
  const preferences = { 1: { joinedDatasetResult: joined } }
  const views = { 2: { sales: { joinedDatasetResult: joined } } }
  assert.equal(resolve(preferences, views, "business", 30), joined)
  assert.equal(resolve(preferences, views, "sales", 30), joined)
  assert.equal(resolve(preferences, views, "business", 1), null)
  assert.equal(resolve(preferences, views, "sales", 2), null)
  assert.equal(resolve(preferences, views, "unrelated-dashboard", 30), null)
  assert.equal(resolve({ 1: { joinedDatasetResult: { ...joined, join_version: 7 } } }, {}, "business", 30), null)
})

const localEffect = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
  node.arguments[0].getText(ast).includes("const stored = readPersistedJoinedDataset(")).arguments[0].getText(ast)
test("browser-stored joins respect the selected dataset and cancelled restore effects publish nothing", () => {
  for (const selectedDatasetId of [1, 2, 3, 30]) {
    const tasks = [], updates = []
    const start = compile(`${helpers}\n(${localEffect})`, { ...defaults, selectedDatasetId, userId: "owner", joinedDatasetStorageKey: "scoped-key",
      queueMicrotask: task => tasks.push(task), readPersistedJoinedDataset: () => joined,
      setJoinedDatasetResult: update => updates.push(update(null)), setSelectedMetrics: update => update([]) })
    start()
    tasks.splice(0).forEach(task => task())
    assert.deepEqual(updates, selectedDatasetId === 30 ? [joined] : [])
    updates.length = 0
    const stop = start()
    stop()
    tasks.splice(0).forEach(task => task())
    assert.deepEqual(updates, [])
  }
})

function harness(overrides = {}) {
  const requests = [], persisted = []
  const context = { ...defaults, selectedDatasetId: 30, selectedDashboard: "business", userId: "owner", activeWorkspaceId: "workspace",
    datasets: [{ id: 1 }, { id: 2 }, joined.derived_dataset], joinedDatasetResult: joined,
    dashboardDatasetIds: { business: 30, sales: 2 }, datasetSelectionRequestRef: { current: 0 },
    dashboardPreferenceSaveQueueRef: { current: Promise.resolve() }, dashboardDatasetHydrationRef: { current: "loaded" },
    dataset: { metrics: [{ column: "revenue" }] }, selectedMetrics: [], showJoinPanel: true,
    setDataset: value => { context.dataset = value }, setTargets() {}, setDashboardTitle() {}, setDashboardSubtitle() {},
    defaultDashboardTitle: "Business", defaultDashboardSubtitle: "",
    setLoading: value => { context.loading = value }, setDashboardError: value => { context.error = value }, setDashboardErrorRetryMode() {},
    setShareEnabled() {}, clearShareStatus() {},
    setSelectedDatasetId: value => { context.selectedDatasetId = value },
    setDashboardDatasetIds: value => { context.dashboardDatasetIds = value },
    setJoinedDatasetResult: value => { context.joinedDatasetResult = value },
    setShowJoinPanel: value => { context.showJoinPanel = value }, setDatasetLoadRetryKey: update => { context.retries = update(context.retries ?? 0) },
    setDatasetPreferenceError() {}, getErrorMessage: error => error.message,
    updateDatasetPreference: async (...args) => requests.push(args),
    setDatasets: update => { context.datasets = update(context.datasets) }, setStartDate() {},
    setSelectedMetrics: update => { context.selectedMetrics = typeof update === "function" ? update(context.selectedMetrics) : update },
    getJoinedDatasetStorageKey: (workspace, user, id, dashboard) => `${workspace}:${user}:${id}:${dashboard}`,
    persistJoinedDataset: (...args) => persisted.push(args), ...overrides }
  context.initialJoinedDatasetResult = context.joinedDatasetResult
  const handlers = compile(`const joinedDatasetResult = initialJoinedDatasetResult;\nconst clearSelectedDashboard = ${callback("clearSelectedDashboard")};\nconst handleDatasetSelectionChange = ${callback("handleDatasetSelectionChange")};\nconst handleJoinedDatasetResult = ${callback("handleJoinedDatasetResult")};\n({ handleDatasetSelectionChange, handleJoinedDatasetResult })`, context)
  return { context, requests, persisted, ...handlers }
}

test("switching away from a join clears only its active view and keeps the generated dataset available", async () => {
  const h = harness()
  await h.handleDatasetSelectionChange(1)
  assert.equal(h.context.selectedDatasetId, 1)
  assert.equal(h.context.joinedDatasetResult, null)
  assert.equal(h.context.showJoinPanel, false)
  assert.equal(h.context.datasets.length, 3)
  assert.equal(h.context.dashboardDatasetIds.sales, 2)
  assert.equal(h.requests[0][0], 1)
  assert.equal(h.requests[0][5], "workspace")
})

test("creating a join selects and persists its generated dataset without writing join state under its sources", async () => {
  const h = harness({ selectedDatasetId: 1 })
  h.handleJoinedDatasetResult(joined)
  await flush()
  assert.equal(h.context.selectedDatasetId, 30)
  assert.equal(h.context.dashboardDatasetIds.business, 30)
  assert.equal(h.context.showJoinPanel, true)
  assert.deepEqual(h.persisted, [["workspace:owner:30:business", joined]])
  assert.equal(h.context.datasets.filter(item => item.id === 30).length, 1)
})

test("editing join settings does not remove its generated dataset; a confirmed reset returns to an original source", async () => {
  const editing = harness()
  editing.handleJoinedDatasetResult(null)
  assert.equal(editing.context.datasets.length, 3)
  assert.equal(editing.context.selectedDatasetId, 30)
  const reset = harness({ dashboardDatasetIds: { business: 30, sales: 30, other: 2 } })
  reset.handleJoinedDatasetResult(null, 30)
  await flush()
  assert.deepEqual(reset.context.datasets.map(item => item.id), [1, 2])
  assert.equal(reset.context.selectedDatasetId, 1)
  assert.deepEqual({ ...reset.context.dashboardDatasetIds }, { business: 1, other: 2 })
  assert.ok(reset.persisted.every(([, value]) => value === null))
})

test("a failed earlier selection cannot restore the join after a newer dataset has been selected", async () => {
  let fail
  const first = new Promise((resolve, reject) => { fail = reject })
  let calls = 0
  const h = harness({ updateDatasetPreference: () => ++calls === 1 ? first : Promise.resolve() })
  const old = h.handleDatasetSelectionChange(1)
  const latest = h.handleDatasetSelectionChange(2)
  await flush()
  assert.equal(calls, 1)
  fail(new Error("Old save failed"))
  await old
  await latest
  assert.equal(h.context.selectedDatasetId, 2)
  assert.equal(h.context.error, "")
  assert.equal(calls, 2)
})

test("saving a dashboard view changes only the selected dataset, not all original sources in the join", async () => {
  const preferences = { 1: { title: "Original sales" }, 2: { title: "Original costs" } }
  const views = { 1: { business: { title: "Source view" } }, 2: { sales: { title: "Other dashboard" } } }
  const current = { title: "Joined view", joinedDatasetResult: joined }
  const requests = []
  const save = compile(`(${callback("saveDashboardViewPreference")})`, {
    activeWorkspaceId: "workspace", selectedDatasetId: 30, selectedDashboard: "business", userId: "owner", dataset: {}, loading: false,
    dimensionFilter: undefined, dashboardDatasetHydrationRef: { current: "workspace:30:business" },
    currentSavedDashboardPreference: {}, currentDashboardPreference: current, dashboardPreferencesByDataset: preferences,
    dashboardViewsByDataset: views, dashboardDatasetIds: { business: 30 }, selectedDashboardSharedMetric: "revenue",
    dashboardPreferenceSaveVersionRef: { current: 0 }, dashboardPreferenceContextRef: { current: "context" },
    dashboardPreferenceSaveQueueRef: { current: Promise.resolve() },
    updateDatasetPreference: async (...args) => requests.push(args),
    setDashboardPreferencesByDataset() {}, setDashboardViewsByDataset() {}, setDashboardError() {}, setDashboardErrorRetryMode() {},
  })
  await save()
  assert.equal(requests[0][4][1], preferences[1])
  assert.equal(requests[0][4][2], preferences[2])
  assert.equal(requests[0][4][30].joinedDatasetResult, joined)
  assert.equal(requests[0][7][1], views[1])
  assert.equal(requests[0][7][2], views[2])
  assert.equal(requests[0][7][30].business, current)
})

test("joined selections retain source-based review controls on both dashboard layouts", () => {
  const scope = { isSelectedDerivedDataset: true, selectedDatasetId: 30, joinedDatasetResult: joined,
    sourceDatasets: [{ id: 1 }, { id: 2 }], selectedDashboardNeedsDataset: true }
  assert.equal(compile(variable("joinPanelDatasetId").initializer.getText(ast), scope), 1)
  assert.equal(compile(variable("canCompareDashboardData").initializer.getText(ast), scope), true)
  assert.equal(source.match(/selectedDatasetId=\{joinPanelDatasetId\}/g)?.length, 2)
  assert.doesNotMatch(source, /showJoinPanel && (?:selectedDashboardNeedsDataset && )?!isSelectedDerivedDataset/)
})
