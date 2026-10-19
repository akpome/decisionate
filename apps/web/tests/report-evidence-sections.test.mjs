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
  report_id: "report-1", definition: { metrics: [{ dataset_id: 1 }, { dataset_id: 2 }] }, decisions: [], ...patch,
} }))
const decisionLinks = html => html.match(/href="\/dashboard\/decisions\/\d+"/g) || []

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

test("historical finding exclusions remain excluded in both preview and print", () => {
  const html = renderFindings({ included_findings: [] })
  assert.match(html, /No relationship findings included in this report/)
  assert.doesNotMatch(html, /Website visits|Insufficient matched history/)
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
  assert.match(html, /href="\/dashboard\/decisions\/1">Decision draft/)
  assert.match(html, /Action not recorded/)
  assert.doesNotMatch(html, /Review joined|Actual:|Expected:|No active decisions/)
})

test("a current report-linked decision suppresses the older source-only draft", () => {
  const html = renderDecisions({ decisions: [realDecision], decision_drafts: [{ ...legacy[0], evidence_dataset_ids: [1, 2] }] })
  assert.equal(decisionLinks(html).length, 1)
  assert.match(html, /Move 10% of the campaign budget/)
  assert.doesNotMatch(html, /Decision draft|Earlier draft/)
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
  assert.doesNotMatch(html, /Decision draft/)
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
