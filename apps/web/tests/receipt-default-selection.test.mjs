import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const page = readFileSync(new URL("../app/dashboard/datasets/[id]/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const selectionFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getSelectedMetricColumns")
assert.ok(selectionFunction, "Test the page's actual selection resolver")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(`export ${selectionFunction.getText(ast)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: loaded, exports: loaded.exports })
const getSelectedMetricColumns = loaded.exports.getSelectedMetricColumns

test("effective server selection wins over broad historical curated selections", () => {
  const effective = ["quantity", "line_total"]
  const result = getSelectedMetricColumns({
    selected_metric_columns: effective,
    metric_selection_configured: true,
    metric_profile: {
      recommended_metric_columns: effective,
      curated_recommendations: { savedSelection: ["quantity", "line_total", ...Array.from({ length: 40 }, (_, i) => `internal_${i}`)] },
    },
  })
  assert.equal(result, effective)
})

test("an effective empty selection stays empty even if raw saved metrics exist", () => {
  const effective = []
  assert.equal(getSelectedMetricColumns({ selected_metric_columns: effective, metric_profile: {
    curated_recommendations: { savedSelection: ["balance", "inventory_count"] },
  } }), effective)
})

test("unconfigured datasets use recommendations, not a stale curated saved list", () => {
  const recommended = ["quantity"]
  assert.equal(getSelectedMetricColumns({ metric_selection_configured: false, metric_profile: {
    recommended_metric_columns: recommended, curated_recommendations: { savedSelection: ["internal_count"] },
  } }), recommended)
})

test("reset asks the server to select defaults instead of recording a manual override", () => {
  const reset = page.slice(page.indexOf("async function handleResetMetricSelection"), page.indexOf("async function handleUnselectAllMetricSelection"))
  assert.match(reset, /saveMetricSelection\(defaultColumns, metricObjective, true\)/)
  const save = page.slice(page.indexOf("async function handleSaveMetricSelection"), page.indexOf("async function handleResetMetricSelection"))
  assert.match(save, /saveMetricSelection\(selectedMetricColumns\)/)
})
