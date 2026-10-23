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

test("date range defaults span three total calendar years rather than adding history before the initial window", () => {
  const source = readFileSync(new URL("../features/datasets/components/data-source-connections.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("connections.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["formatDateInputValue", "subtractCalendarMonths", "getAdvancedSyncDateBounds"].includes(node.name?.text)).map(node => node.getText(ast)).join("\n")
  const bounds = vm.runInNewContext(ts.transpileModule(`${helpers}\ngetAdvancedSyncDateBounds`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)
  const today = new Date(), expected = new Date(today)
  expected.setDate(1)
  expected.setFullYear(today.getFullYear() - 3)
  expected.setDate(Math.min(today.getDate(), new Date(expected.getFullYear(), expected.getMonth() + 1, 0).getDate()))
  const minimum = [expected.getFullYear(), String(expected.getMonth() + 1).padStart(2, "0"), String(expected.getDate()).padStart(2, "0")].join("-")
  assert.equal(bounds({}).min, minimum)
  assert.equal(bounds({ initial_sync_days: 90, initial_backfill_months: 36 }).min, minimum)
  assert.equal(bounds({ initial_sync_days: 60, initial_backfill_months: 36 }).min, minimum)
  assert.equal(bounds({ source_type: "shopify", initial_sync_days: 90, initial_backfill_months: 36, initial_backfill_days: null, advanced_sync_max_days: null }).min, minimum)
  assert.equal(bounds({ initial_sync_earliest_date: "2025-01-01", initial_backfill_months: 24 }).min, minimum)
  assert.equal(bounds({ advanced_sync_max_days: 60 }).min, minimum)
  const serverWindow = bounds({ retention_start_date: "2021-02-28", retention_end_date: "2024-02-29" })
  assert.equal(serverWindow.min, "2021-02-28")
  assert.equal(serverWindow.max, "2024-02-29")
  assert.equal(serverWindow.defaultStart, "2024-02-28")
  assert.equal(bounds({ retention_start_date: "invalid", retention_end_date: "invalid" }).min, minimum)
})

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate))
  if (!React.isValidElement(node)) return []
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)]
}

function harness(sourceType = "meta_ads", connectionOverrides = {}) {
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
    ...connectionOverrides,
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
    statuses: () => elements(render(), node => node.props.role === "status").map(node => node.props.children),
  }
}

for (const sourceType of connectorTypes) {
  test(`${sourceType}: initial import progress defaults to 90 days`, () => {
    const view = harness(sourceType, { initial_sync_status: "initial", ingestion_job: { status: "running", job_type: "initial_connector_sync" } })
    assert.ok(view.statuses().some(text => typeof text === "string" && text.includes("most recent 90 days")))
  })

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

test("initial import progress respects an explicit server window during rolling deployment", () => {
  const view = harness("meta_ads", { initial_sync_status: "initial", initial_sync_days: 60, ingestion_job: { status: "running", job_type: "initial_connector_sync" } })
  assert.ok(view.statuses().some(text => typeof text === "string" && text.includes("most recent 60 days")))
})

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
