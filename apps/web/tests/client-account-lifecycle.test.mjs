import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/settings/settings-client.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(root, predicate) {
  let result
  function visit(node) { if (predicate(node)) result = node; ts.forEachChild(node, visit) }
  visit(root)
  assert.ok(result)
  return result
}
const declaration = name => find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
const compile = (code, context) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const workspace = { id: 2, name: "Client", owner_user_id: "agency:client:one", role: "managed_client", is_paused: false }
function harness(overrides = {}) {
  const requests = []
  const context = {
    selectedClientWorkspace: workspace, canManageClientWorkspaces: true, deletingClientWorkspace: false,
    updatingClientWorkspaceStatus: false, userId: "agency", organizationWorkspaces: [workspace, { id: 3 }],
    setUpdatingClientWorkspaceStatus: value => { context.updatingClientWorkspaceStatus = value },
    setClientWorkspaceError: value => { context.error = value }, setClientWorkspaceNotice: value => { context.notice = value },
    setOrganizationWorkspaces: update => { context.organizationWorkspaces = update(context.organizationWorkspaces) },
    getSettingsErrorMessage: error => error.message,
    updateClientWorkspaceStatus: async (...args) => { requests.push(args); return { ...workspace, is_paused: args[1] } },
    ...overrides,
  }
  return { context, requests, toggle: compile(`${declaration("handleToggleClientWorkspaceStatus")}\nhandleToggleClientWorkspaceStatus`, context) }
}

test("pause and resume target only the chosen client and update after server confirmation", async () => {
  for (const paused of [false, true]) {
    const h = harness({ selectedClientWorkspace: { ...workspace, is_paused: paused } })
    await h.toggle()
    assert.deepEqual(h.requests, [[2, !paused, "agency"]])
    assert.equal(h.context.organizationWorkspaces[0].is_paused, !paused)
    assert.equal(h.context.organizationWorkspaces[1].id, 3)
    assert.equal(h.context.updatingClientWorkspaceStatus, false)
    assert.match(h.context.notice, paused ? /active again/ : /data is preserved and billing is unchanged/)
  }
})

test("failed pause preserves account status and reports the server error", async () => {
  const h = harness({ updateClientWorkspaceStatus: async () => { throw new Error("An import is active") } })
  await h.toggle()
  assert.equal(h.context.organizationWorkspaces[0], workspace)
  assert.equal(h.context.error, "An import is active")
  assert.equal(h.context.notice, "")
  assert.equal(h.context.updatingClientWorkspaceStatus, false)
})

test("a pending pause leaves the account selected and prevents duplicate or destructive actions", async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const h = harness({ updateClientWorkspaceStatus: () => pending })
  const request = h.toggle()
  assert.equal(h.context.updatingClientWorkspaceStatus, true)
  assert.equal(h.context.organizationWorkspaces[0].is_paused, false)
  await h.toggle()
  finish({ ...workspace, is_paused: true })
  await request
  assert.equal(h.context.organizationWorkspaces[0].is_paused, true)
  const openDelete = declaration("handleOpenDeleteClientWorkspace")
  assert.match(openDelete, /updatingClientWorkspaceStatus/)
})

test("missing clients, non-owners and busy accounts cannot trigger a status change", async () => {
  for (const overrides of [{ selectedClientWorkspace: null }, { canManageClientWorkspaces: false },
    { deletingClientWorkspace: true }, { updatingClientWorkspaceStatus: true }]) {
    const h = harness(overrides)
    await h.toggle()
    assert.equal(h.requests.length, 0)
  }
})

test("pause controls expose progress and status while deletion keeps typed confirmation", () => {
  assert.match(source, /aria-busy=\{updatingClientWorkspaceStatus\}/)
  assert.match(source, /"Resume account" : "Pause account"/)
  assert.match(source, /!selectedClientWorkspace\.is_paused && !selectedClientWorkspace\.client_owner_accepted && <>/)
  assert.match(source, /Remove from agency/)
  assert.match(declaration("handleDeleteClientWorkspace"), /clientWorkspaceDeleteConfirmation\.trim\(\)/)
  assert.match(source, /Type <span[^>]*>\{clientWorkspaceDeleteTarget\.name\}/)
  const shell = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
  assert.match(shell, /activeWorkspaceRecord\?\.is_paused &&/)
  assert.match(shell, /Client account paused/)
})

test("status requests use authenticated agency headers and invalidate the workspace list", async () => {
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const tree = ts.createSourceFile("api.ts", api, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const fn = find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === "updateClientWorkspaceStatus").getText(tree).replace(/^export /, "")
  const calls = [], invalidated = []
  const update = compile(`${fn}\nupdateClientWorkspaceStatus`, {
    API_URL: "https://api.example.test", JSON,
    cleanPositiveIntegerId: value => value,
    organizationOwnerHeaders: async user => ({ Authorization: "Bearer trusted", "X-Workspace-Id": user }),
    fetchOrganizationRequest: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ ...workspace, is_paused: true }) } },
    invalidateApiReadCache: prefixes => invalidated.push(...prefixes),
  })
  assert.equal((await update(2, true, "agency")).is_paused, true)
  assert.equal(calls[0][0], "https://api.example.test/organizations/client-workspaces/2")
  assert.equal(calls[0][1].method, "PATCH")
  assert.equal(calls[0][1].headers["X-Workspace-Id"], "agency")
  assert.deepEqual(JSON.parse(calls[0][1].body), { is_paused: true })
  assert.deepEqual(invalidated, ["organization-workspaces:agency"])
})
