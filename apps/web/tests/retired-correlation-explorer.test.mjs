import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, require: name => imports[name] || require(name), URLSearchParams, AbortController, Error, ...globals })
  return module.exports
}
const destinations = load("../features/reports/legacy-relationship-destination.ts")

test("retired explorer links lead to Reports or frozen evidence without dropping run/result identities", () => {
  assert.equal(destinations.legacyRelationshipDestination({}), "/dashboard/reports")
  for (const params of [{ run: "run-1" }, { result: "result-1" }, { run: "run-1", result: "result-1" }]) {
    const value = new URL(destinations.legacyRelationshipDestination(params), "https://decisionate.ca")
    assert.equal(value.pathname, "/dashboard/reports/evidence")
    for (const [key, item] of Object.entries(params)) assert.equal(value.searchParams.get(key), item)
  }
  assert.equal(destinations.legacyRelationshipDestination({ run: ["one", "two"], returnTo: "https://example.test" }), "/dashboard/reports")
  const encoded = new URL(destinations.historicalEvidenceHref("a/b?c", "d&e"), "https://decisionate.ca")
  assert.equal(encoded.searchParams.get("run"), "a/b?c")
  assert.equal(encoded.searchParams.get("result"), "d&e")
})

test("the old Next route only redirects and no longer imports the explorer", async () => {
  let location
  const { default: Page } = load("../app/dashboard/relationships/explorer/page.tsx", {
    "next/navigation": { redirect: value => { location = value } },
    "@/features/reports/legacy-relationship-destination": destinations,
  })
  await Page({ searchParams: Promise.resolve({ run: "original", result: "finding" }) })
  assert.equal(location, "/dashboard/reports/evidence?run=original&result=finding")
  assert.doesNotMatch(read("../app/dashboard/relationships/explorer/page.tsx"), /CorrelationExplorer|capabilities/)
})

test("the advanced entry, client builder and dedicated worker are removed, not merely hidden by flags", () => {
  for (const file of ["../features/relationships/correlation-entry.tsx", "../features/relationships/correlation-explorer.tsx",
    "../../api/scripts/run_correlation_worker.py", "../../api/app/modules/correlation/worker.py"]) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false, file)
  }
  const env = read("../../api/.env.example")
  assert.doesNotMatch(env, /MULTI_METRIC_CORRELATION_|CORRELATION_WORKER_ENABLED|CORRELATION_JOB_|CORRELATION_LAG_MATRIX/)
  assert.match(env, /CORRELATION_REPORTING_TIMEZONE=UTC/)
  const basic = read("../app/dashboard/relationships/page.tsx")
  assert.match(basic, /previewDatasetRelationship/)
  assert.match(basic, /createDatasetRelationship/)
  assert.doesNotMatch(basic, /CorrelationEntry/)
})

const run = { run_id: "original", engine_version: "legacy.shared-periods.v1", computed_at: "2026-01-31T12:00:00Z", status: "completed",
  definition: { name: "Original selected evidence", metrics: [{ dataset_id: 1 }, { dataset_id: 2 }], date_range: { start: "2026-01-01", end: "2026-01-31" }, method: "pearson", grain: "daily" }, summary: {} }
const matrix = { metrics: [], cells: [] }
const detail = { run_id: "original", result_id: "finding" }
const Matrix = () => null, Evidence = () => null
const flush = () => new Promise(resolve => setImmediate(resolve))
function harness({ search = "?run=original&result=finding", state: initial, request } = {}) {
  const state = initial || [null, null, null, "", true, 0], calls = [], effects = [], urls = [], refs = []
  let cursor = 0, refCursor = 0
  const { HistoricalRelationshipEvidence } = load("../features/reports/historical-relationship-evidence.tsx", {
    react: { ...React, useState: () => {
      const index = cursor++
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value }]
    }, useRef: initial => refs[refCursor++] ||= { current: initial }, useEffect: effect => effects.push(effect) },
    "next/link": { __esModule: true, default: props => React.createElement("a", props) },
    "@/lib/api": { correlationRequest: async (...args) => {
      calls.push(args)
      if (request) return request(...args)
      return args[1].includes("/correlation-results/") ? detail : args[1].endsWith("/matrix") ? matrix : run
    } },
    "@/features/relationships/relationship-detail": { RelationshipEvidence: Evidence },
    "@/features/relationships/relationship-matrix": { RelationshipMatrix: Matrix },
    "./legacy-relationship-destination": destinations,
  }, { window: { location: { search }, history: { replaceState: (...args) => urls.push(args[2]) } } })
  const tree = HistoricalRelationshipEvidence({ userId: "owner", workspaceId: "workspace-a" })
  return { tree, state, calls, effects, urls, refs }
}
function nodes(tree, predicate) {
  const result = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (predicate(node)) result.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(tree)
  return result
}

test("historical evidence reads only stored result/run/matrix in the current workspace", async () => {
  const view = harness()
  view.effects[0]()
  await flush()
  assert.deepEqual(view.calls.map(call => call[1]), ["/correlation-results/finding", "/correlation-runs/original", "/correlation-runs/original/matrix"])
  assert.ok(view.calls.every(call => call[0] === "owner" && call[3] === "workspace-a" && !call[2].method))
  assert.equal(view.state[0], run)
  assert.equal(view.state[1], matrix)
  assert.equal(view.state[2], detail)
  assert.equal(view.state[4], false)
})

test("old result-only links resolve the original run without losing the saved finding", async () => {
  const view = harness({ search: "?result=finding" })
  view.effects[0](); await flush()
  assert.equal(view.state[0].run_id, "original")
  assert.equal(view.state[2].result_id, "finding")
})

test("unfinished historical runs are not polled, recalculated or presented as completed", async () => {
  const view = harness({ search: "?run=unfinished", request: async () => ({ ...run, run_id: "unfinished", status: "queued" }) })
  view.effects[0](); await flush()
  assert.equal(view.calls.length, 1)
  assert.equal(view.state[1], null)
  assert.equal(view.state[0].status, "queued")
  const source = read("../features/reports/historical-relationship-evidence.tsx")
  assert.doesNotMatch(source, /setTimeout|setInterval|method: "POST"|correlation-capabilities/)
})

test("workspace changes abort pending history reads and cannot publish stale evidence", async () => {
  let complete
  const view = harness({ search: "?run=original", request: () => new Promise(resolve => { complete = resolve }) })
  const cleanup = view.effects[0]()
  cleanup(); complete(run); await flush()
  assert.equal(view.calls.length, 1)
  assert.equal(view.calls[0][2].signal.aborted, true)
  assert.equal(view.state[0], null)
  assert.equal(view.state[2], null)
})

test("mismatched run/result links and failed reads do not fabricate historical evidence", async () => {
  const mismatch = harness({ search: "?run=different&result=finding" })
  mismatch.effects[0](); await flush()
  assert.match(mismatch.state[3], /does not belong/)
  assert.equal(mismatch.state[0], null)
  const denied = harness({ request: async () => { throw new Error("Saved evidence is unavailable") } })
  denied.effects[0](); await flush()
  assert.equal(denied.state[3], "Saved evidence is unavailable")
  assert.equal(denied.state[1], null)
  assert.equal(denied.state[4], false)
})

test("the historical view exposes no job/creation controls and large snapshots cannot seed an oversized report", () => {
  const view = harness({ state: [run, matrix, detail, "", false, 0] })
  const html = renderToStaticMarkup(view.tree)
  assert.match(html, /Historical snapshot/)
  assert.match(html, /legacy.shared-periods.v1/)
  assert.match(html, /dashboard\/reports\?run=original/)
  assert.doesNotMatch(html, /Run analysis|Save insight|Save relationship widget|Refresh analysis/)
  const large = harness({ state: [{ ...run, definition: { ...run.definition, metrics: Array(50).fill({}) } }, matrix, null, "", false, 0] })
  assert.doesNotMatch(renderToStaticMarkup(large.tree), /Build report/)
  nodes(view.tree, node => node.type === Evidence)[0].props.onClose()
  assert.equal(view.state[2], null)
  assert.equal(view.urls[0], "/dashboard/reports/evidence?run=original")
})
