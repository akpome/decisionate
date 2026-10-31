import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
class AnalysisFailedError extends Error {
  constructor(message, retrySafe) { super(message); this.retrySafe = retrySafe }
}
const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let declaration
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "sendWeeklyNow") declaration = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)

function harness(overrides = {}) {
  const calls = [], errors = [], state = {}
  const requestKey = { current: null }, action = { current: false }
  const handler = vm.runInNewContext(ts.transpileModule(`${declaration}\nsendWeeklyNow`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    weekly: true, canManage: true, busy: false, previewDisabled: false, weeklyDirty: false, weeklySendIssue: "", uncertainDelivery: false, report: null,
    AnalysisFailedError,
    managementAction: action, weeklySendRequest: requestKey, routeController: { current: null },
    pagePath: "/dashboard/reports/weekly", encodeURIComponent,
    window: { location: { pathname: "/dashboard/reports/weekly", search: "" }, history: { replaceState: (...args) => { state.url = args[2] } } },
    crypto: { randomUUID: () => "owner-request" },
    execute: async fn => { try { await fn() } catch (error) { errors.push(error.message) } },
    persistWeeklySettings: async () => calls.push(["settings"]),
    request: async (path, init) => { calls.push([path, init]); return { job_id: "send-job", kind: "weekly_owner_send", status: "queued" } },
    waitForAnalysis: async () => ({ status: "sent", delivered_count: 1 }),
    setAnalysisJob: value => { state.job = value }, setMessage: value => { state.message = value },
    setReport: () => { throw new Error("A send must not replace the report preview") }, ...overrides,
  })
  return { handler, calls, errors, state, requestKey, action }
}

test("manual weekly sends save pending settings and target the owner without client recipient input", async () => {
  const { handler, calls, state, requestKey } = harness({ weeklyDirty: true })
  await handler()
  assert.equal(calls[0][0], "settings")
  assert.equal(calls[1][0], "/weekly-owner-jobs?include_ai_analysis=true")
  assert.equal(calls[1][1].method, "POST")
  assert.equal(calls[1][1].body, undefined)
  assert.equal(calls[1][1].headers["Idempotency-Key"], "owner-request")
  assert.match(state.message, /workspace owner/)
  assert.equal(requestKey.current, null)
  assert.equal(state.url, "/dashboard/reports/weekly")
})

test("read-only, nonweekly, incomplete, busy and repeated send clicks cannot queue duplicates", async () => {
  for (const overrides of [{ weekly: false }, { canManage: false }, { busy: true }, { previewDisabled: true }, { weeklySendIssue: "No data this week" }, { uncertainDelivery: true }]) {
    const { handler, calls } = harness(overrides)
    await handler()
    assert.equal(calls.length, 0)
  }
  const { handler, calls } = harness()
  await Promise.all([handler(), handler(), handler()])
  assert.equal(calls.length, 1)
})

test("a confirmed failure before sending releases the request key for a deliberate fresh attempt", async () => {
  let attempts = 0
  const { handler, errors, requestKey } = harness({
    waitForAnalysis: async () => { if (++attempts === 1) throw new AnalysisFailedError("No current-week coverage", true); return { status: "sent" } },
  })
  await handler()
  assert.equal(requestKey.current, null)
  await handler()
  assert.deepEqual(errors, ["No current-week coverage"])
  assert.equal(attempts, 2)
})

test("a failure after delivery could have started preserves duplicate-send protection", async () => {
  const { handler, requestKey } = harness({ waitForAnalysis: async () => { throw new AnalysisFailedError("Check delivery history", false) } })
  await handler()
  assert.equal(requestKey.current, "owner-request")
})

test("successful retries return to the report rather than an earlier failed delivery job", async () => {
  for (const [report, expected] of [[{ report_id: "saved-report" }, "?report=saved-report"],
    [{ analysis_job_id: "preview-job" }, "?job=preview-job"], [null, ""]]) {
    const { handler, state } = harness({ report, window: {
      location: { pathname: "/dashboard/reports/weekly", search: "?job=earlier-failed-send" },
      history: { replaceState: (_value, _unused, value) => { state.url = value } },
    } })
    await handler()
    assert.equal(state.url, "/dashboard/reports/weekly" + expected)
    assert.match(state.message, /sent to the workspace owner/)
  }
})

test("uncertain status reads preserve the same idempotency key on a deliberate retry", async () => {
  let attempts = 0
  const { handler, calls, errors, requestKey } = harness({
    waitForAnalysis: async () => { if (++attempts === 1) throw new Error("Connection lost"); return { status: "sent" } },
  })
  await handler()
  assert.equal(requestKey.current, "owner-request")
  await handler()
  assert.deepEqual(errors, ["Connection lost"])
  assert.deepEqual(calls.map(call => call[1].headers["Idempotency-Key"]), ["owner-request", "owner-request"])
})

test("send controls and grouping labels are specific to the weekly page", () => {
  assert.match(source, /weekly && canManage && <button[^>]*[\s\S]*?Send report now/)
  assert.match(source, /Report week: daily detail/)
  assert.match(source, /Earlier history: grouped weekly/)
  assert.match(source, /\["weekly_send", "weekly_owner_send"\].includes\(analysisJob.kind\) && analysisJob.phase === "sending"/)
  assert.match(source, /const deliveryNotStarted = .*retry_safe === true/)
  assert.match(source, /\{deliveryNotStarted && <p role="status"[^>]*>Report preparation stopped before email delivery started\. No email was sent\./)
})

test("coverage feedback blocks a current empty week without shifting it to historical file dates", () => {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/reports/weekly-settings.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, require: () => ({ editableDefinition: value => value }) })
  const window = { start: "2026-10-19", end: "2026-10-25" }
  const report = { weekly_report: true, window, status: "limited_coverage", dataset_count: 0 }
  const issue = loaded.exports.weeklyDeliveryIssue(report, window)
  assert.match(issue, /2026-10-19 to 2026-10-25/)
  assert.match(issue, /Analysis/)
  assert.equal(loaded.exports.weeklyDeliveryIssue({ ...report, status: "ready", dataset_count: 2 }, window), "")
  assert.equal(loaded.exports.weeklyDeliveryIssue(null, window), "")
  assert.equal(loaded.exports.weeklyDeliveryIssue({ ...report, window: { start: "2025-01-01", end: "2025-01-07" } }, window), "")
  assert.match(source, /\{weeklySendIssue && <p role="status"/)
})
