import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
const tracker = readFileSync(new URL("../features/marketing/activity-tracker.tsx", import.meta.url), "utf8")

function transportHarness(fetch) {
  const parsed = ts.createSourceFile("api.ts", api, ts.ScriptTarget.Latest, true)
  const functions = ["marketingRequest", "apiFetch", "notifyApiAvailability"].map(name => {
    const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(node)
    return node.getText(parsed).replace("export ", "")
  }).join("\n")
  const availability = [], requests = [], window = new EventTarget()
  Object.assign(window, { setTimeout, clearTimeout })
  window.addEventListener("availability", event => availability.push(event.detail))
  const context = {
    window, AbortController, DOMException, TypeError, Error, CustomEvent, process: { env: {} }, Headers,
    API_URL: "https://api.example.test", apiRequestTimeoutMs: 1000,
    apiAvailabilityChangedEvent: "availability", apiAvailabilitySnapshot: { available: false, message: "Existing outage" },
    workspaceHeaders: async userId => ({ "X-User-Id": userId, "X-Workspace-Id": "workspace" }),
    fetch: async (...args) => { requests.push(args); return fetch(...args) },
    throwApiError: async response => { throw new Error(`Request failed: ${response.status}`) },
  }
  const request = vm.runInNewContext(ts.transpileModule(`${functions}\nmarketingRequest`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { request, context, requests, availability }
}

test("background activity failures do not announce a global outage or retry", async () => {
  for (const failure of [() => { throw new TypeError("Failed to fetch") }, () => new Response("Unavailable", { status: 503 })]) {
    const h = transportHarness(failure)
    await assert.rejects(h.request("owner", "/activity", { method: "POST", body: '{"event":"dashboard_view"}' }))
    assert.equal(h.requests.length, 1)
    assert.deepEqual(h.availability, [])
    assert.equal(h.context.apiAvailabilitySnapshot.message, "Existing outage")
  }
})

test("successful background activity cannot clear an existing product outage", async () => {
  const h = transportHarness(() => Response.json({ status: "recorded" }))
  const result = await h.request("owner", "/activity", { method: "POST", body: '{"event":"dashboard_view"}' })
  assert.equal(result.status, "recorded")
  assert.equal(h.requests[0][0], "https://api.example.test/marketing/activity")
  assert.equal(h.requests[0][1].headers["X-Workspace-Id"], "workspace")
  assert.deepEqual(h.availability, [])
  assert.equal(h.context.apiAvailabilitySnapshot.available, false)
})

test("email preference failures still report service availability normally", async () => {
  for (const method of ["GET", "PUT"]) {
    const h = transportHarness(() => { throw new TypeError("Failed to fetch") })
    await assert.rejects(h.request("owner", "/preferences", { method }))
    assert.equal(h.availability.length, 1)
    assert.equal(h.availability[0].available, false)
  }
})

test("aborted activity is cancelled without reporting a global outage", async () => {
  let started
  const requestStarted = new Promise(resolve => { started = resolve })
  const h = transportHarness((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    started()
  }))
  const controller = new AbortController()
  const pending = h.request("owner", "/activity", { method: "POST", signal: controller.signal })
  await requestStarted
  controller.abort()
  await assert.rejects(pending, error => error.name === "AbortError")
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.availability, [])
})

function trackerHarness({ pathname = "/dashboard", visible = true, userId = "owner", search = "" } = {}) {
  let effect, dependencies, nextTimer = 0
  const timers = new Map(), calls = [], loaded = { exports: {} }
  const window = {
    location: { search },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
  }
  vm.runInNewContext(ts.transpileModule(tracker, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    module: loaded, exports: loaded.exports, window, URLSearchParams, AbortController, process: { env: {} },
    document: { visibilityState: visible ? "visible" : "hidden" },
    require: name => {
      if (name === "react") return { useEffect: (callback, deps) => { effect = callback; dependencies = deps } }
      if (name === "next/navigation") return { usePathname: () => pathname }
      if (name === "@clerk/nextjs") return { useUser: () => ({ user: userId ? { id: userId } : null }) }
      if (name === "@/lib/api") return { marketingRequest: async (...args) => { calls.push(args) } }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  loaded.exports.MarketingActivityTracker()
  return { run: () => effect(), rerender: loaded.exports.MarketingActivityTracker, dependencies: () => Array.from(dependencies), calls, timers }
}

test("leaving a page cancels scheduled or in-flight tracking", () => {
  const scheduled = trackerHarness(), cleanup = scheduled.run()
  assert.equal(scheduled.timers.size, 1)
  cleanup()
  assert.equal(scheduled.timers.size, 0)
  assert.equal(scheduled.calls.length, 0)

  const active = trackerHarness(), cancel = active.run()
  for (const callback of active.timers.values()) callback()
  assert.equal(active.calls.length, 1)
  const [userId, path, options] = active.calls[0]
  assert.equal(userId, "owner")
  assert.equal(path, "/activity")
  assert.equal(JSON.parse(options.body).event, "dashboard_view")
  assert.equal(options.signal.aborted, false)
  cancel()
  assert.equal(options.signal.aborted, true)
})

test("new Clerk user object instances do not restart the same activity timer", () => {
  const h = trackerHarness()
  const dependencies = h.dependencies()
  h.rerender()
  assert.deepEqual(h.dependencies(), dependencies)
  assert.deepEqual(dependencies, ["/dashboard", "owner"])
})

test("hidden pages, unrelated routes and signed-out users do not record activity", () => {
  for (const options of [{ visible: false }, { pathname: "/dashboard/settings" }, { userId: null }]) {
    const h = trackerHarness(options), cleanup = h.run()
    for (const callback of h.timers.values()) callback()
    assert.equal(h.calls.length, 0)
    cleanup?.()
  }
})
