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

test("new weekly reports explicitly label their fixed weekly grouping", () => {
  const markup = render({ weekly_report: true, grain: "weekly", analysis_grain: "weekly" })
  assert.match(markup, /Weekly report \/ Grouped weekly/)
  assert.doesNotMatch(markup, /daily detail/)
})

test("a known legacy weekly snapshot retains its originally calculated units", () => {
  const markup = render({ weekly_report: true, grain: "daily", analysis_grain: "monthly" })
  assert.match(markup, /Weekly report/)
  assert.match(markup, /daily detail/)
  assert.match(markup, /Analysis group by: monthly/)
  assert.doesNotMatch(markup, /Grouped weekly/)
})

test("weekly results distinguish daily summary detail from saved analysis grouping", () => {
  for (const grain of ["weekly", "monthly", "quarterly"]) {
    const markup = render({ grain: "daily", analysis_grain: grain })
    assert.match(markup, /Weekly summary: daily detail/)
    assert.ok(markup.includes(`Analysis group by: ${grain}`))
  }
})

test("manual and legacy snapshots retain their grouping without inventing a weekly schedule", () => {
  for (const report of [{ grain: "daily" }, { grain: "monthly", analysis_grain: "monthly" }]) {
    const markup = render(report)
    assert.ok(markup.includes(`Analysis group by: ${report.grain}`))
    assert.doesNotMatch(markup, /Weekly summary/)
  }
})
