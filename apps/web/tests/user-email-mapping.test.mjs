import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const source = read("../features/platform-admin/user-email-mapping.tsx")
const ast = ts.createSourceFile("mapping.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const dialog = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "MappingDialog")
const handler = name => dialog.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)

function harness(send, options = {}) {
  const state = { saved: false, busy: false, error: "", calls: [], events: [], refreshed: 0, closed: 0 }
  const context = { Error, userId: "operator", targetUserId: "usr_recover", email: " Owner@example.test ", confirmed: true,
    running: { current: false }, mappedResult: { current: null }, saved: false, busy: false,
    setBusy: value => { state.busy = value; context.busy = value }, setSaved: value => { state.saved = value; context.saved = value },
    setError: value => { state.error = value }, onMapped: async email => { state.refreshed++; state.mappedEmail = email; if (options.refreshFails) throw new Error("Unavailable") },
    onClose: () => { state.closed++ }, mapPlatformUserEmail: async (...args) => { state.calls.push(args); return send(...args) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail } },
    window: { dispatchEvent: value => state.events.push(value) }, ...options,
  }
  vm.runInNewContext(ts.transpileModule(handler("save") + handler("close") + "; globalThis.save=save;globalThis.close=close;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return { ...context, state }
}

const mapped = { user_id: "usr_recover", email: "owner@example.test", mapped: true }
test("email mapping waits for confirmation, preserves the target ID and locks duplicate submissions", async () => {
  const unconfirmed = harness(() => mapped, { confirmed: false })
  await unconfirmed.save(); assert.equal(unconfirmed.state.calls.length, 0)
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  const pending = h.save()
  await h.save(); h.close()
  assert.equal(h.state.calls.length, 1)
  assert.equal(h.state.closed, 0)
  assert.equal(h.state.busy, true)
  assert.equal(h.state.saved, false)
  finish(mapped); await pending
  assert.deepEqual(h.state.calls, [["operator", "usr_recover", "Owner@example.test"]])
  assert.equal(h.state.saved, true)
  assert.equal(h.state.refreshed, 1)
  assert.equal(h.state.mappedEmail, "owner@example.test")
  assert.equal(h.state.events.length, 0, "Completion stays visible until the administrator dismisses it")
  h.close()
  assert.equal(h.state.events[0].type, "decisionate:user-email-mapped")
  assert.equal(h.state.events[0].detail.user_id, "usr_recover")
  assert.equal(h.state.closed, 1)
  await h.save(); assert.equal(h.state.calls.length, 1)
})

test("conflicts and provider errors keep the ID unmapped and do not emit success", async () => {
  const h = harness(() => { throw new Error("Email already belongs to another account") })
  await h.save()
  assert.equal(h.state.saved, false)
  assert.equal(h.state.busy, false)
  assert.equal(h.state.refreshed, 0)
  assert.match(h.state.error, /another account/)
  h.close(); assert.equal(h.state.events.length, 0)
})

test("a failed list refresh does not retry or lose a confirmed mapping", async () => {
  const h = harness(() => mapped, { refreshFails: true })
  await h.save()
  assert.equal(h.state.saved, true)
  assert.match(h.state.error, /mapping is saved/)
  assert.equal(h.state.calls.length, 1)
  h.close(); assert.equal(h.state.events.length, 1)
})

test("mapping dialogs trap focus and clearly distinguish identity mapping from account merging", () => {
  assert.match(source, /\.showModal\(\)/)
  assert.match(source, /opener\?\.focus\(\)/)
  assert.match(source, /if \(busy\) event.preventDefault\(\)/)
  assert.match(source, /type="email"/)
  assert.match(source, /I confirm this email belongs/)
  assert.match(source, /other accounts will not be merged/)
  assert.match(source, /unmapped && <button/)
  const page = read("../app/platform-admin/page.tsx")
  assert.match(page, /adminAccess\?\.full_access && user\?\.id && platformUser.clerk_user_id/)
  assert.match(page, /unmapped=\{!platformUser.email\}/)
  assert.match(page, /setPlatformUsers\(current => current.map\(item => item.clerk_user_id === platformUser.clerk_user_id \? \{ \.\.\.item, email \} : item\)\)/)
  const repair = read("../features/platform-admin/user-email-repair.tsx")
  assert.match(repair, /Email mapping required/)
  assert.match(repair, /<UserEmailMapping userId=\{userId\} targetUserId=\{item.user_id\}/)
})
