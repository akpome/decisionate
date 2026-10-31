import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(read("../features/reports/weekly-decision-update.tsx"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { module: loaded, exports: loaded.exports, require })
const { WeeklyAssessmentSetup, WeeklyDecisionUpdate } = loaded.exports
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const definition = { impact: { decision_id: 7, change: "Added staff" } }
const report = { definition, impact_analysis: { headline: "Not enough later history", summary: "Wait for more complete weeks.", window: { start: "2023-01-01", end: "2025-12-31" }, change: "Added staff", change_date: "2025-11-01", estimate: null, checks: [{ key: "history", message: "More later records needed" }], limitations: ["No reliable estimate yet"] } }

test("weekly assessment setup is read-only and preserves its decision link without a duplicate form", () => {
  const before = structuredClone(definition)
  const html = render(WeeklyAssessmentSetup, { definition, issue: "More matching records needed", onSwitch() {}, preview: React.createElement("button", null, "Preview report") })
  assert.match(html, /Existing decision update/)
  assert.match(html, /href="\/dashboard\/reports\?decision=7"/)
  assert.match(html, /Manage assessment in Business Analysis/)
  assert.match(html, /Set up metric monitoring/)
  assert.match(html, /Preview report/)
  assert.match(html, /More matching records needed/)
  assert.doesNotMatch(html, /<input|<select|<textarea|Check this decision|Analysis type/)
  assert.deepEqual(definition, before)
  assert.doesNotMatch(render(WeeklyAssessmentSetup, { definition, issue: "", preview: null }), /Set up metric monitoring|<button/)
  assert.equal(render(WeeklyAssessmentSetup, { definition: { impact: null } }), "")
})

test("weekly decision update is a dated summary with retained evidence, not an assessment editor", () => {
  const before = structuredClone(report)
  const html = render(WeeklyDecisionUpdate, { report })
  assert.match(html, /Decision update/)
  assert.match(html, /Not enough later history/)
  assert.match(html, /Wait for more complete weeks/)
  assert.match(html, /Assessment period: 2023-01-01 to 2025-12-31/)
  assert.match(html, /No impact amount has been estimated/)
  assert.match(html, /href="\/dashboard\/decisions\/7#business-impact-review"/)
  assert.match(html, /Assessment evidence/)
  assert.match(html, /More later records needed/)
  assert.doesNotMatch(html, /<input|<select|<textarea|Save|Check this decision/)
  assert.deepEqual(report, before)
  assert.equal(render(WeeklyDecisionUpdate, { report: { impact_analysis: null } }), "")
  assert.doesNotMatch(render(WeeklyDecisionUpdate, { report: { ...report, review_decision_missing: true } }), /href=/)
  assert.doesNotMatch(render(WeeklyDecisionUpdate, { report: { ...report, definition: { impact: {} } } }), /href=/)
  assert.match(render(WeeklyDecisionUpdate, { report: { ...report, impact_analysis: { ...report.impact_analysis, estimate: { effect: 10 } } } }), /Estimated impact, not proof of cause and effect/)
})

test("only Business Analysis exposes the assessment tabs and form; switching legacy weekly setup needs confirmation", () => {
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /!single && !weekly && <fieldset[^\n]+Analysis type/)
  assert.match(source, /definition.impact && !weekly \? <ImpactBuilder/)
  assert.match(source, /weekly=\{false\} weeklySettings=\{null\}/)
  assert.match(source, /if \(weekly \|\| !canEditDecisions \|\| busy \|\| managementAction.current\) return/)
  assert.match(source, /if \(window.confirm\("Switch this weekly setup[^\n]+\)\) edit\(\{ impact: null \}\)/)
  assert.match(source, /weekly && <WeeklyDecisionUpdate report=\{report\}/)
  assert.match(source, /!weekly && report.impact_analysis && <ImpactChart/)
  assert.match(source, /collapsed=\{!weekly && Boolean\(report.impact_analysis\)\}/)
})
