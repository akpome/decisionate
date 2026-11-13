import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module: loaded, exports: loaded.exports, require: key => imports[key] || require(key), Date, Set })
  return loaded.exports
}
const defaults = load("../features/relationships/defaults.ts")
const workflow = load("../features/reports/report-workflow.ts", { "@/features/relationships/defaults": defaults })
const { reportSetupIssue, reportMetadataIssue, defaultReportQuestion, reportNextSteps } = workflow
const definition = updates => ({ name: "Sales review", business_question: "", scope: "multi", include_relationships: true,
  metrics: [{ dataset_id: 1, metric_key: "spend", date_column: "date" }, { dataset_id: 2, metric_key: "sales", date_column: "date" }],
  date_range: { start: "2026-01-01", end: "2026-01-31" }, filters: { minimum_observations: 30 }, lag: { minimum: 0, maximum: 12 }, ...updates })

test("report readiness names the missing input and supports all three report modes", () => {
  assert.equal(reportSetupIssue(definition(), false, 1), "")
  assert.match(reportSetupIssue(definition({ metrics: [] }), false, 0), /Choose at least one metric/)
  const one = definition({ metrics: [definition().metrics[0]] })
  assert.match(reportSetupIssue(one, false, 0), /at least two datasets/)
  assert.equal(reportSetupIssue({ ...one, scope: "single" }, false, 0), "")
  assert.equal(reportSetupIssue(definition({ include_relationships: false, filters: {}, lag: {} }), false, 0), "")
  assert.match(reportSetupIssue(definition({ metrics: [{ dataset_id: 1 }, { dataset_id: 2 }] }), false, 0), /date column/)
  assert.match(reportSetupIssue(definition({ metrics: Array.from({ length: 26 }, (_, dataset_id) => ({ dataset_id, date_column: "date" })) }), false, 0), /25 metrics/)
})

test("manual windows are validated but weekly dates remain automatic", () => {
  for (const date_range of [{ start: "", end: "" }, { start: "2026-02-30", end: "2026-03-05" }, { start: "bad", end: "2026-01-31" }]) {
    assert.match(reportSetupIssue(definition({ date_range }), false, 1), /valid start and end/)
    assert.equal(reportSetupIssue(definition({ date_range }), true, 1), "")
  }
  assert.match(reportSetupIssue(definition({ date_range: { start: "2026-02-01", end: "2026-01-01" } }), false, 1), /end date/)
  assert.equal(reportSetupIssue(definition({ date_range: { start: "2026-01-01", end: "2026-01-01" } }), false, 1), "")
})

test("dimension and relationship limits have actionable messages", () => {
  assert.match(reportSetupIssue(definition({ dimension_filters: [{ dataset_id: 1, values: [] }] }), false, 1), /Choose a value/)
  assert.equal(reportSetupIssue(definition({ dimension_filters: [{ dataset_id: 9, values: [] }] }), false, 1), "")
  for (const minimum_observations of [0, 23, 30.5, NaN, 3654]) assert.match(reportSetupIssue(definition({ filters: { minimum_observations } }), false, 1), /Minimum historical observations/)
  for (const maximum of [-1, 0.5, 13, NaN]) assert.match(reportSetupIssue(definition({ lag: { minimum: 0, maximum } }), false, 1), /Maximum delay/)
  assert.match(reportSetupIssue(definition(), false, 1001), /Remove some relationship pairs/)
})

test("an optional question receives a valid purpose without changing user wording or the original draft", () => {
  const value = definition(), before = JSON.stringify(value)
  assert.equal(reportMetadataIssue(value), "")
  assert.match(defaultReportQuestion(value, false), /move together/)
  assert.match(defaultReportQuestion({ ...value, scope: "single" }, false), /What changed/)
  assert.match(defaultReportQuestion({ ...value, include_relationships: false }, false), /What changed/)
  assert.match(defaultReportQuestion(value, true), /last week/)
  assert.match(reportMetadataIssue({ ...value, business_question: "Why?" }), /more detail/)
  assert.match(reportMetadataIssue({ ...value, name: " " }), /report name/)
  assert.equal(JSON.stringify(value), before)
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /business_question: definition.business_question.trim\(\) \|\| defaultReportQuestion\(definition, weekly\)/)
  assert.match(source, /if \(analysisSubmission.current \|\| previewDisabled\) return/)
  assert.match(source, /aria-describedby=\{!definition.impact && previewIssue \? "report-preview-issue"/)
  assert.ok(source.indexOf("<ReportMetricPicker") < source.indexOf("{reportDetails}"))
  assert.match(source, /Business question \(optional\)/)
  assert.doesNotMatch(source, /Business question[^\n]+required/)
})

const { ReportTakeaways } = load("../features/reports/report-takeaways.tsx", {
  "./report-workflow": workflow, "@/features/ai/lib/analysis-copy": { getAIAnalysisProvenance: () => "Rules fallback" },
})
test("next steps are deduplicated without inventing an impact amount or losing cautions", () => {
  const report = { recommendations: ["Check sales.", "Review costs.", "", "Ask the team.", "Check the source."], observations: ["Sales rose by 5%."],
    ai_analysis: { summary: "Sales changed.", recommendations: ["Check sales.", " check   sales. "], risks: ["This is not proof of causation."], confidence: "low" } }
  const before = JSON.stringify(report), actions = reportNextSteps(report)
  assert.equal(actions.length, 4)
  const html = renderToStaticMarkup(React.createElement(ReportTakeaways, { report }))
  assert.equal(html.split("Check sales.").length - 1, 1)
  assert.match(html, /More next steps \(1\)/)
  assert.match(html, /This is not proof of causation/)
  assert.match(html, /low confidence/)
  assert.match(html, /Rules fallback/)
  assert.doesNotMatch(html, /estimated impact|profit increased|CA\$/i)
  assert.equal(JSON.stringify(report), before)
})

test("reports without AI or a supported action still show available evidence honestly", () => {
  const html = renderToStaticMarkup(React.createElement(ReportTakeaways, { report: { recommendations: [], observations: ["No earlier comparison is available."] } }))
  assert.match(html, /No earlier comparison/)
  assert.match(html, /No supported next step/)
  assert.doesNotMatch(html, /confidence|AI-selected/)
})
