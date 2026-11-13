import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
const tree = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate) {
  let match
  function visit(node) { if (predicate(node)) match = node; ts.forEachChild(node, visit) }
  visit(tree); assert.ok(match); return match.getText(tree)
}
const compile = (code, context) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const workspace = { owner_user_id: "agency:client:shop", role: "client_owner", is_paused: true, is_managed_client: true }

function harness(overrides = {}) {
  const calls = [], context = {
    user: { id: "client" }, activeWorkspaceId: workspace.owner_user_id, canResumeWorkspace: true,
    resumePending: { current: false }, workspaces: [{ ...workspace }],
    setResumeState: value => { context.state = typeof value === "function" ? value(context.state) : value },
    resumeOwnedWorkspace: async (...args) => { calls.push(args) },
    setWorkspaces: update => { context.workspaces = update(context.workspaces) },
    setSubscriptionAccess: value => { context.subscription = value },
    notifyWorkspaceAccessChanged: () => { context.notified = true },
    window: { dispatchEvent: event => { context.event = event.type } }, Event, Error, ...overrides,
  }
  const handler = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleResumeWorkspace")
  return { calls, context, resume: compile(handler + "\nhandleResumeWorkspace", context) }
}

test("resuming restores the same workspace and refreshes permissions and billing", async () => {
  const h = harness(); await h.resume()
  assert.deepEqual(h.calls, [["client", workspace.owner_user_id]])
  assert.equal(h.context.workspaces[0].is_paused, false)
  assert.equal(h.context.workspaces[0].owner_user_id, workspace.owner_user_id)
  assert.equal(h.context.subscription, null)
  assert.equal(h.context.notified, true)
  assert.equal(h.context.event, "decisionate:billing-updated")
  assert.equal(h.context.resumePending.current, false)
  assert.equal(h.context.state.pending, false)
})

test("only client-owner roles in an agency-managed workspace receive the resume control", () => {
  const variable = find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === "canResumeWorkspace")
  const managed = item => item?.is_managed_client === true
  for (const role of ["client", "client_owner", "owner", "client_user", "member", "managed_client"]) {
    const eligible = compile(`(() => { const ${variable}; return canResumeWorkspace })()`, { isAgencyManagedWorkspace: managed, activeWorkspaceRecord: workspace, activeWorkspaceRole: role })
    assert.equal(eligible, ["client", "client_owner", "owner"].includes(role))
  }
  assert.equal(compile(`(() => { const ${variable}; return canResumeWorkspace })()`, { isAgencyManagedWorkspace: managed, activeWorkspaceRecord: { ...workspace, is_managed_client: false }, activeWorkspaceRole: "owner" }), false)
})

test("a refused or failed resume preserves the pause and displays the actual failure", async () => {
  const h = harness({ resumeOwnedWorkspace: async () => { throw new Error("Your agency needs an active Agency plan.") } })
  await h.resume()
  assert.equal(h.context.workspaces[0].is_paused, true)
  assert.equal(h.context.state.error, "Your agency needs an active Agency plan.")
  assert.equal(h.context.state.pending, false)
  assert.equal(h.context.notified, undefined)
})

test("duplicate clicks and non-owner attempts cannot send another resume request", async () => {
  let finish
  const h = harness({ resumeOwnedWorkspace: () => new Promise(resolve => { finish = resolve }) })
  const pending = h.resume(); await h.resume()
  assert.equal(h.context.resumePending.current, true)
  finish(); await pending
  assert.equal(h.context.state.pending, false)
  const denied = harness({ canResumeWorkspace: false }); await denied.resume()
  assert.deepEqual(denied.calls, [])
})

test("late resume responses update only their original workspace", async () => {
  let finish
  const other = { owner_user_id: "another:client:shop", is_paused: true }
  const h = harness({ resumeOwnedWorkspace: () => new Promise(resolve => { finish = resolve }), workspaces: [{ ...workspace }, other] })
  const pending = h.resume(); h.context.activeWorkspaceId = other.owner_user_id
  finish(); await pending
  assert.equal(h.context.workspaces[0].is_paused, false)
  assert.equal(h.context.workspaces[1].is_paused, true)
  assert.equal(h.context.state.workspaceId, workspace.owner_user_id)
})
