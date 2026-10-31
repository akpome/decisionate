import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/reports/report-grouping.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { module: loaded, exports: loaded.exports, require })
const render = report => renderToStaticMarkup(React.createElement(loaded.exports.ReportGrouping, { report }))

test("legacy weekly snapshots retain their originally calculated weekly grouping", () => {
  const markup = render({ weekly_report: true, grain: "weekly", analysis_grain: "weekly" })
  assert.match(markup, /Weekly report \/ Grouped weekly/)
  assert.doesNotMatch(markup, /daily detail/)
})

test("weekly reports distinguish daily report-week detail from earlier weekly history", () => {
  const markup = render({ weekly_report: true, grain: "daily", analysis_grain: "weekly" })
  assert.match(markup, /Report week: daily detail/)
  assert.match(markup, /Earlier history: weekly/)
  assert.doesNotMatch(markup, /Weekly report \/ Grouped weekly/)
})

test("whole-week assessment is labeled only when the snapshot actually contains it", () => {
  assert.match(render({ weekly_report: true, grain: "daily", analysis_grain: "weekly", weekly_anomaly_analysis: { metrics: [] } }), /Whole-week assessment and daily checks/)
  assert.doesNotMatch(render({ weekly_report: true, grain: "daily", analysis_grain: "weekly" }), /Whole-week assessment/)
})

test("a known legacy weekly snapshot retains its originally calculated units", () => {
  const markup = render({ weekly_report: true, grain: "daily", analysis_grain: "monthly" })
  assert.match(markup, /Weekly report/)
  assert.match(markup, /daily detail/)
  assert.match(markup, /Analysis periods: monthly/)
  assert.doesNotMatch(markup, /Grouped weekly/)
})

test("weekly results distinguish daily summary detail from saved analysis grouping", () => {
  for (const grain of ["weekly", "monthly", "quarterly"]) {
    const markup = render({ grain: "daily", analysis_grain: grain })
    assert.match(markup, /Weekly summary: daily detail/)
    assert.ok(markup.includes(`Analysis periods: ${grain}`))
  }
})

test("manual and legacy snapshots retain their grouping without inventing a weekly schedule", () => {
  for (const report of [{ grain: "daily" }, { grain: "monthly", analysis_grain: "monthly" }]) {
    const markup = render(report)
    assert.ok(markup.includes(`Analysis periods: ${report.grain}`))
    assert.doesNotMatch(markup, /Weekly summary/)
  }
})
