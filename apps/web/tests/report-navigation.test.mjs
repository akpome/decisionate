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
const { reportPagePath, reportHistoryQuery, reportSourceTabs } = loaded.exports

test("three report tabs distinguish relationships, combined results and one dataset", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(reportSourceTabs)), [
    { href: "/dashboard/reports", label: "Relationships report" },
    { href: "/dashboard/reports/combined", label: "Combined metrics report" },
    { href: "/dashboard/reports/dataset", label: "Single dataset report" },
  ])
  assert.equal(reportPagePath(false, false, "multi", false), "/dashboard/reports/combined")
  assert.equal(reportPagePath(false, false, "single", false), "/dashboard/reports/dataset")
  assert.equal(reportPagePath(true, false, "multi", false), "/dashboard/reports/weekly")
  assert.equal(reportPagePath(false, true, "multi", false), "/dashboard/reports/impact")
  assert.match(read("../app/dashboard/reports/combined/page.tsx"), /<ReportPage includeRelationships=\{false\}/)
})

test("saved definitions and resumed jobs route to their own workflow, including legacy weekly assessments", () => {
  for (const [weekly, impact, scope, path] of [
    [false, false, "multi", "/dashboard/reports"], [false, false, "single", "/dashboard/reports/dataset"],
    [false, true, "multi", "/dashboard/reports/impact"], [true, true, "multi", "/dashboard/reports/weekly"],
    [true, false, "multi", "/dashboard/reports/weekly"],
  ]) assert.equal(reportPagePath(weekly, impact, scope), path)
  const source = read("../features/reports/report-workspace.tsx")
  assert.match(source, /reportPagePath\(job.kind !== "report", Boolean\(job.definition\?\.impact\), job.definition\?\.scope, job.definition\?\.include_relationships\)/)
  assert.equal((source.match(/reportPagePath\(Boolean\(result.weekly_report\), Boolean\(result.definition.impact\), result.definition.scope, result.definition.include_relationships\)/g) || []).length, 2)
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
  assert.match(source, /\/dashboard\/reports\/impact\?decision=\$\{decision.id\}/)
  assert.match(source, /\/dashboard\/reports\/impact\?report=\$\{encodeURIComponent\(review.report_id\)\}/)
  assert.doesNotMatch(source, /\/dashboard\/business-impact/)
  assert.match(read("../features/reports/report-page.tsx"), /key=\{`[^`]*\$\{impactPage\}/)
})

test("old Business Impact links redirect with their decision, saved report and job parameters intact", async () => {
  const loaded = { exports: {} }, destinations = []
  vm.runInNewContext(ts.transpileModule(read("../app/dashboard/business-impact/page.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, URLSearchParams,
    require: name => { assert.equal(name, "next/navigation"); return { redirect: path => destinations.push(path) } } })
  for (const params of [{}, { decision: "7" }, { report: "saved & report", job: "running-job" }, { tag: ["one", "two"], missing: undefined }]) {
    await loaded.exports.default({ searchParams: Promise.resolve(params) })
    const destination = new URL(destinations.at(-1), "https://example.test")
    assert.equal(destination.pathname, "/dashboard/reports/impact")
    for (const [key, value] of Object.entries(params)) {
      assert.deepEqual(destination.searchParams.getAll(key), value === undefined ? [] : Array.isArray(value) ? value : [value])
    }
    if (!Object.keys(params).length) assert.equal(destination.search, "")
  }
})
