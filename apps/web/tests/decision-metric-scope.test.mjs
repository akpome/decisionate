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
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, URLSearchParams, require: name => imports[name] || (name.includes("metric-selector")
    ? { formatMetricLabel: column => column.replaceAll("_", " ") } : require(name)) })
  return loaded.exports
}

const { selectedReportMetrics, selectedDecisionEvidence, decisionEvidenceHref } = load("../features/decisions/lib/report-metric-scope.ts")
const narrative = load("../features/decisions/lib/decision-evidence-text.ts")
const { decisionNarrativeText } = narrative
const { DecisionEvidenceContext } = load("../features/decisions/components/decision-evidence-context.tsx", {
  "../lib/decision-evidence-text": narrative,
  "@/features/reports/impact-types": load("../features/reports/impact-types.ts"),
})
const fields = [
  { dataset_id: 1, metric_key: "spend", label: "Spend" }, { dataset_id: 1, metric_key: "clicks", label: "Clicks" },
  { dataset_id: 2, metric_key: "orders", label: "Orders" }, { dataset_id: 2, metric_key: "sales", label: "Sales" },
]

test("decision report metrics are the chosen references, not every cached metric from selected datasets", () => {
  const report = { metrics: fields, definition: { metrics: [fields[0], fields[2]] } }
  const selected = selectedReportMetrics(report)
  assert.deepEqual(Array.from(selected, item => `${item.dataset_id}:${item.metric_key}`), ["1:spend", "2:orders"])
  assert.equal(report.metrics.length, 4)
})

test("empty or missing report choices never fall back to all metrics", () => {
  for (const definition of [{ metrics: [] }, {}]) {
    assert.equal(selectedReportMetrics({ metrics: fields, definition }).length, 0)
  }
})

test("scope distinguishes identically named metrics in different datasets", () => {
  const report = { metrics: [{ dataset_id: 1, metric_key: "total" }, { dataset_id: 2, metric_key: "total" }],
    definition: { metrics: [{ dataset_id: 2, metric_key: "total" }] } }
  assert.equal(selectedReportMetrics(report)[0].dataset_id, 2)
})

test("report choices preserve selection order without duplicate options", () => {
  const report = { metrics: [...fields, fields[0]], definition: { metrics: [fields[2], fields[0], fields[2]] } }
  assert.deepEqual(Array.from(selectedReportMetrics(report), item => `${item.dataset_id}:${item.metric_key}`), ["2:orders", "1:spend"])
})

const render = props => renderToStaticMarkup(React.createElement(DecisionEvidenceContext, {
  context: JSON.stringify({ metrics: fields }), loading: false, unavailable: false,
  metrics: [{ dataset_id: 1, metric_column: "spend", file_name: "Ads.csv" }, { dataset_id: 2, metric_column: "orders", file_name: "Sales.csv" }],
  ...props,
}))

test("only selected evidence is listed; the full original snapshot is collapsed and escaped", () => {
  const html = render({ context: '<script>original evidence</script>' })
  const listing = html.match(/<ul[^>]*>([\s\S]*?)<\/ul>/)?.[1]
  assert.match(listing, /Ads\.csv \/ spend/)
  assert.match(listing, /Sales\.csv \/ orders/)
  assert.doesNotMatch(listing, /clicks|impressions|discounts/)
  assert.match(html, /<summary[^>]*>Original evidence record<\/summary>/)
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;original evidence/)
})

test("loading, unavailable and empty metric states never render an unfiltered list", () => {
  for (const props of [{ loading: true }, { unavailable: true }, { metrics: [] }]) {
    assert.doesNotMatch(render(props), /<ul/)
  }
})

test("decision details use scoped options without a dataset-wide fallback or duplicate raw context", () => {
  const source = readFileSync(new URL("../app/dashboard/decisions/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(source, /getDecisionMetricOptions\(/)
  assert.match(source, /options=\{joinedEvidenceMetricOptions\}/)
  assert.match(source, /metrics=\{\[\]\}/)
  assert.doesNotMatch(source, /getDatasetMetrics\(|metricColumns|Context: \{decision\.recommendation_context\}/)
  assert.equal((source.match(/context=\{decision\.recommendation_context\}/g) || []).length, 1)
})

test("selected metric requests use the decision id and workspace authorization without stale read caching", async () => {
  const source = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
  const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getDecisionMetricOptions")
  assert.ok(declaration)
  let request
  const lookup = vm.runInNewContext(ts.transpileModule(`${declaration.getText(ast).replace(/^export /, "")}\ngetDecisionMetricOptions`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    API_URL: "https://api.decisionate.test", cleanPositiveIntegerId: Number,
    decisionHeaders: async () => ({ Authorization: "Bearer test", "X-Workspace-Id": "workspace" }),
    apiFetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ metrics: [fields[0], fields[2]] }) } },
  })
  const response = await lookup(55, "owner", "workspace")
  assert.equal(request.url, "https://api.decisionate.test/decisions/55/metric-options")
  assert.equal(request.options.cache, "no-store")
  assert.equal(request.options.headers.Authorization, "Bearer test")
  assert.equal(request.options.headers["X-Workspace-Id"], "workspace")
  assert.equal(response.metrics.length, 2)
})

const joinedSummary = "Joined evidence from 2 datasets on normalized month-year periods using sum aggregation. Shared periods: 12 of 12 available (100.0%). Columns: marketing-demo.csv \u00b7 ad_spend, marketing-demo.csv \u00b7 website_visits, marketing-demo.csv \u00b7 leads, marketing-demo.csv \u00b7 customers, revenue-demo.csv \u00b7 revenue, revenue-demo.csv \u00b7 customers, revenue-demo.csv \u00b7 orders. Latest shared period (2026-12-01): marketing-demo.csv \u00b7 ad_spend: 5800.0; marketing-demo.csv \u00b7 website_visits: 26400.0; marketing-demo.csv \u00b7 leads: 745.0; marketing-demo.csv \u00b7 customers: 65.0; revenue-demo.csv \u00b7 revenue: 30100.0; revenue-demo.csv \u00b7 customers: 268.0; revenue-demo.csv \u00b7 orders: 189.0."
const legacyDescription = [joinedSummary, "Latest shared period: 2026-12-01.",
  "Latest evidence: marketing-demo.csv \u00b7 ad_spend: 5,800; marketing-demo.csv \u00b7 website_visits: 26,400; marketing-demo.csv \u00b7 leads: 745; revenue-demo.csv \u00b7 orders: 189.",
  "Select an outcome metric in Decision Details only if this decision needs numeric outcome measurement."].join("\n\n")

test("the exact legacy joined description is not used as a current metric summary", () => {
  assert.equal(decisionNarrativeText(legacyDescription), "")
  assert.equal(decisionNarrativeText(joinedSummary), "")
  assert.equal(decisionNarrativeText(null), "")
  assert.equal(decisionNarrativeText(undefined), "")
})

test("manual notes around a generated snapshot and unrelated authored prose are preserved", () => {
  const before = "Budget test approved by the account owner."
  const after = "Do not increase spend until the next review."
  assert.equal(decisionNarrativeText([before, legacyDescription, after].join("\n\n")), `${before}\n\n${after}`)
  assert.equal(decisionNarrativeText(legacyDescription.replaceAll("\n", "\r\n")), "")
  for (const text of ["Latest evidence: customers asked for a longer trial.", "Columns: revenue and costs must be reviewed.", `Quoted evidence: ${joinedSummary}`]) {
    assert.equal(decisionNarrativeText(text), text)
  }
})

test("French metadata generated around the English backend snapshot is not left in the description", () => {
  const text = [joinedSummary, "Derni\u00e8re p\u00e9riode commune : 2026-12-01.",
    "Derniers \u00e9l\u00e9ments probants : website_visits: 26400.",
    "S\u00e9lectionnez une m\u00e9trique de r\u00e9sultat dans les d\u00e9tails de la d\u00e9cision uniquement si cette d\u00e9cision n\u00e9cessite une mesure num\u00e9rique du r\u00e9sultat."].join("\n\n")
  assert.equal(decisionNarrativeText(text), "")
})

test("all-field prose is archived, not rendered above the selected evidence or in the main recommendation", () => {
  const html = render({ context: joinedSummary, recommendationText: joinedSummary, description: legacyDescription,
    metrics: [{ dataset_id: 1, metric_column: "ad_spend", file_name: "marketing-demo.csv" }, { dataset_id: 2, metric_column: "orders", file_name: "revenue-demo.csv" }],
  })
  const active = html.replace(/<details[\s\S]*?<\/details>/g, "")
  assert.match(active, /marketing-demo\.csv \/ ad spend/)
  assert.match(active, /revenue-demo\.csv \/ orders/)
  assert.doesNotMatch(active, /website_visits|website visits|customers|leads|26400|26,400|Joined evidence|Latest evidence|Select an outcome/)
  assert.match(html, /website_visits/)
  assert.match(html, /Original evidence record/)
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/)
})

test("description-only legacy evidence remains available even without a recommendation or selected metrics", () => {
  const html = render({ context: null, recommendationText: null, description: legacyDescription, metrics: [] })
  assert.match(html, /Original evidence record/)
  assert.match(html, /website_visits/)
  assert.doesNotMatch(html.replace(/<details[\s\S]*?<\/details>/g, ""), /website_visits|Joined evidence from/)
  const source = readFileSync(new URL("../app/dashboard/decisions/[id]/page.tsx", import.meta.url), "utf8")
  assert.match(source, /decisionDescription !== \(decision\.description \?\? ""\)/)
})

test("report links preserve the exact chosen references and can only narrow authorized metric options", () => {
  const metrics = fields.map(item => ({ ...item, metric_column: item.metric_key }))
  const href = new URL(decisionEvidenceHref(42, [fields[0], fields[2]]), "https://decisionate.test")
  const selection = href.searchParams.get("evidence_metrics")
  assert.equal(href.pathname, "/dashboard/decisions/42")
  assert.deepEqual(JSON.parse(selection), [[1, "spend"], [2, "orders"]])
  assert.deepEqual(Array.from(selectedDecisionEvidence(metrics, selection), item => item.metric_column), ["spend", "orders"])
  assert.equal(selectedDecisionEvidence(metrics, JSON.stringify([[99, "spend"]])).length, 0)
  assert.equal(selectedDecisionEvidence(metrics, null), metrics)
  for (const invalid of ["", "not json", "{}", "[]", '[[true,"spend"]]', '[[-1,"spend"]]', '[[1,""]]', JSON.stringify(Array(26).fill([1, "spend"]))]) {
    assert.equal(selectedDecisionEvidence(metrics, invalid).length, 0)
  }
  const sameNames = [{ dataset_id: 1, metric_column: "total" }, { dataset_id: 2, metric_column: "total" }]
  assert.deepEqual(Array.from(selectedDecisionEvidence(sameNames, '[[2,"total"]]'), item => item.dataset_id), [2])
})

function detailFunction(name) {
  const source = readFileSync(new URL("../app/dashboard/decisions/[id]/page.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration)
  return ts.transpileModule(`${declaration.getText(ast)}\n${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

test("loading the edit form does not put the generated all-column snapshot into its description", () => {
  const values = {}
  const names = ["Title", "OriginalTitle", "Action", "OriginalAction", "Description", "OriginalDescription", "MetricColumn", "OriginalMetricColumn", "OutcomeDatasetId", "OriginalOutcomeDatasetId"]
  const bindings = { decisionNarrativeText, ...Object.fromEntries(names.map(name => [`set${name}`, value => { values[name] = value }])) }
  const sync = vm.runInNewContext(detailFunction("syncDetailsFormFromDecision"), bindings)
  const record = { title: "Budget test", action: "Keep spend steady", description: legacyDescription }
  sync(record)
  assert.equal(values.Description, "")
  assert.equal(values.OriginalDescription, "")
  assert.equal(values.Title, record.title)
  assert.equal(record.description, legacyDescription)
})

test("saving a title-only change does not overwrite the stored original description", async () => {
  let payload
  const bindings = {
    user: { id: "owner" }, decision: { id: 42, description: legacyDescription }, activeWorkspaceId: "workspace",
    title: "Updated budget test", originalTitle: "Budget test", action: "Keep spend steady", originalAction: "Keep spend steady",
    description: "", originalDescription: "", metricColumn: "", originalMetricColumn: "", outcomeDatasetId: null, originalOutcomeDatasetId: null,
    detailsDecisionActivity: "details", setSavingSection() {}, setSaveError() {}, setDecision() {},
    syncDetailsFormFromDecision() {}, loadActivities: async () => {}, showSectionSaved() {}, setDetailsSaved() {},
    getSaveErrorMessage: error => error.message, console,
    updateDecisionDetails: async (_id, value) => { payload = value; return { id: 42, description: legacyDescription } },
  }
  await vm.runInNewContext(detailFunction("handleSaveDetails"), bindings)()
  assert.equal(payload.title, "Updated budget test")
  assert.equal("description" in payload, false)
  assert.equal(bindings.decision.description, legacyDescription)
})
