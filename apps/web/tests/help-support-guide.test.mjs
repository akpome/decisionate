import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../app/dashboard/help/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("help.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ["gettingStartedItems", "faqItems", "referenceChapters"]
const declarations = ast.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => names.includes(item.name.getText(ast))))
const loaded = { exports: {} }
vm.runInNewContext(ts.transpileModule(`${declarations.map(node => node.getText(ast)).join("\n")}\nexport { ${names.join(", ")} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports })
const { gettingStartedItems, faqItems, referenceChapters } = loaded.exports
const chapter = id => JSON.stringify(referenceChapters.find(item => item.id === `reference-${id}`))
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")

test("help updates retain checklist progress identities and all existing manual anchors", () => {
  assert.deepEqual(Array.from(gettingStartedItems, item => item.id), ["dataset", "metrics", "analysis", "decision", "learning"])
  assert.equal(referenceChapters.length, 13)
  assert.equal(new Set(referenceChapters.map(item => item.id)).size, 13)
  assert.equal(new Set(faqItems.map(item => item.question)).size, faqItems.length)
  for (const item of gettingStartedItems) assert.ok(item.href.startsWith("/dashboard"))
  assert.match(source, /href=\{`#\$\{chapter.id\}`\}/)
  assert.match(source, /id=\{chapter.id\}/)
  assert.doesNotMatch(source, /href: "\/dashboard\/insights|href: "\/dashboard\/relationships\/explorer/)
})

test("dashboard guidance documents the Filters tab and retained date and dimension selection", () => {
  const text = chapter("dashboards")
  for (const label of ["Filters", "Date column", "Dimension column", "Unique values", "Search values", "Clear dimension filter"]) assert.ok(text.includes(label), label)
  assert.match(text, /Closing Filters does not clear/)
  assert.match(text, /empty value selection is not treated as all rows/)
  assert.match(text, /Decision Performance uses decision records/)
  assert.match(text, /no longer have an Analysis panel/)
  const page = read("../app/dashboard/page.tsx")
  assert.match(page, /id="dashboard-filters-toggle"/)
  assert.match(page, /hidden=\{!showFiltersPanel\}/)
})

test("dashboard period guidance matches one-year defaults and removed five-year and All options", () => {
  const text = chapter("dashboards"), page = read("../app/dashboard/page.tsx")
  assert.match(text, /1 month, 1 quarter, 6 months, 1 year, 2 years, and 3 years/)
  assert.match(text, /saved views using them reopen at 1 year/)
  assert.match(page, /useState<PeriodFilter>\("1y"\)/)
  assert.doesNotMatch(page, /<option value="5y"|<option value="all"|\["5y", "5Y"\]|\["all", "All"\]/)
  assert.match(JSON.stringify(faqItems), /Other valid saved periods are preserved/)
})

test("Analysis is the documented analysis entry and date and dimension filtering is explained for each workflow", () => {
  assert.match(chapter("orientation"), /cross-dataset decision-intelligence/)
  assert.match(chapter("analysis"), /Multi dataset report opens by default/)
  assert.match(chapter("analysis"), /choose one Dataset from the dropdown/)
  assert.match(chapter("analysis"), /Changing the dataset clears the previous metrics, filters and date choices/)
  assert.match(chapter("analysis"), /old Insights links redirect to Analysis/)
  assert.match(chapter("analysis"), /preselected Date column beside Dimension column/)
  assert.match(chapter("analysis"), /Each source's|each source's preselected Date column/)
  assert.match(chapter("relationships-alerts"), /independent Dimension column filter/)
  assert.match(chapter("joins"), /Each source has its own dimension filter/)
  assert.match(chapter("troubleshooting"), /Retry filtered dashboard/)
})

test("report timing guidance matches the 52-observation daily default and pair-specific calendar lags", () => {
  const text = chapter("analysis")
  assert.match(text, /New multi dataset reports open with Explore relationships/)
  assert.match(text, /Assess a decision is a separate optional analysis type/)
  assert.match(text, /defaults to 52/)
  assert.match(text, /limited to 12/)
  assert.match(text, /includes lag zero/)
  assert.match(text, /every relevant pair independently/)
  assert.match(text, /Twelve monthly observations do not meet the default minimum of 52/)
  assert.match(read("../features/reports/types.ts"), /minimum_observations: Math.max\(MINIMUM_RELATIONSHIP_OBSERVATIONS/)
  assert.match(read("../features/reports/report-pair-directions.tsx"), /Same period only/)
  assert.match(text, /Analysis and Relationships share the same new-analysis defaults/)
  assert.match(chapter("relationships-alerts"), /Spearman, daily Group by, Sum aggregation, 52 Minimum historical observations, Maximum lag 12, and Same-period comparison only/)
  assert.match(chapter("relationships-alerts"), /Maximum lag appears only for a directional timing search/)
})

test("indexed comparisons and seasonality include their interpretation limits", () => {
  const text = chapter("analysis")
  assert.match(text, /shared positive baseline date as 100/)
  assert.match(text, /120 means 20 percent above/)
  assert.match(text, /original values and units/)
  assert.match(text, /does not force seasonal adjustment/)
  assert.match(text, /insufficient/)
  assert.match(text, /Seasonal forecasting validates/)
})

test("weekly delivery documents independent settings, fixed weekly grouping and safe removal", () => {
  const text = chapter("analysis")
  assert.match(text, /Select source metrics, date columns, dimension filters/)
  assert.match(text, /latest completed week/)
  assert.match(text, /rolling three years/)
  assert.match(text, /does not itself enable delivery or change recipients/)
  assert.match(text, /independent of Analysis/)
  assert.match(text, /last completed Monday-Sunday is analyzed daily/)
  assert.match(text, /daily and as a whole week/)
  assert.match(text, /Whole-week assessment compares each selected metric with its normal weekly range/)
  assert.match(text, /earlier relationship history is grouped into complete weeks/)
  assert.match(text, /Send report now emails the current weekly report only to the workspace owner/)
  assert.match(text, /daily lags are not interpreted as weeks/)
  assert.match(text, /Linked decisions and datasets are kept/)
  assert.match(text, /Deleting a saved snapshot does not remove independent weekly settings or change delivery/)
})

test("connector guidance matches the current 90-day initial request and bounded three-year history", () => {
  const text = chapter("data-ingestion")
  assert.match(text, /latest 90 days first/)
  assert.match(text, /rolling three years/)
  assert.match(text, /at most 30 days/)
  assert.match(text, /Manual date ranges longer than 90 days/)
  assert.match(text, /older than the rolling three-year retention boundary is deleted/)
  assert.match(read("../../api/app/modules/datasets/router.py"), /INITIAL_CONNECTOR_SYNC_DAYS = 90/)
  assert.match(read("../../api/app/modules/datasets/router.py"), /INITIAL_CONNECTOR_BACKFILL_MONTHS = 36/)
})

test("decision guidance keeps creation central, report evidence scoped and drafts distinct from recorded actions", () => {
  const text = chapter("decisions")
  assert.match(text, /Open Decisions and choose Create decision/)
  assert.match(text, /only the selected report metrics/)
  assert.match(text, /unique generated decision name/)
  assert.match(text, /explicitly save the decision/)
  assert.match(text, /updating a decision edits that record/)
  assert.match(text, /separate archived-history section/)
})

test("support request types, workspace context and native diagnostic form remain available", () => {
  for (const type of ["support", "bug", "feature"]) assert.ok(source.includes(`openSupportForm("${type}")`))
  assert.match(source, /await submitSupportRequest\(/)
  assert.match(source, /page_url: window.location.href/)
  assert.match(source, /user.id,\s*activeWorkspaceId,/)
  assert.match(source, /onSubmit=\{handleSupportSubmit\}/)
  assert.match(source, /Never send passwords, API keys/)
})
