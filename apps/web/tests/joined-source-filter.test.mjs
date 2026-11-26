import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript"), React = require("react")
const source = readFileSync(new URL("../features/dashboard/components/joined-source-filter.tsx", import.meta.url), "utf8")

test("Select Metrics can filter an original dataset using only the saved join definition", async () => {
  const values = [], refs = [], requests = [], applied = []
  let slot = 0, refSlot = 0
  const react = {
    ...React, useId: () => "source", useEffect: effect => effect(),
    useRef(initial) { return refs[refSlot++] ??= { current: initial } },
    useState(initial) {
      const index = slot++
      if (!(index in values)) values[index] = initial
      return [values[index], next => { values[index] = next }]
    },
  }
  const Filter = () => null
  const result = { derived_dataset_id: 32 }
  const compiledModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    module: compiledModule, exports: compiledModule.exports,
    require: name => name === "react" ? react : name === "@/app/use-decisionate-language"
      ? { useDecisionateText: () => ({ t: text => text }) } : name === "@/features/datasets/components/dimension-filter"
        ? { DatasetDimensionFilter: Filter } : name === "@/lib/api"
          ? { async createFilteredJoinCopy(...args) { requests.push(args); return result } } : require(name),
  })
  const advertisingFilter = { column: "country", values: ["CA"] }
  const datasetOptions = [{ id: 1, file_name: "Ads" }, { id: 2, file_name: "Sales" }, { id: 999, file_name: "Unrelated" }]
  const config = JSON.stringify({ join_definition: { selections: [
    { dataset_id: 1, dimension_filter: advertisingFilter }, { dataset_id: 2 },
  ] } })
  const sources = compiledModule.exports.getJoinedFilterSources(config, datasetOptions)
  assert.deepEqual(JSON.parse(JSON.stringify(sources)), [
    { id: 1, file_name: "Ads", filter: advertisingFilter }, { id: 2, file_name: "Sales" },
  ])
  function render() {
    slot = 0; refSlot = 0
    const elements = []
    function walk(node) {
      if (!React.isValidElement(node)) return
      elements.push(node)
      React.Children.forEach(node.props.children, walk)
    }
    walk(compiledModule.exports.JoinedSourceFilter({ datasetId: 30, sources, userId: "owner", workspaceId: "test", dashboardKey: "general-business", onJoined: value => applied.push(value) }))
    return {
      source: elements.find(node => node.type === "select").props,
      filter: elements.find(node => node.type === Filter).props,
      apply: elements.find(node => node.type === "button").props,
    }
  }
  assert.equal(render().filter.datasetId, 1)
  assert.equal(render().apply.disabled, true)
  render().source.onChange({ target: { value: "2" } })
  assert.equal(render().filter.datasetId, 2)
  render().filter.onChange({ column: "channel", values: [] })
  assert.equal(render().apply.disabled, true)
  const salesFilter = { column: "channel", values: ["Online"] }
  render().filter.onChange(salesFilter)
  assert.equal(render().apply.disabled, false)
  const apply = render().apply.onClick
  apply()
  apply()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), [30, "owner", "test", {
    source_dataset_id: 2, dimension_filter: salesFilter, dashboard_key: "general-business",
  }])
  assert.deepEqual(applied, [result])
})
