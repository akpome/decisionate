import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const module = { exports: {} }
const source = readFileSync(new URL("../features/reports/types.ts", import.meta.url), "utf8")
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText,
  { module, exports: module.exports, require, Intl, Number, Math })
const { editableDefinition, formatReportValue } = module.exports

test("report editor removes server-only fields while preserving cross-dataset scope and provenance", () => {
  const value = editableDefinition({ name: "Cross-source review", business_question: "What changed across channels?", reporting_timezone: "UTC", source_run_id: "run-1",
    metrics: [{ dataset_id: 1, metric_key: "spend", aggregation: "sum", date_column: "date" }, { dataset_id: 2, metric_key: "orders", aggregation: "sum", date_column: "date" }],
    date_range: { start: "2026-01-01", end: "2026-01-31" }, included_findings: ["1:spend|2:orders|0"] })
  assert.equal(value.metrics.length, 2)
  assert.equal(value.source_run_id, "run-1")
  assert.equal(value.reporting_timezone, undefined)
  assert.equal(value.included_findings[0], "1:spend|2:orders|0")
})

test("empty findings remain empty rather than silently adding all correlations", () => {
  assert.deepEqual(Array.from(editableDefinition({ included_findings: [] }).included_findings), [])
})

test("currency display preserves zero and safely handles unavailable or invalid values", () => {
  assert.equal(formatReportValue(0), "0")
  assert.equal(formatReportValue(null), "Unavailable")
  assert.equal(formatReportValue(Infinity), "Unavailable")
  assert.equal(formatReportValue(12, "invalid currency"), "12")
  assert.match(formatReportValue(12, "CAD"), /12\.00/)
})

test("legacy analysis transfer respects report safety limits", () => {
  const value = editableDefinition({ lag: { enabled: true, minimum: 0, maximum: 50, direction: "b_leads_a" }, filters: { minimum_observations: 4, minimum_abs_coefficient: 0 } })
  assert.equal(value.lag.maximum, 12)
  assert.equal(value.lag.direction, "b_leads_a")
  assert.equal(value.filters.minimum_observations, 30)
  assert.equal(value.filters.minimum_abs_coefficient, 0)
})

test("main Reports route opens the combined workspace while dataset inspection remains available", () => {
  const page = readFileSync(new URL("../app/dashboard/reports/page.tsx", import.meta.url), "utf8")
  const inspection = readFileSync(new URL("../app/dashboard/reports/dataset/page.tsx", import.meta.url), "utf8")
  assert.match(page, /ReportWorkspace/)
  assert.match(page, /canCreateDecisions/)
  assert.match(inspection, /single-dataset-report/)
})

test("central decision form checks decision permissions and preserves the report evidence handoff", () => {
  const page = readFileSync(new URL("../app/dashboard/decisions/new/page.tsx", import.meta.url), "utf8")
  assert.match(page, /if \(!user\?\.id \|\| !canCreateDecisions \|\| creatingDecision\) return/)
  assert.match(page, /decision-evidence/)
  assert.match(page, /reasoning: createDecisionDescription\.trim\(\)/)
  assert.match(page, /review_date: createDecisionReviewDate/)
  assert.match(page, /payload = evidence\.decision_payload/)
  assert.match(page, /\.\.\.payload, priority: createDecisionPriority/)
  const reports = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(reports, /createDecision|DecisionDialog|Create decision/)
})
