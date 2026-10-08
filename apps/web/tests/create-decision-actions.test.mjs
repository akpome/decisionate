import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(path.join(webRoot, "package.json"))
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function loadSource(relativePath, translate = text => text) {
  const cache = new Map()
  const overrides = {
    "next/link": { __esModule: true, default: props => React.createElement("a", props) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: translate }) },
  }

  function load(filePath) {
    if (cache.has(filePath)) return cache.get(filePath)
    const loadedModule = { exports: {} }
    cache.set(filePath, loadedModule.exports)
    const { outputText } = ts.transpileModule(readFileSync(filePath, "utf8"), {
      fileName: filePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    })
    vm.runInNewContext(outputText, {
      module: loadedModule,
      exports: loadedModule.exports,
      URLSearchParams,
      require: specifier => {
        if (overrides[specifier]) return overrides[specifier]
        if (specifier.startsWith("@/") || specifier.startsWith(".")) {
          const base = specifier.startsWith("@/")
            ? path.join(webRoot, specifier.slice(2))
            : path.resolve(path.dirname(filePath), specifier)
          const resolved = [base, `${base}.tsx`, `${base}.ts`].find(existsSync)
          if (!resolved) throw new Error(`Cannot resolve ${specifier}`)
          return load(resolved)
        }
        return require(specifier)
      },
    }, { filename: filePath })
    return loadedModule.exports
  }

  return load(path.join(webRoot, relativePath))
}

const { CreateDecisionButton, CreateDecisionLink } = loadSource(
  "features/decisions/components/create-decision-action.tsx",
)
const { buildCreateDecisionHref } = loadSource("features/decisions/lib/decision-handoff.ts")
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))

test("creation buttons use one label, icon, stable size and accessible title", () => {
  const html = render(CreateDecisionButton, {})
  assert.match(html, /type="button"/)
  assert.match(html, /title="Create decision"/)
  assert.match(html, /lucide-plus/)
  assert.match(html, /h-10/)
  assert.match(html, />Create decision<\/span>/)
  assert.doesNotMatch(html, /disabled=""/)
})

test("pending creation is disabled and announced without resizing the control", () => {
  const html = render(CreateDecisionButton, { creating: true })
  assert.match(html, /disabled=""/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /animate-spin/)
  assert.match(html, /h-10/)
  assert.match(html, />Creating\.\.\.<\/span>/)
  assert.match(html, /col-start-1 row-start-1 invisible" aria-hidden="true">Create decision/)
})

test("explicit disabled and submit states are retained", () => {
  const html = render(CreateDecisionButton, { type: "submit", disabled: true, id: "save-decision" })
  assert.match(html, /type="submit"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /id="save-decision"/)
  assert.match(html, /aria-busy="false"/)
})

test("compact evidence actions retain their contextual tooltip and variant", () => {
  const html = render(CreateDecisionButton, {
    size: "sm", variant: "secondary", title: "Create decision from evidence", className: "w-full sm:w-auto",
  })
  assert.match(html, /h-9/)
  assert.match(html, /bg-white/)
  assert.match(html, /title="Create decision from evidence"/)
  assert.match(html, /w-full sm:w-auto/)
})

test("creation links carry the dataset, focused metric and return location", () => {
  const href = buildCreateDecisionHref({ datasetId: 39, metric: "Gross profit & margin", returnTo: "/dashboard/datasets/39" })
  const url = new URL(href, "https://decisionate.test")
  assert.equal(url.pathname, "/dashboard/decisions/new")
  assert.equal(url.searchParams.get("dataset"), "39")
  assert.equal(url.searchParams.get("metric"), "Gross profit & margin")
  assert.equal(url.searchParams.get("returnTo"), "/dashboard/datasets/39")
  const html = render(CreateDecisionLink, { href })
  assert.match(html, /href="\/dashboard\/decisions\/new\?/)
  assert.match(html, />Create decision<\/a>/)
})

test("manual creation omits empty metrics and invalid dataset ids", () => {
  for (const datasetId of [undefined, 0, -1, 1.5, NaN]) {
    const url = new URL(buildCreateDecisionHref({ datasetId, metric: "  " }), "https://decisionate.test")
    assert.equal(url.searchParams.has("dataset"), false)
    assert.equal(url.searchParams.has("metric"), false)
    assert.equal(url.searchParams.get("returnTo"), "/dashboard/decisions")
  }
})

test("creation and pending labels use the existing translation hook", () => {
  const { CreateDecisionButton: TranslatedButton } = loadSource(
    "features/decisions/components/create-decision-action.tsx", text => `translated:${text}`,
  )
  assert.match(render(TranslatedButton, {}), />translated:Create decision<\/span>/)
  assert.match(render(TranslatedButton, { creating: true }), />translated:Creating\.\.\.<\/span>/)
})

test("insight cards only offer creation when a permitted callback is supplied", () => {
  const { InsightCard } = loadSource("features/insights/components/insight-card.tsx")
  const insight = { title: "Revenue change", description: "Review the change in revenue." }
  assert.doesNotMatch(render(InsightCard, { insight }), /<button/)
  const html = render(InsightCard, { insight, onCreateDecision: () => {}, actionDisabled: true })
  assert.match(html, /title="Create a decision from Revenue change"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /mt-auto/)
})

test("recommendation cards keep the action after the evidence and omit it for read-only access", () => {
  const { RecommendationCard } = loadSource("features/dashboard/components/recommendation-card.tsx")
  const props = { title: "Review spending", reason: "Costs increased", confidence: "high", decisionBrief: "Review costs.", creatingDecision: false }
  assert.doesNotMatch(render(RecommendationCard, props), /<button/)
  const html = render(RecommendationCard, { ...props, onCreateDecision: () => {} })
  assert.ok(html.indexOf("Costs increased") < html.indexOf("<button"))
  assert.match(html, /mt-auto/)
})

function sourceAst(relativePath) {
  return ts.createSourceFile(relativePath, readFileSync(path.join(webRoot, relativePath), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function findNodes(ast, predicate) {
  const nodes = []
  function visit(node) {
    if (predicate(node)) nodes.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return nodes
}

test("manual creation appears once in the Decisions header and dashboard toolbar", () => {
  for (const [relativePath, tag] of [["app/dashboard/decisions/page.tsx", "CreateDecisionLink"], ["app/dashboard/page.tsx", "CreateDecisionButton"]]) {
    const ast = sourceAst(relativePath)
    const actions = findNodes(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === tag)
    assert.equal(actions.length, 1, relativePath)
  }
})

test("follow-up queues and read-only public dashboards have no create action", () => {
  for (const relativePath of ["app/dashboard/action-needed/page.tsx", "app/share/dashboard/page.tsx"]) {
    const source = readFileSync(path.join(webRoot, relativePath), "utf8")
    assert.doesNotMatch(source, /\/decisions\/new|CreateDecisionButton|CreateDecisionLink|handleDemoCreateDecision/)
  }
})

test("Decision Performance renders the shared action toolbar outside the analysis card", () => {
  const ast = sourceAst("features/dashboards/dashboard-registry.tsx")
  const [dashboard] = findNodes(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === "DecisionPerformanceDashboard")
  const toolbars = findNodes(dashboard, node => ts.isJsxExpression(node) && node.expression?.getText(ast) === "managementActions")
  assert.equal(toolbars.length, 1)
})

test("every direct decision handler checks decision permissions rather than data-management permissions", () => {
  const pages = ["insights", "reports", "forecasts", "datasets/[id]", "decisions/new", "alerts"]
  for (const page of pages) {
    const relativePath = `app/dashboard/${page}/page.tsx`
    const ast = sourceAst(relativePath)
    const handlers = findNodes(ast, node => ts.isFunctionDeclaration(node) && /^handleCreate/.test(node.name?.text ?? ""))
    assert.ok(handlers.length > 0, page)
    for (const handler of handlers) {
      const permissionChecks = findNodes(handler, node => ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && node.operand.getText(ast) === "canCreateDecisions")
      assert.ok(permissionChecks.length > 0, `${page}: ${handler.name.text}`)
    }
  }
})
