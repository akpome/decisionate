import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/settings/client-workspace-ownership.tsx", import.meta.url), "utf8")
const tree = ts.createSourceFile("ownership.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  let found
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit) }
  visit(tree); assert.ok(found); return found.getText(tree)
}
const compile = (code, context) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const workspace = { id: 2, name: "Client Shop", owner_user_id: "old:client:shop", agency_removed: true }
function harness(overrides = {}) {
  const calls = [], context = {
    workspace, userId: "client", pending: { current: false }, confirmation: "", invitations: [{ id: "invite", agency_name: "New Agency" }],
    setBusy: value => { context.busy = value }, setError: value => { context.error = value }, setNotice: value => { context.notice = value },
    setInvitations: update => { context.invitations = update(context.invitations) }, refreshAccess: () => { context.refreshed = true },
    startIndependentWorkspaceTrial: async (...args) => { calls.push(["trial", ...args]); return { trial_days: 30 } },
    respondToAgencyClientInvitation: async (...args) => calls.push(["invitation", ...args]),
    deleteOwnedWorkspace: async (...args) => calls.push(["delete", ...args]),
    setActiveWorkspaceId: (...args) => calls.push(["active", ...args]), window: { location: { assign: path => calls.push(["redirect", path]) } },
    message: error => error.message, ...overrides,
  }
  return { calls, context, act: compile(`${declaration("act")}\nact`, context) }
}

test("the trial starts on the same workspace and refreshes billing and permissions", async () => {
  const h = harness(); await h.act("trial")
  assert.deepEqual(h.calls, [["trial", "client", "old:client:shop"]]); assert.equal(h.context.refreshed, true)
  assert.match(h.context.notice, /30-day trial has started/); assert.equal(h.context.pending.current, false)
})

test("joining or declining an agency acts only on the selected invitation and workspace", async () => {
  for (const action of ["accept", "decline"]) {
    const h = harness(); await h.act(action, h.context.invitations[0])
    assert.deepEqual(h.calls, [["invitation", "invite", action === "accept", "client", "old:client:shop"]])
    assert.equal(h.context.invitations.length, 0); assert.equal(h.context.refreshed, true)
  }
})

test("owner deletion requires the exact name and does not use agency removal", async () => {
  const invalid = harness({ confirmation: "wrong" }); await invalid.act("delete"); assert.deepEqual(invalid.calls, [])
  const h = harness({ confirmation: "Client Shop" }); await h.act("delete")
  assert.deepEqual(h.calls, [["delete", "Client Shop", "client", "old:client:shop"], ["active", "client", "client"], ["redirect", "/auth/redirect"]])
})

test("failed or duplicate actions preserve the workspace and remain retryable", async () => {
  const h = harness({ startIndependentWorkspaceTrial: async () => { throw new Error("Trial already used") } })
  await h.act("trial"); assert.equal(h.context.error, "Trial already used"); assert.equal(h.context.refreshed, undefined)
  h.context.pending.current = true; await h.act("accept", h.context.invitations[0]); assert.equal(h.calls.length, 0)
})

test("an explicit independent relationship overrides the old agency prefix in the browser", () => {
  const text = readFileSync(new URL("../lib/workspace-ownership.ts", import.meta.url), "utf8")
  const helper = compile(text.replace(/^import[^\n]*\n/, "").replace("export function", "function") + "\nisAgencyManagedWorkspace", {})
  assert.equal(helper({ owner_user_id: "old:client:shop", is_managed_client: false }), false)
  assert.equal(helper({ owner_user_id: "old:client:shop", is_managed_client: true }), true)
  assert.equal(helper({ owner_user_id: "old:client:shop" }), true)
})

test("client owners receive distinct deletion and post-agency choices", () => {
  assert.match(source, /Start free trial/); assert.match(source, /Join agency/)
  assert.match(source, /confirmation\.trim\(\) !== workspace\.name/)
  const settings = readFileSync(new URL("../app/dashboard/settings/settings-client.tsx", import.meta.url), "utf8")
  assert.match(settings, /client_owner_accepted \? "Remove from agency"/)
  assert.match(settings, /result\.removed \?/)
  assert.match(settings, /selectedClientWorkspace\?\.client_owner_accepted \|\|/)
})
