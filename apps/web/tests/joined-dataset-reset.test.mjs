import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/dashboard/components/dataset-join-panel.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("join-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate) {
  let found
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit) }
  visit(ast)
  assert.ok(found)
  return found
}
const resetSource = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "resetJoinedDataset").getText(ast)
const toggleSource = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "toggleDataset").getText(ast)
const compile = (code, globals) => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
  target: ts.ScriptTarget.ES2022,
} }).outputText, globals)
const joined = { derived_dataset_id: 30, derived_dataset: { id: 30 }, dataset_ids: [1, 2] }
function harness(overrides = {}) {
  const requests = [], updates = [], notifications = []
  const context = {
    activeResult: joined, savedJoinResult: null, joinedDatasetId: undefined, selectedDatasetId: 1,
    selectedDatasetIds: [1, 2], dashboardKey: "business", userId: "owner", workspaceId: "workspace", t: value => value,
    joining: false, resetting: false, error: "", Error,
    configurations: { 1: { dataset_id: 1, date_column: "date", metric_columns: ["revenue"] }, 2: { dataset_id: 2 } },
    setResetting: value => { context.resetting = value }, setError: value => { context.error = value },
    updateJoinResult: (value, deletedDatasetId) => { updates.push(value); notifications.push([value, deletedDatasetId]); context.activeResult = value },
    setSelectedDatasetIds: value => { context.selectedDatasetIds = value },
    setConfigurations: update => { context.configurations = update(context.configurations) },
    setMetadata: value => { context.metadata = value },
    setSavedJoinResult: value => { context.savedJoinResult = value },
    deleteDataset: async (...args) => { requests.push({ kind: "dataset", args }) },
    deleteDatasetJoinCache: async (...args) => { requests.push({ kind: "cache", args }); return { deleted: true } },
    ...overrides,
  }
  context.resetResult = context.activeResult ?? context.savedJoinResult
  context.canResetJoin = Boolean(context.joinedDatasetId || context.resetResult)
  const handlers = compile(`${resetSource}\n${toggleSource}\n({ resetJoinedDataset, toggleDataset })`, context)
  return { context, requests, updates, notifications, reset: handlers.resetJoinedDataset, toggle: handlers.toggleDataset }
}

test("reset deletes the generated dataset, not an original source or just its dashboard cache", async () => {
  const h = harness()
  await h.reset()
  assert.deepEqual(h.requests, [{ kind: "dataset", args: [30, "owner", "workspace"] }])
  assert.deepEqual(h.updates, [null])
  assert.deepEqual(h.notifications, [[null, 30]])
  assert.equal(h.context.resetting, false)
  assert.deepEqual(Array.from(h.context.selectedDatasetIds), [1])
  assert.deepEqual(Object.keys(h.context.configurations), ["1"])
  assert.equal(h.context.configurations[1].date_column, "date")
  assert.equal(h.context.metadata.length, 0)
})

test("a stored dataset summary also identifies the generated dataset when the top-level ID is absent", async () => {
  const h = harness({ activeResult: { ...joined, derived_dataset_id: undefined } })
  await h.reset()
  assert.equal(h.requests[0].kind, "dataset")
  assert.equal(h.requests[0].args[0], 30)
})

test("legacy joins without a generated dataset still use the dashboard cache reset", async () => {
  const h = harness({ activeResult: { dataset_ids: [1, 2] } })
  await h.reset()
  assert.deepEqual(h.requests, [{ kind: "cache", args: [1, "business", "owner", "workspace"] }])
  assert.deepEqual(h.updates, [null])
})

test("reset retains the saved join identity after the preview has been cleared by an edit", async () => {
  for (const overrides of [{ activeResult: null, savedJoinResult: joined }, { activeResult: null, joinedDatasetId: 30 }]) {
    const h = harness(overrides)
    assert.equal(await h.reset(), true)
    assert.deepEqual(h.requests, [{ kind: "dataset", args: [30, "owner", "workspace"] }])
    assert.deepEqual(h.notifications, [[null, 30]])
    assert.equal(h.context.savedJoinResult, null)
  }
})

test("removing the last joined source deletes the generated dataset before clearing the join", async () => {
  const h = harness()
  await h.toggle(2)
  assert.deepEqual(h.requests, [{ kind: "dataset", args: [30, "owner", "workspace"] }])
  assert.deepEqual(h.notifications, [[null, 30]])
  assert.deepEqual(Array.from(h.context.selectedDatasetIds), [1])
})

test("a failed unjoin preserves the selected sources and the saved join", async () => {
  const h = harness({ deleteDataset: async () => { throw new Error("Deletion was rejected") } })
  await h.toggle(2)
  assert.deepEqual(h.context.selectedDatasetIds, [1, 2])
  assert.equal(h.context.activeResult, joined)
  assert.deepEqual(h.updates, [])
  assert.equal(h.context.error, "Deletion was rejected")
})

test("editing a multi-source draft does not delete a join until only one source remains", async () => {
  const h = harness({ selectedDatasetIds: [1, 2, 3] })
  await h.toggle(3)
  assert.deepEqual(Array.from(h.context.selectedDatasetIds), [1, 2])
  assert.equal(h.requests.length, 0)
  await h.toggle(2)
  assert.equal(h.requests[0].kind, "dataset")
})

test("an unconfirmed cache reset is never displayed as a successful unjoin", async () => {
  const h = harness({ activeResult: { dataset_ids: [1, 2] }, deleteDatasetJoinCache: async () => ({ deleted: false }) })
  assert.equal(await h.reset(), false)
  assert.match(h.context.error, /saved join could not be found/)
  assert.deepEqual(h.updates, [])
})

test("a legacy reset reports the dataset deleted by the server so the selector can remove it", async () => {
  const h = harness({ activeResult: { dataset_ids: [1, 2] }, deleteDatasetJoinCache: async () => ({ deleted: true, deleted_dataset_id: 30 }) })
  await h.reset()
  assert.deepEqual(h.notifications, [[null, 30]])
})

test("reset keeps the joined view until deletion succeeds and blocks duplicate actions while pending", async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const h = harness({ deleteDataset: () => pending })
  const reset = h.reset()
  assert.equal(h.context.resetting, true)
  assert.equal(h.context.activeResult, joined)
  assert.equal(h.updates.length, 0)
  await h.reset()
  assert.equal(h.updates.length, 0)
  finish()
  await reset
  assert.deepEqual(h.updates, [null])
  assert.equal(h.context.resetting, false)
})

test("failed deletion preserves the joined data, selections and error details", async () => {
  for (const legacy of [false, true]) {
    const fail = async () => { throw new Error("An import is active. Wait for it to finish before deleting data.") }
    const h = harness({ activeResult: legacy ? { dataset_ids: [1, 2] } : joined, deleteDataset: fail, deleteDatasetJoinCache: fail })
    const original = h.context.activeResult
    await h.reset()
    assert.equal(h.context.activeResult, original)
    assert.equal(h.context.error, "An import is active. Wait for it to finish before deleting data.")
    assert.equal(h.context.resetting, false)
    assert.equal(h.updates.length, 0)
    assert.deepEqual(Object.keys(h.context.configurations), ["1", "2"])
  }
})

test("missing authentication, missing selection and an active join cannot start deletion", async () => {
  for (const overrides of [{ userId: undefined }, { selectedDatasetId: undefined }, { joining: true }, { resetting: true }]) {
    const h = harness(overrides)
    await h.reset()
    assert.equal(h.requests.length, 0)
    assert.equal(h.updates.length, 0)
  }
})

test("join and reset buttons are disabled during deletion and reset exposes its busy state", () => {
  for (const handler of ["handleJoin()", "resetJoinedDataset()"]) {
    const button = find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "button" &&
      node.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.text === "onClick" && property.getText(ast).includes(handler)))
    const disabled = button.attributes.properties.find(property => property.name?.text === "disabled").initializer.expression.getText(ast)
    assert.equal(compile(disabled, { joining: false, resetting: true, loadingMetadata: false, selectedDatasetIds: [1, 2] }), true)
    if (handler === "resetJoinedDataset()") {
      assert.equal(button.attributes.properties.find(property => property.name?.text === "aria-busy").initializer.expression.getText(ast), "resetting")
    }
  }
})
