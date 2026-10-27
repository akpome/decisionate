import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(path, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name) })
  return loaded.exports
}
const { newImpactStudy, retainedImpactStudy, impactReady, impactEvidenceSummary } = load("../features/reports/impact-types.ts")
const formatReportValue = (value, currency) => `${currency ? `${currency} ` : ""}${value}`
const { ImpactResult } = load("../features/reports/impact-result.tsx", { "./types": { formatReportValue } })
const { ImpactSetup, ImpactChange } = load("../features/reports/impact-setup.tsx")
const { editableDefinition } = load("../features/reports/types.ts", {
  "./pair-directions": load("../features/reports/pair-directions.ts"),
  "@/features/relationships/defaults": load("../features/relationships/defaults.ts"),
})
const metrics = [{ dataset_id: 1, metric_key: "orders" }, { dataset_id: 2, metric_key: "orders" }]
const study = { ...newImpactStudy(), change: "Extended opening hours", change_date: "2025-01-01", outcome: metrics[0], comparison: metrics[1],
  comparison_reason: "Another shop did not change its opening hours.", comparison_unaffected: true, other_changes: "none_known" }
const analysis = {
  engine_version: "controlled_change.v1", status: "estimated", evidence_grade: "model_estimated", change: study.change, change_date: study.change_date,
  window: { start: "2023-01-01", end: "2025-12-31" }, grain: "weekly", outcome: { label: "Orders", currency: null }, comparison: { dataset_label: "Other shop", label: "Orders" },
  headline: "Your change appears to have helped.", summary: "We estimate 200 more orders. The model's range is 100 to 300.",
  next_steps: ["Check the benefit against the cost before expanding."], before_periods: 104, after_periods: 20,
  comparison_reason: study.comparison_reason, checks: [{ key: "earlier_prediction", passed: true, message: "Earlier results matched well." }],
  assumptions: ["The comparison was unaffected."], limitations: ["Not a randomized test."],
  estimate: { effect: 200, actual: 2000, expected_without_change: 1800, worthwhile_change: null, is_total: true },
}
const render = value => renderToStaticMarkup(React.createElement(ImpactResult, { analysis: value }))

test("new impact studies never invent a change, comparison, or confirmation", () => {
  const value = newImpactStudy()
  assert.equal(value.outcome, null)
  assert.equal(value.comparison, null)
  assert.equal(value.comparison_unaffected, false)
  assert.equal(value.other_changes, "not_sure")
  assert.equal(impactReady(value, metrics), false)
  assert.equal(impactReady(study, metrics), true)
  assert.equal(impactReady(null, metrics), true)
})

test("removing metrics clears stale study roles, and changed segments require confirmation again", () => {
  const value = retainedImpactStudy(study, [metrics[0]], true)
  assert.equal(value.comparison, null)
  assert.equal(value.outcome.dataset_id, 1)
  assert.equal(value.comparison_unaffected, false)
  assert.equal(impactReady(value, [metrics[0]]), false)
  assert.equal(retainedImpactStudy(study, metrics).comparison_unaffected, true)
  assert.equal(study.comparison_unaffected, true)
})

test("the result and comparison must come from selected, different datasets", () => {
  assert.equal(impactReady({ ...study, comparison: metrics[0] }, metrics), false)
  assert.equal(impactReady({ ...study, outcome: { dataset_id: 3, metric_key: "orders" } }, metrics), false)
})

test("the report leads with a business answer, original units and a next step", () => {
  const html = render(analysis)
  assert.match(html, /Did your change help/)
  assert.match(html, /Your change appears to have helped/)
  assert.match(html, /What actually happened/)
  assert.match(html, /Expected without the change/)
  assert.match(html, /Estimated total difference/)
  assert.match(html, /What to do next/)
  assert.match(html, /Model-based estimate/)
  assert.match(html, /<details[^>]*>/)
  assert.doesNotMatch(html, /<details[^>]*open|p-value|statistically significant|95% probability of causation/)
})

test("a withheld estimate has no invented numbers or business win", () => {
  const html = render({ ...analysis, status: "not_ready", estimate: null, headline: "We cannot tell yet.", summary: "More history is needed." })
  assert.match(html, /Not enough reliable evidence/)
  assert.match(html, /More history is needed/)
  assert.doesNotMatch(html, /Estimated total difference|>2000<|>1800</)
  assert.equal(render(null), "")
})

test("average metrics explicitly avoid total language and outcomes respect a worthwhile target", () => {
  const html = render({ ...analysis, estimate: { ...analysis.estimate, is_total: false, worthwhile_change: 250, worthwhile_result: "unclear" } })
  assert.match(html, /Estimated difference per period/)
  assert.match(html, /not totals/)
  assert.match(html, /not clear whether the benefit reaches/)
})

test("plain-language study controls show only selected comparison candidates and reset confirmation on change", () => {
  const changes = []
  const props = { study, metrics, datasets: [], onChange: value => changes.push(value) }
  const html = renderToStaticMarkup(React.createElement(ImpactSetup, props))
  assert.match(html, /Which result should improve/)
  assert.match(html, /Why was the comparison unaffected/)
  assert.doesNotMatch(html, /value="1:orders">Dataset 1 \/ orders<\/option><\/select><\/label><p/)
  const elements = []
  const visit = node => {
    if (!node || typeof node !== "object") return
    if (node.type === "select") elements.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(ImpactSetup(props))
  elements[2].props.onChange({ target: { value: "2:orders" } })
  assert.equal(changes[0].comparison.dataset_id, 2)
  assert.equal(changes[0].comparison_unaffected, false)
  assert.match(renderToStaticMarkup(React.createElement(ImpactChange, { study, onChange() {} })), /What ongoing change did you make/)
})

test("decision evidence reads only a stored report summary and tolerates malformed legacy contexts", () => {
  for (const context of [null, "bad-json", "[]", '{"impact_analysis": {}}']) assert.equal(impactEvidenceSummary(context), null)
  const value = impactEvidenceSummary(JSON.stringify({ evidence_kind: "business_report", impact_analysis: analysis }))
  assert.equal(value.headline, analysis.headline)
  assert.equal(value.summary, analysis.summary)
})

test("fresh reports open with correlation settings and do not initialize an impact study", () => {
  const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initialize
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(ast) === "definition") {
      initialize = node.initializer.arguments[0].getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(initialize)
  for (const scope of ["single", "multi"]) {
    const value = vm.runInNewContext(ts.transpileModule(`(${initialize})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { initialScope: scope, editableDefinition, newImpactStudy: () => { throw new Error("Impact must be an explicit choice") } })
    assert.equal(value.scope, scope)
    assert.equal(value.impact, null)
    assert.equal(value.method, "spearman")
    assert.equal(value.grain, "daily")
    assert.equal(value.filters.minimum_observations, 52)
  }
  assert.match(workspace, /<ImpactResult analysis=\{report.impact_analysis\}/)
  assert.match(workspace, /!single && !definition.impact/)
  assert.doesNotMatch(workspace, /Create decision|createDecision\(/)
})

test("explicitly named modes switch without changing selected metrics, dates or correlation settings", () => {
  const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let controls
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "fieldset" && node.getText(ast).includes('aria-label="Analysis type"')) controls = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(controls)
  const original = editableDefinition({ metrics, grain: "monthly", method: "pearson", date_range: { start: "2023-01-01", end: "2025-12-31" } })
  const changes = []
  const context = { require, exports: {}, newImpactStudy, definition: original, edit: patch => {
    changes.push(patch)
    context.definition = editableDefinition({ ...context.definition, ...patch })
  } }
  function buttons() {
    const node = vm.runInNewContext(ts.transpileModule(`(${controls})`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { ...context })
    const result = []
    function visit(element) {
      if (!element || typeof element !== "object") return
      if (element.type === "button") result.push(element)
      React.Children.forEach(element.props?.children, visit)
    }
    visit(node)
    return result
  }
  let options = buttons()
  assert.deepEqual(options.map(button => button.props.children), ["Correlation analysis", "Business impact analysis"])
  assert.equal(options[0].props["aria-pressed"], true)
  assert.equal(options[1].props["aria-pressed"], false)
  options[0].props.onClick()
  assert.equal(changes.length, 0)
  options[1].props.onClick()
  assert.equal(context.definition.impact.comparison_unaffected, false)
  assert.equal(context.definition.impact.outcome, null)
  options = buttons()
  assert.equal(options[1].props["aria-pressed"], true)
  options[0].props.onClick()
  assert.equal(context.definition.impact, null)
  assert.equal(context.definition.metrics, original.metrics)
  assert.deepEqual(context.definition.date_range, original.date_range)
  assert.equal(context.definition.grain, original.grain)
  assert.equal(context.definition.method, original.method)
  assert.deepEqual(context.definition.filters, original.filters)
})

test("saved impact reports restore their explicit analysis type without changing the saved definition", () => {
  const saved = { scope: "multi", impact: study, metrics, grain: "monthly", method: "pearson" }
  const before = JSON.stringify(saved)
  const restored = editableDefinition(saved)
  assert.equal(restored.impact, study)
  assert.equal(restored.grain, "monthly")
  assert.equal(restored.method, "pearson")
  assert.equal(JSON.stringify(saved), before)
  assert.equal(editableDefinition({ metrics }).impact, null)
})
