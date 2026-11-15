import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, dependencies = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, URL, Request, Response, ...globals,
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    } })
  return loaded.exports
}
const domains = load("../lib/decisionate-domains.ts")
const routes = load("../lib/application-routes.ts")
const auth = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })
const common = { "@/lib/decisionate-domains": domains, "@/features/auth/lib/auth-redirects": auth }
const forbiddenHosts = ["decisionate.ca", "www.decisionate.ca", "preview.vercel.app", "tenant.decisionate.app", "app.decisionate.ca.attacker.test", "localhost"]

test("only the app host advertises an installable manifest and Apple PWA metadata", async () => {
  for (const hostname of ["app.decisionate.ca", ...forbiddenHosts]) {
    const { generateMetadata } = load("../app/layout.tsx", {
      ...common, "./globals.css": {}, "react/jsx-runtime": {}, "./clerk-provider": {}, "./pwa-registration": {},
      "./theme-bootstrap": {}, "./language-bootstrap": {}, "./workspace-favicon-bootstrap": {},
      "@/lib/portal-brand": { portalBrand: { name: "Decisionate", id: "" } },
      "next/headers": { headers: async () => new Headers({ host: "internal:3000", "x-forwarded-host": hostname, "x-forwarded-proto": "https" }) },
    })
    const metadata = await generateMetadata(), enabled = hostname === "app.decisionate.ca"
    assert.equal(metadata.manifest, enabled ? "/manifest.webmanifest" : undefined, hostname)
    assert.equal(metadata.appleWebApp?.capable, enabled ? true : undefined, hostname)
    assert.equal(metadata.title.default, "Decisionate")
  }
})

test("the manifest endpoint rejects marketing and unrelated origins and retains application shortcuts", async () => {
  const { GET } = load("../app/manifest.webmanifest/route.ts", common)
  for (const hostname of forbiddenHosts) {
    const response = GET(new Request(`https://${hostname}/manifest.webmanifest`))
    assert.equal(response.status, 404, hostname)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  const response = GET(new Request("http://internal:3000/manifest.webmanifest?name=My%20workspace", {
    headers: { "x-forwarded-host": "app.decisionate.ca", "x-forwarded-proto": "https" },
  }))
  assert.equal(response.status, 200)
  const manifest = await response.json()
  assert.equal(manifest.name, "My workspace")
  assert.equal(manifest.start_url, "/dashboard")
  assert.equal(manifest.scope, "/")
  assert.deepEqual(manifest.shortcuts.map(item => item.url), ["/dashboard", "/alerts", "/decisions"])
})

test("the primary-host change does not enable PWA installation for hosted portals", async () => {
  const { generateMetadata } = load("../app/layout.tsx", {
    ...common, "./globals.css": {}, "react/jsx-runtime": {}, "./clerk-provider": {}, "./pwa-registration": {},
    "./theme-bootstrap": {}, "./language-bootstrap": {}, "./workspace-favicon-bootstrap": {},
    "@/lib/portal-brand": { portalBrand: { name: "Agency portal", id: "agency" } },
    "next/headers": { headers: async () => new Headers({ host: "tenant.decisionate.app", "x-forwarded-proto": "https" }) },
  })
  const metadata = await generateMetadata()
  assert.equal(metadata.manifest, undefined)
  assert.equal(metadata.applicationName, "Agency portal")
  assert.equal(metadata.appleWebApp.capable, true, "Existing portal Apple metadata is unchanged")
})

function registrationHarness(hostname, { environment = "production", readyState = "complete", protocol = "https:", failCleanup = false } = {}) {
  const calls = [], listeners = new Map()
  const registration = name => ({ active: { scriptURL: `https://${hostname}/${name}` }, unregister: async () => calls.push(`unregister:${name}`) })
  const navigator = { serviceWorker: {
    getRegistrations: async () => { if (failCleanup) throw new Error("Unavailable"); return [registration("sw.js"), registration("other-worker.js")] },
    register: async (url, options) => { calls.push({ url, scope: options.scope }); return { update: async () => calls.push("update") } },
  } }
  const window = { location: { hostname, origin: `https://${hostname}`, protocol },
    caches: { keys: async () => ["decisionate-pwa-v5-shell", "decisionate-pwa-v6-shell", "unrelated-cache"], delete: async name => calls.push(`delete:${name}`) },
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
  }
  let cleanup
  const { PwaRegistration } = load("../app/pwa-registration.tsx", {
    "@/lib/decisionate-domains": domains, react: { useEffect: effect => { cleanup = effect() } },
  }, { window, navigator, document: { readyState }, process: { env: { NODE_ENV: environment } } })
  PwaRegistration()
  return { calls, listeners, cleanup }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test("marketing cleanup removes only Decisionate registrations and caches, never other site data", async () => {
  for (const hostname of forbiddenHosts) {
    const { calls } = registrationHarness(hostname)
    await settle()
    assert.ok(calls.includes("unregister:sw.js"), hostname)
    assert.ok(calls.includes("delete:decisionate-pwa-v5-shell"), hostname)
    assert.ok(calls.includes("delete:decisionate-pwa-v6-shell"), hostname)
    assert.ok(!calls.includes("unregister:other-worker.js"))
    assert.ok(!calls.includes("delete:unrelated-cache"))
    assert.ok(!calls.some(call => typeof call === "object"))
  }
  const { calls } = registrationHarness("decisionate.ca", { failCleanup: true })
  await settle()
  assert.ok(calls.includes("delete:decisionate-pwa-v5-shell"))
})

test("production registers on the secure app host after load; development only cleans up", async () => {
  const app = registrationHarness("app.decisionate.ca")
  await settle()
  assert.equal(JSON.stringify(app.calls), JSON.stringify([{ url: "/sw.js", scope: "/" }, "update"]))
  const deferred = registrationHarness("app.decisionate.ca", { readyState: "loading" })
  assert.equal(deferred.calls.length, 0)
  deferred.listeners.get("load")()
  await settle()
  assert.equal(deferred.calls.length, 2)
  deferred.cleanup()
  assert.equal(deferred.listeners.size, 0)
  const development = registrationHarness("app.decisionate.ca", { environment: "development" })
  await settle()
  assert.ok(development.calls.includes("unregister:sw.js"))
  assert.equal(registrationHarness("app.decisionate.ca", { protocol: "http:" }).calls.length, 0)
})

function workerHarness(hostname) {
  const events = {}, calls = []
  const caches = {
    keys: async () => ["decisionate-pwa-v5-shell", "decisionate-pwa-v6-shell", "unrelated-cache"],
    delete: async name => calls.push(`delete:${name}`),
    open: async name => { calls.push(`open:${name}`); return { addAll: async () => {} } },
    match: async () => new Response("Offline page"),
  }
  vm.runInNewContext(read("../public/sw.js"), { caches, URL, Response, fetch: async () => { throw new Error("Offline") }, self: {
    location: { hostname, origin: `https://${hostname}` }, addEventListener: (name, handler) => events[name] = handler,
    skipWaiting: async () => calls.push("skipWaiting"), clients: { claim: async () => calls.push("claim") },
    registration: { unregister: async () => calls.push("unregister") },
  } })
  const dispatch = async name => { let work; events[name]({ waitUntil: promise => work = promise }); await work }
  return { calls, events, dispatch }
}

test("old marketing workers retire themselves without caching or intercepting navigation", async () => {
  for (const hostname of forbiddenHosts) {
    const worker = workerHarness(hostname)
    await worker.dispatch("install")
    await worker.dispatch("activate")
    assert.ok(worker.calls.includes("unregister"), hostname)
    assert.ok(worker.calls.includes("delete:decisionate-pwa-v5-shell"))
    assert.ok(worker.calls.includes("delete:decisionate-pwa-v6-shell"))
    assert.ok(!worker.calls.includes("claim"))
    assert.ok(!worker.calls.some(call => call.startsWith("open:") || call === "delete:unrelated-cache"))
    worker.events.fetch({ request: { method: "GET", mode: "navigate", url: `https://${hostname}/` }, respondWith() { assert.fail("Marketing navigation must use the network") } })
  }
})

test("the app worker keeps offline fallback, upgrades old caches, and never caches authenticated responses", async () => {
  const worker = workerHarness("app.decisionate.ca")
  await worker.dispatch("install")
  await worker.dispatch("activate")
  assert.ok(worker.calls.includes("open:decisionate-pwa-v6-shell"))
  assert.ok(worker.calls.includes("delete:decisionate-pwa-v5-shell"))
  assert.ok(!worker.calls.includes("delete:decisionate-pwa-v6-shell"))
  assert.ok(worker.calls.includes("claim"))
  assert.ok(!worker.calls.includes("unregister"))
  let response
  worker.events.fetch({ request: { method: "GET", mode: "navigate", url: "https://app.decisionate.ca/decisions" }, respondWith: promise => response = promise })
  assert.equal(await (await response).text(), "Offline page")
  worker.events.fetch({ request: { method: "GET", mode: "cors", url: "https://api.decisionate.ca/datasets" }, respondWith() { assert.fail("API responses must stay outside the worker") } })
})
