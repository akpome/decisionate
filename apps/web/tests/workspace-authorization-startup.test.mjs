import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const shell = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
const workspaceContext = readFileSync(new URL("../lib/workspace-context.ts", import.meta.url), "utf8")
const cacheSource = readFileSync(new URL("../lib/api-read-cache.ts", import.meta.url), "utf8")
const tree = source => ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(source, predicate) {
  const parsed = tree(source)
  let found
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit) }
  visit(parsed); assert.ok(found)
  return found.getText(parsed)
}
const declaration = (source, name) => find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
const compile = (code, context) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const cacheModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(cacheSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module: cacheModule, exports: cacheModule.exports })
const { ApiReadCache } = cacheModule.exports
const own = { id: 1, owner_user_id: "agency", role: "owner", name: "Agency" }
const client = { id: 2, owner_user_id: "agency:client:shop", role: "managed_client", agency_owner_access_enabled: false }

function harness(overrides = {}) {
  const calls = [], context = {
    user: { id: "agency" }, activeWorkspaceId: client.owner_user_id, workspaceAccessUserId: "", organization: null,
    ignoreResult: false, workspaces: [], workspaceAccessRevision: 0,
    getMyOrganization: async (...args) => { calls.push(["profile", ...args]); assert.equal(args[1], "agency"); return own },
    getOrganizationWorkspaces: async () => [own, client],
    setWorkspaceAccessError: error => { context.error = error },
    setOrganization: value => { context.organization = value },
    setWorkspaces: value => { context.workspaces = value },
    setWorkspaceAccessUserId: value => { context.workspaceAccessUserId = value },
    setWorkspaceSetupUserId: value => { context.setupUser = value },
    getActiveWorkspaceId: () => context.activeWorkspaceId,
    setActiveWorkspaceId: (...args) => { calls.push(["select", ...args]); context.activeWorkspaceId = args[1] },
    isClientWorkspaceRole: role => ["client", "client_owner", "client_user"].includes(role),
    window: { location: { search: "" } }, URLSearchParams, console: { error() {} }, ...overrides,
  }
  const readiness = find(shell, node => ts.isVariableDeclaration(node) && node.name.getText() === "workspaceSelectionReady")
  return { calls, context, load: compile(`${declaration(shell, "loadOrganization")}\nloadOrganization`, context), ready: () => compile(`(() => { const ${readiness}; return workspaceSelectionReady })()`, context) }
}

test("saved denied client selections are validated before the dashboard becomes ready", async () => {
  let resolve
  const h = harness({ getOrganizationWorkspaces: () => new Promise(done => { resolve = done }) })
  const pending = h.load("agency")
  assert.equal(h.ready(), false)
  assert.deepEqual(h.calls, [["profile", "agency", "agency"]])
  resolve([own, client]); await pending
  assert.equal(h.context.activeWorkspaceId, "agency")
  assert.equal(h.ready(), true)
  assert.equal(h.context.workspaces.length, 1)
})

test("a removed client owner keeps their existing independent workspace", async () => {
  const independent = { ...client, role: "owner", agency_removed: true, is_managed_client: false }
  const h = harness({ user: { id: "client" }, getMyOrganization: async () => null, getOrganizationWorkspaces: async () => [independent] })
  await h.load("client")
  assert.equal(h.context.activeWorkspaceId, independent.owner_user_id)
  assert.equal(h.ready(), true)
})

test("failed discovery cannot approve a saved selection or misroute a client to onboarding", async () => {
  const h = harness({ getMyOrganization: async () => null, getOrganizationWorkspaces: async () => { throw new Error("Unavailable") } })
  await h.load("agency")
  assert.equal(h.ready(), false)
  assert.match(h.context.error, /access could not be checked/)
  assert.equal(h.context.setupUser, undefined)
  assert.equal(h.context.activeWorkspaceId, client.owner_user_id)
})

test("readiness cannot carry over from another user or to a newly selected unknown workspace", async () => {
  const h = harness(); await h.load("agency")
  h.context.activeWorkspaceId = "another:client:private"
  assert.equal(h.ready(), false)
  h.context.activeWorkspaceId = "agency"; h.context.user = { id: "another" }
  assert.equal(h.ready(), false)
})

test("billing and page mounting both wait for verified workspace selection", () => {
  const billingEffect = find(shell, node => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.getText().includes("async function loadSubscriptionAccess"))
  assert.match(billingEffect, /!workspaceSelectionReady/)
  assert.match(shell, /\{!workspaceSelectionReady \? \(/)
  assert.match(shell, /workspaceAccessError \|\| "Loading your workspace/)
})

test("workspace ownership changes refresh the shell without changing the workspace or reloading", () => {
  const listener = find(shell, node => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.getText().includes("window.addEventListener(workspaceAccessChangedEvent"))
  assert.match(listener, /setWorkspaceAccessRevision\(value => value \+ 1\)/)
  assert.match(listener, /removeEventListener\(workspaceAccessChangedEvent/)
  assert.match(listener, /addEventListener\("focus", refreshWorkspaceAccess\)/)
  assert.match(listener, /removeEventListener\("focus", refreshWorkspaceAccess\)/)
  const discovery = find(shell, node => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.getText().includes("async function loadOrganization"))
  assert.match(discovery, /workspaceAccessRevision,/)
  assert.match(discovery, /forceRefresh: workspaceAccessRevision > 0/)
  const access = readFileSync(new URL("../lib/use-workspace-access.ts", import.meta.url), "utf8")
  assert.match(access, /addEventListener\("focus", handleWorkspaceAccessChanged\)/)
  assert.match(access, /removeEventListener\("focus", handleWorkspaceAccessChanged\)/)
  assert.match(access, /forceRefresh: accessRefreshKey > 0/)
})

test("workspace status refresh bypasses cached records for agency-initiated removals", async () => {
  let record = { ...client, role: "client_owner", agency_removed: false }, pending, loaded, invalidated
  const cache = new Map(), context = {
    getCachedRead: (key, loader) => {
      if (!cache.has(key)) cache.set(key, loader())
      return cache.get(key)
    },
    apiReadCache: { invalidate: keys => { invalidated = Array.from(keys); for (const key of keys) cache.delete(key) } },
    organizationOwnerHeaders: async () => ({}), API_URL: "https://api.test",
    fetchOrganizationRequest: async () => { loaded = [record]; return { ok: true, json: async () => loaded } },
  }
  const get = compile(declaration(api, "getOrganizationWorkspaces").replace("export ", "") + "\ngetOrganizationWorkspaces", context)
  pending = await get("client", "client@example.test", { includeManagedClientWorkspaces: true })
  assert.equal(pending[0].agency_removed, false)
  record = { ...record, role: "owner", agency_removed: true }
  const refreshed = await get("client", "client@example.test", { includeManagedClientWorkspaces: true, forceRefresh: true })
  assert.equal(refreshed[0].agency_removed, true)
  assert.deepEqual(invalidated, ["organization-workspaces:client:client@example.test:true"])
})

function accessRefreshHarness() {
  const window = new EventTarget(), apiReadCache = new ApiReadCache(), requests = []
  const records = [{ ...own }, { ...client, is_paused: true }]
  let mutationFails = false, notifications = 0
  window.addEventListener("decisionate:workspace-access-changed", () => { notifications++ })
  const context = {
    window, Event, apiReadCache, apiReadCacheTtlMs: 10_000,
    workspaceAccessChangedEvent: "decisionate:workspace-access-changed", API_URL: "https://api.test",
    organizationOwnerHeaders: async () => ({}),
    throwApiError: async () => { throw new Error("Status update failed") },
    fetchOrganizationRequest: async (url, options) => {
      requests.push([url, options])
      if (options.method === "PATCH") {
        if (mutationFails) return { ok: false }
        records[1].is_paused = JSON.parse(options.body).is_paused
        return { ok: true, json: async () => ({ ...records[1] }) }
      }
      return { ok: true, json: async () => records.map(record => ({ ...record })) }
    },
  }
  const functions = [
    declaration(workspaceContext, "notifyWorkspaceAccessChanged"),
    ...["getCachedRead", "invalidateApiReadCache", "cleanPositiveIntegerId", "getOrganizationWorkspaces", "updateClientWorkspaceStatus"].map(name => declaration(api, name)),
  ].map(source => source.replace("export ", "")).join("\n")
  const { get, update } = compile(`${functions}\n({ get: getOrganizationWorkspaces, update: updateClientWorkspaceStatus })`, context)
  return {
    window, requests, records, get, update, notifications: () => notifications,
    failMutation: () => { mutationFails = true },
    workspaceReads: () => requests.filter(([url]) => url.includes("/organizations/workspaces")).length,
  }
}

for (const isPaused of [false, true]) {
  test(`agency ${isPaused ? "pause" : "resume"} refreshes mounted consumers without a notification loop`, async () => {
    const h = accessRefreshHarness(), pending = []
    const options = { includeManagedClientWorkspaces: true }
    h.records[1].is_paused = !isPaused
    await h.get("agency", "agency@example.test", options)
    h.window.addEventListener("decisionate:workspace-access-changed", () => {
      // Bound the old recursion so a regression fails without freezing the test runner.
      if (h.notifications() > 8) return
      for (let consumer = 0; consumer < 2; consumer++) {
        pending.push(Promise.resolve().then(() => h.get("agency", "agency@example.test", { ...options, forceRefresh: true })))
      }
    })
    const updated = await h.update(2, isPaused, "agency")
    for (let index = 0; index < pending.length; index++) {
      assert.equal((await pending[index])[1].is_paused, isPaused)
    }
    assert.equal(updated.is_paused, isPaused)
    assert.equal(h.notifications(), 1)
    assert.equal(pending.length, 2)
    const reads = h.workspaceReads()
    assert.ok(reads <= 3, `Unexpected refresh requests: ${reads}`)
    assert.equal((await h.get("agency", "agency@example.test", options))[1].is_paused, isPaused)
    assert.equal(h.workspaceReads(), reads)
    assert.equal(h.requests.filter(([, options]) => options.method === "PATCH").length, 1)
  })
}

test("focus-style forced refresh sees external changes without broadcasting an access change", async () => {
  const h = accessRefreshHarness(), options = { includeManagedClientWorkspaces: true }
  assert.equal((await h.get("agency", undefined, options))[1].is_paused, true)
  h.records[1].is_paused = false
  assert.equal((await h.get("agency", undefined, { ...options, forceRefresh: true }))[1].is_paused, false)
  assert.equal(h.notifications(), 0)
  assert.equal(h.workspaceReads(), 2)
})

test("failed resume leaves paused records cached without broadcasting a status change", async () => {
  const h = accessRefreshHarness()
  await h.get("agency")
  h.failMutation()
  await assert.rejects(h.update(2, false, "agency"), /Status update failed/)
  assert.equal(h.notifications(), 0)
  assert.equal((await h.get("agency"))[1].is_paused, true)
  assert.equal(h.workspaceReads(), 1)
})

test("organization reads use one fixed workspace for both the cache key and authorization header", async () => {
  let active = "revoked:client:shop", run, key
  const calls = [], context = {
    getActiveWorkspaceId: () => active,
    getCachedRead: (value, loader) => { key = value; run = loader },
    workspaceHeaders: async (...args) => { calls.push(args); return {} }, API_URL: "https://api.test",
    fetchOrganizationRequest: async () => ({ ok: true, json: async () => own }),
  }
  const get = compile(declaration(api, "getMyOrganization").replace("export ", "") + "\ngetMyOrganization", context)
  await get("agency", "agency"); active = "new:client:shop"; await run()
  assert.equal(key, "organization:agency:agency"); assert.deepEqual(calls.pop(), ["agency", "agency"])
  await get("agency"); active = "different:client:shop"; await run()
  assert.equal(key, "organization:agency:new:client:shop"); assert.deepEqual(calls.pop(), ["agency", "new:client:shop"])
})
