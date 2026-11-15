import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
function load(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"), loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module: loaded, exports: loaded.exports, process: { env: {} }, require: name => {
      assert.ok(name in imports, `Unexpected dependency: ${name}`)
      return imports[name]
    } })
  return loaded.exports
}
const routes = load("../lib/application-routes.ts")
const config = load("../next.config.ts", { "./lib/application-routes": routes }).default

test("clean workspace URLs rewrite to existing pages without moving their shared layout", async () => {
  const rewrites = await config.rewrites()
  assert.equal(rewrites.length, routes.workspaceRoutes.length)
  assert.ok(existsSync(new URL("../app/dashboard/layout.tsx", import.meta.url)))
  for (const { path, internal } of routes.workspaceRoutes) {
    assert.match(path, /^\/[a-z-]+$/)
    assert.ok(existsSync(new URL(`../app${internal}/page.tsx`, import.meta.url)), internal)
    const rewrite = rewrites.find(item => item.source === `${path}/:path*`)
    assert.equal(rewrite.destination, `${internal}/:path*`)
    assert.equal(routes.canonicalWorkspacePathname(internal), path)
    assert.equal(routes.canonicalWorkspacePathname(path), path)
  }
})

test("public, authentication, API and shared dashboard routes are outside the workspace rewrites", () => {
  for (const path of ["/", "/privacy", "/terms", "/security", "/demo", "/auth/redirect", "/sign-in", "/sign-up", "/api/portal-health", "/share/dashboard", "/public/dashboard/104", "/_next/static/app.js"]) {
    assert.equal(routes.isWorkspacePathname(path), false, path)
    assert.equal(routes.canonicalWorkspacePathname(path), path)
  }
  assert.equal(routes.isWorkspacePathname("/dashboard"), true)
  assert.equal(routes.canonicalWorkspacePathname("/dashboard"), "/dashboard")
  assert.equal(routes.canonicalWorkspacePathname("/dashboard/reports/weekly"), "/weekly-reports")
  assert.equal(routes.canonicalWorkspacePathname("/dashboard/reports/combined"), "/business-analysis/combined")
})

test("business analysis has a matching URL while historical reports and weekly links stay compatible", () => {
  for (const [oldPath, expected] of [
    ["/reports", "/business-analysis"], ["/reports/impact", "/business-analysis/impact"],
    ["/reports/returns", "/business-analysis/returns"], ["/dashboard/reports", "/business-analysis"],
    ["/reports/weekly", "/weekly-reports"], ["/business-analysis/weekly", "/weekly-reports"],
    ["/dashboard/reports/weekly", "/weekly-reports"],
  ]) assert.equal(routes.canonicalWorkspacePathname(oldPath), expected)
  for (const path of ["/reports-fake", "/reportsevil", "/business-analysis-fake"]) {
    assert.equal(routes.canonicalWorkspacePathname(path), path)
    assert.equal(routes.isWorkspacePathname(path), false)
  }
})

test("all sidebar navigation items use root-level URLs, not internal layout paths", () => {
  const source = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
  const tree = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const group = tree.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find(node => node.name.getText(tree) === "dashboardNavGroups")
  assert.ok(group)
  const hrefs = []
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "href") hrefs.push(node.initializer.text)
    ts.forEachChild(node, visit)
  }
  visit(group)
  assert.ok(hrefs.includes("/connections") && hrefs.includes("/decisions") && hrefs.includes("/weekly-reports"))
  assert.ok(hrefs.includes("/business-analysis"))
  assert.ok(!hrefs.includes("/reports"))
  for (const href of hrefs) {
    assert.match(href, /^\/[a-z-]+$/)
    assert.equal(routes.isWorkspacePathname(href), true)
  }
})
