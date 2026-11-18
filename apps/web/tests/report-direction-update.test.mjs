import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(code, imports = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name), ...globals })
  return loaded.exports
}
const pairs = load(read("../features/reports/pair-directions.ts"))
const types = load(read("../features/reports/types.ts"), { "./pair-directions": pairs,
  "@/features/relationships/defaults": load(read("../features/relationships/defaults.ts")) })
const weeklySettings = load(read("../features/reports/weekly-settings.ts"), { "./types": types,
  "./default-report-name": load(read("../features/reports/default-report-name.ts")) })
const source = read("../features/reports/report-workspace.tsx")
const tree = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = {}
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["calculate", "execute"].includes(node.name?.text)) functions[node.name.text] = node.getText(tree)
  ts.forEachChild(node, visit)
}
visit(tree)
const metrics = [1, 2, 3].map(dataset_id => ({ dataset_id, metric_key: `metric_${dataset_id}`, date_column: "date", aggregation: "sum" }))
const definition = () => ({ ...types.editableDefinition({ name: "Channel performance", metrics,
  date_range: { start: "2026-01-01", end: "2026-03-31" } }), reporting_timezone: "America/Halifax" })
const plain = value => JSON.parse(JSON.stringify(value))

function harness({ weekly = false, requestError, waitError, abort = false } = {}) {
  const originalDefinition = weekly ? weeklySettings.weeklyDefinition(definition()) : definition(), controller = new AbortController()
  const oldJob = { job_id: "old-job", status: "succeeded", kind: weekly ? "weekly_preview" : "report" }
  const oldReport = { name: "Previous preview", analysis_job_id: oldJob.job_id, definition: originalDefinition }
  const originalUrl = "/business-analysis?job=old-job&draft=kept#relationship-findings"
  const state = { definition: originalDefinition, report: oldReport, job: oldJob, error: "", dirty: false, url: originalUrl, writes: [], changes: [] }
  const submission = { current: false }
  const globals = {
    weekly, canManage: true, weeklySettings: { history_window: { start: "2023-04-01", end: "2026-03-31" } },
    definition: originalDefinition, analysisJob: oldJob, analysisSubmission: submission, previewDisabled: false,
    routeController: { current: { signal: controller.signal } }, crypto: { randomUUID: () => "request-key" },
    window: { location: { pathname: "/business-analysis", search: "?job=old-job&draft=kept", hash: "#relationship-findings" },
      history: { replaceState: (_data, _unused, url) => { state.url = url } } },
    ...pairs, ...types, ...weeklySettings,
    defaultReportQuestion: () => "What changed in these metrics?", errorMessage: error => error.message,
    setBusy: value => { state.busy = value }, setError: value => { state.error = value }, setMessage: () => {},
    setAnalysisJob: value => { state.job = value }, setWeeklyDirty: value => { state.dirty = value },
    setDefinition: value => { state.changes.push("definition"); state.definition = value },
    setReport: value => { state.changes.push("report"); state.report = value }, setView: value => { state.view = value },
    request: async (path, init) => {
      assert.equal(state.report, oldReport, "Keep the existing preview while submitting")
      assert.equal(state.definition, originalDefinition, "Do not relabel old results with the requested direction")
      state.writes.push({ path, body: JSON.parse(init.body) })
      if (requestError) throw requestError
      return { job_id: "new-job", status: "queued" }
    },
    waitForAnalysis: async (_request, _identity, options) => {
      assert.equal(state.report, oldReport, "Keep the existing preview while the worker runs")
      options.onUpdate({ job_id: "new-job", status: "running" })
      if (abort) { state.url = "/connections"; controller.abort(); throw new Error("Aborted") }
      if (waitError) throw waitError
      return { name: "Updated preview", analysis_job_id: "new-job", definition: state.writes.at(-1).body }
    },
  }
  return { ...load(`${functions.execute}\n${functions.calculate}\nexport { calculate }`, {}, globals),
    state, originalDefinition, oldReport, oldJob, originalUrl, submission }
}

for (const weekly of [false, true]) {
  test(`${weekly ? "weekly" : "instant"}: request normalization removes metric display fields for every direction`, async () => {
    for (const direction of ["a_leads_b", "b_leads_a", "auto"]) {
      const current = harness({ weekly })
      const requested = { ...current.originalDefinition, pair_directions: current.originalDefinition.pair_directions.map(pair => ({
        ...pair, direction, label: "Display-only pair", metric_a: { ...pair.metric_a, label: "Display metric", id: "metric-a", currency: "CAD" },
        metric_b: { ...pair.metric_b, label: "Display metric", date_column: "date", aggregation: "sum" },
      })) }
      await current.calculate(requested)
      const body = current.state.writes[0].body
      assert.equal(body.reporting_timezone, "America/Halifax")
      assert.equal(body.pair_directions.length, 3)
      for (const pair of body.pair_directions) {
        assert.deepEqual(Object.keys(pair).sort(), ["direction", "metric_a", "metric_b"])
        for (const endpoint of [pair.metric_a, pair.metric_b]) assert.deepEqual(Object.keys(endpoint).sort(), ["dataset_id", "metric_key"])
        assert.equal(pair.direction, direction)
      }
      assert.equal(current.state.report.analysis_job_id, "new-job")
      assert.equal(current.state.definition.pair_directions[0].direction, direction)
      assert.equal(current.state.dirty, weekly)
      assert.equal(current.state.url, "/business-analysis?job=new-job")
      assert.equal(current.state.busy, false)
      assert.equal(current.submission.current, false)
    }
  })

  for (const phase of ["request", "worker"]) {
    test(`${weekly ? "weekly" : "instant"}: ${phase} failure retains the previous preview, direction, job and URL`, async () => {
      const failure = new Error("The analysis could not be completed.")
      const current = harness({ weekly, ...(phase === "request" ? { requestError: failure } : { waitError: failure }) })
      const requested = { ...current.originalDefinition, pair_directions: current.originalDefinition.pair_directions.map(pair => ({ ...pair, direction: "b_leads_a" })) }
      await current.calculate(requested)
      assert.equal(current.state.report, current.oldReport)
      assert.equal(current.state.definition, current.originalDefinition)
      assert.equal(current.state.job, current.oldJob)
      assert.equal(current.state.url, current.originalUrl)
      assert.equal(current.state.dirty, false)
      assert.equal(current.state.error, failure.message)
      assert.equal(current.state.busy, false)
      assert.deepEqual(current.state.changes, [])
    })
  }
}

test("an interrupted direction change does not restore an old URL after navigation", async () => {
  const current = harness({ abort: true })
  await current.calculate(current.originalDefinition)
  assert.equal(current.state.url, "/connections")
  assert.equal(current.state.error, "")
  assert.equal(current.submission.current, false)
})

test("the preview handler keeps existing evidence and marks only the chosen pair while recalculating", async () => {
  let callback
  function find(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "onDirectionChange") callback = node.initializer.expression.whenFalse.getText(tree)
    ts.forEachChild(node, find)
  }
  find(tree)
  const before = definition(), next = [], submission = { current: false }
  let finish, updatingPair
  const { change } = load(`export const change = ${callback}`, {}, {
    ...pairs, definition: before, busy: false, analysisSubmission: submission,
    calculate: value => { next.push(value); submission.current = true; return new Promise(resolve => { finish = resolve }) },
    setUpdatingPair: value => { updatingPair = value },
    setDefinition: () => assert.fail("Do not mutate the current preview setup"), setReport: () => assert.fail("Do not discard the current preview"),
  })
  const pair = { metric_a: { ...metrics[1], label: "Sales" }, metric_b: { ...metrics[0], label: "Ads" } }
  change(pair, "a_leads_b")
  assert.equal(updatingPair, pairs.unorderedReportPairKey(pair))
  change(pair, "b_leads_a")
  assert.equal(next.length, 1)
  assert.equal(next[0].pair_directions[0].direction, "b_leads_a", "Reversed endpoints retain the actual chosen leader")
  assert.deepEqual(plain(next[0].pair_directions[0].metric_a), { dataset_id: 1, metric_key: "metric_1" })
  finish()
  await Promise.resolve()
  assert.equal(updatingPair, null)
})
