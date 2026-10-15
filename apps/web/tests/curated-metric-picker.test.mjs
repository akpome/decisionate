import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const React = require("react")
const ts = require("typescript")
const { outputText } = ts.transpileModule(readFileSync(new URL("../features/datasets/components/curated-metric-picker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
})
const module = { exports: {} }
vm.runInNewContext(outputText, { module, exports: module.exports, require: name => {
  if (name === "react/jsx-runtime") return require(name)
  if (name === "lucide-react") return require(name)
  if (name === "@/features/dashboard/components/metric-selector") return { formatMetricLabel: name => name.replaceAll("_", " ") }
  throw Error(`Unexpected import: ${name}`)
} })
const { CuratedMetricPicker, getRecommendedMetricKeys } = module.exports
const metric = (columnKey, aggregation = "SUM") => ({ columnKey, semanticKey: columnKey, aggregation, unit: "count", reason: `${columnKey} definition` })
const recommendations = {
  policyVersion: "v1", recommended: [metric("clicks"), metric("impressions")],
  optional: [metric("unit_price", "AVG")],
  derived: [{ ...metric("ctr", "AVG_WEIGHTED"), defaultSelected: true, formula: "ratio(clicks, impressions)" }],
}
function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate))
  if (!React.isValidElement(node)) return []
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)]
}
function content(node) {
  if (Array.isArray(node)) return node.map(content).join("")
  if (React.isValidElement(node)) return content(node.props.children)
  return node == null || typeof node === "boolean" ? "" : String(node)
}
function harness() {
  let selected = ["clicks", "impressions", "ctr"], saves = 0, restores = 0
  return {
    get selected() { return selected },
    get saves() { return saves },
    get restores() { return restores },
    select(value) { selected = value },
    render(overrides = {}) { return CuratedMetricPicker({ recommendations, selected, dimensions: ["date", "campaign_id"], disabled: false, saving: false, onChange: columns => { selected = columns }, onSave: () => { saves++ }, onRestore: () => { restores++ }, ...overrides }) },
  }
}
test("only reviewed core and enabled derived metrics are defaults", () => {
  assert.deepEqual(Array.from(getRecommendedMetricKeys(recommendations)), ["clicks", "impressions", "ctr"])
})
test("manual deselection and optional selection remain controlled user choices", () => {
  const h = harness()
  let tree = h.render()
  const clicks = elements(tree, node => node.type === "input" && node.props["aria-label"] === "Use clicks as a metric")[0]
  clicks.props.onChange({ target: { checked: false } })
  tree = h.render()
  assert.equal(elements(tree, node => node.type === "input" && node.props["aria-label"] === "Use clicks as a metric")[0].props.checked, false)
  elements(tree, node => node.type === "input" && node.props["aria-label"] === "Use unit price as a metric")[0].props.onChange({ target: { checked: true } })
  assert.deepEqual(Array.from(h.selected), ["impressions", "ctr", "unit_price"])
  assert.equal(h.restores, 0)
})
test("clear all stays empty until an explicit select or restore action", () => {
  const h = harness()
  elements(h.render(), node => node.type === "button" && content(node) === "Clear all")[0].props.onClick()
  assert.equal(h.selected.length, 0)
  assert.equal(elements(h.render(), node => node.type === "input" && node.props.checked).length, 0)
  elements(h.render(), node => node.type === "button" && content(node) === "Save metrics")[0].props.onClick()
  assert.equal(h.saves, 1)
  elements(h.render(), node => node.type === "button" && content(node) === "Restore recommended")[0].props.onClick()
  assert.equal(h.restores, 1)
})
test("optional definitions show aggregation and non-additive warning before selection", () => {
  const h = harness(), tree = h.render()
  const more = elements(tree, node => node.type === "details" && content(node).includes("More metrics"))[0]
  assert.ok(content(more).includes("unit_price definition"))
  assert.ok(content(more).includes("Non-additive"))
  assert.equal(elements(more, node => node.type === "input")[0].props.checked, false)
})
test("metric acronyms and aggregation names use readable labels", () => {
  const tree = harness().render()
  assert.equal(elements(tree, node => node.type === "input" && node.props["aria-label"] === "Use CTR as a metric").length, 1)
  assert.ok(content(tree).includes("Weighted average"))
})
test("dimensions are separate and have no metric checkboxes", () => {
  const tree = harness().render()
  const dimensions = elements(tree, node => node.type === "details" && content(node).includes("Dimensions"))[0]
  assert.ok(content(dimensions).includes("campaign id"))
  assert.equal(elements(dimensions, node => node.type === "input").length, 0)
})
test("missing saved selections are visible and never silently removed", () => {
  const h = harness()
  h.select(["clicks", "old_metric"])
  const tree = h.render()
  assert.ok(content(tree).includes("Previously selected metrics unavailable"))
  assert.deepEqual(h.selected, ["clicks", "old_metric"])
  assert.equal(elements(tree, node => node.type === "button" && content(node) === "Save metrics")[0].props.disabled, true)
})
test("read-only and saving states disable selection commands", () => {
  for (const state of [{ disabled: true }, { saving: true }]) {
    const tree = harness().render(state)
    for (const button of elements(tree, node => node.type === "button")) assert.equal(button.props.disabled, true)
    for (const checkbox of elements(tree, node => node.type === "input")) assert.equal(checkbox.props.disabled, true)
  }
})
test("page uses the server rollout and policy version instead of browser heuristics", () => {
  const page = readFileSync(new URL("../app/dashboard/datasets/[id]/page.tsx", import.meta.url), "utf8")
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  assert.ok(page.includes("curatedRecommendations?.uiEnabled && curatedRecommendations.grain"))
  assert.ok(page.includes("showCuratedPicker ? curatedRecommendations?.policyVersion : undefined"))
  assert.ok(page.includes("savedCuratedSelection !== null && savedCuratedSelection !== undefined"))
  assert.ok(api.includes("use_curated_recommendations: true"))
  assert.ok(api.includes("policy_version: curatedPolicyVersion"))
})

const summaryModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/dashboard/lib/summary-aggregation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, { module: summaryModule, exports: summaryModule.exports })
const { aggregateSummaryAwareValues, isInternalSummaryColumn } = summaryModule.exports
const policy = JSON.stringify({
  ctr: { aggregation: "AVG_WEIGHTED", operation: "ratio", components: ["clicks", "impressions"] },
  position: { aggregation: "AVG_WEIGHTED", operation: "weighted_mean", components: ["position", "impressions"] },
  unit_price: { aggregation: "AVG" },
  records: { aggregation: "COUNT_DISTINCT", operation: "count_distinct", components: ["record_id"] },
})
const rows = [
  { clicks: 1, impressions: 10, ctr: .1, position: 2, unit_price: 10, record_id: "a", __decisionate_metric_policy__: policy },
  { clicks: 30, impressions: 100, ctr: .3, position: 4, unit_price: 20, record_id: "a", __decisionate_metric_policy__: policy },
]
test("browser regrouping recomputes CTR and weighted position instead of summing rates", () => {
  assert.equal(aggregateSummaryAwareValues(rows, "ctr", "sum"), 31 / 110)
  assert.equal(aggregateSummaryAwareValues(rows, "position", "sum"), 420 / 110)
  assert.equal(aggregateSummaryAwareValues(rows, "unit_price", "sum"), 15)
  assert.equal(aggregateSummaryAwareValues(rows, "records", "sum"), 1)
})
test("browser regrouping preserves valid position weights from calendar summaries", () => {
  const summaries = [
    { position: 2, impressions: 110, __decisionate_metric_weighted_sum__position: 20, __decisionate_metric_weight__position: 10, __decisionate_metric_policy__: policy },
    { position: 4, impressions: 100, __decisionate_metric_weighted_sum__position: 400, __decisionate_metric_weight__position: 100, __decisionate_metric_policy__: policy },
  ]
  assert.equal(aggregateSummaryAwareValues(summaries, "position", "sum"), 420 / 110)
  assert.equal(isInternalSummaryColumn("__decisionate_metric_weight__position"), true)
})
test("browser zero denominators stay null and malformed policy cannot enable SUM", () => {
  assert.equal(aggregateSummaryAwareValues([{ ...rows[0], impressions: 0 }], "ctr", "sum"), null)
  assert.equal(aggregateSummaryAwareValues([{ ...rows[0], __decisionate_metric_policy__: "invalid" }], "ctr", "sum"), null)
})
test("legacy summaries keep their original aggregation without policy metadata", () => {
  assert.equal(aggregateSummaryAwareValues([{ amount: 10 }, { amount: 20 }], "amount", "sum"), 30)
  assert.equal(aggregateSummaryAwareValues([{ amount: 10 }, { amount: 20 }], "amount", "avg"), 15)
  assert.equal(isInternalSummaryColumn("__decisionate_metric_policy__"), true)
  assert.equal(isInternalSummaryColumn("__decisionate_metric_members__records"), true)
})
