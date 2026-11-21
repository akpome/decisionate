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
const GroupFilter = () => null
const { SingleDatasetSetup } = load("../features/performance/performance-setup.tsx", {
  "./types": types,
  "./amount-source": setupSources,
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: GroupFilter },
})
const { GrowthSetup } = load("../features/performance/growth-setup.tsx", {
  react: hooks,
  "@/lib/api": {},
  "@/features/datasets/components/dimension-filter": { DatasetDimensionFilter: () => null },
  "./amount-source": setupSources,
})
const context = { userId: "owner", workspaceId: "workspace" }
const render = node => renderToStaticMarkup(node)
function findControl(tree, type) {
  let control
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (node.type === type) control = node
    React.Children.forEach(node.props?.children, visit)
  }
  visit(tree)
  return control
}

function findGrouping(tree) {
  const grouping = findControl(tree, sources.GroupChoice)
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

test("the grouped Return on spend filter restores saved values and preserves other dataset filters", () => {
  const definition = types.newPerformance("return")
  definition.items[0].revenue.dataset_id = 7
  definition.items[0].revenue.dimension_filter = { column: "region", values: ["East"] }
  assert.equal(findControl(SingleDatasetSetup({ definition, context, onChange() {} }), GroupFilter), undefined)
  definition.group_column = "channel"
  definition.group_filter = { column: "channel", values: ["Search"] }
  const changes = []
  const tree = SingleDatasetSetup({ definition, context, onChange: value => changes.push(value) })
  const filter = findControl(tree, GroupFilter)
  assert.equal(filter.props.fixedColumn, "channel")
  assert.equal(filter.props.datasetId, 7)
  assert.deepEqual(filter.props.value, definition.group_filter)

  const selected = { column: "channel", values: ["Search", "Display"] }
  filter.props.onChange(selected)
  assert.deepEqual(changes.at(-1).group_filter, selected)
  assert.deepEqual(changes.at(-1).items, definition.items)
  filter.props.onChange(undefined)
  assert.equal(changes.at(-1).group_filter, undefined)
  assert.equal(changes.at(-1).group_column, "channel")
  findGrouping(tree).props.onChange("product")
  assert.equal(changes.at(-1).group_filter, undefined)
  assert.equal(changes.at(-1).group_column, "product")
  const profit = { ...definition, kind: "profit", group_filter: undefined }
  assert.equal(findControl(SingleDatasetSetup({ definition: profit, context, onChange() {} }), GroupFilter), undefined)
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
