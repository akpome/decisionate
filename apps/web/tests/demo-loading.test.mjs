import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const catalog = JSON.parse(read("../features/demo/data/catalog.json"))
const fixtures = Object.fromEntries(catalog.map(({ key, asset }) => [
  key,
  JSON.parse(read(`../public${asset}`))
]))

function compile(path, globals = {}) {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, {
    module: loaded,
    exports: loaded.exports,
    ...globals
  })
  return loaded.exports
}

const cache = compile("../lib/api-read-cache.ts")
const definitions = compile("../features/dashboards/dashboard-definitions.ts")
function loader(fetch) {
  return compile("../features/demo/lib/demo-data.ts", {
    fetch,
    AbortSignal,
    require: (id) => {
      if (id === "@/lib/api-read-cache") return cache
      if (id === "@/features/dashboards/dashboard-definitions") return definitions
      if (id === "../data/catalog.json") return catalog
      throw new Error(`Unexpected dependency: ${id}`)
    }
  })
}

const response = (key = "google-analytics") => ({
  ok: true,
  json: async () => fixtures[key]
})
function deferred() {
  let resolve
  const promise = new Promise((accept) => { resolve = accept })
  return { promise, resolve }
}

test("all twelve demo samples are content-addressed, complete and read-only", () => {
  assert.equal(catalog.length, 12)
  assert.equal(new Set(catalog.map(({ key }) => key)).size, 12)
  for (const { key, asset } of catalog) {
    const encoded = read(`../public${asset}`)
    const hash = createHash("sha256").update(encoded).digest("hex").slice(0, 12)
    assert.equal(asset, `/demo-data/${key}.${hash}.json`)
    assert.ok(Buffer.byteLength(encoded) < 500_000)
    const data = fixtures[key]
    assert.equal(data.demo, true)
    assert.equal(data.selected_dataset, key)
    assert.equal(data.dataset.chart.data.length, 365)
    assert.equal(data.demo_datasets.length, 12)
    assert.equal(data.capabilities.can_upload, false)
    assert.equal(data.capabilities.can_create_decisions, false)
    assert.equal(data.capabilities.can_delete_datasets, false)
    assert.doesNotMatch(encoded, /access_token|client_secret|refresh_token/)
  }
})

test("only the selected sample loads, using public same-origin caching without credentials", async () => {
  const calls = []
  const { loadPublicDemoDashboard } = loader(async (url, options) => {
    calls.push({ url, options })
    return response()
  })
  const data = await loadPublicDemoDashboard("  Google-Analytics  ")
  assert.equal(data.selected_dataset, "google-analytics")
  assert.equal(data.selected_dashboard, "general-business")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, catalog[0].asset)
  assert.equal(calls[0].options.cache, "force-cache")
  assert.equal(calls[0].options.credentials, "omit")
  assert.ok(calls[0].options.signal instanceof AbortSignal)
})

test("preload and navigation share the same pending fetch and subsequent dataset reads", async () => {
  const pending = deferred()
  let calls = 0
  const { prefetchPublicDemo, loadPublicDemoDashboard } = loader(() => {
    calls++
    return pending.promise
  })
  prefetchPublicDemo()
  const page = loadPublicDemoDashboard("google-analytics")
  assert.equal(calls, 1)
  pending.resolve(response())
  await page
  await loadPublicDemoDashboard("google-analytics")
  assert.equal(calls, 1)
})

test("changing dashboards reuses sample data without mutating the cached selection", async () => {
  let calls = 0
  const { loadPublicDemoDashboard } = loader(async () => {
    calls++
    return response()
  })
  const industry = await loadPublicDemoDashboard("google-analytics", "marketing-performance")
  const general = await loadPublicDemoDashboard("google-analytics")
  assert.equal(industry.selected_dashboard, "marketing-performance")
  assert.equal(general.selected_dashboard, "general-business")
  assert.notEqual(industry, general)
  assert.equal(industry.dataset, general.dataset)
  assert.equal(calls, 1)
})

test("cancelling one view never aborts another view's shared data request", async () => {
  const pending = deferred()
  let fetchSignal
  const { loadPublicDemoDashboard } = loader((_url, options) => {
    fetchSignal = options.signal
    return pending.promise
  })
  const cancelled = new AbortController()
  const first = loadPublicDemoDashboard("google-analytics", undefined, cancelled.signal)
  const rejection = assert.rejects(first, { name: "AbortError" })
  const second = loadPublicDemoDashboard("google-analytics")
  cancelled.abort()
  await rejection
  assert.equal(fetchSignal.aborted, false)
  pending.resolve(response())
  assert.equal((await second).demo, true)
})

test("already-cancelled and invalid requests do not start a fetch", async () => {
  const { loadPublicDemoDashboard } = loader(() => { throw new Error("Unexpected fetch") })
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(loadPublicDemoDashboard("google-analytics", undefined, aborted.signal), {
    name: "AbortError"
  })
  for (const key of ["missing", "../private", "https://example.com", ""]) {
    assert.equal(await loadPublicDemoDashboard(key), null)
  }
  assert.equal(await loadPublicDemoDashboard("google-analytics", "missing"), null)
})

test("network and invalid sample failures can be retried", async () => {
  const failures = [
    () => Promise.reject(new Error("offline")),
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => null }),
    async () => ({ ok: true, json: async () => ({ ...fixtures["google-analytics"], demo: false }) }),
    async () => response("stripe")
  ]
  for (const fail of failures) {
    let calls = 0
    const { loadPublicDemoDashboard } = loader(() => ++calls === 1 ? fail() : Promise.resolve(response()))
    await assert.rejects(loadPublicDemoDashboard("google-analytics"))
    assert.equal((await loadPublicDemoDashboard("google-analytics")).demo, true)
    assert.equal(calls, 2)
  }
})

test("an optional preload failure does not prevent a later navigation retry", async () => {
  let calls = 0
  const { prefetchPublicDemo, loadPublicDemoDashboard } = loader(async () => {
    if (++calls === 1) throw new Error("offline")
    return response()
  })
  prefetchPublicDemo()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await loadPublicDemoDashboard("google-analytics")).demo, true)
  assert.equal(calls, 2)
})

test("immutable caching is limited to sample files, not private shared dashboards", () => {
  const config = read("../next.config.ts")
  assert.match(config, /source: "\/demo-data\/:path\*"/)
  assert.match(config, /max-age=31536000, immutable/)
  const api = read("../lib/api.ts")
  const privateShare = api.split("export async function getPublicSharedDashboard")[1]
    .split("export async function")[0]
  assert.match(privateShare, /cache: "no-store"/)
  assert.match(privateShare, /token/)
})

test("the read-only status stays within the mobile demo in both dashboard layouts", () => {
  for (const path of [
    "../app/share/dashboard/page.tsx",
    "../features/dashboards/dashboard-registry.tsx"
  ]) {
    const statusLine = read(path).split("const demoStatusLine =")[1].split("</p>")[0]
    assert.match(statusLine, /max-w-full break-words/)
    assert.match(statusLine, /sm:truncate/)
  }
})

test("public demo charts draw immediately without changing workspace or export behavior", () => {
  const shared = read("../app/share/dashboard/page.tsx")
  assert.equal(shared.match(/demoMode=\{sharedDemo\}/g).length, 4)
  assert.equal(shared.match(/isAnimationActive=\{!demoMode\}/g).length, 3)
  const industry = read("../features/dashboards/dashboard-registry.tsx")
  assert.equal(industry.match(/isAnimationActive=\{!exportMode && !demoMode\}/g).length, 5)
})
