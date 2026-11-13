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
  assert.match(setup, /opened && <div id="white-label-setup" hidden=\{!expanded\}><SetupWizard userId=\{userId\}/)
  assert.doesNotMatch(setup, /type="password"|stripe_secret_key|resend_api_key/i)
})

test("save carries the revision and downloading requires a saved, unchanged setup", () => {
  assert.match(setup, /revision: saved\?\.revision \?\? 0/)
  assert.match(setup, /disabled=\{!saved \|\| dirty \|\| !form\.auth_issuer\.startsWith/)
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
})
