import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(code, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { module: loaded, exports: loaded.exports, Date, ...globals })
  return loaded.exports
}
const dates = load(read("../features/dashboard/date-window.ts"))
const summary = load(read("../features/dashboard/lib/summary-aggregation.ts"))

for (const path of ["../app/dashboard/page.tsx", "../app/share/dashboard/page.tsx"]) {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), functions = {}
  function visit(node) {
    if (ts.isFunctionDeclaration(node)) functions[node.name?.text] = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const metricFunction = path.includes("share") ? "getSharedDashboardMetrics" : "getDashboardPeriodMetrics"
  const helpers = load(["getRowPeriodStartDate", "filterRowsByDateRange", metricFunction].map(name => functions[name]).join("\n")
    + `\nexport { filterRowsByDateRange, ${metricFunction} as metrics }`, { ...dates, ...summary, getMonthIndex: () => -1 })
  test(`${path}: arbitrary start and end dates are inclusive, also for timestamps`, () => {
    for (const time of ["", "T23:59:00Z", "T00:00:00-04:00"]) {
      const rows = ["2026-02-10", "2026-02-11", "2026-05-18", "2026-05-19"].map(day => ({ date: day + time, revenue: 10 }))
      assert.deepEqual(Array.from(helpers.filterRowsByDateRange(rows, "date", { start: "2026-02-11", end: "2026-05-18" }), row => row.date), [rows[1].date, rows[2].date])
    }
  })
  test(`${path}: same-day and empty windows never fall back to all-time totals`, () => {
    const range = { start: "2026-05-18", end: "2026-05-18" }
    const rows = helpers.filterRowsByDateRange([{ date: "2026-05-17", revenue: 100 }, { date: range.start, revenue: 10 }, { date: "2026-05-19", revenue: 100 }], "date", range)
    assert.equal(rows.length, 1)
    assert.equal(helpers.metrics([{ column: "revenue", total: 9999 }], rows, "sum")[0].total, 10)
    assert.equal(helpers.metrics([{ column: "revenue", total: 9999 }], [], "sum")[0].total, 0)
  })
  test(`${path}: each aggregation uses only the selected dates`, () => {
    const rows = [{ date: "2026-05-17", revenue: 100 }, { date: "2026-05-18", revenue: 10 }, { date: "2026-05-19", revenue: 20 }]
    const selected = helpers.filterRowsByDateRange(rows, "date", { start: "2026-05-18", end: "2026-05-19" })
    for (const [aggregation, expected] of [["sum", 30], ["avg", 15], ["count", 2], ["min", 10], ["max", 20]]) {
      assert.equal(helpers.metrics([{ column: "revenue" }], selected, aggregation)[0].total, expected)
    }
  })
}
