import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/dashboard/date-window.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports, Date })
const { dashboardCalendarDate, dashboardDateWindow, dashboardToday } = loaded.exports
const plain = value => JSON.parse(JSON.stringify(value))

test("dashboard periods end today unless an end date is deliberately selected", () => {
  const now = new Date(2026, 10, 16, 12)
  assert.equal(dashboardToday(now), "2026-11-16")
  assert.deepEqual(plain(dashboardDateWindow("", "1m", now)), { start: "2026-10-17", end: "2026-11-16" })
  assert.deepEqual(plain(dashboardDateWindow("2026-10-31", "1m", now)), { start: "2026-10-01", end: "2026-10-31" })
  assert.deepEqual(plain(dashboardDateWindow("2024-02-29", "1y", now)), { start: "2023-03-01", end: "2024-02-29" })
  assert.deepEqual(plain(dashboardDateWindow("2026-03-31", "1m", now)), { start: "2026-03-01", end: "2026-03-31" })
})

for (const path of ["../app/dashboard/page.tsx", "../app/share/dashboard/page.tsx"]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration, rowDate
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "filterRowsByPeriod") declaration = node.getText(ast)
    if (ts.isFunctionDeclaration(node) && node.name?.text === "getRowPeriodStartDate") rowDate = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const scoped = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`${rowDate}\n${declaration}\nexport { filterRowsByPeriod }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: scoped, exports: scoped.exports, Date, dashboardDateWindow, dashboardCalendarDate, getMonthIndex: () => -1 })
  test(`${path}: end day is included, earlier and future rows are excluded`, () => {
    const rows = ["2026-10-16", "2026-10-17", "2026-11-16", "2026-11-17"].map(date => ({ date }))
    assert.deepEqual(Array.from(scoped.exports.filterRowsByPeriod(rows, "date", "2026-11-16", "1m"), row => row.date), ["2026-10-17", "2026-11-16"])
    const timestamps = ["2026-10-16T23:59:00Z", "2026-10-17T00:00:00Z", "2026-11-16T23:59:00Z", "2026-11-17T00:00:00Z"].map(date => ({ date }))
    assert.deepEqual(Array.from(scoped.exports.filterRowsByPeriod(timestamps, "date", "2026-11-16", "1m"), row => row.date), [timestamps[1].date, timestamps[2].date])
    assert.match(source, /value=\{endDate \|\| dashboardToday\(\)\}/)
    assert.doesNotMatch(source, /Start date|first available period/)
  })
}
