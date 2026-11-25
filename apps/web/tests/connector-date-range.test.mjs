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

function harness(sourceType = "meta_ads", connectionOverrides = {}, propsOverrides = {}) {
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
    ...propsOverrides,
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
    calls, panel, trigger, submit, fields, connection, render,
    open: () => trigger().props.onClick(),
    close: () => buttons().find(button => button.props["aria-label"] === "Close advanced date range"),
    focusCount: () => focusCount,
    alerts: () => elements(render(), node => node.props.role === "alert"),
    statuses: () => elements(render(), node => node.props.role === "status").map(node => node.props.children),
  }
}

test("automatic sync stays available without expanding every saved connection by default", () => {
  const view = harness("meta_ads", { sync_enabled: true }, {
    sources: [{ type: "meta_ads", status: "available", connection_type: "oauth", sync_modes: ["scheduled"] }],
    onUpdateSchedule: () => {},
  })
  const card = view.render()
  assert.equal(card.type, "article")
  const [schedule] = elements(card, node => node.type === "details")
  assert.equal(schedule.props.open, undefined)
  assert.match(schedule.props.children[0].props.children.join(" "), /Automatic sync/)
  assert.ok(elements(schedule, node => node.type === "button" && node.props.children === "Save schedule").length)
})

const noMetaData = "Meta Ads returned no records from 2023-11-07 through 2023-11-23. Verify that the connected account contains data in this range."

test("identical initial-import and job warnings are shown only once", () => {
  const view = harness("meta_ads", { initial_sync_message: noMetaData, ingestion_job: { status: "no_data", job_type: "initial_connector_backfill", error_message: noMetaData } })
  assert.equal(view.statuses().filter(message => message === noMetaData).length, 1)
  assert.equal(view.alerts().length, 0)
})

test("duplicate notices are compared after trimming whitespace", () => {
  const variant = noMetaData.replace("returned no records", "returned   no records").slice(0, -1)
  const view = harness("meta_ads", { initial_sync_message: ` ${noMetaData}\n`, ingestion_job: { status: "no_data", error_message: `\n${variant} ` } })
  assert.equal(view.statuses().filter(message => message === noMetaData).length, 1)
  assert.equal(view.statuses().length, 1)
})

test("different date-range warnings remain visible", () => {
  const otherRange = noMetaData.replace("2023-11-07 through 2023-11-23", "2026-10-01 through 2026-10-31")
  const view = harness("meta_ads", { initial_sync_message: noMetaData, ingestion_job: { status: "no_data", error_message: otherRange } })
  assert.ok(view.statuses().includes(noMetaData))
  assert.ok(view.statuses().includes(otherRange))
})

test("an initial warning is retained without a job and a job warning is retained without a summary", () => {
  for (const fields of [{ initial_sync_message: noMetaData }, { ingestion_job: { status: "no_data", error_message: noMetaData } }]) {
    assert.equal(harness("meta_ads", fields).statuses().filter(message => message === noMetaData).length, 1)
  }
})

test("repeated failure text remains a single accessible error, not a warning", () => {
  const message = "The import failed because the service is unavailable."
  const view = harness("meta_ads", { initial_sync_status: "failed", initial_sync_error: message, initial_sync_message: message, ingestion_job: { status: "failed", error_message: message } })
  assert.equal(view.alerts().filter(node => node.props.children === message).length, 1)
  assert.equal(view.statuses().includes(message), false)
})

test("different import failures are not removed", () => {
  const view = harness("meta_ads", { initial_sync_status: "failed", initial_sync_error: "The historical import failed.", ingestion_job: { status: "failed", error_message: "The latest sync failed." } })
  assert.deepEqual(view.alerts().map(node => node.props.children), ["The historical import failed.", "The latest sync failed."])
})

test("temporary feedback does not repeat an already-visible warning", () => {
  const view = harness("meta_ads", { initial_sync_message: noMetaData }, { connectionFeedback: { 1: { tone: "no_data", message: ` ${noMetaData} ` } } })
  assert.equal(view.statuses().filter(message => message === noMetaData).length, 1)
  assert.equal(view.statuses().length, 1)
})

test("distinct temporary feedback remains visible", () => {
  const view = harness("meta_ads", { initial_sync_message: noMetaData }, { connectionFeedback: { 1: { tone: "success", message: "Schedule saved." } } })
  assert.ok(view.statuses().includes(noMetaData))
  assert.ok(view.statuses().includes("Schedule saved."))
})

test("repeated temporary error feedback retains its alert severity", () => {
  const message = "The connection requires attention."
  const view = harness("meta_ads", { initial_sync_message: message }, { connectionFeedback: { 1: { tone: "error", message } } })
  assert.equal(view.alerts().filter(node => node.props.children === message).length, 1)
  assert.equal(view.statuses().includes(message), false)
})

test("range-sync and missing-detail no-data fallbacks remain available", () => {
  assert.ok(harness("meta_ads", { ingestion_job: { status: "no_data", job_type: "connector_range_sync" } }).statuses().includes("No data was returned for the latest import chunk."))
  assert.ok(harness("meta_ads", { ingestion_job: { status: "no_data" } }).statuses().includes("No meta_ads data was found for the selected period."))
})

test("a range-sync job displays the actual warning rather than repeating it as a generic warning", () => {
  for (const error_message of [noMetaData, undefined]) {
    const view = harness("meta_ads", { initial_sync_message: noMetaData, ingestion_job: { status: "no_data", job_type: "connector_range_sync", error_message } })
    assert.deepEqual(view.statuses(), [noMetaData])
  }
})

test("a reconnect error repeated by the job and action is displayed only as the authorization alert", () => {
  const message = "Access expired. Reconnect to import more data."
  const view = harness("meta_ads", {
    authorization_error: message,
    initial_sync_status: "failed",
    initial_sync_error: message,
    initial_sync_message: message,
    ingestion_job: { status: "failed", error_message: message },
  }, { connectionFeedback: { 1: { tone: "error", message } } })
  assert.equal(view.alerts().length, 1)
  assert.equal(elements(view.alerts()[0], node => node.props.children === message).length, 1)
  assert.equal(view.statuses().length, 0)
})

test("the card shows only the current stage of import or analysis", () => {
  const view = harness("meta_ads", {
    initial_sync_status: "initial", analysis_status: "running",
    ingestion_job: { status: "running", job_type: "initial_connector_sync" },
  })
  assert.equal(view.statuses().length, 1)
  assert.match(view.statuses()[0], /Initial import is running/)
  view.connection.initial_sync_status = "complete"
  view.connection.ingestion_job = { status: "queued", job_type: "manual_connector_sync" }
  assert.deepEqual(view.statuses(), ["Data ingestion is queued and will run in the background."])
  view.connection.ingestion_job = { status: "running", job_type: "connector_analysis" }
  assert.deepEqual(view.statuses(), ["Historical data is ready. Dataset analysis is running in the background."])
})

test("polling replaces the old job message without retaining duplicate notices", () => {
  const view = harness("meta_ads", { initial_sync_message: noMetaData, ingestion_job: { status: "no_data", error_message: noMetaData } })
  assert.equal(view.statuses().filter(message => message === noMetaData).length, 1)
  view.connection.initial_sync_message = undefined
  view.connection.ingestion_job = { status: "succeeded" }
  assert.equal(view.statuses().includes(noMetaData), false)
  view.connection.ingestion_job = { status: "no_data", error_message: noMetaData }
  assert.equal(view.statuses().filter(message => message === noMetaData).length, 1)
})

const notificationConnectors = JSON.parse(readFileSync(new URL(
  "../../../docs/knowledge-base/connector-catalog.json", import.meta.url
), "utf8")).sources.filter(source => source.connection_type !== "upload")

for (const source of notificationConnectors) {
  const props = { sources: [{
    type: source.type, label: source.label, status: "available",
    connection_type: source.connection_type, config_keys: [],
  }] }
  const message = `${source.label} returned no records from 2023-11-07 through 2023-11-23.`

  test(`${source.type}: repeated initial, job and temporary no-data notices appear once`, () => {
    const view = harness(source.type, {
      initial_sync_message: message,
      ingestion_job: { status: "no_data", job_type: "initial_connector_backfill", error_message: message },
    }, { ...props, connectionFeedback: { 1: { tone: "no_data", message } } })
    assert.equal(view.statuses().filter(text => text === message).length, 1)
    assert.equal(view.alerts().length, 0)
  })

  test(`${source.type}: repeated import failures remain one accessible error`, () => {
    const error = `${source.label} import failed. Please reconnect.`
    const view = harness(source.type, {
      initial_sync_status: "failed", initial_sync_message: error, initial_sync_error: error,
      ingestion_job: { status: "failed", error_message: error },
    }, { ...props, connectionFeedback: { 1: { tone: "error", message: error } } })
    assert.equal(view.alerts().filter(node => node.props.children === error).length, 1)
    assert.equal(view.statuses().includes(error), false)
  })

  test(`${source.type}: distinct results and temporary feedback remain visible`, () => {
    const other = `${source.label} returned no records from 2026-10-01 through 2026-10-31.`
    const view = harness(source.type, {
      initial_sync_message: message, ingestion_job: { status: "no_data", error_message: other },
    }, { ...props, connectionFeedback: { 1: { tone: "success", message: "Schedule saved." } } })
    assert.ok(view.statuses().includes(message))
    assert.ok(view.statuses().includes(other))
    assert.ok(view.statuses().includes("Schedule saved."))
  })
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

  test(`${sourceType}: a configured connector can sync a range without a successful first import`, () => {
    const view = harness(sourceType, { initial_sync_status: "failed" })
    view.open()
    assert.equal(view.submit().props.disabled, false)
    view.submit().props.onClick()
    assert.equal(view.calls.length, 1)
    assert.equal(view.calls[0].payload.advanced_date_range, true)
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

test("an active import does not hide the range or allow another sync to start", () => {
  for (const state of [
    { initial_sync_status: "pending" },
    { initial_sync_status: "initial" },
    { initial_sync_status: "backfill" },
    { ingestion_job: { status: "queued", job_type: "manual_connector_sync" } },
  ]) {
    const view = harness("meta_ads", state)
    view.open()
    assert.equal(view.submit().props.disabled, true)
    view.submit().props.onClick()
    assert.equal(view.calls.length, 0)
  }
})

test("an unconfigured or unavailable connector can open the date range but cannot sync it", () => {
  const views = [
    harness("meta_ads", { status: "needs_setup", has_config: false }),
    harness("lightspeed_k", {}, { sources: [{ type: "lightspeed_k", status: "planned", connection_type: "oauth" }] }),
  ]
  for (const view of views) {
    view.open()
    assert.equal(view.fields().length, 2)
    assert.equal(view.submit().props.disabled, true)
    view.submit().props.onClick()
    assert.equal(view.calls.length, 0)
  }
})

test("a viewer without sync permission has no advanced date range action", () => {
  assert.equal(harness("meta_ads", {}, { onSyncConnection: undefined }).trigger(), undefined)
})

function connectionsPage(access, { api = {}, browser = {} } = {}) {
  const page = readFileSync(new URL("../app/dashboard/connections/page.tsx", import.meta.url), "utf8")
  const compiled = ts.transpileModule(page, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loaded = { exports: {} }
  const ConnectionList = () => null
  const calls = []
  const state = []
  let cursor = 0
  const stubs = {
    react: { ...React, useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next }]
    }, useEffect: () => {} },
    "@clerk/nextjs": { useUser: () => ({ user: { id: "test-user" } }) },
    "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: "test-workspace" }) },
    "@/lib/use-workspace-access": { useWorkspaceAccess: () => access },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
    "@/features/dashboard/components/dashboard-page-header": { DashboardPageHeader: () => null },
    "@/features/datasets/components/data-source-connections": { DataSourceConnections: ConnectionList },
    "@/features/datasets/components/data-source-panel": { DataSourcePanel: () => null },
    "@/lib/api": {
      syncDataSourceConnection: async (...args) => {
        calls.push(args)
        return { status: "queued", job_id: "test-job" }
      },
      getDataSourceConnections: async () => [],
      ...api,
    },
  }
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, require: name => stubs[name] ?? require(name), window: browser,
  })
  function render() {
    cursor = 0
    const content = loaded.exports.default()
    return content.type(content.props)
  }
  return { render, calls, ConnectionList, Sources: stubs["@/features/datasets/components/data-source-panel"].DataSourcePanel }
}

test("Connections uses the workspace data permission for sync without granting setup access", async () => {
  for (const canConfigureWorkspace of [true, false]) {
    const { render, calls, ConnectionList } = connectionsPage({ canConfigureWorkspace, canManageWorkspaceData: true, canViewConnections: true })
    const [list] = elements(render(), node => node.type === ConnectionList)
    assert.equal(typeof list.props.onSyncConnection, "function")
    assert.equal(Boolean(list.props.onConfigureConnection), canConfigureWorkspace)
    await list.props.onSyncConnection({ id: 1 }, { advanced_date_range: true })
    assert.deepEqual(calls.at(-1), [1, "test-user", "test-workspace", { advanced_date_range: true }])
  }
  const { render, ConnectionList } = connectionsPage({ canConfigureWorkspace: false, canManageWorkspaceData: false, canViewConnections: true })
  const [list] = elements(render(), node => node.type === ConnectionList)
  assert.equal(list.props.onSyncConnection, undefined)
})

test("adding the first connection opens setup and removing the last returns to sources", async () => {
  const connection = { id: 1, display_name: "Shopify", source_type: "shopify" }
  let records = []
  const { render, Sources, ConnectionList } = connectionsPage({ canConfigureWorkspace: true, canManageWorkspaceData: true, canViewConnections: true }, {
    api: {
      createDataSourceConnection: async () => { records = [connection]; return connection },
      deleteDataSourceConnection: async () => { records = [] },
      getDataSourceConnections: async () => records,
    },
    browser: { location: { hash: "" }, history: { replaceState() {} }, confirm: () => true },
  })
  function tabs() { return elements(render(), node => node.type === "a").map(node => [node.props.href, node.props["aria-current"]]) }
  function panelFor(href) {
    const tree = render()
    const [tab] = elements(tree, node => node.type === "a" && node.props.href === href)
    assert.equal(elements(tree, node => node.props.id === href.slice(1)).length, 0, "Tabs must not trigger native fragment scrolling")
    return elements(tree, node => node.props.id === tab.props["aria-controls"])[0]
  }
  assert.deepEqual(tabs(), [["#connection-sources", "location"]])
  await elements(render(), node => node.type === Sources)[0].props.onCreateConnection({ type: "shopify", label: "Shopify" })
  assert.deepEqual(tabs(), [["#connection-sources", undefined], ["#saved-connections", "location"]])
  assert.equal(panelFor("#saved-connections").props.hidden, false)
  await elements(render(), node => node.type === ConnectionList)[0].props.onDeleteConnection(connection)
  assert.deepEqual(tabs(), [["#connection-sources", "location"]])
  assert.equal(panelFor("#connection-sources").props.hidden, false)
})

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
