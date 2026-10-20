import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
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
  const state = {
    saved: [{ report_id: "report-1", name: "Selected" }, { report_id: "report-2", name: "Other" }],
    report: { report_id: "report-1", name: "Selected" }, view: "report",
    template: { report_id: "report-1", name: "Selected", enabled: true }, reload: 0,
  }
  const managementAction = { current: false }, deletedReports = { current: new Set() }
  const handler = vm.runInNewContext(ts.transpileModule(`${functions.get(name)}\n${name}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    canManage: true, busy: false, report: state.report, weeklyTemplate: state.template, managementAction, deletedReports,
    t: value => value, encodeURIComponent,
    window: { confirm: () => true, history: { replaceState: (...args) => calls.push(["history", ...args]) } },
    execute: async action => { try { await action() } catch (error) { errors.push(error.message) } },
    request: async (path, init) => {
      calls.push([path, init.method])
      return name === "deleteSavedReport" ? { weekly_template_removed: true } : { report_id: null, name: null, enabled: false }
    },
    setSaved: update => { state.saved = update(state.saved) },
    setReport: value => { state.report = value }, setView: value => { state.view = value },
    setWeeklyTemplate: value => { state.template = value }, setTemplateReload: update => { state.reload = update(state.reload) },
    setMessage: value => { state.message = value }, ...overrides,
  })
  return { handler, calls, errors, state, managementAction, deletedReports }
}

test("deleting a saved report removes only its UI snapshot after successful confirmation", async () => {
  const { handler, calls, state, deletedReports, managementAction } = management("deleteSavedReport")
  await handler()
  assert.deepEqual(calls[0], ["/report-1", "DELETE"])
  assert.equal(state.saved.length, 1)
  assert.equal(state.saved[0].report_id, "report-2")
  assert.equal(state.report, null)
  assert.equal(state.view, "explore")
  assert.equal(state.template.enabled, false)
  assert.equal(state.template.report_id, null)
  assert.ok(deletedReports.current.has("report-1"))
  assert.deepEqual(calls[1], ["history", null, "", "/dashboard/reports"])
  assert.match(state.message, /Linked decisions and datasets were kept/)
  assert.equal(managementAction.current, false)
})

test("template removal leaves saved reports and the open snapshot intact", async () => {
  const { handler, calls, state, managementAction } = management("removeWeeklyTemplate")
  await handler()
  assert.deepEqual(calls, [["/weekly-template?report_id=report-1", "DELETE"]])
  assert.equal(state.saved.length, 2)
  assert.equal(state.report.report_id, "report-1")
  assert.equal(state.view, "report")
  assert.equal(state.template.report_id, null)
  assert.equal(state.template.enabled, false)
  assert.equal(managementAction.current, false)
})

test("cancelled, read-only and busy deletion attempts do not change reports or templates", async () => {
  for (const name of ["deleteSavedReport", "removeWeeklyTemplate"]) {
    for (const override of [
      { canManage: false }, { busy: true }, { managementAction: { current: true } },
      { window: { confirm: () => false } },
    ]) {
      const { handler, calls, state } = management(name, override)
      await handler()
      assert.deepEqual(calls, [])
      assert.equal(state.saved.length, 2)
      assert.equal(state.report.report_id, "report-1")
      assert.equal(state.template.enabled, true)
    }
  }
})

test("failed deletion preserves the snapshot, list and template and releases retry protection", async () => {
  for (const name of ["deleteSavedReport", "removeWeeklyTemplate"]) {
    const { handler, calls, errors, state, managementAction, deletedReports } = management(name, { request: async () => { throw new Error("Unavailable") } })
    await handler()
    assert.deepEqual(errors, ["Unavailable"])
    assert.deepEqual(calls, [])
    assert.equal(state.saved.length, 2)
    assert.equal(state.report.report_id, "report-1")
    assert.equal(state.template.enabled, true)
    assert.equal(deletedReports.current.size, 0)
    assert.equal(managementAction.current, false)
  }
})

test("repeated delete clicks produce one mutation", async () => {
  for (const name of ["deleteSavedReport", "removeWeeklyTemplate"]) {
    const { handler, calls } = management(name)
    await Promise.all([handler(), handler(), handler()])
    assert.equal(calls.filter(item => item[1] === "DELETE").length, 1)
  }
})

test("management commands are owner guarded, icon labelled and use separate template status", () => {
  assert.match(source, /canManage && report\?\.report_id && <button[^>]*aria-label=\{t\("Delete saved report"\)\}/)
  assert.match(source, /canManage && <button[^>]*aria-label=\{t\("Remove weekly report template"\)\}/)
  assert.match(source, /correlationRequest<WeeklyTemplate>\(userId, "\/business-reports\/weekly-template"/)
  assert.match(source, /filter\(item => !deletedReports\.current\.has\(item\.report_id\)\)/)
})
