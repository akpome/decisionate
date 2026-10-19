import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function functionSource(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast).replace(/^export /, "")
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(result, name)
  return result
}

const handler = functionSource("../app/dashboard/decisions/new/page.tsx", "handleCreateDecision")

function submission(createDecision) {
  const calls = [], errors = [], destinations = []
  const bindings = {
    user: { id: "owner" }, activeWorkspaceId: "workspace", canCreateDecisions: true, creatingDecision: false,
    submissionInFlight: { current: false }, submissionRequest: { current: null },
    createDatasetId: "1", createDecisionTitle: "Shift campaign budget", createDecisionAction: "Move 10% of budget to campaign B",
    createDecisionExpectedOutcome: "Increase orders without additional spend", createDecisionDescription: "Test the cross-source finding",
    createDecisionReviewDate: "2026-11-01", createDecisionPriority: "medium", createDecisionCategory: "marketing", createDecisionConfidence: "",
    selectedMetric: "orders", reportEvidence: { reportId: "" }, reportOutcomeMetric: undefined,
    getCreateDecisionDatasetId: Number, setCreatingDecision: () => {}, setCreateDecisionError: message => errors.push(message),
    getDecisionPageErrorMessage: error => error.message, returnPath: "/dashboard/decisions",
    router: { replace: value => destinations.push(value) }, console: { error: () => {} }, crypto: { randomUUID },
    createDecision: async (...args) => { calls.push(args); return createDecision?.(...args) },
  }
  const code = ts.transpileModule(`${handler}\nhandleCreateDecision`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const submit = vm.runInNewContext(code, bindings)
  return { bindings, calls, errors, destinations, submit: () => submit({ preventDefault() {} }) }
}

test("two submit events in the same render make one request and successful navigation stays locked", async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const form = submission(() => pending)
  const first = form.submit()
  await form.submit()
  assert.equal(form.calls.length, 1)
  release({ id: 1 })
  await first
  await form.submit()
  assert.equal(form.calls.length, 1)
  assert.deepEqual(form.destinations, ["/dashboard/decisions"])
  assert.equal(form.bindings.submissionInFlight.current, true)
  assert.equal(form.calls[0][0].title, "Shift campaign budget")
})

test("an uncertain response can be retried with the original submission key", async () => {
  let attempt = 0
  const form = submission(() => {
    if (++attempt === 1) throw new Error("Response lost after saving")
    return { id: 1 }
  })
  await form.submit()
  assert.equal(form.bindings.submissionInFlight.current, false)
  assert.equal(form.errors.at(-1), "Response lost after saving")
  await form.submit()
  assert.equal(form.calls.length, 2)
  assert.equal(form.calls[0][3], form.calls[1][3])
  assert.match(form.calls[0][3], /^[0-9a-f-]{36}$/)
})

test("a deliberately changed action gets a new submission key", async () => {
  const form = submission(() => { throw new Error("Try again") })
  await form.submit()
  form.bindings.createDecisionAction = "Pause the campaign for one week"
  await form.submit()
  assert.notEqual(form.calls[0][3], form.calls[1][3])
})

test("report evidence is a draft payload, not a second decision creation", async () => {
  const form = submission()
  form.bindings.reportEvidence = { reportId: "report-1", report: { status: "ready" }, loadingReport: false }
  form.bindings.reportOutcomeMetric = { id: "1:orders" }
  form.bindings.reportOutcome = "1:orders"
  form.bindings.correlationRequest = async (_user, path, options) => {
    assert.equal(path, "/business-reports/report-1/decision-evidence")
    const fields = JSON.parse(options.body)
    return { decision_payload: { ...fields, dataset_id: 1, recommendation_context: '{"report_id":"report-1"}' } }
  }
  await form.submit()
  assert.equal(form.calls.length, 1)
  assert.equal(form.calls[0][0].title, "Shift campaign budget")
  assert.equal(form.calls[0][0].action, "Move 10% of budget to campaign B")
  assert.equal(form.calls[0][0].recommendation_context, '{"report_id":"report-1"}')
})

test("the API wrapper passes the submission key without dropping authorization or workspace headers", async () => {
  const source = functionSource("../lib/api.ts", "createDecision")
  let request
  const create = vm.runInNewContext(ts.transpileModule(`${source}\ncreateDecision`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    API_URL: "https://decisionate.test", cleanPositiveIntegerId: Number,
    decisionHeaders: async () => ({ Authorization: "Bearer test", "X-Workspace-Id": "workspace", "Content-Type": "application/json" }),
    apiFetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ id: 1 }) } },
  })
  await create({ dataset_id: 1, title: "Shift campaign budget" }, "owner", "workspace", "submission-key")
  assert.equal(request.options.headers["Idempotency-Key"], "submission-key")
  assert.equal(request.options.headers.Authorization, "Bearer test")
  assert.equal(request.options.headers["X-Workspace-Id"], "workspace")
  assert.equal(JSON.parse(request.options.body).title, "Shift campaign budget")
  await create({ dataset_id: 1 }, "owner", "workspace")
  assert.equal(request.options.headers["Idempotency-Key"], undefined)
})
