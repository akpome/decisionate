import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { webcrypto } from "node:crypto"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/reports/default-report-name.ts", import.meta.url), "utf8")
const workspace = readFileSync(new URL("../features/reports/report-workspace.tsx", import.meta.url), "utf8")
const namePattern = /^Report \([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\)$/
const pairs = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/reports/pair-directions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: pairs, exports: pairs.exports })
const impact = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../features/reports/impact-types.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: impact, exports: impact.exports })

function draft(url = "https://decisionate.test/dashboard/reports") {
  const changes = []
  const window = { location: { href: url }, history: { replaceState(state, _, path) {
    changes.push({ state, path }); window.location.href = new URL(path, window.location.href).href
  } } }
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: loaded, exports: loaded.exports, window, crypto: webcrypto, URL })
  return { ...loaded.exports, window, changes }
}

test("new reports receive random unique names within the report name limit", () => {
  const names = new Set(Array.from({ length: 100 }, () => draft().reportDraftName()))
  assert.equal(names.size, 100)
  for (const name of names) {
    assert.match(name, namePattern)
    assert.ok(name.length <= 120)
    assert.equal(draft().isDefaultReportName(name), true)
  }
})

test("draft reloads preserve the generated name and source navigation parameters", () => {
  for (const query of ["?dataset=39&metric=ad_spend", "?run=analysis-42", ""]) {
    const form = draft(`https://decisionate.test/dashboard/reports${query}#analysis`)
    const first = form.reportDraftName()
    assert.equal(form.reportDraftName(), first)
    assert.equal(draft(form.window.location.href).reportDraftName(), first)
    assert.equal(form.changes.length, 1)
    assert.equal(form.changes[0].state, null)
    const url = new URL(form.window.location.href)
    for (const [key, value] of new URLSearchParams(query)) assert.equal(url.searchParams.get(key), value)
    assert.equal(url.hash, "#analysis")
  }
})

test("invalid URL draft identifiers are replaced, never inserted into a report name", () => {
  for (const value of ["", "undefined", "<script>", "../another-report", "review revenue"]) {
    const form = draft(`https://decisionate.test/dashboard/reports?draft=${encodeURIComponent(value)}`)
    assert.match(form.reportDraftName(), namePattern)
    assert.equal(form.changes.length, 1)
  }
  for (const name of ["My sales analysis", "Report (my sales analysis)", "Cross-dataset business review"]) {
    assert.equal(draft().isDefaultReportName(name), false)
  }
})

function editor({ name = draft().defaultReportName(), saved = false } = {}) {
  const ast = ts.createSourceFile("report-workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "edit") declaration = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const state = { definition: { name, metrics: [], included_findings: ["finding-1"] }, report: saved ? { report_id: "report-1" } : null }
  const bindings = {
    definition: state.definition, report: state.report, ...draft(), ...pairs.exports, ...impact.exports,
    setDefinition: update => { state.definition = update(state.definition); bindings.definition = state.definition },
    setReport: value => { state.report = value; bindings.report = value }, setError: () => {}, setMessage: () => {},
    setAnalysisJob: () => {}, URLSearchParams, window: { location: { search: "" } },
  }
  const edit = vm.runInNewContext(ts.transpileModule(`${declaration}\nedit`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bindings)
  return { state, edit }
}

test("metric and settings changes retain the name of an unsaved report", () => {
  const { state, edit } = editor()
  const original = state.definition.name
  edit({ grain: "monthly" })
  edit({ business_question: "How did orders change?" })
  assert.equal(state.definition.name, original)
  assert.equal(state.definition.included_findings, null)
})

test("forking a saved report refreshes its generated name only once", () => {
  const { state, edit } = editor({ saved: true })
  const original = state.definition.name
  edit({ grain: "monthly" })
  const next = state.definition.name
  assert.match(next, namePattern)
  assert.notEqual(next, original)
  edit({ method: "pearson" })
  assert.equal(state.definition.name, next)
  assert.equal(state.report, null)
})

test("deliberate names and explicit renames are preserved when editing any analysis setting", () => {
  for (const saved of [false, true]) {
    const { state, edit } = editor({ name: "My sales and advertising analysis", saved })
    edit({ grain: "monthly" })
    assert.equal(state.definition.name, "My sales and advertising analysis")
    edit({ name: "My renamed analysis" })
    edit({ method: "pearson" })
    assert.equal(state.definition.name, "My renamed analysis")
  }
  const { state, edit } = editor({ saved: true })
  edit({ name: "An explicit saved-report rename" })
  assert.equal(state.definition.name, "An explicit saved-report rename")
})

test("random names are generated after mount while saved report names remain unchanged", () => {
  assert.match(workspace, /if \(!params\.get\("report"\) && !params\.get\("weekly"\)\)/)
  assert.match(workspace, /if \(!draftName\.current\) draftName\.current = reportDraftName\(\)/)
  assert.match(workspace, /editableDefinition\(\{ \.\.\.result, name: draftName\.current \}\)/)
  assert.match(workspace, /setDefinition\(current => editableDefinition\(\{ \.\.\.current, metrics:/)
  assert.doesNotMatch(workspace, /useState[^\n]*(?:reportDraftName|defaultReportName|randomUUID)/)
})

test("report and decision name fields clearly explain renaming and associate their hints accessibly", () => {
  assert.match(workspace, /aria-describedby="report-name-hint"/)
  assert.match(workspace, /id="report-name-hint"[^>]*>\{t\("Edit this report name to suit your analysis\."\)\}/)
  for (const path of ["../app/dashboard/decisions/new/page.tsx", "../app/dashboard/decisions/[id]/page.tsx"]) {
    const page = readFileSync(new URL(path, import.meta.url), "utf8")
    assert.match(page, /aria-describedby="decision-name-hint"/)
    assert.match(page, /id="decision-name-hint"[^>]*>\s*Edit this decision name to suit your analysis\./)
  }
  const translations = readFileSync(new URL("../lib/language.ts", import.meta.url), "utf8")
  assert.match(translations, /"Edit this report name to suit your analysis\."/)
  assert.match(translations, /"Edit this decision name to suit your analysis\."/)
})
