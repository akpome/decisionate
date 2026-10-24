import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let sharingEffect
function findSharingEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("getDatasetShareStatus(")) sharingEffect = node.arguments[0]
  ts.forEachChild(node, findSharingEffect)
}
findSharingEffect(ast)
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
function harness() {
  assert.ok(sharingEffect)
  const loaded = { exports: {} }, requests = [], state = { enabled: false, loading: false }
  vm.runInNewContext(ts.transpileModule(`export function begin(selectedDatasetId, userId, activeWorkspaceId, selectedDashboard, canConfigureWorkspace) { return (${sharingEffect.getText(ast)})() }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded, exports: loaded.exports, queueMicrotask,
    setShareEnabled: value => { state.enabled = value }, setShareStatusLoading: value => { state.loading = value },
    getDatasetShareStatus: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
  })
  return { ...loaded.exports, requests, state }
}

test("dashboard chart loading does not wait for optional sharing metadata", () => {
  const groups = []
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "Promise.allSettled") groups.push(node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const core = groups.find(text => text.includes("getDatasetDetails("))
  assert.ok(core)
  assert.match(core, /getDatasetPreference\(/)
  assert.match(core, /getDatasetJoinCache\(/)
  assert.doesNotMatch(core, /getDatasetShareStatus\(/)
})

test("the independent share lookup is scoped and disabled while status or data is pending", () => {
  const start = source.indexOf("if (!selectedDatasetId || !userId || !canConfigureWorkspace) return")
  assert.ok(start > 0)
  const lookup = source.slice(start, source.indexOf("useEffect", start))
  assert.match(lookup, /getDatasetShareStatus\(selectedDatasetId, userId, activeWorkspaceId, selectedDashboard\)/)
  assert.match(lookup, /if \(isCurrent\) setShareEnabled/)
  assert.match(lookup, /if \(isCurrent\) setShareStatusLoading\(false\)/)
  assert.match(lookup, /return \(\) => \{ isCurrent = false \}/)
  const guard = source.slice(source.indexOf("const shareControlsDisabled"), source.indexOf("const stopSharingDisabled"))
  assert.match(guard, /loading \|\|/)
  assert.match(guard, /shareStatusLoading \|\|/)
})

test("old sharing responses cannot overwrite the current dataset or workspace status", async () => {
  const h = harness()
  const first = h.begin(1, "owner", "workspace-a", "general-business", true)
  await flush()
  assert.equal(h.state.loading, true)
  first()
  h.begin(2, "owner", "workspace-b", "sales-performance", true)
  await flush()
  assert.deepEqual(h.requests.map(request => request.args), [[1, "owner", "workspace-a", "general-business"], [2, "owner", "workspace-b", "sales-performance"]])
  h.requests[1].resolve({ share_enabled: false })
  await flush()
  assert.deepEqual(h.state, { enabled: false, loading: false })
  h.requests[0].resolve({ share_enabled: true })
  await flush()
  assert.deepEqual(h.state, { enabled: false, loading: false })
})

test("sharing failures release pending controls without failing the data load", async () => {
  const h = harness()
  h.begin(1, "owner", "workspace", "general-business", true)
  await flush()
  h.requests[0].reject(new Error("Unavailable"))
  await flush()
  assert.deepEqual(h.state, { enabled: false, loading: false })
})

test("sharing metadata is not requested without a dataset, user or configuration access", async () => {
  const h = harness()
  for (const args of [[undefined, "owner", "workspace", "general-business", true], [1, undefined, "workspace", "general-business", true], [1, "owner", "workspace", "general-business", false]]) h.begin(...args)
  await flush()
  assert.deepEqual(h.requests, [])
  assert.deepEqual(h.state, { enabled: false, loading: false })
})
