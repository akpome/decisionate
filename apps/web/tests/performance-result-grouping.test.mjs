import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const React = require("react")
const ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
function load(path, dependencies = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: loadedModule, exports: loadedModule.exports, require: name => dependencies[name] ?? require(name) })
  return loadedModule.exports
}
const types = load("../features/performance/types.ts")
const sources = load("../features/performance/amount-source.tsx", {
  react: { ...React, useEffect() {}, useState: initial => [initial?.columns ? {
    id: 7, columns: [{ column: "channel", label: "Channel" }, { column: "product", label: "Product" }],
  } : initial, () => {}] },
  "@/components/searchable-select": { SearchableSelect: () => null },
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: () => null },
  "@/lib/api": {},
  "./types": types,
})
const { SingleDatasetSetup } = load("../features/performance/performance-setup.tsx", {
  "./types": types,
  "./amount-source": { ...sources, useAmountDataset: () => ({ dataset: null, error: "" }),
    DatasetChoice: () => null, SourceDetails: () => null },
})
const context = { userId: "owner", workspaceId: "workspace" }
const render = node => renderToStaticMarkup(node)

test("Return on spend and Profitability use explicit result grouping labels", () => {
  for (const kind of ["return", "profit"]) {
    const definition = types.newPerformance(kind)
    definition.items[0].revenue.dataset_id = 7
    const html = render(React.createElement(SingleDatasetSetup, { definition, context, onChange() {} }))
    assert.match(html, /Show separate results for<select aria-label="Show separate results for"/)
    assert.match(html, /<option value="" selected="">All records combined<\/option>/)
    assert.match(html, /<option value="channel">Channel<\/option>/)
    assert.doesNotMatch(html, /Compare by|Business total/)
  }
})

test("renaming the field preserves saved categories and clearing restores the overall total", () => {
  for (const kind of ["return", "profit"]) {
    const definition = types.newPerformance(kind)
    definition.items[0].revenue.dataset_id = 7
    definition.group_column = "channel"
    const changes = []
    const tree = SingleDatasetSetup({ definition, context, onChange: value => changes.push(value) })
    let grouping
    function visit(node) {
      if (!node || typeof node !== "object") return
      if (node.type === sources.GroupChoice) grouping = node
      React.Children.forEach(node.props?.children, visit)
    }
    visit(tree)
    assert.ok(grouping)
    const control = sources.GroupChoice(grouping.props).props.children[0].props.children[1]
    assert.match(render(grouping), /<option value="channel" selected="">Channel<\/option>/)
    for (const [value, expected] of [["product", "product"], ["", null]]) {
      control.props.onChange({ target: { value } })
      assert.equal(changes.at(-1).group_column, expected)
      assert.deepEqual(changes.at(-1).items, definition.items)
    }
  }
})

test("Sales conversion keeps its existing grouping labels", () => {
  const html = render(React.createElement(sources.GroupChoice, { datasetId: 7, value: null, context, onChange() {} }))
  assert.match(html, /Compare by<select aria-label="Compare by"/)
  assert.match(html, /<option value="" selected="">Business total<\/option>/)
  assert.doesNotMatch(html, /Show separate results for|All records combined/)
})
