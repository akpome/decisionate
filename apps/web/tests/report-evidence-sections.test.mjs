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
  } }).outputText, { module: loaded, exports: loaded.exports, URLSearchParams, require: name => imports[name] || require(name) })
  return loaded.exports
}

const title = load("../features/decisions/lib/decision-title.ts")
const { ReportRelationshipFindings, ReportDecisions } = load("../features/reports/report-evidence-sections.tsx", {
  "next/link": { __esModule: true, default: props => React.createElement("a", props) },
  "@/features/decisions/lib/decision-title": title,
  "@/features/decisions/lib/report-metric-scope": load("../features/decisions/lib/report-metric-scope.ts"),
})
const finding = {
  id: "finding-1", metric_a: { id: "visits", dataset_label: "marketing-demo.csv", label: "Website visits" },
  metric_b: { id: "orders", dataset_label: "revenue-demo.csv", label: "Orders" }, reliability: "insufficient",
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
  report_id: "report-1", status: "ready", definition: { metrics: [{ dataset_id: 1, metric_key: "spend" }, { dataset_id: 2, metric_key: "orders" }] }, decisions: [], ...patch,
} }))
const decisionLinks = html => html.match(/href="\/dashboard\/decisions\/\d+(?:\?[^"]*)?"/g) || []

test("relationship findings are read-only results with no checkbox or print-only visibility", () => {
  const html = renderFindings()
  assert.match(html, /marketing-demo\.csv \/ Website visits/)
  assert.match(html, /revenue-demo\.csv \/ Orders/)
  assert.match(html, /Insufficient matched history/)
  assert.match(html, /3 observations/)
  assert.match(html, /insufficient overlap/)
  assert.match(html, /<ul aria-label="Relationship results"/)
  assert.doesNotMatch(html, /<input|<label|checkbox|print:hidden/)
})

test("coefficient and lag are visible without expanding the report details", () => {
  for (const coefficient of [0.83, -0.61, 0]) {
    const html = renderFindings({ findings: [{ ...finding, eligible: true, coefficient, lag: 2, lead_metric: "visits" }] })
    const visible = html.split("<details")[0]
    assert.match(visible, /Correlation coefficient/)
    assert.ok(visible.includes(coefficient.toFixed(2)))
    assert.match(visible, /Lag \(observed\)/)
    assert.match(visible, />2 days</)
    assert.match(visible, /marketing-demo.csv \/ Website visits precedes revenue-demo.csv \/ Orders/)
  }
})

test("same-period results show zero lag but unavailable results do not imply zero", () => {
  const valid = renderFindings({ findings: [{ ...finding, eligible: true, coefficient: 0.7 }] })
  assert.match(valid, /0 \(same period\)/)
  for (const coefficient of [null, undefined, NaN, Infinity]) {
    const html = renderFindings({ findings: [{ ...finding, eligible: false, coefficient }] })
    assert.match(html, /Not calculated/)
    assert.match(html, /Not established/)
    assert.doesNotMatch(html, /0 \(same period\)|Lag 0|NaN|Infinity/)
  }
})

test("lag uses the analysis unit rather than the daily detail in a weekly report", () => {
  for (const [grain, unit] of [["daily", "day"], ["weekly", "week"], ["monthly", "month"], ["quarterly", "quarter"]]) {
    for (const lag of [1, 2]) {
      const html = renderFindings({ weekly_report: true, grain: "daily", analysis_grain: grain,
        findings: [{ ...finding, eligible: true, coefficient: 0.75, lag, lag_unit: `calendar ${grain} periods`, lead_metric: "orders" }] })
      assert.ok(html.includes(`>${lag} ${unit}${lag === 1 ? "" : "s"}<`))
      assert.match(html, /revenue-demo.csv \/ Orders precedes marketing-demo.csv \/ Website visits/)
    }
  }
})

test("legacy lag units take precedence over summary grouping and missing units use analysis grouping", () => {
  const historical = { ...finding, eligible: true, coefficient: 0.75, lag: 3, lag_unit: "calendar weekly periods" }
  assert.match(renderFindings({ grain: "daily", findings: [historical] }), />3 weeks</)
  assert.match(renderFindings({ grain: "daily", analysis_grain: "monthly", findings: [{ ...historical, lag_unit: undefined }] }), />3 months</)
  assert.match(renderFindings({ findings: [{ ...historical, lag_unit: undefined }] }), />3 grouped periods</)
  const missingLag = renderFindings({ findings: [{ ...historical, lag: undefined }] })
  assert.match(missingLag, /Not established/)
  assert.doesNotMatch(missingLag, /0 \(same period\)/)
})

test("exploratory timing keeps the computed numbers without hiding its reliability warning", () => {
  const html = renderFindings({ findings: [{ ...finding, eligible: true, coefficient: 0.65, lag: 2,
    timing_validation: { status: "unavailable", message: "The timing was not stable in earlier records." } }] })
  const visible = html.split("<details")[0]
  assert.match(visible, /0.65/)
  assert.match(visible, /2 days/)
  assert.match(visible, /Not yet a dependable timing guide/)
  assert.match(visible, /The timing was not stable in earlier records/)
})

test("historical finding exclusions remain excluded in both preview and print", () => {
  const html = renderFindings({ included_findings: [] })
  assert.match(html, /No relationship findings included in this report/)
  assert.doesNotMatch(html, /Website visits|Insufficient matched history/)
})

test("impact previews and older impact snapshots omit relationship findings entirely", () => {
  for (const patch of [{ definition: { impact: { decision_id: 4 } } }, { impact_analysis: { status: "not_ready" } }]) {
    assert.equal(renderFindings(patch), "")
  }
  assert.match(renderFindings({ definition: { impact: null }, impact_analysis: null }), /Relationship findings/)
})

test("the three older joined-data entries from the screenshot are not report decisions", () => {
  const html = renderDecisions({ decisions: legacy })
  assert.match(html, /No active decisions linked to this report/)
  assert.equal(decisionLinks(html).length, 0)
  assert.doesNotMatch(html, /Review joined|Not yet recorded/)
  assert.match(html, /href="\/dashboard\/decisions">Manage decisions/)
  assert.equal(legacy.length, 3)
  assert.equal(legacy[2].status, "archived")
})

test("even explicitly linked old evidence placeholders are not presented as action decisions", () => {
  const html = renderDecisions({ decisions: legacy.map(item => ({ ...item, report_id: "report-1" })) })
  assert.match(html, /No active decisions linked to this report/)
  assert.equal(decisionLinks(html).length, 0)
})

test("one explicit decision is shown once alongside older or unrelated records", () => {
  const html = renderDecisions({ decisions: [...legacy, realDecision, { ...realDecision, id: 5, report_id: "another-report", title: "Unrelated action" }, realDecision] })
  assert.equal(decisionLinks(html).length, 1)
  assert.match(html, /Move 10% of the campaign budget/)
  assert.match(html, /Increase orders without increasing spend/)
  assert.doesNotMatch(html, /Review joined|Unrelated action/)
})

test("an unsaved preview does not adopt existing decisions from selected datasets", () => {
  const html = renderDecisions({ report_id: undefined, decisions: [realDecision] })
  assert.match(html, /No active decisions linked to this report/)
  assert.equal(decisionLinks(html).length, 0)
})

test("weekly template decisions retain their explicit source without treating the weekly preview as a saved snapshot", () => {
  const html = renderDecisions({ report_id: undefined, decision_report_id: "report-1", decisions: [realDecision] })
  assert.equal(decisionLinks(html).length, 1)
  assert.match(html, /Move 10% of the campaign budget/)
  const unrelated = renderDecisions({ report_id: "report-2", decision_report_id: "report-1", decisions: [realDecision] })
  assert.match(unrelated, /No active decisions linked to this report/)
})

test("distinct action decisions remain distinct and genuinely linked archived decisions remain visible", () => {
  const html = renderDecisions({ decisions: [realDecision, { ...realDecision, id: 5, title: "Review supplier contracts", action: "Compare renewal terms", status: "archived" }] })
  assert.equal(decisionLinks(html).length, 2)
  assert.match(html, /Review supplier contracts/)
  assert.match(html, /archived/)
  assert.match(html, /<summary[^>]*>Archived decisions \(1\)<\/summary>/)
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/)
})

test("a deliberately named decision is not confused with an old generated title", () => {
  const html = renderDecisions({ decisions: [{ ...realDecision, title: "Review joined dataset evidence" }] })
  assert.equal(decisionLinks(html).length, 1)
})

test("one existing active source draft remains editable without inventing an action or outcome", () => {
  const drafts = legacy.map(item => ({ ...item, evidence_dataset_ids: [1, 2] }))
  const html = renderDecisions({ report_id: undefined, decision_drafts: drafts })
  assert.equal(decisionLinks(html).length, 1)
  assert.match(html, /Earlier draft for these datasets/)
  assert.match(html, /href="\/dashboard\/decisions\/1\?evidence_metrics=[^"]+">Continue decision/)
  const href = html.match(/href="([^\"]+)">Continue decision/)?.[1]
  assert.deepEqual(JSON.parse(new URL(href, "https://decisionate.test").searchParams.get("evidence_metrics")), [[1, "spend"], [2, "orders"]])
  assert.match(html, /Action not recorded/)
  assert.doesNotMatch(html, /Review joined|Actual:|Expected:|No active decisions/)
})

test("editable draft navigation uses the evidence-saving handoff and blocks repeated clicks while busy", () => {
  const opened = []
  const props = { report: { status: "ready", report_id: "report-1", decisions: [],
    definition: { metrics: [{ dataset_id: 1, metric_key: "spend" }, { dataset_id: 2, metric_key: "orders" }] },
    decision_drafts: [{ ...legacy[0], evidence_dataset_ids: [1, 2] }],
  }, onOpenDraft: async id => { opened.push(id) } }
  const html = renderToStaticMarkup(React.createElement(ReportDecisions, { ...props, busy: true }))
  assert.match(html, /<button[^>]*disabled=""/)
  assert.equal(decisionLinks(html).length, 0)
  const buttons = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (node.type === "button") buttons.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(ReportDecisions(props))
  assert.equal(buttons.length, 1)
  buttons[0].props.onClick()
  assert.deepEqual(opened, [1])
})

test("a current report-linked decision suppresses the older source-only draft", () => {
  const html = renderDecisions({ decisions: [realDecision], decision_drafts: [{ ...legacy[0], evidence_dataset_ids: [1, 2] }] })
  assert.equal(decisionLinks(html).length, 1)
  assert.match(html, /Move 10% of the campaign budget/)
  assert.doesNotMatch(html, /Continue decision|Create decision|Earlier draft/)
})

test("renaming a report draft does not hide it or show it as a completed action", () => {
  const html = renderDecisions({ decision_drafts: [{ ...legacy[0], title: "Decision (random-id)", is_draft: true, report_id: "report-1", evidence_dataset_ids: [1, 2] }] })
  assert.equal(decisionLinks(html).length, 1)
  assert.match(html, /Continue decision/)
  assert.doesNotMatch(html, /Create decision/)
  assert.doesNotMatch(html, /No active decisions|Expected:|Actual:/)
})

test("an owner without an existing draft gets one central-form handoff and no invented decision", () => {
  const opened = []
  const props = { report: { status: "ready", report_id: "report-1", definition: { metrics: [] }, decisions: [] }, onOpenDraft: async id => { opened.push(id) } }
  const html = renderToStaticMarkup(React.createElement(ReportDecisions, props))
  assert.match(html, /Create decision/)
  assert.match(html, /bg-blue-700[^\"]*text-white/)
  assert.match(html, /lucide-plus/)
  assert.doesNotMatch(html, /disabled=""|Decision draft|Action not recorded|No active decisions|Expected:|Actual:/)
  const buttons = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (node.type === "button") buttons.push(node)
    React.Children.forEach(node.props?.children, visit)
  }
  visit(ReportDecisions(props))
  assert.equal(buttons.length, 1)
  buttons[0].props.onClick()
  assert.deepEqual(opened, [undefined])
  assert.equal(decisionLinks(html).length, 0)
  assert.match(renderToStaticMarkup(React.createElement(ReportDecisions, { ...props, report: { ...props.report, status: "insufficient" } })), /<button[^>]*disabled=""/)
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ReportDecisions, { report: props.report })), /<button|Create decision/)
})

test("saving a weekly report does not bypass missing coverage and the reason names the actual week", () => {
  for (const scope of ["single", "multi"]) {
    const report = { weekly_report: true, weekly_current: true, analysis_job_id: "saved-preview", status: "limited_coverage",
      window: { start: "2026-10-19", end: "2026-10-25" }, definition: { scope, metrics: [] }, decisions: [] }
    const html = renderToStaticMarkup(React.createElement(ReportDecisions, { report, onOpenDraft: async () => {} }))
    assert.match(html, /Create decision/)
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-describedby="report-decision-unavailable"/)
    assert.match(html, /id="report-decision-unavailable" role="status"/)
    assert.match(html, /2026-10-19 to 2026-10-25/)
    assert.ok(html.includes(scope === "single" ? "selected dataset has no usable values" : "fewer than two datasets have usable values"))
    const ready = renderToStaticMarkup(React.createElement(ReportDecisions, { report: { ...report, status: "ready",
      findings: [{ eligible: false, coefficient: null }], warnings: ["Previous-period baseline unavailable"] }, onOpenDraft: async () => {} }))
    assert.doesNotMatch(ready, /disabled=""|Decision evidence unavailable/)
    const busy = renderToStaticMarkup(React.createElement(ReportDecisions, { report: { ...report, status: "ready" }, busy: true, onOpenDraft: async () => {} }))
    assert.match(busy, /disabled=""/)
    assert.doesNotMatch(busy, /Decision evidence unavailable/)
  }
})

test("a legacy draft needs current coverage only when it has no previously linked report", () => {
  for (const report_id of [null, "report-1"]) {
    const report = { report_id: "report-1", status: "limited_coverage", decisions: [],
      definition: { metrics: [{ dataset_id: 1, metric_key: "spend" }, { dataset_id: 2, metric_key: "orders" }] },
      decision_drafts: [{ ...legacy[0], report_id, evidence_dataset_ids: [1, 2] }] }
    const html = renderToStaticMarkup(React.createElement(ReportDecisions, { report, onOpenDraft: async () => {} }))
    assert.match(html, /Continue decision/)
    assert.doesNotMatch(html, /Create decision/)
    assert.equal(html.includes('disabled=""'), !report_id)
    assert.equal(html.includes("Decision evidence unavailable"), !report_id)
  }
})

test("archived, unrelated and unscoped legacy drafts cannot reappear in a report", () => {
  const drafts = [
    { ...legacy[2], evidence_dataset_ids: [1, 2] },
    { ...legacy[0], evidence_dataset_ids: [1, 3] },
    { ...legacy[0], evidence_dataset_ids: [1] },
    { ...legacy[0], report_id: "another-report", evidence_dataset_ids: [1, 2] },
    legacy[0],
  ]
  const html = renderDecisions({ decision_drafts: drafts })
  assert.equal(decisionLinks(html).length, 0)
  assert.match(html, /No active decisions linked/)
  assert.doesNotMatch(html, /Continue decision|Create decision/)
})

test("frontend deployments use the hosting commit id for version skew protection", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8")
  const fullCommitSha = "2205b69d59becc4ada8a56458d84fc4023a14396"
  const shortCommitSha = fullCommitSha.slice(0, 32)
  for (const [env, expected] of [
    [{}, undefined],
    [{ NEXT_DEPLOYMENT_ID: "", VERCEL_GIT_COMMIT_SHA: "", RAILWAY_GIT_COMMIT_SHA: "" }, undefined],
    [{ NEXT_DEPLOYMENT_ID: "explicit-release", VERCEL_GIT_COMMIT_SHA: "web-commit" }, "explicit-release"],
    [{ VERCEL_GIT_COMMIT_SHA: "web-commit" }, "web-commit"],
    [{ RAILWAY_GIT_COMMIT_SHA: "container-commit" }, "container-commit"],
    [{ VERCEL_GIT_COMMIT_SHA: fullCommitSha }, shortCommitSha],
    [{ RAILWAY_GIT_COMMIT_SHA: fullCommitSha }, shortCommitSha],
    [{ VERCEL_GIT_COMMIT_SHA: fullCommitSha, RAILWAY_GIT_COMMIT_SHA: "container-commit" }, shortCommitSha],
    [{ NEXT_DEPLOYMENT_ID: "explicit-release", VERCEL_GIT_COMMIT_SHA: fullCommitSha }, "explicit-release"],
    [{ NEXT_DEPLOYMENT_ID: "dpl_" + "a".repeat(28), VERCEL_GIT_COMMIT_SHA: fullCommitSha }, "dpl_" + "a".repeat(28)],
  ]) {
    const loaded = { exports: {} }
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { module: loaded, exports: loaded.exports, process: { env } })
    assert.equal(loaded.exports.default.deploymentId, expected)
    if (expected) {
      assert.ok(loaded.exports.default.deploymentId.length <= 32, "Vercel deployment IDs must not exceed 32 characters")
      assert.match(loaded.exports.default.deploymentId, /^[a-zA-Z0-9_-]+$/)
    }
  }
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8")
  for (const name of ["NEXT_DEPLOYMENT_ID", "VERCEL_GIT_COMMIT_SHA", "RAILWAY_GIT_COMMIT_SHA"]) {
    assert.match(dockerfile, new RegExp(`ARG ${name}\\b`))
    assert.match(dockerfile, new RegExp(`${name}=\\$${name}`))
  }
})
