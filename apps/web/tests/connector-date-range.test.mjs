import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const React = require("react")
const ts = require("typescript")
const { outputText } = ts.transpileModule(readFileSync(new URL(
  "../features/datasets/components/data-source-connections.tsx", import.meta.url
), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
})
const connectorTypes = [
  "google_analytics", "google_search_console", "google_ads", "google_business_profile",
  "hubspot", "stripe", "shopify", "square", "woocommerce", "lightspeed", "lightspeed_x",
  "lightspeed_k", "lightspeed_o", "meta_ads", "quickbooks", "freshbooks", "sage", "xero",
  "zoho_books", "salesforce", "postgresql", "mysql", "sql_server",
]

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate))
  if (!React.isValidElement(node)) return []
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)]
}

function harness(sourceType = "meta_ads") {
  let hooks = [], cursor = 0, focusCount = 0
  const parentHooks = [], rowHooks = [], calls = []
  const loaded = { exports: {} }
  const dependencies = {
    react: {
      ...React,
      useState(initial) {
        const store = hooks, index = cursor++
        if (!(index in store)) store[index] = typeof initial === "function" ? initial() : initial
        return [store[index], value => { store[index] = typeof value === "function" ? value(store[index]) : value }]
      },
      useRef(initial) {
        const index = cursor++
        return hooks[index] ??= { current: initial }
      },
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": require("lucide-react"),
    "next/link": { default: props => React.createElement("a", props) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
  }
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports,
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  const connection = {
    id: 1, source_type: sourceType, source_label: sourceType, display_name: sourceType,
    status: "connected", has_config: true, initial_sync_status: "complete",
    configured_config_keys: loaded.exports.REQUIRED_CONNECTION_CONFIG_KEYS[sourceType] ?? [],
  }
  const props = {
    connections: [connection],
    sources: [{ type: sourceType, status: "available", config_keys: [], connection_type: "oauth" }],
    onSyncConnection: (item, payload) => {
      calls.push({ connection: item, payload })
      return new Promise(() => {})
    },
  }
  function render() {
    hooks = parentHooks
    cursor = 0
    const parent = loaded.exports.DataSourceConnections(props)
    const row = parent.props.children[0]
    hooks = rowHooks
    cursor = 0
    const tree = row.type(row.props)
    const trigger = elements(tree, node => node.type === "button" && "aria-expanded" in node.props)[0]
    if (trigger) trigger.props.ref.current = { focus: () => focusCount++ }
    return tree
  }
  const buttons = () => elements(render(), node => node.type === "button")
  const panel = () => elements(render(), node => node.props.role === "group")[0]
  const trigger = () => buttons().find(button => "aria-expanded" in button.props)
  const submit = () => buttons().find(button => button.props.children === "Sync selected range")
  const fields = () => elements(render(), node => node.type === "input" && node.props.type === "date")
  return {
    calls, panel, trigger, submit, fields,
    open: () => trigger().props.onClick(),
    close: () => buttons().find(button => button.props["aria-label"] === "Close advanced date range"),
    focusCount: () => focusCount,
    alerts: () => elements(render(), node => node.props.role === "alert"),
  }
}

for (const sourceType of connectorTypes) {
  test(`${sourceType}: date range has an accessible close button and preserves dates when reopened`, () => {
    const view = harness(sourceType)
    view.open()
    const dates = view.fields().map(field => field.props.value)
    const close = view.close()
    assert.equal(close.props.type, "button")
    assert.equal(close.props.title, "Close advanced date range")
    assert.equal(view.trigger().props["aria-controls"], view.panel().props.id)
    close.props.onClick()
    assert.equal(view.panel(), undefined)
    assert.equal(view.trigger().props["aria-expanded"], false)
    assert.equal(view.focusCount(), 1)
    assert.equal(view.calls.length, 0)
    view.open()
    assert.deepEqual(view.fields().map(field => field.props.value), dates)
  })

  test(`${sourceType}: submitting a valid range closes immediately without waiting for the sync`, () => {
    const view = harness(sourceType)
    view.open()
    const [from, to] = view.fields().map(field => field.props.value)
    assert.equal(view.submit().props.disabled, false)
    view.submit().props.onClick()
    assert.equal(view.panel(), undefined)
    assert.equal(view.focusCount(), 1)
    assert.equal(view.calls.length, 1)
    const { connection, payload } = view.calls[0]
    assert.equal(connection.source_type, sourceType)
    assert.equal(payload.advanced_date_range, true)
    assert.equal(payload.start_date, from)
    assert.equal(payload.end_date, to)
    view.open()
    assert.deepEqual(view.fields().map(field => field.props.value), [from, to])
  })
}

test("Escape dismisses the range and returns focus to its trigger without syncing", () => {
  const view = harness()
  view.open()
  let stopped = false
  view.panel().props.onKeyDown({ key: "Escape", stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true)
  assert.equal(view.panel(), undefined)
  assert.equal(view.focusCount(), 1)
  assert.equal(view.calls.length, 0)
})

for (const invalidRange of ["missing", "reversed", "too old", "future"]) {
  test(`${invalidRange} dates keep the range open with validation feedback`, () => {
    const view = harness()
    view.open()
    const [from, to] = view.fields()
    if (invalidRange === "missing") from.props.onChange({ target: { value: "" } })
    if (invalidRange === "reversed") {
      from.props.onChange({ target: { value: to.props.value } })
      to.props.onChange({ target: { value: from.props.value } })
    }
    if (invalidRange === "too old") from.props.onChange({ target: { value: "1900-01-01" } })
    if (invalidRange === "future") to.props.onChange({ target: { value: "9999-12-31" } })
    view.submit().props.onClick()
    assert.ok(view.panel())
    assert.equal(view.alerts().length, 1)
    assert.equal(view.calls.length, 0)
    assert.equal(view.focusCount(), 0)
    view.close().props.onClick()
    view.open()
    assert.equal(view.alerts().length, 0)
  })
}
