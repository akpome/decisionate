import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const root = new URL("../features/budget-planner/", import.meta.url)
function module(name, imports = {}) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(name, root), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Date, Intl, require: name => name in imports ? imports[name] : require(name) })
  return loaded.exports
}
const helpers = module("types.ts")
test("default planning dates always use the next eligible Monday without timezone conversion", () => {
  assert.equal(helpers.nextMonday(new Date(2026, 9, 31, 23)), "2026-11-02")
  assert.equal(helpers.nextMonday(new Date(2026, 10, 2, 0)), "2026-11-02")
})
test("incomplete metrics and dimension values block preview", () => {
  const selection = { dataset_id: 1, metric_key: "revenue", date_column: "date" }
  const definition = { outcome: selection, options: [selection], controls: [] }
  assert.equal(helpers.missingSelection(definition), false)
  assert.equal(helpers.missingSelection({ ...definition, outcome: helpers.blankSelection() }), true)
  assert.equal(helpers.missingSelection({ ...definition, outcome: { ...selection, dimension_filter: { column: "channel", values: [] } } }), true)
})

function render(result, step = 0, canSave = true, canDecide = true) {
  let index = 0
  const hooks = { ...React, useState(initial) { const at = index++; const state = at === 1 ? result : at === 2 ? step : typeof initial === "function" ? initial() : initial; return [state, () => {}] } }
  const { BudgetPlanner } = module("budget-planner.tsx", {
    react: hooks, "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "./types": helpers, "./source-picker": { SourcePicker: () => React.createElement("div", null, "Source picker") },
    "./planner.module.css": { default: {} }, "@/lib/api": { correlationRequest: async () => ({ plans: [] }) },
    "@/components/searchable-select": { SearchableSelect: () => null },
    "@/features/reports/analysis-jobs": { waitForAnalysis: async () => {}, analysisPhaseLabel: value => value },
  })
  return renderToStaticMarkup(React.createElement(BudgetPlanner, { userId: "owner", canSave, canDecide }))
}
const ready = { status: "ready", checks: ["Passed"], limitations: ["Not proof of causation"], definition: { name: "Budget test", weeks: 4, start_date: "2026-11-02", budget: 10000, currency: "CAD" }, outcome: { label: "orders" }, allocations: [{ name: "Channel A", current: 5000, suggested: 6000 }], estimate: { additional_result: 100, lower: 10, upper: 190 } }
test("setup has one preview command and no early save or decision command", () => {
  const html = render(null)
  assert.match(html, /Preview budget/)
  assert.doesNotMatch(html, /Save plan|Create Decision/)
})
test("unsupported evidence withholds allocations and decision creation", () => {
  const html = render({ ...ready, status: "needs_evidence" }, 1)
  assert.match(html, /More evidence needed/)
  assert.doesNotMatch(html, /Save plan|Create Decision|Estimated additional/)
})
test("supported preview can save but cannot create a decision before saving", () => {
  const html = render(ready, 2)
  assert.match(html, /Save plan/)
  assert.match(html, /Not proof of causation/)
  assert.doesNotMatch(html, /Create Decision/)
})
test("saved plan has one decision action and an existing decision replaces that action", () => {
  assert.match(render({ ...ready, plan_id: "plan" }, 2), /Create Decision/)
  const linked = render({ ...ready, plan_id: "plan", decision_id: 8 }, 2)
  assert.match(linked, /\/dashboard\/decisions\/8/)
  assert.doesNotMatch(linked, /Create Decision/)
  assert.doesNotMatch(render({ ...ready, plan_id: "plan" }, 2, false, false), /Create Decision|Save plan|Delete saved plan/)
})
