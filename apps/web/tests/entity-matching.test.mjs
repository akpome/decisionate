import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/entity-matching/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const stateNames = []
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useState") stateNames.push(node.name.elements[0].name.getText(ast))
  ts.forEachChild(node, walk)
}
walk(ast)
const datasets = [1, 2].map(id => ({ id, file_name: `source-${id}.csv`, source_type: "csv", row_count: 3 }))
const metadata = datasets.map(item => ({ dataset_id: item.id, columns: ["email", "date", "revenue"],
  metric_columns: ["revenue"], default_metric_columns: ["revenue"], default_key_columns: ["email"], date_columns: ["date"], default_date_column: "date" }))
const preview = { output_format: "linked_history", datasets: [], candidate_row_count: 6, matched_group_count: 2, matched_row_count: 6, unmatched_row_count: 0,
  review_group_count: 1, review_groups: [{ canonical_key: "weak", review_key: "weak", display_name: "Sam", confidence: .75, match_count: 2,
    sources: [{ dataset_id: 1, file_name: "a", row: 1, keys: ["name:sam"] }, { dataset_id: 2, file_name: "b", row: 1, keys: ["name:sam"] }] }] }

function harness(updates = {}, canManage = true) {
  const states = { datasets, selectedIds: [1, 2], columnMetadata: metadata, selectedKeyColumns: { 1: ["email"], 2: ["email"] },
    selectedMetricColumns: { 1: ["revenue"], 2: ["revenue"] }, dateColumns: { 1: "date", 2: "date" }, loading: false, ...updates }
  let cursor = 0
  const writes = [], loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: loaded, exports: loaded.exports, require: name => {
      if (name === "react") return { ...React, useEffect() {}, useMemo: fn => fn(), useState: initial => {
        const key = stateNames[cursor++]; if (!(key in states)) states[key] = initial
        return [states[key], value => { states[key] = typeof value === "function" ? value(states[key]) : value }]
      } }
      if (name === "@clerk/nextjs") return { useUser: () => ({ user: { id: "owner" } }) }
      if (name === "@/lib/use-active-workspace") return { useActiveWorkspace: () => ({ activeWorkspaceId: "owner", workspaceVersion: 0 }) }
      if (name === "@/lib/use-workspace-access") return { useWorkspaceAccess: () => ({ canManageWorkspaceData: canManage, loadingWorkspaceAccess: false }) }
      if (name === "@/app/use-decisionate-language") return { useDecisionateText: () => ({ t: value => value }) }
      if (name === "@/lib/api") return {
        previewEntityMatching: async payload => { writes.push(payload); return updates.apiPreview ?? preview },
        runEntityMatching: async payload => { writes.push(payload); return { canonical_entity_count: 1, source_row_count: 6, unified_dataset_row_count: 6, unified_dataset_name: "linked.parquet" } },
      }
      if (name === "next/link") return { __esModule: true, default: "a" }
      if (name.includes("dashboard-page-header")) return { DashboardPageHeader: () => null }
      if (name.includes("workspace-access-notice")) return { WorkspaceAccessNotice: () => null }
      return require(name)
    },
  })
  function tree() { cursor = 0; return loaded.exports.default().type() }
  function nodes(predicate) {
    const found = []
    function visit(element) {
      if (Array.isArray(element)) return element.forEach(visit)
      if (!element?.props) return
      if (predicate(element)) found.push(element)
      visit(element.props.children)
    }
    visit(tree()); return found
  }
  const text = value => typeof value === "string" ? value : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : ""
  const button = label => nodes(element => element.type === "button" && text(element) === label)[0]
  return { states, writes, nodes, button }
}

test("linked history can only be saved after preview and dates accompany each request", async () => {
  const h = harness()
  assert.equal(h.button("Save linked history"), undefined)
  await h.button("Preview matches").props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(h.button("Save linked history"))
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].date_columns)), { 1: "date", 2: "date" })
  assert.deepEqual(Array.from(h.states.approvedMatches), [])
})

test("date changes invalidate the preview and previous result", () => {
  const h = harness({ preview, result: null })
  h.nodes(element => element.props["aria-label"] === "source-1.csv record date column")[0].props.onChange({ target: { value: "date" } })
  assert.equal(h.states.preview, null)
  assert.equal(h.states.result, null)
  assert.equal(h.button("Save linked history"), undefined)
})

test("uncertain matches are opt-in and the summary is independently optional", async () => {
  const h = harness({ preview, approvedMatches: ["weak"], includeSummary: true })
  await h.button("Save linked history").props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(Array.from(h.writes[0].approved_match_keys), ["weak"])
  assert.equal(h.writes[0].include_summary, true)
  assert.equal(h.writes[0].replace_existing, true)
})

test("read-only access and incomplete metadata disable preview", () => {
  assert.equal(harness({}, false).button("Preview matches").props.disabled, true)
  assert.equal(harness({ columnMetadata: [] }).button("Preview matches").props.disabled, true)
  assert.equal(harness({ preview }, false).button("Save linked history").props.disabled, true)
})

test("oversized uncertain groups cannot be approved from a partial preview", () => {
  const h = harness({ preview: { ...preview, review_groups: [{ ...preview.review_groups[0], match_count: 21 }] } })
  const inputs = h.nodes(element => element.type === "input" && element.props.type === "checkbox")
  assert.ok(inputs.some(input => input.props.disabled === true && input.props.checked === false))
})

test("an older API cannot silently save a collapsed summary", async () => {
  const h = harness({ preview, apiPreview: { ...preview, output_format: undefined } })
  await h.button("Preview matches").props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.button("Save linked history"), undefined)
  assert.match(h.states.error, /API version/)
})
