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
const hooks = { ...React, useEffect() {}, useState: initial => [initial?.columns ? {
  id: 7, columns: [{ column: "channel", label: "Channel" }, { column: "product", label: "Product" }],
} : initial, () => {}] }
const sources = load("../features/performance/amount-source.tsx", {
  react: hooks,
  "@/components/searchable-select": { SearchableSelect: () => null },
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: () => null },
  "@/lib/api": {},
  "./types": types,
})
const setupSources = { ...sources, useAmountDataset: () => ({ dataset: null, error: "" }),
  DatasetChoice: () => null, SourceDetails: () => null }
const { SingleDatasetSetup } = load("../features/performance/performance-setup.tsx", {
  "./types": types,
  "./amount-source": setupSources,
})
const { GrowthSetup } = load("../features/performance/growth-setup.tsx", {
  react: hooks,
  "@/lib/api": {},
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: () => null },
  "./amount-source": setupSources,
})
const context = { userId: "owner", workspaceId: "workspace" }
const render = node => renderToStaticMarkup(node)
function findGrouping(tree) {
  let grouping
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (node.type === sources.GroupChoice) grouping = node
    React.Children.forEach(node.props?.children, visit)
  }
  visit(tree)
  assert.ok(grouping)
  return grouping
}

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
    const grouping = findGrouping(tree)
    const control = sources.GroupChoice(grouping.props).props.children[0].props.children[1]
    assert.match(render(grouping), /<option value="channel" selected="">Channel<\/option>/)
    for (const [value, expected] of [["product", "product"], ["", null]]) {
      control.props.onChange({ target: { value } })
      assert.equal(changes.at(-1).group_column, expected)
      assert.deepEqual(changes.at(-1).items, definition.items)
    }
  }
})

test("Sales conversion uses the same result grouping wording and preserves saved choices", () => {
  for (const group_column of [null, "channel"]) {
    const definition = types.newPerformance("conversion")
    Object.assign(definition, { source: { dataset_id: 7, date_column: "date" }, group_column })
    const changes = []
    const tree = GrowthSetup({ definition, context, onChange: value => changes.push(value) })
    const html = render(tree)
    assert.match(html, /Show separate results for<select aria-label="Show separate results for"/)
    assert.match(html, group_column ? /<option value="channel" selected="">Channel<\/option>/ : /<option value="" selected="">All records combined<\/option>/)
    assert.doesNotMatch(html, /Compare by|Business total/)
    const grouping = findGrouping(tree)
    const control = sources.GroupChoice(grouping.props).props.children[0].props.children[1]
    for (const [value, expected] of [["product", "product"], ["", null]]) {
      control.props.onChange({ target: { value } })
      assert.equal(changes.at(-1).group_column, expected)
      assert.deepEqual(changes.at(-1).steps, definition.steps)
      assert.deepEqual(JSON.parse(JSON.stringify(changes.at(-1).source)), definition.source)
      assert.deepEqual(changes.at(-1).date_range, definition.date_range)
    }
  }
})
