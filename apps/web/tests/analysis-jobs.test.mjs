import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/reports/analysis-jobs.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports, DOMException,
  setTimeout: callback => setTimeout(callback, 0), clearTimeout })
const { waitForAnalysis, analysisPhaseLabel, AnalysisUnavailableError, AnalysisFailedError } = loaded.exports

test("report polling retrieves the frozen result without resubmitting analysis", async () => {
  const calls = [], progress = []
  const states = [{ status: "queued", phase: "queued" }, { status: "running", phase: "computing" },
    { status: "succeeded", phase: "completed", result: { metrics: ["selected"] } }]
  const result = await waitForAnalysis(async (path, init) => {
    calls.push(path); assert.equal(init.method, undefined); return states.shift()
  }, "job-1", { onUpdate: job => progress.push(job.phase) })
  assert.deepEqual(Array.from(result.metrics), ["selected"])
  assert.deepEqual(calls, ["/jobs/job-1", "/jobs/job-1", "/jobs/job-1"])
  assert.deepEqual(progress, ["queued", "computing", "completed"])
})

test("failed and cancelled jobs stop polling with useful feedback", async () => {
  for (const status of ["failed", "cancelled"]) {
    await assert.rejects(waitForAnalysis(async () => ({ status, phase: status, error: "Your selections remain available" }), "job-1"), /selections remain/)
  }
})

test("terminal failures expose only explicit server approval for retrying a send", async () => {
  for (const retry of [true, false, undefined]) {
    await assert.rejects(waitForAnalysis(async () => ({ status: "failed", phase: "failed", error: "Delivery failed", retry_safe: retry }), "send-1"),
      error => error instanceof AnalysisFailedError && error.retrySafe === (retry === true))
  }
})

test("deleted or expired analysis links stop immediately with availability feedback", async () => {
  for (const status of [404, 410]) {
    let calls = 0
    await assert.rejects(waitForAnalysis(async () => {
      calls++; throw Object.assign(new Error("Analysis job not found"), { status })
    }, "deleted-job"), error => error instanceof AnalysisUnavailableError && error.status === status && /deleted or expired/.test(error.message))
    assert.equal(calls, 1)
  }
})

test("saved reports remain the only report history selector without background job-history reads", () => {
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /Saved reports<select/)
  assert.doesNotMatch(source, /Recent analyses|Choose an analysis|recentJobs|analysisHistoryReload|visibleAnalysisJobs|deletedJobs/)
  assert.doesNotMatch(source, /"\/business-reports\/jobs"/)
})

test("unmount aborts local polling without cancelling durable computation", async () => {
  const controller = new AbortController()
  let requests = 0
  await assert.rejects(waitForAnalysis(async () => {
    requests++; controller.abort(); return { status: "queued", phase: "queued" }
  }, "job-1", { signal: controller.signal }), error => error.name === "AbortError")
  assert.equal(requests, 1)
})

test("temporary status-read errors retry reads but never submit another job", async () => {
  let calls = 0
  const result = await waitForAnalysis(async () => {
    if (++calls < 3) throw new Error("Disconnected")
    return { status: "succeeded", result: "original result", phase: "completed" }
  }, "original-job")
  assert.equal(calls, 3)
  assert.equal(result, "original result")
})

test("progress has readable phase labels and snapshot saving uses the completed job", () => {
  assert.equal(analysisPhaseLabel("computing"), "Analyzing selected data")
  const source = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /\/jobs\/\$\{encodeURIComponent\(report.analysis_job_id\)\}\/save/)
  assert.match(source, /params.get\("job"\)/)
  assert.match(source, /Cancel analysis/)
  assert.doesNotMatch(source, /request<BusinessReport>\("\/preview"/)
})

test("rate limiting delays status reads while revoked access stops immediately", async () => {
  let calls = 0
  assert.equal(await waitForAnalysis(async () => {
    if (++calls <= 4) throw Object.assign(new Error("Wait"), { status: 429 })
    return { status: "succeeded", result: "same job", phase: "completed" }
  }, "job-1"), "same job")
  calls = 0
  await assert.rejects(waitForAnalysis(async () => {
    calls++; throw Object.assign(new Error("Access revoked"), { status: 403 })
  }, "job-1"), /Access revoked/)
  assert.equal(calls, 1)
})
