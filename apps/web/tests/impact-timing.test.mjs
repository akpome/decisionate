import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(path, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, Intl, require: name => imports[name] || require(name) })
  return loaded.exports
}
const { ImpactTiming } = load("../features/reports/impact-timing.tsx")
const impact = load("../features/reports/impact-types.ts")
const types = load("../features/reports/types.ts", { "./pair-directions": load("../features/reports/pair-directions.ts"),
  "@/features/relationships/defaults": load("../features/relationships/defaults.ts") })
const { decisionReviewDefinition } = load("../features/reports/decision-review.ts", { "./impact-types": impact, "./types": types, "./impact-builder-state": load("../features/reports/impact-builder-state.ts") })
const { ImpactResult } = load("../features/reports/impact-result.tsx", { "./types": { formatReportValue: value => String(value) } })
const evidence = { status: "supported", report_id: "source", finding_id: "driver-a", driver_label: "Meta / Spend", lag: 2, grain: "weekly",
  message: "Consistent earlier timing.", history_window: { start: "2023-01-01", end: "2024-12-31" },
  choices: [{ finding_id: "driver-a", driver_label: "Meta / Spend", driver: { dataset_id: 3, metric_key: "spend" }, lag: 2, grain: "weekly" }] }
const study = { ...impact.newImpactStudy(), change_date: "2025-01-01", timing_evidence: evidence }
const render = value => renderToStaticMarkup(React.createElement(ImpactTiming, { study: value, onChange() {} }))

test("a single supported historical relationship supplies advice without a numeric lag input", () => {
  const html = render(study)
  assert.match(html, /Timing from earlier analysis/)
  assert.match(html, /Earlier records showed Meta \/ Spend moving 2 weeks ahead of the outcome/)
  assert.match(html, /Both early and later results count/)
  assert.match(html, /actual response/)
  assert.match(html, /\/dashboard\/reports\?report=source/)
  assert.match(html, /Open the earlier analysis/)
  assert.doesNotMatch(html, /Explore relationships/)
  assert.doesNotMatch(html, /type="number"|<select|type="date"/)
})

test("missing timing never claims a zero delay and post-action timing receives an explicit warning", () => {
  assert.match(render({ ...study, timing_evidence: null }), /delay will not be assumed/)
  assert.doesNotMatch(render({ ...study, timing_evidence: null }), /led the result by 0/)
  assert.match(render({ ...study, change_date: "2024-08-01" }), /history before implementation/)
  const zero = render({ ...study, timing_evidence: { ...evidence, lag: 0, choices: [] } })
  assert.match(zero, /within the same grouped week/)
  assert.doesNotMatch(zero, /led the result by 0/)
})

test("missing source reports keep timing guidance without generic navigation, while evidence links remain specific", () => {
  for (const timing_evidence of [null, { status: "unavailable", message: "No usable timing evidence." }, { ...evidence, report_id: null }]) {
    const html = render({ ...study, timing_evidence })
    assert.match(html, /Timing from earlier analysis/)
    assert.doesNotMatch(html, /<a|Explore relationships|Open the earlier analysis/)
  }
  const html = render({ ...study, timing_evidence: { ...evidence, status: "unavailable", report_id: "source & report", choices: [], message: "Earlier history could not support a delay." } })
  assert.match(html, /Earlier history could not support a delay/)
  assert.match(html, /href="\/dashboard\/reports\?report=source%20%26%20report"/)
  assert.match(html, /Open the earlier analysis/)
})

test("multiple supported drivers are chosen by relationship identity, not by a user-entered lag", () => {
  const multiple = { ...study, timing_finding_id: null, timing_evidence: { ...evidence, status: "choose_relationship",
    message: "Choose an earlier relationship.", choices: [...evidence.choices, { ...evidence.choices[0], finding_id: "driver-b", driver_label: "Store / Visits", lag: 4 }] } }
  assert.match(render(multiple), /Which relationship informed this decision/)
  assert.doesNotMatch(render(multiple), /previously led/)
  assert.match(render({ ...multiple, timing_finding_id: "driver-b" }), /Earlier records showed Store \/ Visits moving 4 weeks ahead of the outcome/)
  let patch
  const element = ImpactTiming({ study: multiple, onChange: value => { patch = value } })
  const walk = node => node && typeof node === "object" ? [node, ...React.Children.toArray(node.props?.children).flatMap(walk)] : []
  walk(element).find(node => node.type === "select").props.onChange({ target: { value: "driver-b" } })
  assert.deepEqual(JSON.parse(JSON.stringify(patch)), { timing_finding_id: "driver-b" })
})

test("the current authorized context replaces a prior assessment's copied timing", () => {
  const previous = { impact: { ...study, timing_finding_id: "removed-driver" }, metrics: [], grain: "weekly" }
  const context = { decision: { id: 7, title: "Added staff", action: "Added one employee" }, outcome: null, decision_revision: "rev",
    timing_evidence: { status: "unavailable", message: "The source was deleted." }, latest_review: { matches_current_decision: true, definition: previous } }
  const value = decisionReviewDefinition(types.editableDefinition({ name: "New assessment" }), context)
  assert.equal(value.impact.timing_evidence.status, "unavailable")
  assert.equal(value.impact.timing_finding_id, null)
  assert.equal(value.impact.change_date, study.change_date)
})

test("phase results distinguish early, later and total values while waiting reports show no invented effect", () => {
  const analysis = { status: "estimated", grain: "weekly", change: "Added staff", change_date: "2025-01-01", headline: "Your change appears to have helped.",
    timing: { ...evidence, expected_response_date: "2025-01-15", later_period_start: "2025-01-20" }, early_periods: 2, later_periods: 8,
    outcome: { label: "Orders" }, next_steps: [], assumptions: [], limitations: [], checks: [], window: { start: "2023-01-01", end: "2025-03-31" },
    estimate: { effect: 50, lower: 10, upper: 90, verdict: "helped", is_total: true, actual: 1000, expected_without_change: 950 },
    phases: [{ phase: "early", effect: -10, lower: -25, upper: 5, observations: 2, start: "2025-01-01", end: "2025-01-14" },
      { phase: "later", effect: 60, lower: 20, upper: 100, observations: 8, start: "2025-01-20", end: "2025-03-16" }] }
  const html = renderToStaticMarkup(React.createElement(ImpactResult, { analysis }))
  for (const text of [/Implemented 2025-01-01/, /Timing reference date/, /First complete later period/, /Early results/, /Later results/, /-10/, /\+60/, /\+50/, /not separate proof/]) assert.match(html, text)
  const waiting = renderToStaticMarkup(React.createElement(ImpactResult, { analysis: { ...analysis, status: "not_ready", estimate: null, phases: [], headline: "Waiting for enough results." } }))
  assert.match(waiting, /Waiting for enough results/)
  assert.doesNotMatch(waiting, /Estimated change in|\+50|\+60/)
})
