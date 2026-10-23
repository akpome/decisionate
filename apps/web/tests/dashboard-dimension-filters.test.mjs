import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
function load(source, globals = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { module: loadedModule, exports: loadedModule.exports, require, Error, URLSearchParams, setTimeout, clearTimeout, ...globals })
  return loadedModule.exports
}
const source = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true)
const extract = name => ast.statements.find(node => node.name?.text === name).getText(ast)
const { ApiError } = load(extract("ApiError"))
const { ApiReadCache } = load(readFileSync(new URL("../lib/api-read-cache.ts", import.meta.url), "utf8"))
function client(legacy = false) {
  const cache = new ApiReadCache(), requests = []
  const api = load(["getDatasetDetails", "getDatasetAnomalies", "getDatasetAIAnalysis"].map(extract).join("\n"), {
    ApiError, API_URL: "https://example.test", cleanPositiveIntegerId: value => value,
    datasetDetailsRequestTimeoutMs: 30000, getWorkspaceCacheIdentity: (user, workspace) => `${user}:${workspace}`,
    workspaceHeaders: async (user, workspace) => ({ user, workspace }),
    invalidateApiReadCache: prefixes => cache.invalidate(prefixes), getCachedRead: (key, loader) => cache.get(key, loader, 10000),
    apiFetch: async (url, init) => { requests.push({ url, init }); return { ok: true,
      json: async () => ({ date_column: legacy ? "date" : new URL(url).searchParams.get("date_column"), dimension_filter: legacy || !init.body ? null : JSON.parse(init.body), rows: [] }) } },
  })
  return { ...api, requests }
}
const readers = (api, workspace, options) => [
  () => api.getDatasetDetails(1, "owner", workspace, options),
  () => api.getDatasetAnomalies(1, "owner", workspace, options),
  () => api.getDatasetAIAnalysis(1, "owner", workspace, "revenue", options),
]
test("every dashboard read posts the exact dimension scope and retains other controls", async () => {
  const api = client(), dimensionFilter = { column: "region", values: ["East", null, ""] }
  for (const read of readers(api, "workspace", { dimensionFilter, aggregation: "daily", periodFilter: "all" })) {
    assert.deepEqual((await read()).dimension_filter, dimensionFilter)
  }
  for (const { url, init } of api.requests) {
    assert.equal(init.method, "POST")
    assert.equal(init.headers["Content-Type"], "application/json")
    assert.equal(init.headers.workspace, "workspace")
    assert.deepEqual(JSON.parse(init.body), dimensionFilter)
    assert.equal(new URL(url).searchParams.get("aggregation"), "daily")
  }
})
test("dashboard caches isolate filters, all rows and workspaces, without changing existing GETs", async () => {
  const api = client()
  const east = { dimensionFilter: { column: "region", values: ["East"] } }
  for (const options of [undefined, east, { dimensionFilter: { column: "region", values: ["West"] } }, east]) {
    for (const read of readers(api, "first", options)) await read()
  }
  for (const read of readers(api, "second", east)) await read()
  assert.equal(api.requests.length, 12)
  for (const { init } of api.requests.slice(0, 3)) assert.equal(init.body, undefined)
})
test("an older server cannot silently return all rows for any filtered dashboard read", async () => {
  const api = client(true), options = { dimensionFilter: { column: "region", values: ["East"] } }
  for (const read of readers(api, "workspace", options)) await assert.rejects(read, error => error instanceof ApiError && error.status === 503)
})

test("dataset AI analysis uses and caches the exact selected date field alongside the dimension filter", async () => {
  const api = client(), dimensionFilter = { column: "region", values: ["East"] }
  for (const dateColumn of ["date", "paid_date", "paid_date"]) {
    const result = await api.getDatasetAIAnalysis(1, "owner", "workspace", "revenue", { dateColumn, dimensionFilter })
    assert.equal(result.date_column, dateColumn)
  }
  assert.equal(api.requests.length, 2)
  assert.equal(new URL(api.requests[1].url).searchParams.get("date_column"), "paid_date")
  await assert.rejects(client(true).getDatasetAIAnalysis(1, "owner", "workspace", "revenue", { dateColumn: "paid_date" }), error => error.status === 503)
})

function hookHarness() {
  const slots = [], effects = [], requests = []
  let cursor = 0
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value }] },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() } } },
  }
  const exports = load(readFileSync(new URL("../features/dashboard/lib/use-dimension-data.ts", import.meta.url), "utf8"), {
    require: name => name === "react" ? react : { getDatasetDetails: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) },
    setTimeout: callback => { callback(); return 1 }, clearTimeout() {},
  })
  return { requests, ...exports, render: (...args) => { cursor = 0; return exports.useDashboardDimensionData(...args) } }
}
const east = { column: "region", values: ["East"] }, west = { column: "region", values: ["West"] }
const sourceData = { id: 1, metrics: [{ column: "revenue", total: 9999 }], chart: { data: [{ revenue: 9999 }] } }
const filtered = { id: 1, metrics: [{ column: "revenue", total: 30 }], chart: { data: [{ revenue: 30 }] } }
test("the dashboard never falls back to whole-source figures while filtering or after an empty selection", async () => {
  const h = hookHarness()
  assert.equal(h.render(sourceData, 1, "owner", "workspace", undefined, "general").data, sourceData)
  assert.equal(h.requests.length, 0)
  assert.equal(h.render(sourceData, 1, "owner", "workspace", east, "general").data, null)
  h.requests[0].resolve(filtered); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.render(sourceData, 1, "owner", "workspace", east, "general").data, filtered)
  assert.equal(h.render(sourceData, 1, "owner", "workspace", { column: "region", values: [] }, "general").data, null)
  assert.equal(h.requests.length, 1)
})
test("late responses cannot replace another filter, dashboard, dataset or workspace", async () => {
  const h = hookHarness()
  h.render(sourceData, 1, "owner", "workspace", east, "general")
  h.render(sourceData, 1, "owner", "workspace", west, "general")
  h.requests[0].resolve(filtered); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.render(sourceData, 1, "owner", "workspace", west, "general").data, null)
  h.requests[1].resolve(filtered); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.render(sourceData, 1, "owner", "workspace", west, "general").data, filtered)
  assert.equal(h.render(sourceData, 1, "owner", "workspace", west, "retail").data, null)
  assert.equal(h.render(sourceData, 1, "owner", "other", west, "retail").data, null)
  assert.equal(h.render({ ...sourceData, id: 2 }, 2, "owner", "other", west, "retail").data, null)
})
test("filtered read failure stays scoped and retry can recover without showing all rows", async () => {
  const h = hookHarness()
  h.render(sourceData, 1, "owner", "workspace", east, "general")
  h.requests[0].reject(new Error("Temporarily unavailable")); await Promise.resolve(); await Promise.resolve()
  const error = h.render(sourceData, 1, "owner", "workspace", east, "general")
  assert.equal(error.data, null)
  assert.equal(error.error, "Temporarily unavailable")
  error.retry()
  assert.equal(h.render(sourceData, 1, "owner", "workspace", east, "general").data, null)
  h.requests[1].resolve(filtered); await Promise.resolve(); await Promise.resolve()
  assert.equal(h.render(sourceData, 1, "owner", "workspace", east, "general").data, filtered)
})
test("missing, empty and literal values remain distinct when checking analysis scope", () => {
  const { sameDimensionFilter } = hookHarness()
  assert.equal(sameDimensionFilter(undefined, null), true)
  for (const values of [[null], [""], ["null"]]) assert.equal(sameDimensionFilter({ column: "region", values }, { column: "region", values: ["Missing"] }), false)
})
test("saved view cleaning preserves exact filters, explicit clear and rejects invalid scope", () => {
  const falseGuard = () => false
  const { cleanDashboardPreference } = load(extract("cleanDashboardPreference") + "\nexport { cleanDashboardPreference }", {
    ApiError, maxDashboardTitleLength: 120, maxDashboardSubtitleLength: 220, getCleanDashboardPreferenceText: () => undefined,
    isChartType: falseGuard, isDashboardAggregation: falseGuard, isDashboardValueAggregation: falseGuard,
    isScaleMode: falseGuard, isPeriodFilter: falseGuard, isDashboardTemplate: falseGuard,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(cleanDashboardPreference({ dimensionFilter: east }))), { dimensionFilter: east })
  assert.equal(cleanDashboardPreference({ dimensionFilter: null }).dimensionFilter, null)
  assert.throws(() => cleanDashboardPreference({ dimensionFilter: { column: "region", values: [] } }), /invalid/)
})
test("all dataset dashboard layouts share the control, joined source filters and export scope", () => {
  const page = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
  assert.match(page, /selectedDashboardNeedsDataset && selectedDatasetId && userId/)
  assert.match(page, /Source dimension filters/)
  assert.ok((page.match(/\{dimensionControls\}/g) || []).length >= 2)
  assert.match(page, /dimensionFilter: dimensionFilter\?\.values\.length \? dimensionFilter : null/)
  assert.match(page, /if \(dimensionBlocked\) return null/)
  const join = readFileSync(new URL("../features/dashboard/components/dataset-join-panel.tsx", import.meta.url), "utf8")
  assert.match(join, /DatasetDimensionFilter/)
  assert.match(join, /dimension_filter: existing\?\.dimension_filter/)
  assert.match(join, /persistedResult\.dimension_filters/)
  const registry = readFileSync(new URL("../features/dashboards/dashboard-registry.tsx", import.meta.url), "utf8")
  assert.match(registry, /Filter: \{filterLabel\}/)
})
