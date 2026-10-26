import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const page = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")

function parse(source) {
  return ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function find(source, predicate) {
  let match
  function visit(node) {
    if (predicate(node)) match = node
    if (!match) ts.forEachChild(node, visit)
  }
  visit(parse(source))
  assert.ok(match, "Expected AI status logic was not found")
  return match
}

function load(source, globals) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, AbortController, Error, ...globals })
  return loaded.exports
}

const effect = find(page, node => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.arguments[0]?.getText().includes("getAIStatus(")).arguments[0].getText()
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
const configured = { provider: "openai", model: "example-model", configured: true }

function harness() {
  const timers = new Map(), intervals = new Map(), windowEvents = new Map(), documentEvents = new Map(), requests = []
  let sequence = 0
  const document = {
    visibilityState: "visible",
    addEventListener: (event, listener) => documentEvents.set(event, listener),
    removeEventListener: (event, listener) => { if (documentEvents.get(event) === listener) documentEvents.delete(event) },
  }
  const state = { overview: { ai_status: { provider: "", model: "", configured: false }, evaluated_recommendation_count: 12 }, refreshing: false, error: "" }
  const code = load(`export function begin(user, canRefreshAIStatus) { return (${effect})() }`, {
    document,
    window: {
      setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id },
      clearTimeout: id => timers.delete(id),
      setInterval: (fn, ms) => { const id = ++sequence; intervals.set(id, { fn, ms }); return id },
      clearInterval: id => intervals.delete(id),
      addEventListener: (event, listener) => windowEvents.set(event, listener),
      removeEventListener: (event, listener) => { if (windowEvents.get(event) === listener) windowEvents.delete(event) },
    },
    getAIStatus: (userId, signal) => new Promise((resolve, reject) => requests.push({ userId, signal, resolve, reject })),
    setOverview: update => { state.overview = update(state.overview) },
    setAiStatusRefreshing: value => { state.refreshing = value },
    setAiStatusError: value => { state.error = value },
  })
  return {
    ...code, state, requests, timers, intervals, windowEvents, documentEvents, document,
    initial() { for (const [id, timer] of timers) { timers.delete(id); timer.fn() } },
    tick() { for (const timer of intervals.values()) timer.fn() },
    focus() { windowEvents.get("focus")?.() },
    visibility(value) { document.visibilityState = value; documentEvents.get("visibilitychange")?.() },
  }
}

test("provider and model refresh without an API key or configured status", async () => {
  const h = harness()
  h.begin({ id: "admin" }, true)
  h.initial()
  assert.equal(h.state.refreshing, true)
  assert.equal(h.requests[0].userId, "admin")
  const status = { ...configured, configured: false }
  h.requests[0].resolve(status)
  await flush()
  assert.deepEqual(h.state.overview.ai_status, status)
  assert.equal(h.state.overview.evaluated_recommendation_count, 12)
  assert.equal(h.state.refreshing, false)
})

test("polling picks up a later deployment without reloading admin forms", async () => {
  const h = harness()
  h.begin({ id: "admin" }, true)
  h.initial()
  h.requests[0].resolve({ ...configured, configured: false })
  await flush()
  assert.equal([...h.intervals.values()][0].ms, 30_000)
  h.tick()
  h.requests[1].resolve(configured)
  await flush()
  assert.equal(h.state.overview.ai_status.configured, true)
  assert.equal(h.state.overview.evaluated_recommendation_count, 12)
})

test("focus and visibility refreshes share one pending request", async () => {
  const h = harness()
  h.begin({ id: "admin" }, true)
  h.initial()
  h.focus()
  h.visibility("visible")
  h.tick()
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve(configured)
  await flush()
  h.focus()
  assert.equal(h.requests.length, 2)
})

test("hidden pages do not poll and returning to the tab refreshes status", async () => {
  const h = harness()
  h.document.visibilityState = "hidden"
  h.begin({ id: "admin" }, true)
  h.initial()
  h.tick()
  h.focus()
  assert.equal(h.requests.length, 0)
  h.visibility("visible")
  assert.equal(h.requests.length, 1)
})

test("a failed refresh preserves the last known status and recovers", async () => {
  const h = harness()
  h.state.overview.ai_status = configured
  h.begin({ id: "admin" }, true)
  h.initial()
  h.requests[0].reject(new Error("Service restarting"))
  await flush()
  assert.deepEqual(h.state.overview.ai_status, configured)
  assert.equal(h.state.error, "Service restarting")
  assert.equal(h.state.refreshing, false)
  h.tick()
  h.requests[1].resolve({ ...configured, model: "updated-model" })
  await flush()
  assert.equal(h.state.error, "")
  assert.equal(h.state.overview.ai_status.model, "updated-model")
})

test("cleanup aborts requests and ignores stale responses", async () => {
  const h = harness()
  const cleanup = h.begin({ id: "admin" }, true)
  h.initial()
  cleanup()
  assert.equal(h.requests[0].signal.aborted, true)
  assert.equal(h.timers.size + h.intervals.size + h.windowEvents.size + h.documentEvents.size, 0)
  h.begin({ id: "other-admin" }, true)
  h.initial()
  h.requests[1].resolve(configured)
  await flush()
  h.requests[0].resolve({ ...configured, model: "stale-model" })
  await flush()
  assert.equal(h.state.overview.ai_status.model, "example-model")
})

test("no polling starts before admin overview access is confirmed", () => {
  const h = harness()
  assert.equal(h.begin({ id: "admin" }, false), undefined)
  assert.equal(h.begin(null, true), undefined)
  h.initial()
  assert.equal(h.requests.length + h.timers.size + h.intervals.size + h.windowEvents.size + h.documentEvents.size, 0)
  assert.match(page, /overview && !loading && adminAccess\?\.allowed/)
  assert.match(page, /adminAccess\.full_access \|\| adminAccess\.permissions\.includes\("overview"\)/)
})

test("AI panel offers an accessible refresh and does not hide missing-key configuration", () => {
  assert.match(page, /aria-label="Refresh AI service status"/)
  assert.match(page, /disabled=\{aiStatusRefreshing\}/)
  assert.match(page, /onClick=\{\(\) => setAiStatusRefreshKey\(value => value \+ 1\)\}/)
  assert.match(page, /overview\.ai_status\.provider \|\| "Not configured"/)
  assert.match(page, /overview\.ai_status\.model \|\| "Not configured"/)
  assert.match(page, /role="alert"[^\n]+Displaying last known status/)
  assert.doesNotMatch(effect, /getPlatformAdminOverview|getPlatformAdminEmailSettings/)
})

const clientSource = find(api, node => ts.isFunctionDeclaration(node) && node.name?.text === "getAIStatus").getText()

test("status requests bypass cache, retain cancellation and use authenticated headers", async () => {
  const requests = []
  const { getAIStatus } = load(clientSource, {
    API_URL: "https://api.example.test",
    workspaceHeaders: async (user, workspace) => ({ user, workspace }),
    apiFetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => configured } },
  })
  const controller = new AbortController()
  assert.deepEqual(await getAIStatus("admin", controller.signal), configured)
  assert.equal(requests[0].url, "https://api.example.test/ai/status")
  assert.equal(requests[0].options.cache, "no-store")
  assert.equal(requests[0].options.signal, controller.signal)
  assert.equal(requests[0].options.headers.user, "admin")
  assert.equal(requests[0].options.headers.workspace, "admin")
})

test("status request failures are reported instead of returning an empty configuration", async () => {
  const { getAIStatus } = load(clientSource, {
    API_URL: "https://api.example.test",
    workspaceHeaders: async () => ({}),
    apiFetch: async () => ({ ok: false }),
    throwApiError: async (_, message) => { throw new Error(message) },
  })
  await assert.rejects(() => getAIStatus("admin"), /AI service status is unavailable/)
})
