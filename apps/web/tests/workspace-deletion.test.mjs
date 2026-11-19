import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/settings/workspace-deletion.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("workspace-deletion.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "WorkspaceDeletion")
const handlers = component.body.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join("\n")

function harness(overrides = {}) {
  const calls = [], state = { busy: false, deleted: false, confirming: true }
  const context = {
    userId: "owner", workspace: { owner_user_id: "owner", name: "My workspace" }, confirmation: "My workspace",
    pending: { current: false }, mounted: { current: true }, deleted: false, Error,
    setBusy: value => { state.busy = value }, setDeleted: value => { state.deleted = value; context.deleted = value },
    setConfirming: value => { state.confirming = value }, setError: value => { state.error = value },
    deleteOwnedWorkspace: async (...args) => { calls.push(["delete", ...args]) },
    clearActiveWorkspaceId: userId => calls.push(["clear", userId]),
    signOut: async options => calls.push(["signOut", options.redirectUrl]), ...overrides,
  }
  const functions = vm.runInNewContext(ts.transpileModule(`${handlers}\n({removeWorkspace,finishSignOut})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return { calls, state, context, ...functions }
}

test("deletion requires exact confirmation, guards duplicate submissions and targets only the selected workspace", async () => {
  for (const invalid of [{ confirmation: "wrong" }, { pending: { current: true } }, { deleted: true }]) {
    const h = harness(invalid); await h.removeWorkspace(); assert.deepEqual(h.calls, [])
  }
  const h = harness()
  await h.removeWorkspace(); await h.removeWorkspace()
  assert.deepEqual(h.calls, [["delete", "My workspace", "owner", "owner"], ["clear", "owner"], ["signOut", "/sign-in"]])
  assert.equal(h.state.deleted, true); assert.equal(h.state.busy, false); assert.equal(h.state.confirming, false)
})

test("failed deletion preserves the workspace selection and confirmation for retry", async () => {
  const h = harness({ deleteOwnedWorkspace: async () => { throw new Error("Cancel your subscription first.") } })
  await h.removeWorkspace()
  assert.equal(h.state.error, "Cancel your subscription first.")
  assert.equal(h.state.confirming, true); assert.equal(h.state.deleted, false); assert.equal(h.state.busy, false)
  assert.deepEqual(h.calls, [])
})

test("failed sign-out after successful deletion can be retried without deleting again", async () => {
  const h = harness({ signOut: async () => { throw new Error("Unavailable") } })
  await h.removeWorkspace()
  assert.equal(h.state.deleted, true)
  assert.match(h.state.error, /workspace was deleted, but sign-out did not finish/)
  h.context.signOut = async options => h.calls.push(["signOut", options.redirectUrl])
  await h.finishSignOut()
  assert.equal(h.calls.filter(([action]) => action === "delete").length, 1)
  assert.deepEqual(h.calls.at(-1), ["signOut", "/sign-in"])
})

test("a completed deletion cannot change another workspace after the component was unmounted", async () => {
  let complete
  const wait = new Promise(resolve => { complete = resolve })
  const h = harness({ deleteOwnedWorkspace: () => wait })
  const pending = h.removeWorkspace()
  h.context.mounted.current = false; complete(); await pending
  assert.deepEqual(h.calls, []); assert.equal(h.state.deleted, false)
})

test("confirmation is focus-trapped, cancelable before sending and clearly names permanent deletion", () => {
  assert.match(source, /<dialog/)
  assert.match(source, /\.showModal\(\)/)
  assert.match(source, /opener\?\.focus\(\)/)
  assert.match(source, /if \(busy\) event.preventDefault\(\)/)
  assert.match(source, /confirmation.trim\(\) !== workspace.name/)
  assert.match(source, /workspace.owner_user_id !== userId/)
  assert.match(source, /isAgencyManagedWorkspace\(workspace\)/)
  assert.match(source, /Other workspaces are not deleted/)
  assert.match(source, /Remove or unlink client workspaces/)
  assert.doesNotMatch(source, /deleteClientWorkspace|deleteOrganization/)
})
