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
  const organization = { name: "Agency", hosted_portal_logo_url: "https://agency.test/published.png",
    hosted_portal_colors: { primary_color: "#A52154", accent_color: "#347850", background_color: "#FDF5F9" } }
  const client = { owner_user_id: "client", name: "Client", logo_url: "https://client.test/logo.png" }
  const own = brand.getWorkspaceBrand("agency", "agency", organization, [client], "Owner")
  assert.equal(own.primaryColor, organization.hosted_portal_colors.primary_color)
  assert.equal(own.accentColor, organization.hosted_portal_colors.accent_color)
  assert.equal(own.backgroundColor, organization.hosted_portal_colors.background_color)
  const clientBrand = brand.getWorkspaceBrand("client", "agency", organization, [client], "Owner")
  assert.equal(clientBrand.logoUrl, client.logo_url)
  assert.equal(clientBrand.backgroundColor, undefined)
  assert.equal(clientBrand.primaryColor, brand.defaultBrandPrimaryColor)
  assert.equal(brand.getWorkspaceBrand("unknown", "agency", organization, [client], "Owner"), brand.defaultWorkspaceBrand)
  assert.equal(brand.getWorkspaceBrand("agency", undefined, organization, [client], "Owner"), brand.defaultWorkspaceBrand)
})

test("published colors drive branded controls and keep readable text on light and dark workspace canvases", () => {
  const contrast = (a, b) => {
    const luminance = color => color.slice(1).match(/../g).reduce((sum, item, index) => {
      const value = parseInt(item, 16) / 255
      return sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    }, 0)
    const foreground = luminance(a), background = luminance(b)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  }
  const colors = { ...brand.defaultWorkspaceBrand, primaryColor: "#FEBA11", accentColor: "#762F7E", backgroundColor: "#FDF5F9" }
  const style = brand.getWorkspaceThemeStyle(colors)
  assert.equal(style["--decisionate-brand-primary"], colors.primaryColor)
  assert.equal(style["--decisionate-brand-accent"], colors.accentColor)
  assert.equal(style["--decisionate-brand-accent-soft"], `${colors.accentColor}12`)
  assert.equal(style["--decisionate-workspace-background-light"], colors.backgroundColor)
  assert.notEqual(style["--decisionate-workspace-background-dark"], colors.backgroundColor)
  for (const backgroundColor of [colors.backgroundColor, "#A9467B", "#10134E", "#FFFFFF", "#000000"]) {
    const theme = brand.getWorkspaceThemeStyle({ ...colors, backgroundColor })
    assert.ok(contrast(theme["--decisionate-brand-primary-surface-text"], colors.primaryColor) >= 4.5)
    for (const [mode, foreground, panel] of [["light", "#6B7280", "#FFFFFF"], ["dark", "#A6ADB6", "#191B20"]]) {
      const canvas = theme[`--decisionate-workspace-background-${mode}`]
      assert.ok(contrast(foreground, canvas) >= 4.5)
      for (const token of ["primary", "accent"]) {
        const text = theme[`--decisionate-workspace-${token}-${mode}`]
        assert.ok(contrast(text, canvas) >= 4.5, `${mode} ${text} on ${canvas}`)
        assert.ok(contrast(text, panel) >= 4.5, `${mode} ${text} on ${panel}`)
      }
    }
  }
  const fallback = brand.getWorkspaceThemeStyle({ ...colors, primaryColor: "not-a-color", backgroundColor: "url(unsupported)" })
  assert.equal(fallback["--decisionate-brand-primary"], brand.defaultBrandPrimaryColor)
  assert.equal(fallback["--decisionate-workspace-background-light"], "#F9FAFB")
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
  assert.match(shell, /logoUrl: getHostedLogo\(portalBranding\)/)
  assert.match(shell, /backgroundColor: portalBranding.background_color/)
  assert.match(shell, /style=\{themeStyle\} data-workspace-brand/)
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
