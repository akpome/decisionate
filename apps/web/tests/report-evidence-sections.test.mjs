import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function load(relativePath, imports = {}) {
  const loaded = { exports: {} }
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { module: loaded, exports: loaded.exports, require: name => imports[name] || require(name) })
  return loaded.exports
}

const title = load("../features/decisions/lib/decision-title.ts")
const { ReportRelationshipFindings, ReportDecisions } = load("../features/reports/report-evidence-sections.tsx", {
  "next/link": { __esModule: true, default: props => React.createElement("a", props) },
  "@/features/decisions/lib/decision-title": title,
})
const finding = {
  id: "finding-1", metric_a: { dataset_label: "marketing-demo.csv", label: "Website visits" },
  metric_b: { dataset_label: "revenue-demo.csv", label: "Orders" }, reliability: "insufficient",
  observations: 3, lag: 0, lag_unit: "calendar daily periods",
  interpretation: "Insufficient matched history or variation to establish a usable relationship.", warnings: ["insufficient_overlap"],
}
const legacy = [
  { id: 1, title: "Review joined evidence: marketing-demo.csv + revenue-demo.csv", status: "planned" },
  { id: 2, title: "Review joined dataset evidence", status: "planned" },
  { id: 3, title: "Review joined dataset evidence", status: "archived" },
]
const realDecision = {
  id: 4, report_id: "report-1", title: "Move 10% of the campaign budget", action: "Run a two-week budget test",
  expected_outcome: "Increase orders without increasing spend", actual_outcome: null, change_percent: null,
  status: "planned", owner_user_id: "owner", review_date: null,
}
const renderFindings = (patch = {}) => renderToStaticMarkup(React.createElement(ReportRelationshipFindings, { report: {
  findings: [finding], included_findings: [finding.id], ...patch,
} }))
const renderDecisions = (patch = {}) => renderToStaticMarkup(React.createElement(ReportDecisions, { report: {
  report_id: "report-1", decisions: [], ...patch,
} }))

test("relationship findings are read-only results with no checkbox or print-only visibility", () => {
  const html = renderFindings()
  assert.match(html, /marketing-demo\.csv \/ Website visits/)
  assert.match(html, /revenue-demo\.csv \/ Orders/)
  assert.match(html, /Insufficient matched history/)
  assert.match(html, /3 observations/)
  assert.match(html, /insufficient overlap/)
  assert.doesNotMatch(html, /<input|<label|checkbox|print:hidden/)
})

test("historical finding exclusions remain excluded in both preview and print", () => {
  const html = renderFindings({ included_findings: [] })
  assert.match(html, /No relationship findings included in this report/)
  assert.doesNotMatch(html, /Website visits|Insufficient matched history/)
})

test("the three older joined-data entries from the screenshot are not report decisions", () => {
  const html = renderDecisions({ decisions: legacy })
  assert.match(html, /No decisions linked to this report/)
  assert.doesNotMatch(html, /<a |Review joined|Not yet recorded/)
  assert.equal(legacy.length, 3)
  assert.equal(legacy[2].status, "archived")
})

test("even explicitly linked old evidence placeholders are not presented as action decisions", () => {
  const html = renderDecisions({ decisions: legacy.map(item => ({ ...item, report_id: "report-1" })) })
  assert.match(html, /No decisions linked to this report/)
  assert.doesNotMatch(html, /<a /)
})

test("one explicit decision is shown once alongside older or unrelated records", () => {
  const html = renderDecisions({ decisions: [...legacy, realDecision, { ...realDecision, id: 5, report_id: "another-report", title: "Unrelated action" }, realDecision] })
  assert.equal((html.match(/<a /g) || []).length, 1)
  assert.match(html, /Move 10% of the campaign budget/)
  assert.match(html, /Increase orders without increasing spend/)
  assert.doesNotMatch(html, /Review joined|Unrelated action/)
})

test("an unsaved preview does not adopt existing decisions from selected datasets", () => {
  const html = renderDecisions({ report_id: undefined, decisions: [realDecision] })
  assert.match(html, /No decisions linked to this report/)
  assert.doesNotMatch(html, /<a /)
})

test("weekly template decisions retain their explicit source without treating the weekly preview as a saved snapshot", () => {
  const html = renderDecisions({ report_id: undefined, decision_report_id: "report-1", decisions: [realDecision] })
  assert.equal((html.match(/<a /g) || []).length, 1)
  assert.match(html, /Move 10% of the campaign budget/)
  const unrelated = renderDecisions({ report_id: "report-2", decision_report_id: "report-1", decisions: [realDecision] })
  assert.match(unrelated, /No decisions linked to this report/)
})

test("distinct action decisions remain distinct and genuinely linked archived decisions remain visible", () => {
  const html = renderDecisions({ decisions: [realDecision, { ...realDecision, id: 5, title: "Review supplier contracts", action: "Compare renewal terms", status: "archived" }] })
  assert.equal((html.match(/<a /g) || []).length, 2)
  assert.match(html, /Review supplier contracts/)
  assert.match(html, /archived/)
})

test("a deliberately named decision is not confused with an old generated title", () => {
  const html = renderDecisions({ decisions: [{ ...realDecision, title: "Review joined dataset evidence" }] })
  assert.equal((html.match(/<a /g) || []).length, 1)
})
