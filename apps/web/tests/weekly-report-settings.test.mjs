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

test("opening a decision directly gives an unsaved weekly report a name and preserves a saved name", () => {
  const source = read("../features/reports/report-workspace.tsx")
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "loadDecisionDefinition" && node.arguments[2]?.getText(ast).includes("weeklyContext")) expression = node.arguments[2].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression)
  for (const definition of [null, { name: "", metrics }, { name: "My weekly review", metrics }]) {
    const value = vm.runInNewContext(`(${expression})`, { weekly: true, weeklyDefinition,
      weeklyContext: { definition }, draftName: { current: "Report (unique-test-id)" } })
    assert.equal(value.name, definition?.name || "Report (unique-test-id)")
    assert.equal(value.grain, "weekly")
    if (definition) assert.equal(value.metrics, metrics)
  }
})

test("weekly route and saved histories stay separate from instant analysis", () => {
  assert.match(read("../app/dashboard/reports/weekly/page.tsx"), /<ReportPage weekly/)
  const workspace = read("../features/reports/report-workspace.tsx")
  assert.match(workspace, /workflow=\$\{weekly \? "weekly" : "instant"\}/)
  assert.doesNotMatch(workspace, /Recent analyses|"\/business-reports\/jobs"/)
  assert.match(workspace, /weekly \? canManage \? "\/weekly-preview-jobs" : "\/weekly-jobs\?include_ai_analysis=true" : "\/jobs"/)
  assert.match(workspace, /weekly \? <div[^>]*>[\s\S]*?Last completed week[\s\S]*? : <div[^>]*>[\s\S]*?type="date"/)
  assert.match(workspace, /Maximum delay \(\{weekly \? "weeks"/)
  assert.match(workspace, /Minimum matching \{weekly \? "weeks"/)
  assert.match(workspace, /if \(!weekly && params.has\("weekly"\)\)/)
  assert.doesNotMatch(workspace, /saveWeeklyTemplate|\/weekly-template/)
})

test("weekly preview calculates draft edits without persisting settings or snapshots", async () => {
  const source = read("../features/reports/report-workspace.tsx"), ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "calculate") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const calls = [], definition = weeklyDefinition({ name: "Draft report", metrics })
  const calculate = vm.runInNewContext(ts.transpileModule(`${declaration}\ncalculate`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    weekly: true, canManage: true, weeklyDirty: true, busy: false, definition, weeklySettings: null, weeklyDefinition,
    selectedReportDimensionFilters: types.selectedReportDimensionFilters, analysisSubmission: { current: false }, routeController: { current: null },
    execute: async action => action(), crypto: { randomUUID: () => "unique" },
    request: async (path, init) => { calls.push(path); const payload = JSON.parse(init.body); assert.equal(payload.name, "Draft report"); assert.equal(payload.grain, "weekly"); assert.equal(payload.metrics.length, 2); return { job_id: "weekly-job" } },
    setAnalysisJob() {}, encodeURIComponent,
    window: { location: { pathname: "/dashboard/reports/weekly" }, history: { replaceState() {} } },
    waitForAnalysis: async () => ({ weekly_report: true }), setReport() {}, setView() {},
    setDefinition: () => { throw new Error("A weekly snapshot must not replace editable weekly settings") },
  })
  await calculate()
  assert.deepEqual(calls, ["/weekly-preview-jobs"])
})

function saveHarness(overrides = {}) {
  const source = read("../features/reports/report-workspace.tsx"), ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "saveWeeklyReport") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const calls = [], state = { dirty: true }, definition = weeklyDefinition({ metrics }), managementAction = { current: false }
  const handler = vm.runInNewContext(ts.transpileModule(`${declaration}\nsaveWeeklyReport`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    weeklyPreviewReady: true, report: { analysis_job_id: "preview-id" }, canManage: true, canSave: true, busy: false,
    analysisJob: { weekly_settings_saved: false }, managementAction, weeklySendRequest: { current: "old-send" },
    weeklyDefinition, routeController: { current: null }, encodeURIComponent, pagePath: "/dashboard/reports/weekly",
    execute: async action => action(),
    window: { history: { replaceState: (...args) => { state.url = args[2] } } },
    request: async (path, init) => { calls.push([path, init]); return { report: { weekly_current: true, analysis_job_id: "preview-id", name: "Weekly report" }, settings: { definition } } },
    setWeeklySettings: value => { state.settings = value }, setWeeklyDirty: value => { state.dirty = value },
    setReport: value => { state.report = value }, setDefinition: value => { state.definition = value },
    setAnalysisJob: update => { state.job = update({ job_id: "preview-id" }) }, setSaved: update => { state.saved = update([]) },
    setMessage: value => { state.message = value }, ...overrides,
  })
  return { handler, calls, state, managementAction }
}

test("one post-preview save stores the report and weekly setup together, once", async () => {
  const { handler, calls, state, managementAction } = saveHarness()
  await Promise.all([handler(), handler(), handler()])
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "/jobs/preview-id/save-weekly")
  assert.equal(calls[0][1].method, "POST")
  assert.equal(calls[0][1].body, undefined, "Save uses the server's preview, not a new client definition")
  assert.equal(state.dirty, false)
  assert.equal(state.job.weekly_settings_saved, true)
  assert.equal(state.saved, undefined, "Updating the current report must not add a historical snapshot")
  assert.equal(state.report.weekly_current, true)
  assert.equal(state.url, "/dashboard/reports/weekly")
  assert.match(state.message, /Delivery settings are unchanged/)
  assert.equal(managementAction.current, false)
})

test("missing, failed, edited or already-saved previews cannot save; roles and busy state are checked", async () => {
  for (const overrides of [{ weeklyPreviewReady: false }, { report: null }, { report: {} }, { canManage: false },
    { canSave: false }, { busy: true }, { analysisJob: { weekly_settings_saved: true } }]) {
    const { handler, calls } = saveHarness(overrides)
    await handler()
    assert.equal(calls.length, 0)
  }
})

test("a failed save preserves the preview and unsaved state for retry", async () => {
  for (const fail of [false, true]) {
    const { handler, state, managementAction } = saveHarness(fail ? { request: async () => { throw new Error("Unavailable") } } : {})
    if (fail) { await assert.rejects(handler, /Unavailable/); assert.equal(state.dirty, true); assert.equal(state.report, undefined); assert.equal(state.url, undefined) }
    else { await handler(); assert.equal(state.dirty, false) }
    assert.equal(managementAction.current, false)
  }
})

test("weekly saving appears only after preview, with no competing save controls", () => {
  const source = read("../features/reports/report-workspace.tsx")
  assert.doesNotMatch(source, /Save and preview|Save weekly settings|persistWeeklySettings/)
  assert.match(source, /weekly && view === "report" && \(weeklyPreviewReady \|\| report.weekly_current\) && canManage && <button/)
  assert.match(source, /"Changes saved" : "Save changes"/)
  assert.match(source, /weekly \? "Weekly history" : "Saved reports"/)
  assert.match(source, /weekly \? "Current weekly report" : "Unsaved analysis"/)
  assert.match(source, /setReport\(weeklyContext.current_report \|\| null\)/)
  assert.match(source, /!weekly && <button[^\n]+Save snapshot/)
  assert.match(source, /setWeeklyDirty\(!job.weekly_settings_saved\)/)
  assert.match(source, /editable \? "\/weekly-preview-jobs" : "\/weekly-jobs\?include_ai_analysis=true"/)
  assert.match(source, /setReport\(null\);[\s\S]*?setAnalysisJob\(null\)/)
})

test("Assess a decision receives only the preview action, never a weekly settings save", () => {
  const source = read("../features/reports/report-workspace.tsx")
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const actions = []
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ImpactBuilder") {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(ast) === "actions")
      actions.push(attribute?.initializer?.getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.deepEqual(actions, ["{previewButton}"])
  assert.doesNotMatch(source, /weeklySaveButton|saveWeeklySettings/)
})
