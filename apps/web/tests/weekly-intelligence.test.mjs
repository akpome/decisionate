import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, imports = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require: key => imports[key] || require(key), Intl, Date })
  return module.exports
}
const { WeeklyIntelligenceReport } = load("../features/reports/weekly-intelligence.tsx", {
  "next/link": ({ children, ...props }) => React.createElement("a", props, children),
  "./types": { formatReportValue: value => value === null ? "Unavailable" : String(value) },
  "@/features/datasets/components/dimension-filter": { dimensionFilterLabel: value => `${value.column}: ${value.values.join(", ")}` },
  "./report-anomalies": { ReportAnomalies: ({ title }) => React.createElement("h4", null, title) },
})
const { intelligenceDraft } = load("../features/decisions/lib/intelligence-draft.ts")
const { completedWeek } = load("../features/reports/weekly-timezone.tsx")
const window = { start: "2026-11-02", end: "2026-11-08" }
function report() {
  return { status: "ready", definition: { dimension_filters: [] }, decisions: [], limitations: ["No causation claim."], metrics: [{ id: "1:sales", dataset_id: 1, label: "Sales", dataset_label: "Store", aggregation: "sum" }],
    intelligence: { version: "weekly_intelligence.v1", as_of: "2026-11-09T09:00:00+00:00", reporting_timezone: "UTC", summary: "Sales changed; investigate the source.", narrative_source: "rules", default_finding_count: 5,
      prioritization: "Unusual complete weeks first.", findings: [{ id: "finding-1", title: "Sales changed", observation: "Sales fell by 10%.", metric_ids: ["1:sales"], window, previous_window: window,
        continuity: "Reported last week", relevance: "Check the records.", rank_basis: "Unusual week", limitations: ["No attribution."], related_decision_id: null,
        evidence: { current: 90, previous: 100, change: -10, change_percent: -10, coverage: [7, 7], unusual_periods: [] } }],
      investigations: [], recommendations: [{ id: "action-1", finding_id: "finding-1", action: "Review the store records.", success_metric_id: "1:sales", expected_direction: "Determine a response.", priority: "Review first", limitations: ["Not a causal estimate."], related_decision_id: null }],
      decisions: [], quality: ["Missing observations are not zero."], forecast_status: "No forecast was calculated.", sources: [] } }
}
const render = (value, onReview) => renderToStaticMarkup(React.createElement(WeeklyIntelligenceReport, { report: value, snapshot: React.createElement("div", null, "KPI totals"), busy: false, onReview }))

test("weekly report presents the seven sections in business-first order with frozen evidence", () => {
  const value = report(), before = JSON.stringify(value), html = render(value, () => {})
  let position = -1
  for (const label of ["This week at a glance", "Business performance", "What deserves attention", "Connections worth investigating", "Recommended next steps", "Decisions and outcomes", "Data quality and coverage"]) {
    const next = html.indexOf(label); assert.ok(next > position); position = next
  }
  assert.match(html, /Supporting evidence/); assert.match(html, /Review in Decisions/)
  assert.match(html, /Daily and whole-week anomaly checks/)
  assert.match(html, /Whole-week anomaly detection/); assert.match(html, /Daily anomaly detection/)
  assert.match(html, /2026-11-09 09:00:00 UTC/)
  assert.equal(JSON.stringify(value), before)
})

test("read-only, limited coverage and active-decision reports do not invite duplicate adoption", () => {
  assert.doesNotMatch(render(report()), /Review in Decisions/)
  assert.doesNotMatch(render({ ...report(), status: "limited_coverage" }, () => {}), /Review in Decisions/)
  const value = report(); value.intelligence.recommendations[0].related_decision_id = 42
  const html = render(value, () => {})
  assert.doesNotMatch(html, /Review in Decisions/); assert.match(html, /href="\/dashboard\/decisions\/42"/)
})

test("central draft prefill carries the finding scope but leaves success criteria and approval to the user", () => {
  const value = report(), before = JSON.stringify(value), draft = intelligenceDraft(value, "finding-1")
  assert.equal(draft.action, "Review the store records.")
  assert.equal(draft.outcome, "1:sales")
  assert.match(draft.reasoning, /Sales fell/); assert.match(draft.reasoning, /No attribution/)
  assert.equal(draft.expected_outcome, undefined); assert.equal(draft.status, undefined)
  assert.equal(intelligenceDraft(value, "missing"), null)
  assert.equal(JSON.stringify(value), before)
  const source = read("../app/dashboard/decisions/new/page.tsx")
  assert.match(source, /finding_id: selectedFindingId/)
  assert.match(source, /outcomeLocked=\{Boolean\(selectedFindingId\)\}/)
  assert.match(read("../features/reports/report-workspace.tsx"), /query.set\("finding", findingId\)/)
})

test("source labels and evidence text are escaped and an empty report remains useful", () => {
  const value = report(); value.intelligence.summary = "<script>alert(1)</script>"
  assert.doesNotMatch(render(value), /<script>/)
  value.intelligence.findings = []; value.intelligence.recommendations = []
  assert.match(render(value), /No supported priority change/)
  assert.match(render(value), /No supported action/)
})

test("timezone selection respects local Monday boundaries and DST", () => {
  const instant = new Date("2026-11-09T01:00:00Z")
  assert.equal(completedWeek("UTC", instant).end, "2026-11-08")
  assert.equal(completedWeek("America/Halifax", instant).end, "2026-11-01")
  assert.equal(completedWeek("America/Halifax", new Date("2026-11-09T05:00:00Z")).start, "2026-11-02")
  assert.equal(completedWeek("America/Halifax", new Date("2026-03-09T05:00:00Z")).end, "2026-03-08")
})

test("filtered scope stays visible and unsupported timing is not presented as a delay", () => {
  const value = report()
  value.definition.dimension_filters = [{ dataset_id: 1, column: "region", values: ["West"] }]
  value.intelligence.investigations = [{ relationship_id: "pair", metric_ids: ["1:sales"], finding_ids: ["finding-1"],
    status: "not_established", summary: "Not enough matched history.", coefficient: null, lag: 0,
    lag_unit: "calendar weekly periods", observations: 12, history_window: window, limitations: ["insufficient_overlap"] }]
  const html = render(value)
  assert.match(html, /region: West/)
  assert.match(html, /No reliable delay established/)
  assert.doesNotMatch(html, /Observed delay: 0/)
  assert.match(html, /insufficient overlap/)
})
