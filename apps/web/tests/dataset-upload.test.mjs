import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const source = read("../lib/api.ts")
const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true)
const names = new Set(["ApiError", "uploadDataset", "getDataIngestionJob", "waitForDataIngestionJob"])
const apiCode = ast.statements.filter(node => names.has(node.name?.text) || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ["datasetUploadRequestTimeoutMs", "datasetUploadMaxBytes"].includes(item.name.getText(ast)))).map(node => node.getText(ast)).join("\n")
function load(code, globals = {}, dependencies = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, Error, ...globals,
    require: name => dependencies[name] ?? require(name) })
  return loaded.exports
}
function api(handler) {
  const requests = [], invalidations = []
  let now = 0
  const client = load(apiCode, { FormData, API_URL: "https://api.example.test", Date: { now: () => now },
    window: { setTimeout: (callback, milliseconds) => { now += milliseconds; callback(); return 1 } },
    workspaceHeaders: async (user, workspace) => ({ "X-User": user, "X-Workspace": workspace }),
    getWorkspaceCacheIdentity: (user, workspace) => `${user}:${workspace}`,
    invalidateApiReadCache: prefixes => invalidations.push(...prefixes),
    apiFetch: async (url, options, timeoutMs) => { requests.push({ url, options, timeoutMs }); return handler({ url, options, timeoutMs }, requests.length) },
    throwApiError: async response => { throw new client.ApiError(response.message || "Rejected", response.status) },
  })
  return { ...client, requests, invalidations, advance: milliseconds => { now += milliseconds } }
}
const response = value => ({ ok: true, json: async () => value })

test("file transfer gets five minutes while retaining workspace headers, multipart and a single POST", async () => {
  const client = api(() => response({ status: "queued", job_id: 7 }))
  const file = new File(["date,revenue\n2026-11-05,50\n"], "sales.csv", { type: "text/csv" })
  assert.equal((await client.uploadDataset(file, "owner", "workspace")).job_id, 7)
  assert.equal(client.requests.length, 1)
  const request = client.requests[0]
  assert.equal(request.timeoutMs, 300000)
  assert.equal(request.options.method, "POST")
  assert.equal(request.options.headers["X-Workspace"], "workspace")
  assert.equal(request.options.headers["Content-Type"], undefined)
  assert.equal(request.options.body.get("file").name, "sales.csv")
  assert.equal(await request.options.body.get("file").text(), await file.text())
  assert.equal(client.invalidations.length, 4)
})

test("an uncertain upload is never automatically submitted a second time", async () => {
  const client = api(() => { throw new Error("Request timed out") })
  await assert.rejects(client.uploadDataset(new File(["a\n1"], "sales.csv"), "owner"), /Check the dataset list before uploading this file again/)
  assert.equal(client.requests.length, 1)
  assert.equal(client.invalidations.length, 0)
})

test("server validation errors retain their useful details and status", async () => {
  const client = api(() => ({ ok: false, status: 413, message: "Uploaded file exceeds the 100 MB import limit." }))
  await assert.rejects(client.uploadDataset(new File(["a\n1"], "sales.csv"), "owner"), error => error.status === 413 && /100 MB/.test(error.message))
  assert.equal(client.requests.length, 1)
})

test("empty and oversized files are rejected before sending any bytes", async () => {
  const client = api(() => { throw new Error("Should not upload") })
  await assert.rejects(client.uploadDataset(new File([], "empty.csv"), "owner"), /file is empty/)
  await assert.rejects(client.uploadDataset({ size: 100 * 1024 * 1024 + 1 }, "owner"), /100 MB/)
  assert.equal(client.requests.length, 0)
})

test("invalid or truncated upload confirmations cannot be mistaken for a completed import", async () => {
  for (const payload of [null, {}, { status: "queued" }, { status: "queued", job_id: 0 }, { status: "queued", job_id: "7" }, { status: "queued", job_id: -1 }, { status: "queued", job_id: 1.5 }]) {
    const client = api(() => response(payload))
    await assert.rejects(client.uploadDataset(new File(["a\n1"], "sales.csv"), "owner"), /upload could not be confirmed/)
    assert.equal(client.invalidations.length, 0)
  }
  const client = api(() => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected end of JSON") } }))
  await assert.rejects(client.uploadDataset(new File(["a\n1"], "sales.csv"), "owner"), /upload could not be confirmed/)
  assert.equal(client.requests.length, 1)
})

test("a completed import invalidates the workspace dataset list again, after processing", async () => {
  const client = api(() => response({ id: 7, status: "succeeded" }))
  await client.waitForDataIngestionJob(7, "owner", "workspace")
  assert.deepEqual(Array.from(client.invalidations), ["datasets:owner:workspace"])
})

test("temporary status-read failures retry only the same job, then finish normally", async () => {
  for (const status of [undefined, 408, 429, 503]) {
    let client
    client = api((request, count) => {
      if (count === 1) {
        if (status) throw new client.ApiError("Temporarily unavailable", status)
        throw new Error("Read timed out")
      }
      return response({ id: 7, status: count === 2 ? "running" : "succeeded" })
    })
    assert.equal((await client.waitForDataIngestionJob(7, "owner", "workspace")).status, "succeeded")
    assert.equal(client.requests.length, 3)
    assert.ok(client.requests.every(request => request.url.endsWith("/ingestion-jobs/7") && !request.options.method && request.options.cache === "no-store"))
  }
})

test("permanent authorization and missing-job errors stop without retries", async () => {
  for (const status of [400, 401, 403, 404, 410]) {
    let client
    client = api(() => { throw new client.ApiError("Cannot read this job", status) })
    await assert.rejects(client.waitForDataIngestionJob(7, "owner"), error => error.status === status)
    assert.equal(client.requests.length, 1)
  }
})

test("a real failed import is not hidden by status-read recovery", async () => {
  const client = api(() => response({ id: 7, status: "failed", error_message: "The file contains no rows." }))
  await assert.rejects(client.waitForDataIngestionJob(7, "owner"), /file contains no rows/)
  assert.equal(client.requests.length, 1)
})

test("repeated status-read failures explain that receipt is confirmed but completion is not", async () => {
  const client = api(() => { throw new Error("Read timed out") })
  await assert.rejects(client.waitForDataIngestionJob(7, "owner"), /Your file was received, but its import status could not be confirmed/)
  assert.equal(client.requests.length, 3)
})

test("polling remains bounded and tells the user to check for completion rather than re-upload", async () => {
  let client
  client = api(() => { client.advance(600001); return response({ id: 7, status: "running" }) })
  await assert.rejects(client.waitForDataIngestionJob(7, "owner"), /Check the dataset list again shortly/)
  assert.equal(client.requests.length, 1)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
function view(upload, wait) {
  const state = [], calls = []
  let cursor = 0, successes = 0
  const { CsvUpload } = load(read("../features/datasets/components/csv-upload.tsx"), {}, {
    react: { ...React, useState(initial) { const index = cursor++; state[index] ??= typeof initial === "function" ? initial() : initial
      return [state[index], next => { state[index] = next }] }, useRef(initial) { const index = cursor++; return state[index] ??= { current: initial } } },
    "@clerk/nextjs": { useUser: () => ({ user: { id: "owner" } }) },
    "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: "workspace" }) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
    "@/lib/api": { uploadDataset: (...args) => { calls.push(args); return upload(...args) }, waitForDataIngestionJob: wait },
  })
  function tree() { cursor = 0; return CsvUpload({ onUploadSuccess: async () => { successes++ } }) }
  function find(node, predicate) {
    if (!React.isValidElement(node)) return undefined
    if (predicate(node)) return node
    return React.Children.toArray(node.props.children).map(child => find(child, predicate)).find(Boolean)
  }
  return { calls, successes: () => successes, html: () => renderToStaticMarkup(tree()),
    start(file) { const input = find(tree(), node => node.type === "input"); const target = { files: [file], value: file.name }; input.props.ref.current = target
      return input.props.onChange({ target }) } }
}

test("upload and preparation are distinct states, with success shown only after job completion", async () => {
  const transfer = deferred(), preparation = deferred()
  const component = view(() => transfer.promise, () => preparation.promise)
  const pending = component.start(new File(["a\n1"], "shopify.csv"))
  assert.match(component.html(), /Uploading data file/)
  assert.match(component.html(), /shopify.csv/)
  assert.doesNotMatch(component.html(), /Uploaded File/)
  transfer.resolve({ status: "queued", job_id: 7 })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(component.html(), /Preparing your dataset/)
  assert.doesNotMatch(component.html(), /Uploaded File/)
  preparation.resolve({ id: 7, status: "succeeded" })
  await pending
  assert.equal(component.successes(), 1)
  assert.match(component.html(), /Uploaded File/)
})

test("uncertain status keeps the affected filename without falsely labelling the import as successful", async () => {
  const component = view(async () => ({ status: "queued", job_id: 7 }), async () => { throw new Error("Import status could not be confirmed") })
  await component.start(new File(["a\n1"], "shopify.csv"))
  assert.match(component.html(), /role="alert"/)
  assert.match(component.html(), /shopify.csv/)
  assert.doesNotMatch(component.html(), /Uploaded File/)
  assert.equal(component.calls.length, 1)
  assert.equal(component.successes(), 0)
})

test("the file picker rejects ZIP bundles without sending them to the API", async () => {
  const component = view(async () => { throw new Error("Should not upload") }, async () => {})
  await component.start(new File(["ZIP"], "datasets.zip"))
  assert.match(component.html(), /This file format is not supported/)
  assert.match(component.html(), /datasets.zip/)
  assert.equal(component.calls.length, 0)
})
