import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
function load(source, globals = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loadedModule, exports: loadedModule.exports, require, URLSearchParams, ...globals })
  return loadedModule.exports
}
const { ForecastBasis } = load(readFileSync(new URL("../features/dashboard/components/forecast-basis.tsx", import.meta.url), "utf8"))
const basis = {
  requested: true, status: "applied", seasonalities: ["weekly", "annual"], lookback_years: 3,
  history_start: "2023-10-18", history_end: "2026-10-18", observations: 1097,
  validation_method: "rolling_origin", validation_horizon: 7, warnings: [],
}
const render = value => renderToStaticMarkup(React.createElement(ForecastBasis, { basis: value }))

test("forecast basis discloses actual history, seasonal patterns and past-only validation", () => {
  const html = render(basis)
  for (const value of ["Seasonal patterns applied", "2023-10-18", "2026-10-18", "1,097 observations", "maximum 3 years", "weekly + annual", "Past-only validation / up to 7 periods ahead"]) assert.ok(html.includes(value), value)
  assert.match(html, /aria-label="Forecast basis"/)
  assert.doesNotMatch(html, /confidence interval|Create decision/)
})

test("unsupported, insufficient and disabled seasonality are distinct outcomes", () => {
  for (const [status, title] of [["insufficient_history", "Insufficient seasonal history"], ["not_supported", "Seasonal adjustment not supported by validation"], ["not_requested", "Non-seasonal forecast"]]) {
    const html = render({ ...basis, status, seasonalities: [], warnings: ["Annual history is insufficient."] })
    assert.ok(html.includes(title))
    assert.match(html, /Annual history is insufficient/)
    assert.doesNotMatch(html, /Calendar patterns:/)
  }
  assert.equal(render(undefined), "")
})

test("forecast warnings are escaped rather than rendered as markup", () => {
  const html = render({ ...basis, warnings: ["<script>unsafe</script>"] })
  assert.match(html, /&lt;script&gt;unsafe/)
  assert.doesNotMatch(html, /<script>/)
})

const apiSource = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8")
const ast = ts.createSourceFile("api.ts", apiSource, ts.ScriptTarget.Latest, true)
const forecastFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getForecast")
const metricsFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getDatasetMetrics")
const apiErrorClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "ApiError")
const { ApiError } = load(apiErrorClass.getText(ast))
const { ApiReadCache } = load(readFileSync(new URL("../lib/api-read-cache.ts", import.meta.url), "utf8"))
function client(legacy = false) {
  const requests = [], cache = new ApiReadCache()
  let legacyResponse = legacy
  const { getForecast, getDatasetMetrics } = load([forecastFunction.getText(ast), metricsFunction.getText(ast)].join("\n"), {
    ApiError,
    API_URL: "https://sample.test", cleanPositiveIntegerId: value => value,
    getWorkspaceCacheIdentity: (user, workspace) => `${user}:${workspace}`,
    workspaceHeaders: async (user, workspace) => ({ "X-User": user, "X-Workspace": workspace }),
    getCachedRead: (key, loader) => cache.get(key, loader, 10000),
    apiFetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({ url,
      dimension_filter: legacyResponse || !init.body ? null : JSON.parse(init.body),
      forecast: { date_column: legacyResponse ? "date" : new URL(url).searchParams.get("date_column") || "date",
        ...legacyResponse ? {} : { seasonality: { requested: new URL(url).searchParams.get("seasonal_business") === "true" } } },
    }) } },
  })
  return { getForecast, getDatasetMetrics, requests, setLegacyResponse: value => { legacyResponse = value } }
}

test("date selections are sent to the forecast API and isolated in its cache", async () => {
  const { getForecast, requests } = client()
  for (const dateColumn of [undefined, "date", "paid_date", "paid_date"]) {
    const result = await getForecast(1, "alice", "revenue", "workspace", { dateColumn })
    assert.equal(result.forecast.date_column, dateColumn || "date")
  }
  assert.equal(requests.length, 3)
  assert.equal(new URL(requests[0].url).searchParams.has("date_column"), false)
  assert.equal(new URL(requests[2].url).searchParams.get("date_column"), "paid_date")
})

test("an API that ignores a date selection is rejected and can recover after upgrade", async () => {
  const { getForecast, requests, setLegacyResponse } = client(true)
  await assert.rejects(getForecast(1, "alice", "revenue", "workspace", { dateColumn: "paid_date" }), error => error.status === 503)
  setLegacyResponse(false)
  const result = await getForecast(1, "alice", "revenue", "workspace", { dateColumn: "paid_date" })
  assert.equal(result.forecast.date_column, "paid_date")
  assert.equal(requests.length, 2)
})

test("date metadata uses the existing metric request with a distinct cache entry", async () => {
  const { getDatasetMetrics, requests } = client()
  await getDatasetMetrics(1, "alice", "workspace")
  await getDatasetMetrics(1, "alice", "workspace", true)
  await getDatasetMetrics(1, "alice", "workspace", true)
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[0].url).search, "")
  assert.equal(new URL(requests[1].url).searchParams.get("include_dates"), "true")
})

test("forecast query sends seasonality explicitly and keeps ordinary controls", async () => {
  const { getForecast, requests } = client()
  await getForecast(1, "alice", " revenue ", "workspace", { seasonalBusiness: true, aggregation: "daily", aggregationType: "sum", startDate: "2025-01-01", periodFilter: "1y" })
  const params = new URL(requests[0].url).searchParams
  assert.equal(params.get("seasonal_business"), "true")
  for (const [key, value] of [["metric", "revenue"], ["aggregation", "daily"], ["aggregation_type", "sum"], ["start_date", "2025-01-01"], ["period_filter", "1y"]]) assert.equal(params.get(key), value)
  assert.equal(requests[0].init.headers["X-Workspace"], "workspace")
})

test("seasonal cache entries cannot replace non-seasonal or other-workspace forecasts", async () => {
  const { getForecast, requests } = client()
  const off = await getForecast(1, "alice", "revenue", "first")
  const on = await getForecast(1, "alice", "revenue", "first", { seasonalBusiness: true })
  assert.notDeepEqual(off, on)
  await getForecast(1, "alice", "revenue", "second", { seasonalBusiness: true })
  await getForecast(1, "alice", "revenue", "first", { seasonalBusiness: true })
  await getForecast(1, "alice", "revenue", "first", { seasonalBusiness: false })
  assert.equal(requests.length, 3)
  assert.equal(new URL(requests[0].url).searchParams.get("seasonal_business"), "false")
})

test("an older API cannot silently satisfy a seasonal request with a non-seasonal forecast", async () => {
  const { getForecast } = client(true)
  await assert.rejects(getForecast(1, "alice", "revenue", "workspace", { seasonalBusiness: true }), error => error instanceof ApiError && error.status === 503 && /temporarily unavailable/.test(error.message))
  assert.ok(await getForecast(1, "alice", "revenue", "workspace", { seasonalBusiness: false }))
})

test("Retry can recover the same cached seasonal request after the API is upgraded", async () => {
  const { getForecast, requests, setLegacyResponse } = client(true)
  await assert.rejects(getForecast(1, "alice", "revenue", "workspace", { seasonalBusiness: true }), /temporarily unavailable/)
  setLegacyResponse(false)
  const result = await getForecast(1, "alice", "revenue", "workspace", { seasonalBusiness: true })
  assert.equal(result.forecast.seasonality.requested, true)
  assert.equal(requests.length, 2)
})

test("dimension filters are posted without changing metric, date, aggregation or seasonal controls", async () => {
  const { getForecast, requests } = client()
  const dimensionFilter = { column: "region", values: ["East", null, ""] }
  const result = await getForecast(1, "alice", "revenue", "workspace", {
    dimensionFilter, aggregation: "monthly", aggregationType: "sum", seasonalBusiness: true,
  })
  assert.equal(requests[0].init.method, "POST")
  assert.equal(requests[0].init.headers["Content-Type"], "application/json")
  assert.deepEqual(JSON.parse(requests[0].init.body), dimensionFilter)
  assert.deepEqual(result.dimension_filter, dimensionFilter)
  assert.equal(new URL(requests[0].url).searchParams.get("seasonal_business"), "true")
  assert.equal(new URL(requests[0].url).searchParams.get("aggregation"), "monthly")
})

test("forecast cache isolates each filter, unfiltered data, and workspace", async () => {
  const { getForecast, requests } = client()
  const east = { dimensionFilter: { column: "region", values: ["East"] } }
  const west = { dimensionFilter: { column: "region", values: ["West"] } }
  await getForecast(1, "alice", "revenue", "first")
  await getForecast(1, "alice", "revenue", "first", east)
  await getForecast(1, "alice", "revenue", "first", west)
  await getForecast(1, "alice", "revenue", "second", east)
  await getForecast(1, "alice", "revenue", "first", east)
  assert.equal(requests.length, 4)
  assert.equal(requests[0].init.method, "GET")
})

test("an older API cannot silently return all rows for a filtered forecast, and retry recovers", async () => {
  const { getForecast, requests, setLegacyResponse } = client(true)
  const options = { dimensionFilter: { column: "region", values: ["East"] } }
  await assert.rejects(getForecast(1, "alice", "revenue", "workspace", options), error => error instanceof ApiError && error.status === 503)
  setLegacyResponse(false)
  assert.deepEqual((await getForecast(1, "alice", "revenue", "workspace", options)).dimension_filter, options.dimensionFilter)
  assert.equal(requests.length, 2)
})

const pageSource = readFileSync(new URL("../app/dashboard/forecasts/page.tsx", import.meta.url), "utf8")
const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
test("forecast date selector is labelled, preselected and updates the actual request", () => {
  let selector
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(pageAst) === "select"
      && node.openingElement.attributes.properties.some(attribute => attribute.name?.getText(pageAst) === "id" && attribute.initializer?.text === "forecast-date-column")) selector = node
    ts.forEachChild(node, visit)
  }
  visit(pageAst)
  assert.ok(selector)
  const changes = []
  const { DateControl } = load(`export function DateControl() { return (${selector.parent.getText(pageAst)}) }`, {
    t: value => value, resolvedDateColumn: "paid_date", availableDateColumns: ["date", "paid_date"], metricsLoading: false,
    setSelectedDateColumn: value => changes.push(value), setForecast: value => changes.push(value),
    setPageError: value => changes.push(value), setForecastUnavailableMessage: value => changes.push(value),
  })
  const html = renderToStaticMarkup(React.createElement(DateControl))
  assert.match(html, /for="forecast-date-column"[^>]*>Date column<\/label>/)
  assert.match(html, /<option value="paid_date" selected="">paid_date<\/option>/)
  const control = DateControl().props.children.find(child => child.type === "select")
  control.props.onChange({ target: { value: "date" } })
  assert.deepEqual(changes, ["date", null, "", ""])
  assert.match(pageSource, /dateColumn: selectedDateColumn/)
  assert.match(pageSource, /@min-\[28rem\]:grid-cols-\[minmax\(0,1fr\)_minmax\(0,3fr\)\]/)
  assert.match(pageSource, /value=\{dimensionFilter\} embedded/)
  assert.equal((pageSource.match(/setSelectedDateColumn\(undefined\)/g) || []).length, 2)
})
const helpers = pageAst.statements.filter(node => ts.isFunctionDeclaration(node) && ["getForecastPageErrorMessage", "getForecastUnavailableMessage"].includes(node.name?.text))
const { getForecastUnavailableMessage } = load(helpers.map(node => node.getText(pageAst)).join("\n") + "\nexport { getForecastUnavailableMessage }", { ApiError, Error })

test("expected service rollout failures use the unavailable state rather than the console-error path", () => {
  const error = new ApiError("Seasonal forecasting is temporarily unavailable. Please try again shortly.", 503)
  assert.equal(getForecastUnavailableMessage(error), error.message)
  assert.equal(getForecastUnavailableMessage(new Error("Unexpected failure")), "")
})
