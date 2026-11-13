import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const setup = readFileSync(new URL("../features/white-label/setup.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8")
const state = readFileSync(new URL("../features/white-label/state.ts", import.meta.url), "utf8")

function extract(source, name) {
  const tree = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration)
  return declaration.getText(tree)
}

function load(source, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: loaded.exports, module: loaded, ...globals })
  return loaded.exports
}

test("brand name suggests a stable, bounded application id", () => {
  const { suggestApplicationId } = load(extract(setup, "suggestApplicationId"))
  assert.equal(suggestApplicationId("North Star Analytics"), "north-star-analytics")
  assert.equal(suggestApplicationId("Decisionate.ai"), "decisionate-ai")
  assert.equal(suggestApplicationId("123 Stores"), "brand-123-stores")
  assert.ok(suggestApplicationId("A".repeat(100)).length <= 63)
  assert.equal(suggestApplicationId("   "), "")
})

test("setup is offered only to full-access operators", () => {
  assert.match(page, /adminAccess\.full_access && <WhiteLabelSetup userId=\{user\.id\}/)
  assert.match(setup, /opened && <div id="white-label-setup" hidden=\{!expanded\}><SetupWizard key=\{userId\} userId=\{userId\}/)
  assert.doesNotMatch(setup, /type="password"|stripe_secret_key|resend_api_key/i)
})

test("save carries the revision and downloading requires a saved, unchanged setup", () => {
  assert.match(setup, /revision: saved\?\.revision \?\? 0/)
  assert.match(setup, /disabled=\{!saved \|\| dirty \|\| !saved\.readiness\.package_ready\}/)
  assert.match(setup, /downloadWhiteLabelPackage\(userId, saved\.configuration\.id, saved\.revision\)/)
  assert.match(setup, /saved && !saved\.readiness\.registered/)
  assert.match(setup, /confirmDelete &&/)
})

test("setup calls use owner authentication headers and never a selected customer workspace", async () => {
  const calls = []
  const { whiteLabelRequest } = load(extract(api, "whiteLabelRequest"), {
    API_URL: "https://api.example",
    workspaceJsonHeaders: async (...args) => { calls.push(args); return { Authorization: "Bearer token" } },
    apiFetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ saved: true }) } },
  })
  assert.equal((await whiteLabelRequest("admin", "/north-star", { method: "PUT", body: "{}" })).saved, true)
  assert.deepEqual(calls[0], ["admin", "admin"])
  assert.equal(calls[1].url, "https://api.example/admin/white-label/north-star")
  assert.equal(calls[1].init.cache, "no-store")
  assert.equal(calls[1].init.headers.Authorization, "Bearer token")
})

test("package download escapes the id and preserves server errors", async () => {
  let called
  const { downloadWhiteLabelPackage } = load(extract(api, "downloadWhiteLabelPackage"), {
    API_URL: "https://api.example",
    workspaceHeaders: async () => ({}),
    apiFetch: async (url) => { called = url; return { ok: false } },
    throwApiError: async () => { throw new Error("Issuer required") },
  })
  await assert.rejects(downloadWhiteLabelPackage("admin", "unsafe/id"), /Issuer required/)
  assert.equal(called, "https://api.example/admin/white-label/unsafe%2Fid/package")
  await assert.rejects(downloadWhiteLabelPackage("admin", "north-star", 4), /Issuer required/)
  assert.equal(called, "https://api.example/admin/white-label/north-star/package?revision=4")
})

test("empty new setups are clean but unsaved edits and launch tests are protected", () => {
  const { emptyConfiguration, hasSetupChanges } = load(state)
  assert.equal(hasSetupChanges({ ...emptyConfiguration }, null), false)
  assert.equal(hasSetupChanges({ ...emptyConfiguration, name: "North Star" }, null), true)
  const saved = { configuration: { ...emptyConfiguration, name: "North Star" } }
  assert.equal(hasSetupChanges({ ...saved.configuration }, saved), false)
  assert.equal(hasSetupChanges({ ...saved.configuration, confirmed_checks: [0] }, saved), true)
  assert.match(setup, /if \(dirty\) \{ setPendingNavigation\(target\); return \}/)
  assert.match(setup, /window\.addEventListener\("beforeunload", warn\)/)
  assert.match(setup, /aria-label="Reload setup"[^>]*disabled=\{busy\}/)
})

test("resuming a setup opens its first incomplete stage or launch review", () => {
  const { resumeStep } = load(state)
  const saved = { readiness: { setup_checks: [{ step: 0, complete: true }, { step: 1, complete: false }], configuration_complete: false } }
  assert.equal(resumeStep(saved), 1)
  saved.readiness.setup_checks[1].complete = true
  assert.equal(resumeStep(saved), 2)
  saved.readiness.configuration_complete = true
  assert.equal(resumeStep(saved), 3)
})

test("launch confirmation needs matching deployment and all saved manual tests", () => {
  const { canConfirmLaunch } = load(state)
  const saved = { configuration: { confirmed_checks: [0, 1] }, completion: null,
    readiness: { configuration_complete: true, launch_checks: ["HTTPS", "Sign in"] } }
  assert.equal(canConfirmLaunch(null, false), false)
  assert.equal(canConfirmLaunch(saved, false), true)
  assert.equal(canConfirmLaunch(saved, true), false)
  saved.configuration.confirmed_checks = [0]
  assert.equal(canConfirmLaunch(saved, false), false)
  saved.configuration.confirmed_checks = [0, 1]
  saved.readiness.configuration_complete = false
  assert.equal(canConfirmLaunch(saved, false), false)
  saved.readiness.configuration_complete = true
  saved.completion = { current: true }
  assert.equal(canConfirmLaunch(saved, false), false)
  saved.completion.current = false
  assert.equal(canConfirmLaunch(saved, false), true)
})

test("async actions cannot overlap and failures leave editing and recovery available", async () => {
  const tree = ts.createSourceFile("setup.tsx", setup, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const wizard = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SetupWizard")
  const runNode = wizard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "run")
  const pending = { current: false }, busy = [], errors = []
  const { run } = load(`export ${runNode.getText(tree)}`, {
    actionPending: pending, setBusy: value => busy.push(value), setError: value => errors.push(value), setMessage: () => {}, Error,
  })
  let finish, calls = 0
  const first = run(() => new Promise(resolve => { calls++; finish = resolve }))
  await run(async () => { calls++ })
  assert.equal(calls, 1)
  finish(); await first
  assert.equal(pending.current, false)
  await run(async () => { throw new Error("This setup changed. Reload it before saving.") })
  assert.match(errors.at(-1), /Reload it before saving/)
  assert.equal(busy.at(-1), false)
  assert.equal(pending.current, false)
})
