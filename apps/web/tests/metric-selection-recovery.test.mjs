import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}
const options = {
  datasetId: 58, userId: "owner", workspaceId: "workspace-1", columns: ["revenue"],
  objective: "general_business",
}
const savedDataset = {
  file_name: "sales.csv", numeric_columns: ["revenue", "visits"],
  selected_metric_columns: ["revenue"], metric_selection_configured: true,
  metric_profile: { objective: "general_business", recommended_metric_columns: ["revenue", "visits"] },
}

function harness({ save = async () => ({ ...savedDataset, dataset_id: 58 }), read = async () => savedDataset } = {}) {
  const calls = { saves: [], reads: [] }
  const source = readFileSync(new URL("../features/datasets/lib/metric-selection-save.ts", import.meta.url), "utf8")
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    module: loaded, exports: loaded.exports,
    setTimeout: callback => { callback(); return 1 },
    require: name => {
      assert.equal(name, "@/lib/api")
      return {
        ApiError,
        updateDatasetMetricSelection: async (...args) => { calls.saves.push(args); return save(...args) },
        getDatasetDetails: async (...args) => { calls.reads.push(args); return read(...args) },
      }
    },
  })
  return { ...loaded.exports, calls }
}

test("acknowledged saves succeed independently of the results refresh", async () => {
  const h = harness({ read: async () => { throw new TypeError("Failed to fetch") } })
  const result = await h.saveMetricSelectionWithRecovery(options)
  assert.equal(result.saved, true)
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.reads.length, 0)
})

test("a dropped save response is recovered with a fresh scoped read, never a second mutation", async () => {
  const h = harness({ save: async () => { throw new TypeError("net::ERR_HTTP2_PING_FAILED") } })
  const result = await h.saveMetricSelectionWithRecovery(options)
  assert.equal(result.saved, true)
  assert.equal(result.dataset, savedDataset)
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.reads.length, 1)
  const [id, user, workspace, readOptions] = h.calls.reads[0]
  assert.deepEqual([id, user, workspace], [58, "owner", "workspace-1"])
  assert.equal(readOptions.forceRefresh, true)
  assert.equal(readOptions.notifyAvailability, false)
})

test("a transient read failure retries once without replaying the save", async () => {
  let reads = 0
  const h = harness({
    save: async () => { throw new Error("connection lost") },
    read: async () => { if (++reads === 1) throw new TypeError("Failed to fetch"); return savedDataset },
  })
  assert.equal((await h.saveMetricSelectionWithRecovery(options)).saved, true)
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.reads.length, 2)
})

test("unconfirmed saves preserve the draft and never expose diagnostic details", async () => {
  for (const read of [async () => { throw new Error("socket failed token=secret") }, async () => ({ ...savedDataset, selected_metric_columns: ["visits"] })]) {
    const columns = ["revenue"]
    const h = harness({ save: async () => { throw new Error("net::ERR_HTTP2_PING_FAILED") }, read })
    const result = await h.saveMetricSelectionWithRecovery({ ...options, columns })
    assert.equal(result.saved, false)
    assert.equal(result.retryable, true)
    assert.match(result.message, /couldn't confirm.*selections are still here/)
    assert.doesNotMatch(result.message, /HTTP2|socket|secret|token|fetch/i)
    assert.deepEqual(columns, ["revenue"])
    assert.equal(h.calls.saves.length, 1)
    assert.ok(h.calls.reads.length <= 2)
  }
})

test("recovery verifies the objective, explicit empty selection, and policy, not only column count", async () => {
  for (const [dataset, overrides] of [
    [{ ...savedDataset, metric_profile: { objective: "profitability" } }, {}],
    [{ ...savedDataset, selected_metric_columns: undefined }, { columns: [] }],
    [{ ...savedDataset, selected_metric_columns: [], metric_selection_configured: false }, { columns: [] }],
    [{ ...savedDataset, metric_profile: { objective: "general_business", curated_recommendations: { policyVersion: "old" } } }, { policyVersion: "v2" }],
    [{ ...savedDataset, metric_selection_configured: undefined }, {}],
    [{ ...savedDataset, selected_metric_columns: ["revenue", "revenue"] }, { columns: ["revenue", "visits"] }],
  ]) {
    const h = harness({ save: async () => { throw new Error("offline") }, read: async () => dataset })
    const result = await h.saveMetricSelectionWithRecovery({ ...options, ...overrides })
    assert.equal(result.saved, false)
  }
  const h = harness({ save: async () => { throw new Error("offline") }, read: async () => ({ ...savedDataset, selected_metric_columns: [] }) })
  assert.equal((await h.saveMetricSelectionWithRecovery({ ...options, columns: [] })).saved, true)
  const matchingPolicy = harness({ save: async () => { throw new Error("offline") }, read: async () => ({
    ...savedDataset, metric_profile: { ...savedDataset.metric_profile, curated_recommendations: { policyVersion: "v2" } },
  }) })
  assert.equal((await matchingPolicy.saveMetricSelectionWithRecovery({ ...options, policyVersion: "v2" })).saved, true)
})

test("restoring recommendations verifies the intended defaults rather than the empty request list", async () => {
  const h = harness({ save: async () => { throw new Error("offline") }, read: async () => ({ ...savedDataset, selected_metric_columns: ["visits", "revenue"] }) })
  const result = await h.saveMetricSelectionWithRecovery({ ...options, columns: [], restoreRecommended: true })
  assert.equal(result.saved, true)
  assert.equal(h.calls.saves[0][5], true)
})

test("objective changes recover against the new defaults rather than the previous objective's metrics", async () => {
  const dataset = {
    ...savedDataset, selected_metric_columns: ["spend"],
    metric_profile: { objective: "reduce_expenses", recommended_metric_columns: ["spend"] },
  }
  const h = harness({ save: async () => { throw new TypeError("Failed to fetch") }, read: async () => dataset })
  const result = await h.saveMetricSelectionWithRecovery({
    ...options, objective: "reduce_expenses", restoreRecommended: true,
  })
  assert.equal(result.saved, true)
  assert.deepEqual(result.selection.selected_metric_columns, ["spend"])
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.saves[0][4], "reduce_expenses")
  assert.equal(h.calls.saves[0][5], true)

  for (const unconfirmed of [
    { ...dataset, selected_metric_columns: ["revenue"] },
    { ...dataset, selected_metric_columns: ["spend", "revenue"] },
    { ...dataset, selected_metric_columns: [], metric_profile: { objective: "reduce_expenses" } },
  ]) {
    const mismatch = harness({ save: async () => { throw new Error("offline") }, read: async () => unconfirmed })
    assert.equal((await mismatch.saveMetricSelectionWithRecovery({
      ...options, objective: "reduce_expenses", restoreRecommended: true,
    })).saved, false)
  }
})

test("an objective with no relevant metrics can recover an explicitly empty default selection", async () => {
  const h = harness({ save: async () => { throw new Error("offline") }, read: async () => ({
    ...savedDataset, selected_metric_columns: [],
    metric_profile: { objective: "reduce_expenses", recommended_metric_columns: [] },
  }) })
  assert.equal((await h.saveMetricSelectionWithRecovery({
    ...options, objective: "reduce_expenses", restoreRecommended: true,
  })).saved, true)
})

test("validation and authorization failures are not mistaken for successful matching old state", async () => {
  for (const status of [400, 401, 402, 403, 404, 409, 422, 429]) {
    const h = harness({ save: async () => { throw new ApiError("Internal diagnostic detail", status) } })
    const result = await h.saveMetricSelectionWithRecovery(options)
    assert.equal(result.saved, false)
    assert.equal(result.retryable, status === 429)
    assert.equal(h.calls.reads.length, 0)
    assert.doesNotMatch(result.message, /Internal diagnostic/)
  }
})

test("server failures can be verified but denied reads are never retried", async () => {
  const h = harness({ save: async () => { throw new ApiError("server unavailable", 503) } })
  assert.equal((await h.saveMetricSelectionWithRecovery(options)).saved, true)
  for (const status of [401, 403, 404, 429]) {
    const denied = harness({ read: async () => { throw new ApiError("denied", status) } })
    await assert.rejects(denied.refreshDatasetMetrics(58, "owner", "workspace-1"), error => error.status === status)
    assert.equal(denied.calls.reads.length, 1)
  }
})

test("the page offers separate save and read-only refresh retries with stale-workspace guards", () => {
  const page = readFileSync(new URL("../app/dashboard/datasets/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(page, /Retry save/)
  assert.match(page, /Refresh results/)
  assert.match(page, /Metrics saved\. Updated results are temporarily unavailable\./)
  assert.match(page, /requestId !== metricSelectionRequest\.current/)
  const refresh = page.slice(page.indexOf("async function handleRefreshSavedMetrics"), page.indexOf("async function handleSaveMetricSelection"))
  assert.match(refresh, /refreshDatasetMetrics/)
  assert.doesNotMatch(refresh, /updateDatasetMetricSelection|saveMetricSelectionWithRecovery/)
})

function apiHarness(fetch) {
  function compile(relative, dependencies, globals = {}) {
    const loaded = { exports: {} }
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
      module: loaded, exports: loaded.exports,
      require: name => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name] },
      ...globals,
    })
    return loaded.exports
  }
  const availability = []
  const api = compile("../lib/api.ts", {
    "@/features/reports/analysis-jobs": {},
    "@/lib/api-read-cache": compile("../lib/api-read-cache.ts", {}),
    "@/lib/workspace-context": { getActiveWorkspaceId: () => "workspace-1", notifyWorkspaceAccessChanged: () => {} },
    "@/features/dashboards/dashboard-definitions": {},
  }, {
    process: { env: { NEXT_PUBLIC_API_URL: "https://api.test" } }, URL, URLSearchParams, Headers,
    AbortController, DOMException, TypeError, Error, fetch, setTimeout, clearTimeout,
    window: { setTimeout, clearTimeout, dispatchEvent: event => availability.push(event.detail) },
    CustomEvent: class { constructor(name, { detail }) { this.detail = detail } },
  })
  return { api, availability }
}

test("the real API wrapper invalidates old cached choices even when the save response is lost", async () => {
  let selected = ["visits"], reads = 0
  const h = apiHarness(async (url, init) => {
    if (init.method === "PATCH") {
      selected = JSON.parse(init.body).selected_metric_columns
      throw new TypeError("Failed to fetch")
    }
    reads++
    return new Response(JSON.stringify({ ...savedDataset, selected_metric_columns: selected }), { status: 200 })
  })
  await h.api.getDatasetDetails(58, "owner", "workspace-1", { includeAIAnalysis: false })
  const eventCount = h.availability.length
  await assert.rejects(h.api.updateDatasetMetricSelection(58, ["revenue"], "owner", "workspace-1"))
  assert.equal(h.availability.length, eventCount, "One locally handled save must not mark the whole application unavailable")
  const result = await h.api.getDatasetDetails(58, "owner", "workspace-1", { includeAIAnalysis: false })
  assert.deepEqual(result.selected_metric_columns, ["revenue"])
  assert.equal(reads, 2)
})

test("verification reads bypass the cache and report errors only to the local save flow", async () => {
  let reads = 0
  const h = apiHarness(async () => {
    reads++
    if (reads === 3) throw new TypeError("Failed to fetch")
    return new Response(JSON.stringify({ ...savedDataset, selected_metric_columns: reads === 1 ? ["visits"] : ["revenue"] }), { status: 200 })
  })
  await h.api.getDatasetDetails(58, "owner", "workspace-1", { includeAIAnalysis: false })
  const eventCount = h.availability.length
  const result = await h.api.getDatasetDetails(58, "owner", "workspace-1", { includeAIAnalysis: false, forceRefresh: true, notifyAvailability: false })
  assert.deepEqual(result.selected_metric_columns, ["revenue"])
  assert.equal(h.availability.length, eventCount)
  await assert.rejects(h.api.getDatasetDetails(58, "owner", "workspace-1", { includeAIAnalysis: false, forceRefresh: true, notifyAvailability: false }))
  assert.equal(h.availability.length, eventCount)
  assert.equal(reads, 3)
})
