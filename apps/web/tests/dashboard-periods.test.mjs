import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(code, globals = {}, imports = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, Date, require: name => imports[name] || require(name), ...globals })
  return loaded.exports
}
const dates = load(read("../features/dashboard/date-window.ts"))
const { dashboardDateRange, changeDashboardDate } = dates
const { DashboardDateInputs } = load(read("../features/dashboard/components/dashboard-date-inputs.tsx"), {}, { "@/features/dashboard/date-window": dates })
const now = new Date(2026, 10, 18, 12), plain = value => JSON.parse(JSON.stringify(value))

test("a new dashboard starts one calendar year ago and ends today, including leap years", () => {
  assert.deepEqual(plain(dashboardDateRange({}, now)), { start: "2025-11-18", end: "2026-11-18" })
  assert.deepEqual(plain(dashboardDateRange({}, new Date(2024, 1, 29, 12))), { start: "2023-02-28", end: "2024-02-29" })
})

test("custom saved dates are retained and take precedence over legacy periods", () => {
  const saved = { startDate: "2024-02-29", endDate: "2026-04-17", periodFilter: "1m" }
  assert.deepEqual(plain(dashboardDateRange(saved, now)), { start: saved.startDate, end: saved.endDate })
  assert.deepEqual(plain(dashboardDateRange({ endDate: "2026-04-17" }, now)), { start: "2025-04-17", end: "2026-04-17" })
})

test("older saved periods migrate to the same inclusive dates", () => {
  for (const [periodFilter, start] of [["1m", "2026-10-19"], ["1q", "2026-08-19"], ["6m", "2026-05-19"], ["1y", "2025-11-19"], ["2y", "2024-11-19"], ["3y", "2023-11-19"]]) {
    assert.deepEqual(plain(dashboardDateRange({ periodFilter }, now)), { start, end: "2026-11-18" })
  }
  assert.deepEqual(plain(dashboardDateRange({ periodFilter: "1m", endDate: "2026-03-31" }, now)), { start: "2026-03-01", end: "2026-03-31" })
})

test("invalid, reversed, retired and obsolete start-only preferences use the one-year default", () => {
  for (const saved of [{}, { periodFilter: "all" }, { periodFilter: "5y" }, { periodFilter: {} },
    { startDate: "2000-01-01" }, { startDate: "2026-11-19", endDate: "2026-11-18" },
    { startDate: "2025-02-30", endDate: "2026-11-18" }, { endDate: "2026-02-30" }, { endDate: "2028-01-01" }]) {
    assert.deepEqual(plain(dashboardDateRange(saved, now)), { start: "2025-11-18", end: "2026-11-18" })
  }
})

test("editing dates keeps a valid inclusive range and rejects malformed or future dates", () => {
  const range = { start: "2025-11-18", end: "2026-11-18" }
  assert.deepEqual(plain(changeDashboardDate(range, "start", "2026-02-02", now)), { ...range, start: "2026-02-02" })
  assert.deepEqual(plain(changeDashboardDate(range, "end", "2025-01-01", now)), { start: "2025-01-01", end: "2025-01-01" })
  for (const value of ["", "not-a-date", "2026-02-30", "2026-11-19"]) assert.equal(changeDashboardDate(range, "start", value, now), range)
})

for (const compact of [false, true]) {
  test(`${compact ? "chart" : "dataset"} date controls show Start then End, with no period menu`, () => {
    const range = dashboardDateRange(), updates = []
    const element = DashboardDateInputs({ range, compact, onChange: value => updates.push(value) })
    const html = renderToStaticMarkup(element)
    assert.equal((html.match(/type="date"/g) || []).length, 2)
    assert.ok(html.indexOf("Start date") < html.indexOf("End date"))
    assert.doesNotMatch(html, /<select|Period/)
    const labels = React.Children.toArray(element.props.children)
    const inputs = labels.map(label => React.Children.toArray(label.props.children).find(child => child.type === "input"))
    assert.equal(inputs[0].props.max, range.end)
    assert.equal(inputs[1].props.min, range.start)
    assert.equal(inputs[0].props.required, true)
    inputs[0].props.onChange({ target: { value: range.end } })
    assert.equal(updates[0].start, range.end)
  })
}

for (const path of ["../app/dashboard/page.tsx", "../app/share/dashboard/page.tsx"]) {
  test(`${path}: every template uses the same explicit range`, () => {
    const source = read(path)
    assert.match(source, /useState\(\(\) => dashboardDateRange\(\)\)/)
    assert.match(source, /DashboardDateInputs range=\{dateRange\} onChange=\{setDateRange\}/)
    assert.doesNotMatch(source, /setPeriodFilter|periodFilter=|setEndDate|label="Period"|>Period</)
  })
}

test("reset restores one year through today and retains the existing chart defaults", () => {
  const source = read("../app/dashboard/page.tsx"), tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let reset
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "handleResetView") reset = node.getText(tree); ts.forEachChild(node, visit) }
  visit(tree)
  const state = {}, globals = { dashboardDateRange: () => dashboardDateRange({}, now) }
  for (const key of ["DateRange", "Aggregation", "AggregationType", "ScaleMode", "ChartType"]) globals[`set${key}`] = value => { state[key] = plain(value) }
  load(`${reset}\nexport { handleResetView }`, globals).handleResetView()
  assert.deepEqual(state, { DateRange: { start: "2025-11-18", end: "2026-11-18" }, Aggregation: "monthly", AggregationType: "sum", ScaleMode: "actual", ChartType: "line" })
  assert.match(source, /startDate: dateRange.start,\s*endDate: dateRange.end/)
  assert.match(source, /startDate: dateRange.start,\s*endDate: dateRange.end,\s*periodFilter: "all"/)
})
