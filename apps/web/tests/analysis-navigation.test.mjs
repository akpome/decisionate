import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const React = require("react")
const ts = require("typescript")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")

function compile(path, imports = {}) {
  const loadedModule = { exports: {} }
  const code = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
  }).outputText
  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: name => {
      if (imports[name]) return imports[name]
      if (name.startsWith(".")) {
        const base = new URL(name, new URL(path, import.meta.url))
        const file = [base, new URL(`${base.href}.ts`), new URL(`${base.href}.tsx`)].find(existsSync)
        if (!file) throw new Error(`Cannot resolve ${name}`)
        return compile(file.href, imports)
      }
      return require(name)
    },
  })
  return loadedModule.exports
}

function navigation(translate = text => text) {
  return compile("../features/reports/analysis-navigation.tsx", {
    "next/link": { __esModule: true, default: props => React.createElement("a", props) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: translate }) },
  }).AnalysisNavigation
}

const paths = ["/dashboard/reports", "/dashboard/reports/weekly"]

test("report navigation separates instant analysis from weekly reporting", () => {
  const html = renderToStaticMarkup(React.createElement(navigation(), { active: "reports" }))
  assert.match(html, /<nav aria-label="Report navigation"/)
  for (const path of paths) assert.ok(html.includes(`href="${path}"`))
  for (const label of ["Instant analysis", "Weekly reports"]) assert.ok(html.includes(`>${label}</span>`))
  assert.doesNotMatch(html, /Relationships|\/dashboard\/relationships|Advanced matrix|Saved monitors|Dataset inspection/)
  assert.equal((html.match(/<a /g) ?? []).length, 2)
  assert.ok(html.indexOf("Instant analysis") < html.indexOf("Weekly reports"))
})

test("each report view marks exactly one real navigation link as current", () => {
  for (const [index, active] of ["reports", "weekly"].entries()) {
    const html = renderToStaticMarkup(React.createElement(navigation(), { active }))
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1)
    assert.ok(html.includes(`href="${paths[index]}" aria-current="page"`))
    assert.doesNotMatch(html, /role="tab"/)
  }
})

test("navigation remains touch sized, keyboard accessible and shrinkable", () => {
  const html = renderToStaticMarkup(React.createElement(navigation(), { active: "reports" }))
  assert.match(html, /min-h-14/)
  assert.match(html, /min-w-0/)
  assert.match(html, /break-words/)
  assert.match(html, /focus-visible:outline/)
  assert.match(html, /sm:flex-row/)
})

test("French report labels use the existing translation dictionary", () => {
  const { getLandingText } = compile("../lib/language.ts")
  const html = renderToStaticMarkup(React.createElement(navigation(text => getLandingText("fr", text)), { active: "reports" }))
  assert.match(html, /aria-label="Navigation des rapports"/)
  assert.match(html, />Analyse instantanée</)
  assert.match(html, />Rapports hebdomadaires</)
  for (const label of ["Build report", "Report preview", "Compare two metrics", "Compare multiple metrics"]) {
    assert.notEqual(getLandingText("fr", label), label)
  }
})

test("Relationships is directly discoverable in the Analysis sidebar", () => {
  const source = read("../app/dashboard/dashboard-shell.tsx")
  const analysis = source.slice(source.indexOf('label: "Analysis"'), source.indexOf('label: "Data"'))
  assert.match(analysis, /href: "\/dashboard\/relationships",\s+label: "Relationships"/)
  assert.ok(analysis.indexOf('label: "Instant analysis"') < analysis.indexOf('label: "Weekly reports"'))
  assert.ok(analysis.indexOf('label: "Weekly reports"') < analysis.indexOf('label: "Relationships"'))
})

test("both report views share navigation while Relationships stays a separate sidebar destination", () => {
  for (const path of ["../features/reports/report-workspace.tsx", "../features/reports/single-dataset-report.tsx"]) {
    const source = read(path)
    assert.doesNotMatch(source, /Advanced matrix|Saved monitors|Dataset inspection/)
  }
  assert.match(read("../features/reports/single-dataset-report.tsx"), /<ReportPage scope="single"/)
  for (const path of ["../app/dashboard/relationships/page.tsx", "../app/dashboard/relationships/explorer/page.tsx"]) {
    assert.doesNotMatch(read(path), /AnalysisNavigation/)
  }
  const report = read("../features/reports/report-workspace.tsx")
  assert.match(report, /<AnalysisNavigation active=\{navigation\}/)
  assert.match(report, /<h1[^>]*>\{t\(weekly \? "Weekly reports" : "Instant analysis"\)\}<\/h1>/)
  assert.match(report, /<nav aria-label="Analysis sources"/)
  assert.match(report, /"Build report" : "Report preview"/)
  assert.match(report, /"Save and preview" : "Preview report"/)
  assert.doesNotMatch(report, /href="\/dashboard\/relationships\/explorer"/)
})

test("advanced comparison is removed while the basic saved relationships remain available", () => {
  const relationships = read("../app/dashboard/relationships/page.tsx")
  assert.doesNotMatch(relationships, /CorrelationEntry|Compare multiple metrics/)
  assert.match(relationships, /id="saved-relationships"/)
  assert.match(read("../app/dashboard/relationships/explorer/page.tsx"), /redirect\(legacyRelationshipDestination\(await searchParams\)\)/)
  assert.match(read("../features/reports/single-dataset-report.tsx"), /scope="single"/)
})

test("report setup and results are separate and preview opens the result view", () => {
  const source = read("../features/reports/report-workspace.tsx")
  const calculate = source.slice(source.indexOf("async function calculate"), source.indexOf("async function saveSnapshot"))
  assert.match(calculate, /setReport\(result\)/)
  assert.match(calculate, /setView\("report"\)/)
  const builder = source.slice(source.indexOf('id="report-explore"'), source.indexOf('id="report-report"'))
  assert.doesNotMatch(builder, /<MetricTrends|<ReportOverview|<Finding /)
  const preview = source.slice(source.indexOf('id="report-report"'))
  assert.match(preview, /<ReportRelationshipFindings report=\{report\}/)
  assert.match(preview, /<ReportDecisions report=\{report\}/)
  assert.doesNotMatch(source, /chooseFinding|selectedIds/)
})
