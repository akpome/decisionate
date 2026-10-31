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
const { ImpactSetup, ImpactChange } = load("../features/reports/impact-setup.tsx", {
  "./report-metric-picker": { reportDateColumn: source => source.date_columns[0] || "" },
  "./impact-timing": load("../features/reports/impact-timing.tsx"),
})
const { editableDefinition } = load("../features/reports/types.ts", {
  "./pair-directions": load("../features/reports/pair-directions.ts"),
  "@/features/relationships/defaults": load("../features/relationships/defaults.ts"),
})
const metrics = [{ dataset_id: 1, metric_key: "orders" }, { dataset_id: 2, metric_key: "orders" }]
const study = { ...newImpactStudy(), decision_id: 7, decision_revision: "decision-revision", change: "Extended opening hours", change_date: "2025-01-01", outcome: metrics[0], comparison: metrics[1],
  comparison_reason: "Another shop did not change its opening hours.", comparison_unaffected: true, other_changes: "none_known" }
const analysis = {
  engine_version: "controlled_change.v1", status: "estimated", evidence_grade: "model_estimated", change: study.change, change_date: study.change_date,
  window: { start: "2023-01-01", end: "2025-12-31" }, grain: "weekly", outcome: { label: "Orders", currency: null }, comparison: { dataset_label: "Other shop", label: "Orders" },
  headline: "Your change appears to have helped.", summary: "We estimate 200 more orders. The model's range is 100 to 300.",
  next_steps: ["Check the benefit against the cost before expanding."], before_periods: 104, after_periods: 20,
  comparison_reason: study.comparison_reason, checks: [{ key: "earlier_prediction", passed: true, message: "Earlier results matched well." }],
  assumptions: ["The comparison was unaffected."], limitations: ["Not a randomized test."],
  estimate: { effect: 200, lower: 100, upper: 300, confidence_level: .95, verdict: "helped", actual: 2000, expected_without_change: 1800, worthwhile_change: null, is_total: true },
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
  assert.equal(impactReady({ ...study, decision_id: null }, metrics), false)
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
  assert.match(html, /Actual result/)
  assert.match(html, /Without the change \(estimated\)/)
  assert.match(html, /Estimated change in Orders/)
  assert.match(html, /\+200/)
  assert.match(html, /Estimated range \(95%\): \+100 to \+300/)
  assert.match(html, /20 complete weeks after the change/)
  assert.match(html, /What to do next/)
  assert.match(html, /Estimated impact/)
  assert.match(html, /<details[^>]*>/)
  assert.doesNotMatch(html, /<details[^>]*open|p-value|statistically significant|95% probability of causation/)
})

test("a withheld estimate has no invented numbers or business win", () => {
  const html = render({ ...analysis, status: "not_ready", estimate: null, headline: "We cannot tell yet.", summary: "More history is needed." })
  assert.match(html, /Not enough reliable evidence/)
  assert.match(html, /More history is needed/)
  assert.doesNotMatch(html, /Estimated change in|>2000<|>1800</)
  assert.equal(render(null), "")
})

test("new results disclose the validated comparison baseline while old snapshots remain readable", () => {
  const html = render({ ...analysis, baseline: { kind: "comparison", annual_adjustment: false, annual_history_available: true,
    message: "The comparison's normal movement provides the expected baseline." } })
  assert.match(html, /normal movement provides the expected baseline/)
  assert.doesNotMatch(render(analysis), /undefined|null/)
})

test("average metrics explicitly avoid total language and outcomes respect a worthwhile target", () => {
  const html = render({ ...analysis, estimate: { ...analysis.estimate, is_total: false, worthwhile_change: 250, worthwhile_result: "unclear" } })
  assert.match(html, /Average difference per week, not a total/)
  assert.match(html, /range does not clearly meet or fall short/)
  assert.match(html, /250 per week/)
})

test("range labels use the recorded confidence and do not invent it for older snapshots", () => {
  assert.match(render({ ...analysis, estimate: { ...analysis.estimate, confidence_level: .9 } }), /Estimated range \(90%\)/)
  assert.doesNotMatch(render({ ...analysis, estimate: { ...analysis.estimate, confidence_level: undefined } }), /Estimated range \(95%\)/)
})

test("plain-language comparison controls use available datasets without a second metric-selection step", () => {
  const changes = []
  const datasets = [1, 2, 3].map(dataset_id => ({ dataset_id, dataset_label: `Store ${dataset_id}`, metrics: [{ metric_key: "orders", label: "Orders", aggregation: "sum" }],
    date_columns: ["date"], availability: { date: { start: "2023-01-01", end: "2026-01-01" } } }))
  const props = { study, metrics, datasets, onChange: value => changes.push(value), onComparisonChange() {}, onRetryDataset() {}, onExplore() {} }
  const html = renderToStaticMarkup(React.createElement(ImpactSetup, props))
  assert.match(html, /Comparison dataset/)
  assert.match(html, /Comparison metric/)
  assert.match(html, /Why was this comparison not affected/)
  assert.match(html, /value="3">Store 3/)
  assert.doesNotMatch(html, /value="1">Store 1/)
  assert.doesNotMatch(html, /Choose a selected result|Choose from another dataset/)
  const change = renderToStaticMarkup(React.createElement(ImpactChange, { study, datasets, onChange() {} }))
  assert.match(change, /Recorded action/)
  assert.match(change, /Outcome metric/)
  assert.match(change, /When did you implement the change/)
  assert.match(change, /Desired improvement/)
  assert.match(change, /Edit the action or result in Decision Details/)
  assert.doesNotMatch(change, /value="Extended opening hours"|What ongoing change did you make/)
  const elements = []
  const visit = node => {
    if (!node || typeof node !== "object") return
    if (node.type === "select") elements.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(ImpactChange(props))
  elements[0].props.onChange({ target: { value: "decrease" } })
  assert.equal(changes[0].desired_direction, "decrease")
})

test("unclear and negative results are not presented as a positive business win", () => {
  const unclear = render({ ...analysis, headline: "It is not clear yet whether your change helped.", estimate: { ...analysis.estimate, effect: 0, lower: -10, upper: 10, verdict: "unclear" } })
  assert.match(unclear, /cannot yet say this helped or hurt/)
  assert.match(unclear, /Estimated range \(95%\): -10 to \+10/)
  assert.doesNotMatch(unclear, /text-green-800/)
  const hurt = render({ ...analysis, headline: "Your change appears to have worked against your goal.", estimate: { ...analysis.estimate, effect: -200, lower: -300, upper: -100, verdict: "hurt" } })
  assert.match(hurt, />-200</)
  assert.match(hurt, /against your goal/)
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
      { weekly: false, initialScope: scope, editableDefinition, newImpactStudy: () => { throw new Error("Impact must be an explicit choice") } })
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
  const context = { require, exports: {}, t: text => text, newImpactStudy, definition: original, edit: patch => {
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
  assert.deepEqual(options.map(button => button.props.children), ["Explore relationships", "Assess a decision"])
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

test("impact previews are not blocked by unused correlation tests and do not label earlier relationships", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /!single && !weekly && !definition\.impact && <div[^>]*><CorrelationInsights/)
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let count, evidence
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "taskCount") count = node.initializer.getText(ast)
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "details" && node.getText(ast).includes("Earlier relationships:")) evidence = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(count)
  assert.ok(evidence)
  const computeCount = impact => vm.runInNewContext(ts.transpileModule(count, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { definition: { impact }, reportTestCount: () => 3900 })
  assert.equal(computeCount(study), 0)
  assert.equal(computeCount(null), 3900)
  const renderEvidence = impact => {
    const report = { definition: { impact }, impact_analysis: impact ? analysis : null,
      limitations: ["Old correlation-only caution"], history_window: { start: "2023-01-01", end: "2025-12-31" } }
    const node = vm.runInNewContext(ts.transpileModule(`(${evidence})`, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { require, exports: {}, report, single: false,
      Statements: ({ statements }) => React.createElement("p", null, statements.join("; ")) })
    return renderToStaticMarkup(node)
  }
  assert.doesNotMatch(renderEvidence(study), /Earlier relationships|Old correlation-only caution/)
  assert.match(renderEvidence(study), /Not a randomized test/)
  assert.match(renderEvidence(null), /Earlier relationships/)
})
