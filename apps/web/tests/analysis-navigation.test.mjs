import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
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

function workspaceHeader(weekly, view = "explore", translate = text => text, loading = false) {
  const source = read("../features/reports/report-workspace.tsx")
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const definitions = []
  let header, loader
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ["pageTitle", "setupLabel", "previewLabel"].includes(node.name.getText(ast))) definitions.push(`const ${node.getText(ast)};`)
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "header" && node.getText(ast).includes('role="tablist"')) header = node.getText(ast)
    if (ts.isIfStatement(node) && node.expression.getText(ast) === "loading") loader = node.thenStatement.expression.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(header && loader)
  const loaded = { exports: {} }, icons = require("lucide-react")
  const code = ts.transpileModule(`${definitions.join("\n")} module.exports = ${loading ? loader : header}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
  }).outputText
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require, weekly, view, t: translate, setView() {}, ChartNoAxesCombined: icons.ChartNoAxesCombined, FileText: icons.FileText })
  return renderToStaticMarkup(loaded.exports)
}

test("each separate workflow has its approved title and only its own setup and preview tabs", () => {
  for (const [weekly, title, setup, preview] of [[false, "Analysis", "Build analysis", "Analysis preview"], [true, "Weekly Reports", "Report setup", "Report preview"]]) {
    const html = workspaceHeader(weekly)
    assert.match(html, new RegExp(`<h1[^>]*>${title}</h1>`))
    for (const label of [setup, preview]) assert.ok(html.includes(`>${label}</span>`))
    assert.equal((html.match(/role="tab"/g) ?? []).length, 2)
    assert.doesNotMatch(html, /<nav|href=|Instant analysis/)
    const loading = workspaceHeader(weekly, "explore", text => text, true)
    assert.match(loading, new RegExp(`<h1[^>]*>${title}</h1>`))
    assert.doesNotMatch(loading, /<nav|role="tab"/)
  }
})

test("setup and preview retain a single selected tab, touch sizing and accessible tab panels", () => {
  for (const weekly of [false, true]) for (const view of ["explore", "report"]) {
    const html = workspaceHeader(weekly, view)
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1)
    assert.match(html, new RegExp(`aria-selected="true" aria-controls="report-${view}" id="tab-${view}"`))
    assert.match(html, /min-h-12/)
    assert.match(html, /min-w-0/)
    assert.match(html, /break-words/)
  }
})

test("French report labels use the existing translation dictionary", () => {
  const { getLandingText } = compile("../lib/language.ts")
  const html = workspaceHeader(false, "explore", text => getLandingText("fr", text))
  assert.match(html, />Analyse<\/h1>/)
  assert.match(html, /Préparer une analyse/)
  assert.match(html, /Aperçu de l&#x27;analyse/)
  const weekly = workspaceHeader(true, "explore", text => getLandingText("fr", text))
  assert.match(weekly, /Rapports hebdomadaires/)
  assert.match(weekly, /Configuration du rapport/)
  for (const label of ["Analysis", "Weekly Reports", "Build analysis", "Analysis preview", "Report setup", "Report preview", "Preview analysis", "Copy selection to Weekly Reports"]) {
    assert.notEqual(getLandingText("fr", label), label)
  }
})

test("Relationships is directly discoverable in the Analysis sidebar", () => {
  const source = read("../app/dashboard/dashboard-shell.tsx")
  const analysis = source.slice(source.indexOf('label: "Analysis"'), source.indexOf('label: "Data"'))
  assert.match(analysis, /href: "\/dashboard\/relationships",\s+label: "Relationships"/)
  assert.ok(analysis.indexOf('label: "Analysis"') >= 0)
  assert.ok(analysis.indexOf('label: "Analysis"') < analysis.indexOf('label: "Weekly Reports"'))
  assert.ok(analysis.indexOf('label: "Weekly Reports"') < analysis.indexOf('label: "Relationships"'))
})

test("sidebar navigation marks only the current workflow as active, including the single-dataset route", () => {
  const source = read("../app/dashboard/dashboard-shell.tsx"), ast = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "isActiveDashboardPath")
  assert.ok(declaration)
  const code = ts.transpileModule(`module.exports = ${declaration.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText
  const loaded = { exports: {} }; vm.runInNewContext(code, { module: loaded })
  const matches = loaded.exports
  for (const path of ["/dashboard/reports", "/dashboard/reports/dataset", "/dashboard/reports/evidence"]) {
    assert.equal(matches(path, "/dashboard/reports"), true)
    assert.equal(matches(path, "/dashboard/reports/weekly"), false)
  }
  assert.equal(matches("/dashboard/reports/weekly", "/dashboard/reports"), false)
  assert.equal(matches("/dashboard/reports/weekly", "/dashboard/reports/weekly"), true)
})

test("cross-workflow navigation is removed without losing source scope, delivery or explicit copy actions", () => {
  for (const path of ["../features/reports/report-workspace.tsx", "../features/reports/single-dataset-report.tsx"]) {
    const source = read(path)
    assert.doesNotMatch(source, /Advanced matrix|Saved monitors|Dataset inspection/)
  }
  assert.match(read("../features/reports/single-dataset-report.tsx"), /<ReportPage scope="single"/)
  for (const path of ["../app/dashboard/relationships/page.tsx", "../app/dashboard/relationships/explorer/page.tsx"]) {
    assert.doesNotMatch(read(path), /AnalysisNavigation/)
  }
  const report = read("../features/reports/report-workspace.tsx")
  assert.doesNotMatch(report, /AnalysisNavigation|Report navigation|Instant analysis/)
  assert.equal(existsSync(new URL("../features/reports/analysis-navigation.tsx", import.meta.url)), false)
  assert.match(report, /<h1[^>]*>\{t\(pageTitle\)\}<\/h1>/)
  assert.match(report, /<nav aria-label="Analysis sources"/)
  assert.match(report, /mode === "explore" \? setupLabel : previewLabel/)
  assert.match(report, /weekly \? "Preview report" : definition.impact \? busy \? "Checking decision\.\.\." : "Check this decision" : "Preview analysis"/)
  assert.match(report, /Copy selection to Weekly Reports/)
  assert.match(report, /href="\/dashboard\/alerts#weekly-delivery"/)
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
