import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, imports = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: loadedModule, exports: loadedModule.exports, require: key => imports[key] || require(key) })
  return loadedModule.exports
}
const defaults = load("../features/relationships/defaults.ts")
const pairs = load("../features/reports/pair-directions.ts")
const types = load("../features/reports/types.ts", { "./pair-directions": pairs, "@/features/relationships/defaults": defaults })
const { weeklyDefinition } = load("../features/reports/weekly-settings.ts", { "./types": types })
const metrics = [{ dataset_id: 1, metric_key: "spend", date_column: "date", aggregation: "sum" }, { dataset_id: 2, metric_key: "orders", date_column: "created", aggregation: "sum" }]
const direction = { metric_a: metrics[0], metric_b: metrics[1], direction: "a_leads_b" }

test("new weekly settings have weekly units and independent same-period defaults", () => {
  const value = weeklyDefinition({ metrics })
  assert.equal(value.grain, "weekly")
  assert.equal(value.filters.minimum_observations, 52)
  assert.equal(value.lag.maximum, 12)
  assert.equal(value.pair_directions[0].direction, "same_period")
  assert.equal(types.editableDefinition({}).grain, "daily")
})

test("copying nonweekly analysis preserves selected evidence but resets timing", () => {
  for (const grain of ["daily", "monthly", "quarterly"]) {
    const original = { grain, metrics, date_range: { start: "2000-01-01", end: "2000-02-01" },
      dimension_filters: [{ dataset_id: 1, column: "region", values: ["East"] }], pair_directions: [direction],
      excluded_pairs: [direction], seasonal_business: true, lag: { enabled: true, minimum: 2, maximum: 3, direction: "a_leads_b" } }
    const before = JSON.stringify(original), history = { start: "2023-10-27", end: "2026-10-25" }
    const value = weeklyDefinition(original, history)
    assert.equal(JSON.stringify(original), before)
    assert.equal(value.grain, "weekly")
    assert.equal(value.lag.minimum, 0)
    assert.equal(value.lag.maximum, 12)
    assert.equal(value.pair_directions[0].direction, "same_period")
    assert.deepEqual(value.date_range, history)
    assert.equal(value.metrics, metrics)
    assert.equal(value.dimension_filters, original.dimension_filters)
    assert.equal(value.excluded_pairs.length, 1)
    assert.equal(value.seasonal_business, true)
  }
})

test("deliberate weekly timing is retained", () => {
  const value = weeklyDefinition({ grain: "weekly", metrics, pair_directions: [direction], lag: { enabled: true, minimum: 0, maximum: 3, direction: "a_leads_b" } })
  assert.equal(value.lag.maximum, 3)
  assert.equal(value.pair_directions[0].direction, "a_leads_b")
})

test("weekly route and saved histories stay separate from instant analysis", () => {
  assert.match(read("../app/dashboard/reports/weekly/page.tsx"), /<ReportPage weekly/)
  const workspace = read("../features/reports/report-workspace.tsx")
  assert.match(workspace, /workflow=\$\{weekly \? "weekly" : "instant"\}/)
  assert.match(workspace, /job.kind === \(weekly \? "weekly_preview" : "report"\)/)
  assert.match(workspace, /weekly \? "\/weekly-jobs\?include_ai_analysis=true" : "\/jobs"/)
  assert.match(workspace, /weekly \? <div[^>]*>[\s\S]*?Last completed week[\s\S]*? : <div[^>]*>[\s\S]*?type="date"/)
  assert.match(workspace, /weekly \? "Maximum lag \(weeks\)" : "Maximum lag"/)
  assert.match(workspace, /weekly \? "Minimum matched weeks" : "Minimum historical observations"/)
  assert.match(workspace, /if \(!weekly && params.has\("weekly"\)\)/)
  assert.doesNotMatch(workspace, /saveWeeklyTemplate|\/weekly-template/)
})

test("weekly preview persists its own edits before enqueueing, without sending manual settings to instant jobs", async () => {
  const source = read("../features/reports/report-workspace.tsx"), ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "calculate") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const calls = []
  const calculate = vm.runInNewContext(ts.transpileModule(`${declaration}\ncalculate`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    weekly: true, weeklyDirty: true, busy: false, analysisSubmission: { current: false }, routeController: { current: null },
    execute: async action => action(), persistWeeklySettings: async () => calls.push("save-weekly"), crypto: { randomUUID: () => "unique" },
    request: async (path, init) => { calls.push(path); assert.equal(init.body, undefined); return { job_id: "weekly-job" } },
    setAnalysisJob() {}, setRecentJobs() {}, encodeURIComponent,
    window: { location: { pathname: "/dashboard/reports/weekly" }, history: { replaceState() {} } },
    waitForAnalysis: async () => ({ weekly_report: true }), setReport() {}, setView() {},
    setDefinition: () => { throw new Error("A weekly snapshot must not replace editable weekly settings") },
  })
  await calculate()
  assert.deepEqual(calls, ["save-weekly", "/weekly-jobs?include_ai_analysis=true"])
})

test("saving copied weekly settings clears the copy link only after a successful save", async () => {
  const source = read("../features/reports/report-workspace.tsx"), ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "persistWeeklySettings") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const fail of [false, true]) {
    const calls = [], state = { dirty: true }, definition = weeklyDefinition({ metrics })
    const save = vm.runInNewContext(ts.transpileModule(`${declaration}\npersistWeeklySettings`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      weekly: true, canManage: true, definition, weeklySettings: { history_window: {} }, weeklyDefinition, routeController: { current: null },
      selectedReportDimensionFilters: types.selectedReportDimensionFilters, URLSearchParams, pagePath: "/dashboard/reports/weekly",
      window: { location: { search: "?copy=old-instant-report" }, history: { replaceState: (...args) => calls.push(args) } },
      request: async (path, init) => { assert.equal(path, "/weekly-settings"); assert.equal(init.method, "PUT"); if (fail) throw new Error("Unavailable"); return { definition } },
      setWeeklySettings: value => { state.settings = value }, setWeeklyDirty: value => { state.dirty = value },
    })
    if (fail) { await assert.rejects(save, /Unavailable/); assert.equal(state.dirty, true); assert.equal(calls.length, 0) }
    else { await save(); assert.equal(state.dirty, false); assert.deepEqual(calls, [[null, "", "/dashboard/reports/weekly"]]) }
  }
})
