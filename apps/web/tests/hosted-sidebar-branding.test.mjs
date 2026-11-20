import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(source, dependencies = {}, context = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, ...context, require: name => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } })
  return loaded.exports
}
const brand = load(read("../lib/workspace-brand.ts"), { "@/lib/portal-brand": {
  portalBrand: { name: "Decisionate", logo: "/icons/decisionate-logo.png", color: "#2563EB" },
} })

test("the agency's main-app brand uses its published hosted logo while retaining its workspace name and colors", () => {
  const organization = { name: "Agency workspace", logo_url: "https://agency.test/standard.png",
    hosted_portal_logo_url: "https://agency.test/published.png", primary_color: "#047857", accent_color: "#B91C1C" }
  const value = brand.getWorkspaceBrand("agency", "agency", organization, [], "Owner")
  assert.equal(value.logoUrl, organization.hosted_portal_logo_url)
  assert.equal(value.name, organization.name)
  assert.equal(value.primaryColor, organization.primary_color)
  assert.equal(value.accentColor, organization.accent_color)
  for (const absent of [undefined, null]) {
    assert.equal(brand.getWorkspaceBrand("agency", "agency", { ...organization, hosted_portal_logo_url: absent }, [], "Owner").logoUrl,
      organization.logo_url)
  }
  assert.equal(brand.getWorkspaceBrand("agency", "agency", { ...organization, hosted_portal_logo_url: "" }, [], "Owner").logoUrl, "")
})

test("switching to a client or unknown workspace never borrows the owner's hosted logo", () => {
  const organization = { name: "Agency", hosted_portal_logo_url: "https://agency.test/published.png" }
  const client = { owner_user_id: "client", name: "Client", logo_url: "https://client.test/logo.png" }
  assert.equal(brand.getWorkspaceBrand("client", "agency", organization, [client], "Owner").logoUrl, client.logo_url)
  assert.equal(brand.getWorkspaceBrand("unknown", "agency", organization, [client], "Owner"), brand.defaultWorkspaceBrand)
  assert.equal(brand.getWorkspaceBrand("agency", undefined, organization, [client], "Owner"), brand.defaultWorkspaceBrand)
})

test("sidebar logos use the existing proportional, transparent image renderer with a broken-image fallback", () => {
  const { renderToStaticMarkup } = require("react-dom/server")
  const source = read("../app/dashboard/workspace-brand-mark.tsx")
  const render = (logoUrl, failed = null) => {
    const { WorkspaceBrandMark } = load(source, {
      react: { useState: () => [failed, () => {}] }, "react/jsx-runtime": require("react/jsx-runtime"), "@/lib/workspace-brand": brand,
    })
    return renderToStaticMarkup(React.createElement(WorkspaceBrandMark, { name: "Agency", logoUrl, primaryColor: "#047857", className: "h-10 w-10" }))
  }
  const logo = "https://agency.test/wide-logo.png", visible = render(logo)
  assert.match(visible, /background-color:transparent/)
  assert.match(visible, /object-contain/)
  assert.match(visible, /src="https:\/\/agency.test\/wide-logo.png"/)
  const failed = render(logo, logo)
  assert.doesNotMatch(failed, /<img/)
  assert.match(failed, /background-color:#047857/)
  assert.match(failed, /<span>A<\/span>/)
  assert.match(render("https://agency.test/replacement.png", logo), /<img/)
  const shell = read("../app/dashboard/dashboard-shell.tsx")
  assert.match(shell, /<WorkspaceBrandMark\s+name=\{displayBrand.name\}\s+logoUrl=\{displayBrand.logoUrl\}/)
  assert.match(shell, /logoUrl: getHostedLogo\(portal.branding\)/)
})

test("successful portal publication refreshes the agency brand once; drafts, failures and other operations do not", async () => {
  const api = read("../lib/api.ts"), ast = ts.createSourceFile("api.ts", api, ts.ScriptTarget.Latest, true)
  const request = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "hostedSubdomainRequest").getText(ast)
  for (const [path, init, admin, ok, refreshed] of [
    ["/activate", { method: "POST" }, false, true, true],
    ["/activate", { method: "post" }, false, true, true],
    ["/activate", { method: "POST" }, false, false, false],
    ["", { method: "PUT" }, false, true, false],
    ["", {}, false, true, false],
    ["/activate", { method: "POST" }, true, true, false],
    ["/activate", {}, false, true, false],
  ]) {
    const invalidated = [], events = [], result = { id: "portal", published: true }
    const { hostedSubdomainRequest } = load(request, {}, { API_URL: "https://api.test",
      workspaceJsonHeaders: async () => ({}),
      apiFetch: async () => ({ ok, json: async () => result }), throwApiError: async () => { throw new Error("Cannot publish") },
      invalidateApiReadCache: values => invalidated.push(Array.from(values)), notifyWorkspaceAccessChanged: () => events.push("refresh"),
    })
    if (ok) assert.equal(await hostedSubdomainRequest("agency", path, init, admin), result)
    else await assert.rejects(hostedSubdomainRequest("agency", path, init, admin), /Cannot publish/)
    assert.deepEqual(events, refreshed ? ["refresh"] : [])
    assert.deepEqual(invalidated, refreshed ? [["organization:agency", "organization-workspaces:agency"]] : [])
  }
})
