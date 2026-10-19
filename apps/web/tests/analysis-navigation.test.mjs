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

const paths = ["/dashboard/reports", "/dashboard/relationships", "/dashboard/reports/dataset"]

test("analysis destinations have visible names and preserve existing routes", () => {
  const html = renderToStaticMarkup(React.createElement(navigation(), { active: "reports" }))
  assert.match(html, /<nav aria-label="Analysis navigation"/)
  for (const path of paths) assert.ok(html.includes(`href="${path}"`))
  for (const label of ["Reports", "Relationships", "Dataset reports"]) assert.ok(html.includes(`>${label}</span>`))
  assert.doesNotMatch(html, /Advanced matrix|Saved monitors|Dataset inspection/)
  assert.equal((html.match(/<a /g) ?? []).length, 3)
})

test("each analysis view marks exactly one real navigation link as current", () => {
  for (const [index, active] of ["reports", "relationships", "dataset-reports"].entries()) {
    const html = renderToStaticMarkup(React.createElement(navigation(), { active }))
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1)
    assert.ok(html.includes(`href="${paths[index]}" aria-current="page"`))
    assert.doesNotMatch(html, /role="tab"/)
  }
})

test("navigation remains touch sized, keyboard accessible and shrinkable", () => {
  const html = renderToStaticMarkup(React.createElement(navigation(), { active: "relationships" }))
  assert.match(html, /min-h-14/)
  assert.match(html, /min-w-0/)
  assert.match(html, /break-words/)
  assert.match(html, /focus-visible:outline/)
  assert.match(html, /sm:flex-row/)
})

test("French analysis labels use the existing translation dictionary", () => {
  const { getLandingText } = compile("../lib/language.ts")
  const html = renderToStaticMarkup(React.createElement(navigation(text => getLandingText("fr", text)), { active: "relationships" }))
  assert.match(html, /aria-label="Navigation d&#x27;analyse"/)
  assert.match(html, />Rapports</)
  assert.match(html, />Relations</)
  assert.match(html, />Rapports par jeu de données</)
  for (const label of ["Build report", "Report preview", "Compare two metrics", "Compare multiple metrics"]) {
    assert.notEqual(getLandingText("fr", label), label)
  }
})

test("Relationships is directly discoverable in the Analysis sidebar", () => {
  const source = read("../app/dashboard/dashboard-shell.tsx")
  const analysis = source.slice(source.indexOf('label: "Analysis"'), source.indexOf('label: "Data"'))
  assert.match(analysis, /href: "\/dashboard\/relationships",\s+label: "Relationships"/)
  assert.ok(analysis.indexOf('label: "Reports"') < analysis.indexOf('label: "Relationships"'))
})

test("report builder, relationship views and dataset reports share navigation", () => {
  for (const [path, active] of [
    ["../features/reports/report-workspace.tsx", "reports"],
    ["../app/dashboard/relationships/page.tsx", "relationships"],
    ["../features/relationships/correlation-explorer.tsx", "relationships"],
    ["../features/reports/single-dataset-report.tsx", "dataset-reports"],
  ]) {
    const source = read(path)
    assert.ok(source.includes(`<AnalysisNavigation active="${active}" />`), path)
    assert.doesNotMatch(source, /Advanced matrix|Saved monitors|Dataset inspection/)
  }
  const report = read("../features/reports/report-workspace.tsx")
  assert.match(report, /"Build report" : "Report preview"/)
  assert.match(report, /t\("Preview report"\)/)
  assert.doesNotMatch(report, /href="\/dashboard\/relationships\/explorer"/)
})

test("multi-metric comparison remains gated and saved links target the right section", () => {
  const entry = read("../features/relationships/correlation-entry.tsx")
  assert.match(entry, /if \(!available\) return null/)
  assert.match(entry, /t\("Compare multiple metrics"\)/)
  const explorer = read("../features/relationships/correlation-explorer.tsx")
  assert.match(explorer, /if \(!capabilities\?\.ui\)/)
  assert.match(explorer, /href="\/dashboard\/relationships#saved-relationships"/)
  assert.match(read("../app/dashboard/relationships/page.tsx"), /id="saved-relationships"/)
  assert.match(read("../features/reports/single-dataset-report.tsx"), /title="Dataset reports"/)
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
