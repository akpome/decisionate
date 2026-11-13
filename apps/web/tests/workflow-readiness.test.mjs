import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
function load(path, imports = {}) {
  const loaded = { exports: {} }
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module: loaded, exports: loaded.exports, require: name => imports[name] ?? require(name) })
  return loaded.exports
}
const Select = () => null
function selector(props = {}, auth = true) {
  const changes = []
  const { DatasetSelector } = load("../features/dashboard/components/dataset-selector.tsx", {
    react: { ...React, useEffect() {}, useState: value => [value, () => {}] },
    "@clerk/nextjs": { useAuth: () => ({ isLoaded: true, isSignedIn: auth, userId: auth ? "owner" : undefined }), useUser: () => ({ user: auth ? { id: "owner" } : null }) },
    "next/link": { default: "a" }, "@/lib/api": {},
    "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: "workspace" }) },
    "@/features/datasets/lib/source-config": { getDatasetSourceDetails: () => ({ label: "Uploaded CSV" }) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
    "@/components/searchable-select": { SearchableSelect: Select },
  })
  const tree = DatasetSelector({ datasets: [{ id: 4, file_name: "Shop sales" }, { id: 8, file_name: "Advertising" }], onChange: value => changes.push(value), ...props })
  return { control: tree.props.children.find(child => child?.type === Select), changes }
}
test("dashboard and forecast selectors keep exact dataset IDs while offering one searchable field", () => {
  const h = selector({ value: 8, ariaLabel: "Forecast dataset" })
  assert.equal(h.control.props.value, "8")
  assert.equal(h.control.props.label, "Forecast dataset")
  assert.equal(h.control.props.hideLabel, true)
  assert.equal(h.control.props.selectedLabel, "Advertising (Uploaded CSV)")
  h.control.props.onChange("4")
  h.control.props.onChange("")
  h.control.props.onChange("invalid")
  assert.deepEqual(h.changes, [4, undefined, undefined])
  assert.equal(h.control.props.options[0].value, "")
  assert.equal(selector({ value: 8, allowClear: false }).control.props.options.some(option => option.value === ""), false)
})
test("dataset loading, unavailable data and sign-in are distinct states", () => {
  assert.equal(selector({ datasets: [], loading: true }).control.props.disabled, true)
  assert.equal(selector({ loading: true, value: 4 }).control.props.disabled, false)
  assert.equal(selector({ loadError: true, datasets: [] }).control.props.placeholder, "Datasets unavailable")
  assert.equal(selector({ datasets: [] }).control.props.placeholder, "No datasets available")
  assert.equal(selector({}, false).control.props.placeholder, "Sign in to load datasets")
})

const decisionSource = readFileSync(new URL("../app/dashboard/decisions/new/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("decision.tsx", decisionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let declaration
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "decisionSetupIssue") declaration = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
function decisionIssue(patch = {}) {
  return vm.runInNewContext(ts.transpileModule(`${declaration}\ndecisionSetupIssue()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    selectedFindingId: "", findingDraft: null, reportEvidence: { reportId: "report", report: { status: "ready" }, loadingReport: false },
    reportOutcomeMetric: "revenue", createDatasetId: "4", createDecisionTitle: "Pricing test", createDecisionAction: "Test a new price",
    createDecisionExpectedOutcome: "Increase revenue", createDecisionDescription: "The report suggests testing price sensitivity.", createDecisionReviewDate: "2026-12-01", ...patch,
  })
}
test("decision creation gives the next missing requirement and keeps report evidence safeguards", () => {
  assert.equal(decisionIssue(), "")
  for (const [patch, expected] of [
    [{ createDecisionTitle: " " }, /name/], [{ createDecisionAction: "" }, /action/],
    [{ createDecisionExpectedOutcome: "" }, /expect/], [{ createDecisionDescription: "" }, /why/],
    [{ createDecisionReviewDate: "" }, /review/], [{ reportOutcomeMetric: "" }, /measure/],
    [{ reportEvidence: { reportId: "report", loadingReport: true } }, /Loading/],
    [{ reportEvidence: { reportId: "report", report: { status: "insufficient_data" } } }, /available report/],
    [{ selectedFindingId: "finding", findingDraft: { existingDecisionId: 9 } }, /already/],
    [{ selectedFindingId: "missing", findingDraft: null }, /recommendation/],
    [{ reportEvidence: {}, createDatasetId: "" }, /dataset/],
  ]) assert.match(decisionIssue(patch), expected)
  assert.equal(decisionIssue({ reportEvidence: {}, createDecisionDescription: "", createDecisionReviewDate: "" }), "")
  assert.match(decisionSource, /if \(setupIssue\) \{ setCreateDecisionError\(setupIssue\); return \}/)
})
