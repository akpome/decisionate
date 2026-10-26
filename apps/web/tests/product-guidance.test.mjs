import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const component = readFileSync(new URL("../features/support/product-guidance.tsx", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/dashboard/help/page.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")

function loadFunction(source, name, globals = {}) {
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name)
  assert.ok(declaration)
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: loaded, exports: loaded.exports, ...globals })
  return loaded.exports[name]
}

test("guidance history is bounded, contains only role and text, and never mutates messages", () => {
  const history = loadFunction(component, "guidanceHistory")
  const messages = Array.from({ length: 20 }, (_, id) => ({ role: id % 2 ? "assistant" : "user", content: "x".repeat(3000), secretMetadata: "not sent" }))
  const result = history(messages)
  assert.equal(result.length, 6)
  assert.equal(result[0].content.length, 2000)
  assert.deepEqual(Object.keys(result[0]), ["role", "content"])
  assert.equal(messages[0].content.length, 3000)
})

test("citations only link to allowed same-origin application routes", () => {
  const safe = loadFunction(component, "safeGuidanceRoute")
  for (const route of ["/dashboard/reports", "/dashboard/help", "/privacy"]) assert.equal(safe(route), true)
  for (const route of ["https://bad.test", "//bad.test", "javascript:alert(1)", "/dashboard?workspace=victim", "/platform-admin", "/dashboard/../admin"]) assert.equal(safe(route), false)
})

test("chat API uses authenticated workspace context, cancellation and no cached transcript", async () => {
  const calls = [], signal = new AbortController().signal
  const ask = loadFunction(api, "askProductGuidance", {
    API_URL: "https://api.example.test",
    workspaceJsonHeaders: async (user, workspace) => ({ "X-User-Id": user, "X-Workspace-Id": workspace }),
    apiFetch: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ answer: "Documented", mode: "documentation", sources: [] }) } },
  })
  await ask("Reports?", [], "user", "workspace", signal)
  const [url, init, timeout, notify] = calls[0]
  assert.equal(url, "https://api.example.test/support/chat")
  assert.equal(init.signal, signal)
  assert.equal(init.cache, "no-store")
  assert.equal(init.headers["X-Workspace-Id"], "workspace")
  assert.deepEqual(JSON.parse(init.body), { question: "Reports?", history: [] })
  assert.equal(timeout, 25000)
  assert.equal(notify, false)
})

test("API errors use the shared customer-safe handler", async () => {
  const ask = loadFunction(api, "askProductGuidance", {
    API_URL: "https://api.example.test", workspaceJsonHeaders: async () => ({}),
    apiFetch: async () => ({ ok: false }), throwApiError: async () => { throw new Error("Please wait") },
  })
  await assert.rejects(ask("Reports?", [], "u", "w", new AbortController().signal), /Please wait/)
})

test("conversation scope resets on identity or workspace changes and unmount aborts pending calls", () => {
  assert.match(page, /key=\{`\$\{user\?\.id \?\? ""\}:\$\{activeWorkspaceId\}`\}/)
  assert.match(component, /useEffect\(\(\) => \(\) => request.current\?\.abort\(\), \[\]\)/)
  assert.match(component, /if \(controller.signal.aborted\) return/)
  assert.match(component, /request.current === controller/)
  assert.doesNotMatch(component, /localStorage|sessionStorage|dangerouslySetInnerHTML/)
})

test("sources, privacy, retries, stop and human handoff remain available without automatic support delivery", () => {
  assert.match(component, /AI answer/)
  assert.match(component, /Documentation/)
  assert.match(component, /<details key=\{source.chunk_id\}/)
  assert.match(component, /not your live account/)
  assert.match(component, /aria-label="Stop waiting"/)
  assert.match(component, /void ask\(retryQuestion, true\)/)
  assert.match(component, /onContactSupport\(/)
  assert.doesNotMatch(component, /submitSupportRequest/)
  assert.match(page, /if \(message\) setSupportMessage\(message\)/)
})
