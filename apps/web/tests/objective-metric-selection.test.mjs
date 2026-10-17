import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/datasets/[id]/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = []
function visit(node) {
  if (ts.isFunctionDeclaration(node)) declarations.push(node)
  ts.forEachChild(node, visit)
}
visit(ast)
const handler = declarations.find(node => node.name?.text === "handleObjectiveChange")
assert.ok(handler)

test("objective changes request fresh defaults without resubmitting old selections", async () => {
  const calls = []
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`export ${handler.getText(ast)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    module: loaded, exports: loaded.exports,
    saveMetricSelection: async (...args) => calls.push(args),
  })
  await loaded.exports.handleObjectiveChange("reduce_expenses")
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[[], "reduce_expenses", true]])
})

test("failed objective saves do not relabel the previous selection as the new objective", async () => {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`export ${handler.getText(ast)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    module: loaded, exports: loaded.exports,
    setMetricObjective: () => assert.fail("The acknowledged save owns objective state"),
    saveMetricSelection: async () => { throw new Error("offline") },
  })
  await assert.rejects(loaded.exports.handleObjectiveChange("cash_flow"), /offline/)
})

test("the business objective remains available with either metric picker", () => {
  const start = source.indexOf('{dataset.metric_profile && (')
  const objectivePanel = source.slice(start, source.indexOf('Recommended:', start))
  assert.match(objectivePanel, /Business objective/)
  assert.match(objectivePanel, /handleObjectiveChange\(event.target.value\)/)
  assert.doesNotMatch(objectivePanel, /!showCuratedPicker/)
})
