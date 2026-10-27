import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("report-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = new Map()
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)

function management(name, overrides = {}) {
  const calls = [], errors = []
  const state = { saved: [{ report_id: "report-1" }, { report_id: "report-2" }], report: { report_id: "report-1", name: "Selected" }, view: "report", weekly: { enabled: true, definition: {} } }
  const managementAction = { current: false }, deletedReports = { current: new Set() }
  const handler = vm.runInNewContext(ts.transpileModule(`${functions.get(name)}\n${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    canManage: true, busy: false, weekly: true, pagePath: "/dashboard/reports", report: state.report, managementAction, deletedReports,
    t: value => value, encodeURIComponent, defaultReportName: () => "New report", weeklyDefinition: value => value,
    window: { confirm: () => true, history: { replaceState: (...args) => calls.push(["history", ...args]) } },
    execute: async action => { try { await action() } catch (error) { errors.push(error.message) } },
    request: async (path, init) => { calls.push([path, init.method]); return name === "deleteSavedReport" ? { weekly_template_removed: false } : { definition: null, enabled: false, history_window: {} } },
    setSaved: update => { state.saved = update(state.saved) }, setReport: value => { state.report = value },
    setView: value => { state.view = value }, setWeeklySettings: value => { state.weekly = value },
    setWeeklyDirty: value => { state.dirty = value }, setDefinition: () => {}, setAnalysisJob: () => {},
    setMessage: value => { state.message = value }, ...overrides,
  })
  return { handler, calls, errors, state, managementAction, deletedReports }
}

test("deleting a snapshot leaves independent weekly settings intact", async () => {
  const { handler, calls, state, deletedReports } = management("deleteSavedReport")
  await handler()
  assert.deepEqual(calls[0], ["/report-1", "DELETE"])
  assert.equal(state.saved.length, 1)
  assert.equal(state.report, null)
  assert.equal(state.weekly.enabled, true)
  assert.ok(deletedReports.current.has("report-1"))
})

test("removing weekly settings pauses delivery but does not delete snapshots", async () => {
  const { handler, calls, state, managementAction } = management("removeWeeklySettings")
  await handler()
  assert.deepEqual(calls[0], ["/weekly-settings", "DELETE"])
  assert.equal(state.saved.length, 2)
  assert.equal(state.weekly.definition, null)
  assert.equal(state.weekly.enabled, false)
  assert.equal(state.dirty, false)
  assert.equal(managementAction.current, false)
})

test("snapshot deletion retains the correct workflow URL", async () => {
  for (const pagePath of ["/dashboard/reports", "/dashboard/reports/dataset", "/dashboard/reports/weekly"]) {
    const { handler, calls } = management("deleteSavedReport", { pagePath })
    await handler()
    assert.deepEqual(calls[1], ["history", null, "", pagePath])
  }
})

test("cancelled, read-only and busy removal attempts do not mutate saved state", async () => {
  for (const name of ["deleteSavedReport", "removeWeeklySettings"]) {
    for (const override of [{ canManage: false }, { busy: true }, { managementAction: { current: true } }, { window: { confirm: () => false } }]) {
      const { handler, calls, state } = management(name, override)
      await handler()
      assert.deepEqual(calls, [])
      assert.equal(state.report.report_id, "report-1")
      assert.equal(state.weekly.enabled, true)
    }
  }
})

test("failed removals preserve saved state and release retry protection", async () => {
  for (const name of ["deleteSavedReport", "removeWeeklySettings"]) {
    const { handler, errors, state, managementAction } = management(name, { request: async () => { throw new Error("Unavailable") } })
    await handler()
    assert.deepEqual(errors, ["Unavailable"])
    assert.equal(state.saved.length, 2)
    assert.equal(state.weekly.enabled, true)
    assert.equal(managementAction.current, false)
  }
})

test("repeated removal clicks produce one mutation", async () => {
  for (const name of ["deleteSavedReport", "removeWeeklySettings"]) {
    const { handler, calls } = management(name)
    await Promise.all([handler(), handler(), handler()])
    assert.equal(calls.filter(item => item[1] === "DELETE").length, 1)
  }
})

test("weekly settings commands are separate from the snapshot toolbar", () => {
  assert.match(source, /canManage && report\?\.report_id && <button[^>]*aria-label=\{t\("Delete saved report"\)\}/)
  assert.match(source, /canManage && weeklySettings\?\.definition && <button[^>]*aria-label="Remove weekly settings"/)
  assert.doesNotMatch(source, /\/weekly-template|saveWeeklyTemplate/)
})
