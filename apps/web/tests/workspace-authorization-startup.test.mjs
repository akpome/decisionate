import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const shell = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
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
const own = { id: 1, owner_user_id: "agency", role: "owner", name: "Agency" }
const client = { id: 2, owner_user_id: "agency:client:shop", role: "managed_client", agency_owner_access_enabled: false }

function harness(overrides = {}) {
  const calls = [], context = {
    user: { id: "agency" }, activeWorkspaceId: client.owner_user_id, workspaceAccessUserId: "", organization: null,
    ignoreResult: false, workspaces: [],
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
