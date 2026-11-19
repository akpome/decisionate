import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const source = read("../features/platform-admin/user-email-repair.tsx")
const ast = ts.createSourceFile("repair.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "UserEmailRepair")
const action = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "repair").getText(ast)
const page = (updates = {}) => ({ checked: 1, emails_updated: 1, users_deleted: 0, unresolved: [], next_user_id: null, provider_unavailable: false, ...updates })

function harness(responses, { confirm = true } = {}) {
  const requests = [], state = { busy: false, summary: null, error: "", paused: false, refreshed: 0, confirmations: 0 }
  const context = { Error, running: { current: false }, cancelled: { current: false }, mounted: { current: true }, userId: "operator",
    window: { confirm: () => { state.confirmations++; return confirm } },
    empty: () => ({ checked: 0, emails_updated: 0, users_deleted: 0, unresolved: [] }),
    setBusy: value => { state.busy = value }, setSummary: value => { state.summary = value },
    setError: value => { state.error = typeof value === "function" ? value(state.error) : value }, setPaused: value => { state.paused = value },
    onRepaired: async () => { state.refreshed++ }, repairPlatformUserEmails: async (...args) => {
      requests.push(args)
      const value = responses.shift()
      if (value instanceof Error) throw value
      return typeof value === "function" ? value() : value
    },
  }
  vm.runInNewContext(ts.transpileModule(action + "; globalThis.repair = repair", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...context, state, requests }
}

test("user repair requires confirmation and ignores repeated clicks while pending", async () => {
  const cancelled = harness([], { confirm: false })
  await cancelled.repair()
  assert.equal(cancelled.requests.length, 0)
  let release
  const h = harness([() => new Promise(resolve => { release = resolve })])
  const pending = h.repair()
  await h.repair()
  assert.equal(h.requests.length, 1)
  assert.equal(h.state.confirmations, 1)
  assert.equal(h.state.busy, true)
  release(page()); await pending
  assert.equal(h.state.busy, false)
  assert.equal(h.state.refreshed, 1)
})

test("repair follows bounded cursors, adds progress and reports preserved accounts", async () => {
  const h = harness([page({ next_user_id: "usr_01" }), page({ emails_updated: 0, users_deleted: 1, unresolved: [{ user_id: "usr_linked", reason: "Preserved" }] })])
  await h.repair()
  assert.deepEqual(h.requests, [["operator", null], ["operator", "usr_01"]])
  assert.equal(h.state.summary.checked, 2)
  assert.equal(h.state.summary.emails_updated, 1)
  assert.equal(h.state.summary.users_deleted, 1)
  assert.equal(h.state.summary.unresolved.length, 1)
})

test("provider errors stop future batches and preserve already reported progress", async () => {
  const h = harness([page({ next_user_id: "usr_01" }), page({ checked: 0, emails_updated: 0, provider_unavailable: true, next_user_id: "usr_02" })])
  await h.repair()
  assert.equal(h.requests.length, 2)
  assert.equal(h.state.summary.emails_updated, 1)
  assert.match(h.state.error, /preserved/)
  assert.equal(h.state.busy, false)
  assert.equal(h.state.refreshed, 1)
})

test("transport failures retain results, refresh the list and do not retry mutations automatically", async () => {
  const h = harness([page({ next_user_id: "usr_01" }), new Error("Connection lost")])
  await h.repair()
  assert.equal(h.requests.length, 2)
  assert.equal(h.state.summary.emails_updated, 1)
  assert.equal(h.state.error, "Connection lost")
  assert.equal(h.state.refreshed, 1)
})

test("Stop finishes the current batch while unmount prevents subsequent requests", async () => {
  for (const unmount of [false, true]) {
    let release
    const h = harness([() => new Promise(resolve => { release = resolve })])
    const pending = h.repair()
    if (unmount) h.mounted.current = false
    else h.cancelled.current = true
    release(page({ next_user_id: "usr_01" })); await pending
    assert.equal(h.requests.length, 1)
    assert.equal(h.state.refreshed, unmount ? 0 : 1)
    assert.equal(h.state.paused, !unmount)
  }
})

test("non-advancing cursors cannot create an infinite repair loop", async () => {
  const h = harness([page({ next_user_id: "usr_01" }), page({ next_user_id: "usr_01" })])
  await h.repair()
  assert.equal(h.requests.length, 2)
  assert.match(h.state.error, /progress could not be confirmed/)
})

test("repair controls are full-admin only and use the operator workspace, not a selected client", () => {
  const pageSource = read("../app/platform-admin/page.tsx")
  assert.match(pageSource, /adminAccess\?\.full_access && user\?\.id && <UserEmailRepair/)
  assert.match(source, /preserved for review/)
  assert.match(source, /role="status"/)
  assert.match(source, /role="alert"/)
  const api = read("../lib/api.ts")
  const start = api.indexOf("export async function repairPlatformUserEmails")
  const request = api.slice(start, api.indexOf("export async function linkPlatformAdminIdentity", start))
  assert.match(request, /workspaceJsonHeaders\(userId, userId\)/)
  assert.match(request, /confirmation: "REPAIR USERS"/)
  assert.match(request, /45000/)
})
