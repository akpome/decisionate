import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(read("../features/performance/types.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports })
const { newPerformance, missingSetup, performancePath, sameDatasetLayout, toolLabels } = loaded.exports

test("historical comparisons remain within Business Analysis without more sidebar pages", () => {
  assert.equal(performancePath("return"), "/dashboard/reports/returns")
  assert.equal(performancePath("profit"), "/dashboard/reports/profitability")
  const nav = read("../features/reports/analysis-tools.tsx")
  assert.ok(nav.includes("Compare metrics"))
  assert.deepEqual(Object.values(toolLabels).sort(), ["Cash flow planning", "Customer retention", "Profitability", "Return on spend", "Sales conversion"])
  assert.match(nav, /Analysis tool<select/)
  assert.match(nav, /lg:hidden/)
  assert.match(read("../features/reports/report-workspace.tsx"), /!weekly && !impactPage && <AnalysisTools/)
  assert.doesNotMatch(read("../app/dashboard/dashboard-shell.tsx"), /label: "Return on spend"|label: "Profitability"/)
})

test("all five tools have their own routes and explicit input checks", () => {
  for (const kind of ["retention", "conversion", "cashflow"]) {
    assert.match(performancePath(kind), /^\/dashboard\/reports\//)
    const value = newPerformance(kind)
    assert.notEqual(missingSetup(value), "")
    value.source = { dataset_id: 1, date_column: "date" }
    if (kind === "retention") {
      value.date_range = { start: "2025-01-01", end: "2025-04-30" }
      value.customer_column = "customer_id"; value.order_column = "order_id"
    } else if (kind === "conversion") {
      value.date_range = { start: "2025-01-01", end: "2025-01-31" }
      value.steps = [{ name: "Enquiries", metric_key: "leads" }, { name: "Buyers", metric_key: "customers" }]
    } else {
      value.start_date = "2027-01-01"; value.incoming_metric = "revenue"; value.outgoing_metric = "cost"
    }
    assert.match(missingSetup(value), /Confirm/)
    value.amounts_confirmed = true
    assert.equal(missingSetup(value), "")
  }
})

test("retention IDs, sales steps and cash directions cannot reuse ambiguous columns", () => {
  const retention = newPerformance("retention")
  Object.assign(retention, { source: { dataset_id: 1, date_column: "date" }, date_range: { start: "2025-01-01", end: "2025-04-30" }, customer_column: "customer", order_column: "customer", amounts_confirmed: true })
  assert.match(missingSetup(retention), /different columns/)
  const conversion = newPerformance("conversion")
  Object.assign(conversion, { source: retention.source, date_range: retention.date_range, steps: [{ name: "One", metric_key: "count" }, { name: "Two", metric_key: "count" }], amounts_confirmed: true })
  assert.match(missingSetup(conversion), /different count/)
  const cash = newPerformance("cashflow")
  Object.assign(cash, { start_date: "2027-01-01", source: retention.source, incoming_metric: "amount", outgoing_metric: "amount", amounts_confirmed: true })
  assert.match(missingSetup(cash), /separate amounts/)
})

test("new tools share preview-before-save and keep optional cash assumptions collapsed", () => {
  const setup = read("../features/performance/growth-setup.tsx")
  assert.match(setup, /<details[^>]*>[\s\S]*?Cash buffer and what-if changes/)
  assert.doesNotMatch(setup, /<details[^>]*\bopen\b/)
  assert.match(setup, /Cancelled purchases/)
  assert.match(setup, /same group of people or opportunities/)
  const results = read("../features/performance/growth-results.tsx")
  assert.match(results, /Without adjustments/)
  assert.match(results, /Planned cash/)
  assert.match(results, /row.issues.map/)
  assert.match(results, /More follow-up is needed/)
})

test("preview needs dates, amount choices, selected dimension values and confirmation", () => {
  const value = newPerformance("return")
  assert.match(missingSetup(value), /dates/)
  value.date_range = { start: "2025-01-01", end: "2025-01-03" }
  assert.match(missingSetup(value), /dataset/)
  value.items[0].revenue = { dataset_id: 1, metric_key: "revenue", date_column: "date", records: "daily" }
  value.items[0].costs = [{ ...value.items[0].revenue, metric_key: "spend" }]
  assert.match(missingSetup(value), /Confirm/)
  value.amounts_confirmed = true
  assert.equal(missingSetup(value), "")
  value.items[0].revenue.dimension_filter = { column: "channel", values: [] }
  assert.match(missingSetup(value), /filter/)
})

test("reopened comparisons retain separate-source and filtered layouts", () => {
  const value = newPerformance("profit")
  assert.equal(sameDatasetLayout(value), true)
  value.items[0].costs[0].dataset_id = 2
  assert.equal(sameDatasetLayout(value), false)
  value.items[0].costs[0].dataset_id = 0
  value.items[0].costs[0].dimension_filter = { column: "region", values: ["East"] }
  assert.equal(sameDatasetLayout(value), false)
})

test("save and decision actions follow a completed preview; edits invalidate it", () => {
  const source = read("../features/performance/performance-workspace.tsx")
  assert.match(source, /view === "results" && result/)
  assert.match(source, /!result.analysis_id && result.rows.some\(row => row.ready\)/)
  assert.match(source, /result.analysis_id && canDecide/)
  assert.match(source, /function change[\s\S]*?amounts_confirmed: false[\s\S]*?setResult\(null\)/)
  assert.match(source, /Idempotency-Key/)
  assert.match(source, /active.current\?\.abort\(\)/)
})

test("result labels distinguish selected costs from net profit and preserve negatives", () => {
  const source = read("../features/performance/performance-results.tsx")
  assert.match(source, /Money left after selected costs/)
  assert.match(source, /Revenue for each 1/)
  assert.match(source, /amount < 0/)
  assert.match(source, /right: "50%"/)
  assert.match(source, /row.issues.map/)
  assert.doesNotMatch(source, /correlation|coefficient|p.value/i)
})
