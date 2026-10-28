import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const loaded = { exports: {} }
const source = readFileSync(new URL("../features/reports/report-catalog-loading.ts", import.meta.url), "utf8")
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: loaded, exports: loaded.exports, Promise })
const { loadReportCatalogPage, loadReportCatalogDataset, mergeReportCatalog } = loaded.exports
const entry = id => ({ dataset_id: id, dataset_label: `Source ${id}`, connector: "csv", metrics: [], date_columns: [], availability: {}, catalog_status: "pending" })
const ready = id => ({ ...entry(id), catalog_status: undefined, metrics: [{ metric_key: "spend" }] })
const page = ids => ({ datasets: ids.map(entry), next_offset: null })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test("dataset names arrive before scans; a slow source does not delay healthy metric results", async () => {
  const slow = deferred(), healthy = deferred(), events = [], controller = new AbortController()
  let active = 0, maximum = 0
  const request = async (path, init) => {
    assert.equal(init.signal, controller.signal)
    if (path.includes("metadata_only")) { assert.equal(path, "/catalog?metadata_only=true&offset=0"); return page([1, 2, 3, 4]) }
    active++; maximum = Math.max(maximum, active)
    const id = Number(new URLSearchParams(path.split("?")[1]).get("dataset_id"))
    try { return id === 1 ? await slow.promise : { datasets: [ready(id)] } } finally { active-- }
  }
  const result = loadReportCatalogPage(request, 0, controller.signal, value => events.push(["page", value.datasets.length]), value => {
    events.push(["dataset", value.dataset_id])
    if (value.dataset_id === 4) healthy.resolve()
  })
  await healthy.promise
  assert.deepEqual(events, [["page", 4], ["dataset", 2], ["dataset", 3], ["dataset", 4]])
  assert.equal(maximum, 2)
  slow.resolve({ datasets: [ready(1)] })
  await result
  assert.deepEqual(events.at(-1), ["dataset", 1])
})

test("one dataset timeout is isolated and does not erase successfully loaded metrics", async () => {
  const resolved = []
  await loadReportCatalogPage(async path => {
    if (path.includes("metadata_only")) return page([1, 2, 3])
    if (path.endsWith("=1")) throw new Error("Private storage failure")
    return { datasets: [ready(Number(path.at(-1)))] }
  }, 0, new AbortController().signal, () => {}, value => resolved.push(value))
  assert.equal(resolved.length, 3)
  assert.equal(resolved.find(item => item.dataset_id === 1).error_code, "dataset_unavailable")
  assert.equal(resolved.find(item => item.dataset_id === 1).catalog_status, undefined)
  assert.equal(resolved.filter(item => item.metrics.length).length, 2)
  assert.doesNotMatch(JSON.stringify(resolved), /Private storage failure/)
})

test("list failure is retryable and is never published as an empty successful page", async () => {
  let pages = 0
  await assert.rejects(loadReportCatalogPage(async () => { throw new Error("Timed out") }, 0, new AbortController().signal,
    () => pages++, () => assert.fail("No dataset results expected")), /Timed out/)
  assert.equal(pages, 0)
  await loadReportCatalogPage(async () => page([]), 0, new AbortController().signal, () => pages++, () => {})
  assert.equal(pages, 1)
})

test("cancelled workspace requests cannot publish stale data or start queued scans", async () => {
  const slow = deferred(), controller = new AbortController(), results = [], requests = []
  const work = loadReportCatalogPage(async path => {
    requests.push(path)
    return path.includes("metadata_only") ? page([1, 2, 3, 4]) : slow.promise
  }, 0, controller.signal, () => {}, item => results.push(item))
  await flush()
  controller.abort()
  slow.resolve({ datasets: [ready(1)] })
  await work
  assert.deepEqual(results, [])
  assert.equal(requests.length, 3)
})

test("pagination and older ready catalog responses do not cause unnecessary repeated file reads", async () => {
  const paths = [], pages = []
  await loadReportCatalogPage(async path => { paths.push(path); return { datasets: [ready(26)], next_offset: 50 } },
    25, new AbortController().signal, value => pages.push(value), () => assert.fail("Already ready"))
  assert.deepEqual(paths, ["/catalog?metadata_only=true&offset=25"])
  assert.equal(pages[0].next_offset, 50)
})

test("single dataset catalogs publish paginated names without scanning unselected sources", async () => {
  const paths = [], pages = []
  await loadReportCatalogPage(async path => { paths.push(path); return { ...page([1, 2, 3]), next_offset: 25 } },
    0, new AbortController().signal, value => pages.push(value), () => assert.fail("Unselected sources must not be scanned"), { metadataOnly: true })
  assert.deepEqual(paths, ["/catalog?metadata_only=true&offset=0"])
  assert.equal(pages[0].datasets.length, 3)
  assert.equal(pages[0].next_offset, 25)
  assert.ok(pages[0].datasets.every(dataset => dataset.catalog_status === "pending"))
})

test("a source retry makes one request instead of rescanning the catalog page", async () => {
  const paths = [], controller = new AbortController()
  const result = await loadReportCatalogDataset(async (path, init) => {
    paths.push(path)
    assert.equal(init.signal, controller.signal)
    return { datasets: [ready(17)] }
  }, entry(17), controller.signal)
  assert.deepEqual(paths, ["/catalog?dataset_id=17"])
  assert.equal(result.dataset_id, 17)
  assert.equal(result.metrics.length, 1)
})

test("a source retry remains retryable on errors, missing or mismatched source responses", async () => {
  for (const request of [async () => { throw new Error("Private bucket URL") }, async () => page([]), async () => ({ datasets: [ready(2)] })]) {
    const result = await loadReportCatalogDataset(request, entry(1), new AbortController().signal)
    assert.equal(result.dataset_id, 1)
    assert.equal(result.error_code, "dataset_unavailable")
    assert.equal(result.catalog_status, undefined)
    assert.doesNotMatch(JSON.stringify(result), /Private bucket URL/)
  }
})

test("a retry cancelled during navigation never returns data for the old workspace", async () => {
  const controller = new AbortController(), pending = deferred()
  const work = loadReportCatalogDataset(() => pending.promise, entry(1), controller.signal)
  controller.abort()
  pending.resolve({ datasets: [ready(1)] })
  await assert.rejects(work, error => error.name === "AbortError")
  await assert.rejects(loadReportCatalogDataset(() => assert.fail("Already cancelled"), entry(1), controller.signal), error => error.name === "AbortError")
})

test("metadata, resolved metrics and pagination preserve row order and healthy selections", () => {
  const first = ready(1), second = entry(2)
  const merged = mergeReportCatalog([first, second], [entry(1), ready(3), ready(2)])
  assert.deepEqual(Array.from(merged, item => item.dataset_id), [1, 2, 3])
  assert.equal(merged[0], first)
  assert.equal(merged[1].metrics.length, 1)
  assert.equal(first.metrics.length, 1)
  assert.equal(second.catalog_status, "pending")
  const updated = ready(1)
  updated.metrics = [{ metric_key: "revenue" }]
  assert.equal(mergeReportCatalog(merged, [updated])[0], updated)
})
