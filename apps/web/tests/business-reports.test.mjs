import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const pairModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/reports/pair-directions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText,
  { module: pairModule, exports: pairModule.exports })
const loadedModule = { exports: {} }
const defaults = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/relationships/defaults.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText,
  { module: defaults, exports: defaults.exports })
const source = readFileSync(new URL("../features/reports/types.ts", import.meta.url), "utf8")
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText,
  { module: loadedModule, exports: loadedModule.exports, require: name => name === "./pair-directions" ? pairModule.exports : name === "@/features/relationships/defaults" ? defaults.exports : require(name), Intl, Number, Math })
const { editableDefinition, formatReportValue, selectedReportDimensionFilters } = loadedModule.exports

test("report defaults share the monitor's method, grouping, observation floor and lag limit", () => {
  const defaultsValue = defaults.exports.RELATIONSHIP_DEFAULTS
  assert.deepEqual(JSON.parse(JSON.stringify(defaultsValue)), { method: "spearman", period: "daily", aggregation: "sum", minimumObservations: 52, maximumLag: 12, minimumAbsCoefficient: .3, lagMode: "manual", lagPeriods: 0, lagDirection: "a_leads_b" })
  const value = editableDefinition({})
  assert.equal(value.method, defaultsValue.method)
  assert.equal(value.grain, defaultsValue.period)
  assert.equal(value.filters.minimum_observations, defaultsValue.minimumObservations)
  assert.equal(value.filters.minimum_abs_coefficient, defaultsValue.minimumAbsCoefficient)
  assert.equal(value.lag.maximum, defaultsValue.maximumLag)
  assert.equal(value.lag.minimum, defaultsValue.lagPeriods)
  const saved = editableDefinition({ method: "pearson", grain: "monthly", filters: { minimum_observations: 60, minimum_abs_coefficient: .6 }, lag: { enabled: true, minimum: 0, maximum: 3, direction: "b_leads_a" } })
  assert.equal(saved.method, "pearson")
  assert.equal(saved.grain, "monthly")
  assert.equal(saved.filters.minimum_observations, 60)
  assert.equal(saved.lag.maximum, 3)
  for (const grain of ["daily", "weekly", "monthly", "quarterly"]) {
    assert.equal(editableDefinition({ grain }).grain, grain)
  }
})

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

test("saved report dimension filters survive editing and legacy reports default to all rows", () => {
  const dimension_filters = [{ dataset_id: 7, column: "region", values: ["East", null, ""] }]
  assert.deepEqual(JSON.parse(JSON.stringify(editableDefinition({ dimension_filters }).dimension_filters)), dimension_filters)
  assert.deepEqual(Array.from(editableDefinition({}).dimension_filters), [])
})

test("only filters for selected datasets are submitted, leaving pending choices untouched", () => {
  const value = editableDefinition({ metrics: [{ dataset_id: 7, metric_key: "spend", date_column: "date", aggregation: "sum" }],
    dimension_filters: [{ dataset_id: 7, column: "region", values: ["East"] }, { dataset_id: 8, column: "channel", values: [] }] })
  const filters = selectedReportDimensionFilters(value)
  assert.equal(filters.length, 1)
  assert.equal(filters[0].dataset_id, 7)
  assert.equal(value.dimension_filters.length, 2)
  assert.equal(value.dimension_filters[1].values.length, 0)
  assert.equal(selectedReportDimensionFilters(editableDefinition({})).length, 0)
})

test("new reports automatically include findings without checkbox selection", () => {
  assert.equal(editableDefinition({}).included_findings, null)
  assert.equal(editableDefinition({ included_findings: null }).included_findings, null)
})

test("a fresh preview includes findings automatically and keeps the returned selection for saving", async () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("report-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "calculate") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration)
  const original = editableDefinition({ included_findings: [],
    metrics: [{ dataset_id: 1, metric_key: "spend", date_column: "date", aggregation: "sum" }],
    dimension_filters: [{ dataset_id: 1, column: "region", values: ["East"] }, { dataset_id: 2, column: "channel", values: [] }],
  })
  let savedDefinition, report, view
  const calculate = vm.runInNewContext(ts.transpileModule(`${declaration}\ncalculate`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    definition: original, execute: async action => action(), editableDefinition, selectedReportDimensionFilters,
    crypto: { randomUUID: () => "request-1" }, setAnalysisJob: () => {}, routeController: { current: null },
    analysisSubmission: { current: false }, busy: false, weekly: false,
    window: { location: { pathname: "/dashboard/reports" }, history: { replaceState() {} } }, encodeURIComponent,
    waitForAnalysis: async (request, identity) => {
      assert.equal(identity, "job-1")
      return { definition: { ...original, included_findings: ["finding-1"] } }
    },
    request: async (path, options) => {
      assert.equal(path, "/jobs")
      assert.equal(JSON.parse(options.body).included_findings, null)
      assert.deepEqual(JSON.parse(options.body).dimension_filters, [{ dataset_id: 1, column: "region", values: ["East"] }])
      return { job_id: "job-1", status: "queued" }
    },
    setDefinition: value => { savedDefinition = value }, setReport: value => { report = value }, setView: value => { view = value },
  })
  await calculate()
  assert.deepEqual(Array.from(savedDefinition.included_findings), ["finding-1"])
  assert.equal(report.definition.included_findings[0], "finding-1")
  assert.equal(view, "report")
  assert.deepEqual(Array.from(original.included_findings), [])
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
  assert.equal(value.filters.minimum_observations, 24)
  assert.equal(value.filters.minimum_abs_coefficient, 0)
})

test("reports default to 52 historical observations while retaining lower and higher saved settings", () => {
  assert.equal(editableDefinition({}).filters.minimum_observations, 52)
  for (const minimum of [24, 30, 48, 3653]) {
    assert.equal(editableDefinition({ filters: { minimum_observations: minimum } }).filters.minimum_observations, minimum)
  }
})

test("main Reports route opens the combined workspace while dataset inspection remains available", () => {
  const page = readFileSync(new URL("../app/dashboard/reports/page.tsx", import.meta.url), "utf8")
  const inspection = readFileSync(new URL("../app/dashboard/reports/dataset/page.tsx", import.meta.url), "utf8")
  assert.match(page, /ReportPage/)
  assert.doesNotMatch(page, /SingleDatasetReport|single-dataset-report|redirect\(/)
  assert.match(readFileSync(new URL("../features/reports/report-page.tsx", import.meta.url), "utf8"), /canCreateDecisions/)
  const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(workspace, /<AnalysisNavigation active=\{navigation\}/)
  assert.match(inspection, /single-dataset-report/)
})

test("multi dataset Reports fills the available shell width during loading and after data loads", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("report-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const roots = []
  function visit(node) {
    if (ts.isReturnStatement(node) && node.expression && ts.isJsxElement(node.expression) && node.expression.children.some(child => ts.isJsxSelfClosingElement(child) && child.tagName.getText(ast) === "AnalysisNavigation")) roots.push(node.expression)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(roots.length, 2)
  for (const root of roots) {
    const classes = root.openingElement.attributes.properties.find(attribute => attribute.name?.text === "className")?.initializer?.text
    assert.match(classes, /\bw-full\b/)
    assert.match(classes, /\bmin-w-0\b/)
    assert.doesNotMatch(classes, /max-w-|mx-auto/)
  }
})

test("central decision form checks decision permissions and preserves the report evidence handoff", () => {
  const page = readFileSync(new URL("../app/dashboard/decisions/new/page.tsx", import.meta.url), "utf8")
  assert.match(page, /if \(!user\?\.id \|\| !canCreateDecisions \|\| creatingDecision\) return/)
  assert.match(page, /decision-evidence/)
  assert.match(page, /reasoning: createDecisionDescription\.trim\(\)/)
  assert.match(page, /review_date: createDecisionReviewDate/)
  assert.match(page, /payload = evidence\.decision_payload/)
  assert.match(page, /\.\.\.payload, priority: createDecisionPriority/)
  assert.match(page, /if \(submissionInFlight\.current\) return/)
  assert.match(page, /submissionRequest\.current\.key/)
  assert.match(page, /router\.replace\(returnPath\)/)
  assert.match(page, /if \(!saved\)/)
  const reports = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(reports, /createDecision|DecisionDialog|Create decision/)
})

function draftHandoff(overrides = {}) {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("report-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "openDecisionDraft") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration)
  const calls = [], errors = [], openingDraft = { current: false }
  const handler = vm.runInNewContext(ts.transpileModule(`${declaration}\nopenDecisionDraft`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    canEditDecisions: true, canSave: true, busy: false, openingDraft, report: null, URLSearchParams, pagePath: "/dashboard/reports",
    execute: async action => { try { await action() } catch (error) { errors.push(error.message) } },
    saveSnapshot: async () => { calls.push("save"); return { report_id: "report-1" } },
    request: async (path, init) => { calls.push([path, init.method]); return { decision_id: 4 } },
    router: { push: path => calls.push(path) }, ...overrides,
  })
  return { handler, calls, errors, openingDraft }
}

test("opening an existing draft saves selected report evidence before navigating to the canonical decision", async () => {
  const { handler, calls, errors, openingDraft } = draftHandoff()
  await handler(3)
  assert.deepEqual(calls, ["save", ["/report-1/decision-drafts/3/evidence", "POST"], "/dashboard/decisions/4"])
  assert.deepEqual(errors, [])
  assert.equal(openingDraft.current, false)
})

test("double clicking the draft cannot submit multiple handoffs or create a decision", async () => {
  const { handler, calls } = draftHandoff()
  await Promise.all([handler(3), handler(3), handler(3)])
  assert.equal(calls.length, 3)
  assert.equal(calls.filter(item => Array.isArray(item)).length, 1)
})

test("a prepared draft opens the central form with this report without inserting a decision", async () => {
  const { handler, calls } = draftHandoff()
  await handler()
  assert.equal(calls.length, 2)
  assert.equal(calls[0], "save")
  const url = new URL(calls[1], "https://decisionate.test")
  assert.equal(url.pathname, "/dashboard/decisions/new")
  assert.equal(url.searchParams.get("report"), "report-1")
  assert.equal(url.searchParams.get("returnTo"), "/dashboard/reports?report=report-1")
})

test("an existing weekly-template draft keeps its original report instead of rebinding its evidence", async () => {
  const { handler, calls } = draftHandoff({ report: { decision_drafts: [{ id: 3, report_id: "template-report" }] } })
  await handler(3)
  assert.deepEqual(calls, [["/template-report/decision-drafts/3/evidence", "POST"], "/dashboard/decisions/4"])
})

test("a failed save or binding keeps the user in the report and permits retry", async () => {
  for (const stage of ["saveSnapshot", "request"]) {
    const { handler, calls, errors, openingDraft } = draftHandoff({ [stage]: async () => { throw new Error("Unavailable") } })
    await handler(3)
    assert.deepEqual(errors, ["Unavailable"])
    assert.ok(calls.every(item => typeof item !== "string" || !item.startsWith("/dashboard/decisions")))
    assert.equal(openingDraft.current, false)
  }
})

test("read-only and busy report views cannot mutate a draft", async () => {
  for (const overrides of [{ canEditDecisions: false }, { canSave: false }, { busy: true }]) {
    const { handler, calls } = draftHandoff(overrides)
    await handler(3)
    assert.deepEqual(calls, [])
  }
  const page = readFileSync(new URL("../features/reports/report-page.tsx", import.meta.url), "utf8")
  assert.match(page, /canEditDecisions=\{access\.canCreateDecisions\}/)
})
