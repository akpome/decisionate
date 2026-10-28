import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate) {
  let found
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit) }
  visit(ast); assert.ok(found); return found
}
const declaration = name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
const compile = (text, globals) => vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals)
const datasets = [1, 2].map(id => ({ dataset_id: id, metrics: [{ metric_key: id === 1 ? "spend" : "orders", aggregation: "sum" }], availability: { date: { start: "2026-01-01", end: "2026-03-31" } } }))
const definition = () => ({ scope: "single", name: "My analysis", business_question: "How are sales changing?", source_run_id: "old-run",
  metrics: [{ dataset_id: 1, metric_key: "spend", date_column: "paid_date", aggregation: "sum" }],
  dimension_filters: [{ dataset_id: 1, column: "region", values: ["East"] }], date_range: { start: "2025-02-01", end: "2025-03-01" } })
function harness(overrides = {}) {
  const patches = [], selections = [], dates = []
  const context = { single: true, busy: false, datasets, singleDatasetId: 1, definition: definition(), datasetCount: 1, dateColumns: { 1: "paid_date" },
    reportDateColumn: dataset => dataset.dataset_id === 2 ? "date" : "paid_date",
    setSelectedDatasetId: id => { selections.push(id); context.singleDatasetId = id }, setDateColumns: value => dates.push(value),
    edit: patch => { patches.push(patch); context.definition = { ...context.definition, ...patch }; context.datasetCount = new Set(context.definition.metrics.map(item => item.dataset_id)).size },
    ...overrides }
  const handlers = compile(`${declaration("chooseSingleDataset")}\n${declaration("toggleMetric")}\n({ chooseSingleDataset, toggleMetric })`, context)
  return { ...handlers, context, patches, selections, dates }
}

test("choosing another source clears previous metrics, dimension filters, dates and source provenance", () => {
  const h = harness(), original = structuredClone(h.context.definition)
  h.chooseSingleDataset(2)
  assert.deepEqual(h.selections, [2])
  assert.deepEqual(JSON.parse(JSON.stringify(h.dates)), [{}])
  assert.deepEqual(JSON.parse(JSON.stringify(h.patches[0])), { metrics: [], dimension_filters: [], date_range: { start: "", end: "" }, source_run_id: null })
  assert.equal(h.context.definition.name, original.name)
  assert.equal(h.context.definition.business_question, original.business_question)
  h.toggleMetric(datasets[1], "orders")
  assert.equal(h.context.definition.metrics.length, 1)
  assert.equal(h.context.definition.metrics[0].dataset_id, 2)
  assert.equal(h.context.definition.metrics[0].date_column, "date")
  assert.equal(h.context.definition.date_range.start, "2026-03-02")
  assert.equal(h.context.definition.date_range.end, "2026-03-31")
})

test("deselecting the last metric retains the chosen dataset and its deliberate filter", () => {
  const h = harness()
  h.toggleMetric(datasets[0], "spend")
  assert.equal(h.context.definition.metrics.length, 0)
  assert.equal(h.context.singleDatasetId, 1)
  assert.equal(h.context.definition.dimension_filters[0].column, "region")
  assert.equal(h.dates.length, 0)
})

test("clearing the dataset clears selections and stale metric callbacks cannot select a different source", () => {
  const h = harness()
  h.chooseSingleDataset(null)
  assert.equal(h.context.singleDatasetId, null)
  h.toggleMetric(datasets[0], "spend")
  assert.equal(h.context.definition.metrics.length, 0)
  assert.equal(h.patches.length, 1)
  h.chooseSingleDataset(2)
  const count = h.patches.length
  h.toggleMetric(datasets[0], "spend")
  h.toggleMetric(datasets[1], "missing")
  assert.equal(h.patches.length, count)
})

test("same-source, unavailable, busy and multi-source changes cannot silently discard selections", () => {
  for (const [overrides, id] of [[{}, 1], [{}, 999], [{ busy: true }, 2], [{ single: false }, 2]]) {
    const h = harness(overrides), original = JSON.stringify(h.context.definition)
    h.chooseSingleDataset(id)
    assert.equal(h.patches.length, 0)
    assert.equal(h.selections.length, 0)
    assert.equal(JSON.stringify(h.context.definition), original)
  }
})

const loadEffect = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0].getText(ast).includes("loadReportCatalogDataset(request, singleDataset")).arguments[0].getText(ast)
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
test("changing dataset or workspace aborts the previous selected-source read without publishing stale data", async () => {
  const pending = deferred(), published = [], requests = []
  let signal
  const run = compile(`(${loadEffect})`, {
    singleDataset: { ...datasets[0], catalog_status: "pending" }, userId: "owner", workspaceId: "workspace", AbortController,
    correlationRequest: (...args) => { requests.push(args); return pending.promise },
    loadReportCatalogDataset: (request, dataset, selectedSignal) => { signal = selectedSignal; return request(`/catalog?dataset_id=${dataset.dataset_id}`, { signal }) },
    setDatasets: update => published.push(update([])), mergeCatalog: (current, added) => [...current, ...added],
  })
  const cleanup = run()
  assert.equal(requests[0][0], "owner")
  assert.equal(requests[0][1], "/business-reports/catalog?dataset_id=1")
  assert.equal(requests[0][3], "workspace")
  cleanup(); assert.equal(signal.aborted, true)
  pending.resolve(datasets[0]); await flush()
  assert.deepEqual(published, [])
})

test("only a pending chosen dataset is read; ready, unavailable and unselected sources are not scanned", async () => {
  for (const singleDataset of [undefined, datasets[0], { ...datasets[0], error_code: "dataset_unavailable" }]) {
    const run = compile(`(${loadEffect})`, { singleDataset, loadReportCatalogDataset: () => assert.fail("Source is not pending") })
    assert.equal(run(), undefined)
  }
  const published = [], selected = { ...datasets[1], catalog_status: "pending" }
  const run = compile(`(${loadEffect})`, { singleDataset: selected, userId: "owner", workspaceId: "workspace", AbortController,
    loadReportCatalogDataset: async (_request, dataset) => { assert.equal(dataset.dataset_id, 2); return datasets[1] },
    setDatasets: update => published.push(update([])), mergeCatalog: (current, added) => [...current, ...added],
  })
  const cleanup = run(); await flush(); cleanup()
  assert.equal(published.length, 1)
  assert.equal(published[0][0].dataset_id, 2)
})

test("single dataset picker is controlled independently of metric count and saved selections determine the source", () => {
  assert.match(source, /definition.metrics\[0\]\?\.dataset_id \?\? selectedDatasetId/)
  assert.match(source, /selectedDatasetId=\{singleDatasetId\} onDatasetChange=\{chooseSingleDataset\}/)
  assert.match(source, /metadataOnly: single/)
  assert.match(source, /singleDataset.catalog_status === "pending"/)
})
