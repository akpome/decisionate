import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const data = JSON.parse(read("../features/support/workflow-guides.generated.json"))
const sections = data.flatMap(group => group.articles.flatMap(article => article.sections))
const source = read("../features/support/workflow-guides.tsx")
const compiled = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, {
  module: compiled, exports: compiled.exports,
  require: name => ({
    "./workflow-guides.generated.json": data,
    "next/link": props => React.createElement("a", { href: props.href }, props.children),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/application-routes": { canonicalWorkspacePathname: path => path },
    "./product-guidance": { safeGuidanceRoute: path => path === "/business-analysis/impact" },
  }[name] ?? {}),
})
const { filterWorkflowGuides, guideCopy } = compiled.exports

test("workflow guides document every customer sidebar destination and all analysis tabs", () => {
  const shell = read("../app/dashboard/dashboard-shell.tsx")
  const navigation = shell.slice(shell.indexOf("const dashboardNavGroups"), shell.indexOf("const dashboardNavigationTranslationKeys"))
  const links = [...navigation.matchAll(/href: "([^"]+)",\s*label: "([^"]+)"/g)]
  const sidebarGuide = sections.find(section => section.id === "product-overview:choose-the-right-page")
  assert.ok(links.length >= 14)
  for (const [, route, label] of links) {
    assert.ok(sidebarGuide.body.includes(`[${label}](${route}):`), label)
    assert.ok(sections.some(section => section.questions.some(question => question.includes(label)) &&
      (section.route === route || section.route.startsWith(route + "/"))), label)
  }
  for (const [label, route] of [
    ["Compare metrics", "/business-analysis"], ["Business impact", "/business-analysis/impact"],
    ["Return on spend", "/business-analysis/returns"], ["Profitability", "/business-analysis/profitability"],
    ["Customer retention", "/business-analysis/retention"], ["Sales conversion", "/business-analysis/conversion"],
    ["Cash flow planning", "/business-analysis/cash-flow"],
  ]) {
    const found = sections.find(section => section.route === route && section.questions.includes(`How do I use ${label}?`))
    assert.ok(found, label)
    assert.ok(found.body.includes(label), label)
    assert.ok(sections.find(section => section.id === "product-overview:which-analysis-tool-should-i-use").body
      .includes(`[${label}](${route}):`), label)
  }
  assert.ok(sections.some(section => section.route === "/alerts" && section.questions.includes("How do I use Scheduled email?")))
})

test("the link-by-link guide renders only approved app links as clickable links", () => {
  const copy = guideCopy("- [Business impact](/business-analysis/impact): Preview an assessment.\n- [Admin](/platform-admin) [External](https://example.test)")
  const html = renderToStaticMarkup(React.createElement("p", null, copy))
  assert.match(html, /<a href="\/business-analysis\/impact">Business impact<\/a>/)
  assert.equal((html.match(/<a /g) || []).length, 1)
})

test("guide search finds text and reviewed question aliases, scoped by topic", () => {
  const titles = groups => groups.flatMap(group => group.articles.flatMap(article => article.sections.map(section => section.title)))
  assert.ok(titles(filterWorkflowGuides("BUSINESS impact tab", "analysis")).includes("Where is Business impact and how do I use it?"))
  assert.ok(titles(filterWorkflowGuides("does the entity matching create a dataset?", "data")).includes("Does Entity Matching create a dataset?"))
  assert.ok(titles(filterWorkflowGuides("Preview cash plan", "analysis")).includes("How do I use Cash flow planning?"))
  assert.ok(!titles(filterWorkflowGuides("Preview cash plan", "data")).includes("How do I use Cash flow planning?"))
  assert.equal(filterWorkflowGuides("guitar pickups", "").length, 0)
})

test("Help & Support exposes the lazy guide and links only to validated pages", () => {
  const help = read("../app/dashboard/help/page.tsx")
  assert.match(help, /dynamic\(\(\) => import\("@\/features\/support\/workflow-guides"\)/)
  assert.match(help, /Browse all tool guides/)
  assert.match(help, /hidden=\{!guidesOpen\}>\{guidesOpen && <WorkflowGuides/)
  assert.match(source, /safeGuidanceRoute\(section.route\)/)
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
})
