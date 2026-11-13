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
const selection = { dataset_id: 1, metric_key: "revenue", date_column: "date", data_grain: "daily" }
function completeDefinition() {
  return { ...helpers.newBudgetDefinition(), budget: 1000, start_date: "2026-11-16", outcome: { ...selection }, options: [2, 3].map(id => ({ ...selection, dataset_id: id, metric_key: "spend", name: `Channel ${id}` })) }
}
test("incomplete metrics and dimension values explain what is needed before preview", () => {
  const definition = completeDefinition()
  assert.equal(helpers.budgetSetupIssue(definition), "")
  assert.match(helpers.budgetSetupIssue({ ...definition, outcome: helpers.blankSelection() }), /dataset for the result/)
  assert.match(helpers.budgetSetupIssue({ ...definition, outcome: { ...selection, dimension_filter: { column: "channel", values: [] } } }), /dimension value/)
  assert.match(helpers.budgetSetupIssue({ ...definition, controls: [helpers.blankSelection()] }), /business influence 1/)
})
test("budget readiness rejects invalid numbers, dates, bounds and duplicate sources", () => {
  const definition = completeDefinition()
  for (const patch of [{ budget: 0 }, { budget: NaN }, { budget: Infinity }, { budget: 1e13 }, { budget: 1.005 }, { weeks: 0 }, { weeks: 1.5 }, { weeks: 14 }, { start_date: "2026-11-17" }, { start_date: "2026-02-30" }, { start_date: "" }, { currency: "invalid" }]) {
    assert.ok(helpers.budgetSetupIssue({ ...definition, ...patch }), JSON.stringify(patch))
  }
  const invalidOptions = [
    [definition.options[0], { ...definition.options[1], name: " channel 2 " }],
    [{ ...definition.options[0], minimum: 50, maximum: 10 }, definition.options[1]],
    [{ ...definition.options[0], minimum: NaN }, definition.options[1]],
    [definition.options[0], { ...definition.options[0], name: "Duplicate source" }],
    [{ ...definition.outcome, name: "Outcome as spend" }, definition.options[1]],
  ]
  for (const options of invalidOptions) assert.ok(helpers.budgetSetupIssue({ ...definition, options }))
  assert.match(helpers.budgetSetupIssue({ ...definition, controls: [definition.outcome] }), /different/)
  definition.options = ["Meta", "Google"].map(value => ({ ...selection, dataset_id: 2, metric_key: "spend", name: value, dimension_filter: { column: "channel", values: [value] } }))
  assert.equal(helpers.budgetSetupIssue(definition), "")
  definition.options[1].dimension_filter.values.push("Meta")
  assert.match(helpers.budgetSetupIssue(definition), /without overlap/)
})
test("new plans have independent empty setup and unconfirmed business assumptions", () => {
  const first = helpers.newBudgetDefinition(), second = helpers.newBudgetDefinition()
  first.options[0].name = "Old channel"; first.outcome.dataset_id = 3
  assert.equal(second.options[0].name, "Option 1")
  assert.equal(second.outcome.dataset_id, 0)
  assert.equal(second.budget, 0)
  assert.equal(second.comparable_spend_confirmed, false)
  assert.equal(second.business_context_confirmed, false)
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
