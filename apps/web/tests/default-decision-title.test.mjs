import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { webcrypto } from "node:crypto"
import { createRequire } from "node:module"
import vm from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../features/decisions/lib/default-decision-title.ts", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/dashboard/decisions/new/page.tsx", import.meta.url), "utf8")
const identity = "abcddcba-1234-4abc-8abc-1234567890ab"

function draft(url = "https://decisionate.test/dashboard/decisions/new") {
  const changes = [], state = { __NA: true, nextRouterState: true }
  const window = { location: { href: url }, history: { state, replaceState(value, _, path) {
    changes.push({ state: value, path }); window.location.href = new URL(path, window.location.href).href
  } } }
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: loaded, exports: loaded.exports, window, crypto: webcrypto, URL })
  return { ...loaded.exports, window, changes, state }
}

function defaultTitleCallback() {
  const ast = ts.createSourceFile("new/page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "applyDefaultDecisionTitle") callback = node.initializer.arguments[0].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback)
  const draftIdentity = { current: null }, generatedTitle = { current: null }
  let value = "", ids = 0
  const apply = vm.runInNewContext(ts.transpileModule(`const apply = ${callback}; apply`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    draftIdentity, generatedTitle, decisionDraftId: () => { ids++; return identity },
    defaultDecisionTitle: draft().defaultDecisionTitle,
    setCreateDecisionTitle: update => { value = update(value) },
  })
  return { apply, get title() { return value }, set title(next) { value = next }, get ids() { return ids } }
}

test("fresh creation forms receive distinct random default names", () => {
  const titles = new Set()
  for (let index = 0; index < 100; index++) {
    const form = draft(), id = form.decisionDraftId()
    const title = form.defaultDecisionTitle(id)
    assert.match(title, /^Decision \([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\)$/)
    titles.add(title)
  }
  assert.equal(titles.size, 100)
})

test("reloading a draft reuses its name and preserves navigation parameters without bypassing the router", () => {
  const form = draft("https://decisionate.test/dashboard/decisions/new?dataset=39&metric=ad_spend&returnTo=%2Fdashboard%2Fdecisions#details")
  const first = form.decisionDraftId()
  assert.equal(form.decisionDraftId(), first)
  assert.equal(draft(form.window.location.href).decisionDraftId(), first)
  assert.equal(form.changes.length, 1)
  // Passing Next's own history markers would bypass its native-history integration.
  assert.equal(form.changes[0].state, null)
  const url = new URL(form.window.location.href)
  assert.equal(url.searchParams.get("dataset"), "39")
  assert.equal(url.searchParams.get("metric"), "ad_spend")
  assert.equal(url.searchParams.get("returnTo"), "/dashboard/decisions")
  assert.equal(url.hash, "#details")
})

test("invalid draft identifiers are replaced, never used as default names", () => {
  for (const invalid of ["", "Review joined dataset evidence", "<script>", "undefined", "../another-page"]) {
    const form = draft(`https://decisionate.test/dashboard/decisions/new?draft=${encodeURIComponent(invalid)}`)
    assert.match(form.decisionDraftId(), /^[0-9a-f-]{36}$/)
    assert.equal(form.changes.length, 1)
  }
})

test("template defaults retain useful wording and the same draft identifier within the title limit", () => {
  const form = draft()
  assert.equal(form.defaultDecisionTitle(identity, "Investigate Ad Spend movement"), `Investigate Ad Spend movement (${identity})`)
  assert.equal(form.defaultDecisionTitle(identity, " "), `Decision (${identity})`)
  const long = form.defaultDecisionTitle(identity, "Very long template title ".repeat(30))
  assert.ok(long.length <= 200)
  assert.ok(long.endsWith(`(${identity})`))
})

test("metric and template changes reuse the generated suffix without regenerating identity", () => {
  const form = defaultTitleCallback()
  form.apply()
  assert.equal(form.title, `Decision (${identity})`)
  form.apply("Investigate Spend movement")
  assert.equal(form.title, `Investigate Spend movement (${identity})`)
  form.apply("Investigate Sales movement")
  assert.equal(form.title, `Investigate Sales movement (${identity})`)
  assert.equal(form.ids, 1)
})

test("manual names survive automatic metric updates; explicit template changes can reset the default", () => {
  const form = defaultTitleCallback()
  form.apply("Investigate Spend movement")
  form.title = "My deliberately chosen decision name"
  form.apply("Investigate Sales movement")
  assert.equal(form.title, "My deliberately chosen decision name")
  form.apply("Reallocate campaign budget", true)
  assert.equal(form.title, `Reallocate campaign budget (${identity})`)
  assert.equal(form.ids, 1)
})

test("default identity is initialized after mounting, not during server rendering", () => {
  assert.match(page, /if \(!draftIdentity\.current\) applyDefaultDecisionTitle\(\)/)
  assert.doesNotMatch(page, /useState\([^\n]*(?:randomUUID|decisionDraftId|defaultDecisionTitle)/)
})
