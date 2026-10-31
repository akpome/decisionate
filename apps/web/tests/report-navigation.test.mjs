import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(read("../features/reports/report-navigation.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports })
const { reportPagePath, reportHistoryQuery } = loaded.exports

test("saved definitions and resumed jobs route to their own workflow, including legacy weekly assessments", () => {
  for (const [weekly, impact, scope, path] of [
    [false, false, "multi", "/dashboard/reports"], [false, false, "single", "/dashboard/reports/dataset"],
    [false, true, "multi", "/dashboard/business-impact"], [true, true, "multi", "/dashboard/reports/weekly"],
    [true, false, "multi", "/dashboard/reports/weekly"],
  ]) assert.equal(reportPagePath(weekly, impact, scope), path)
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /reportPagePath\(job.kind !== "report", Boolean\(job.definition\?\.impact\), job.definition\?\.scope\)/)
  assert.equal((source.match(/reportPagePath\(Boolean\(result.weekly_report\), Boolean\(result.definition.impact\), result.definition.scope\)/g) || []).length, 2)
  assert.match(source, /controller.abort\(\)\s+router.replace\(`\$\{destination\}\?job=/)
})

test("saved metric analyses and assessments request separate histories without changing weekly history", () => {
  assert.equal(reportHistoryQuery(false, false), "workflow=instant&analysis_type=metrics")
  assert.equal(reportHistoryQuery(false, true), "workflow=instant&analysis_type=impact")
  assert.equal(reportHistoryQuery(true, false), "workflow=weekly")
  assert.equal(reportHistoryQuery(true, true), "workflow=weekly")
})

test("decision entry and saved assessment links open Business Impact directly", () => {
  const source = read("../features/decisions/components/decision-impact-reviews.tsx")
  assert.match(source, /\/dashboard\/business-impact\?decision=\$\{decision.id\}/)
  assert.match(source, /\/dashboard\/business-impact\?report=\$\{encodeURIComponent\(review.report_id\)\}/)
  assert.doesNotMatch(source, /href=\{`\/dashboard\/reports/)
  assert.match(read("../features/reports/report-page.tsx"), /key=\{`[^`]*\$\{impactPage\}/)
})
