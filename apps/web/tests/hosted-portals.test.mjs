import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = path => readFileSync(new URL(path, import.meta.url), "utf8")
const setup = source("../features/white-label/hosted-setup.tsx")
function load(text, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module: loaded, exports: loaded.exports, Error, URL, Headers, ...globals })
  return loaded.exports
}
function extract(text, name, parent) {
  const tree = ts.createSourceFile("source.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes = parent ? tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === parent).body.statements : tree.statements
  return nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree)
}

test("portal brand keeps the default site unchanged and does not borrow its logo", () => {
  const text = source("../lib/portal-brand.ts")
  const regular = load(text, { process: { env: {} } }).portalBrand
  assert.equal(regular.name, "Decisionate")
  assert.equal(regular.logo, "/icons/decisionate-logo.png")
  const portal = load(text, { process: { env: { NEXT_PUBLIC_PORTAL_ID: "portal-one", NEXT_PUBLIC_PORTAL_NAME: "North Star", NEXT_PUBLIC_PORTAL_COLOR: "#116644" } } }).portalBrand
  assert.equal(portal.name, "North Star")
  assert.equal(portal.color, "#116644")
  assert.equal(portal.logo, "")
})

test("hosted requests use the agency owner's workspace and preserve an abort signal", async () => {
  let call, owners
  const signal = new AbortController().signal
  const { hostedPortalRequest } = load(extract(source("../lib/api.ts"), "hostedPortalRequest"), {
    API_URL: "https://api.example", workspaceJsonHeaders: async (...ids) => { owners = ids; return { Authorization: "Bearer owner" } },
    apiFetch: async (...args) => { call = args; return { ok: true, json: async () => ({ saved: true }) } },
  })
  assert.equal((await hostedPortalRequest("agency", "/prepare", { method: "POST", signal })).saved, true)
  assert.deepEqual(owners, ["agency", "agency"])
  assert.equal(call[0], "https://api.example/api/v2/hosted-portals/prepare")
  assert.equal(call[1].signal, signal)
  assert.equal(call[1].cache, "no-store")
  assert.equal(call[2], 120000)
})

test("shared portal admin requests do not inherit the selected client workspace", async () => {
  let call, owners
  const signal = new AbortController().signal
  const { hostedSubdomainRequest } = load(extract(source("../lib/api.ts"), "hostedSubdomainRequest"), {
    API_URL: "https://api.example", workspaceJsonHeaders: async (...ids) => { owners = ids; return {} },
    apiFetch: async (...args) => { call = args; return { ok: true, json: async () => ({ saved: true }) } },
  })
  await hostedSubdomainRequest("operator", "/portal/status", { method: "POST", signal }, true)
  assert.deepEqual(owners, ["operator", "operator"])
  assert.equal(call[0], "https://api.example/admin/hosted-subdomains/portal/status")
  assert.equal(call[1].signal, signal)
  assert.equal(call[1].cache, "no-store")
  await hostedSubdomainRequest("agency")
  assert.deepEqual(owners, ["agency", undefined])
  assert.equal(call[0], "https://api.example/api/v2/hosted-subdomains")
  assert.match(source("../features/white-label/settings-link.tsx"), /HostedSettingsLink key=\{activeWorkspaceId\}/)
})

test("Settings only probes custom-domain setup for a custom-domain plan in the user's own workspace", async () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
  for (const [plan, workspace, hostedPortal, expected] of [
    ["agency_subdomain", "agency", null, ["subdomain"]],
    ["agency", "agency", null, ["subdomain"]],
    ["agency_custom_domain", "agency", null, ["subdomain", "custom-domain"]],
    ["agency_custom_domain", "another-agency", null, ["subdomain"]],
    ["professional", "agency", null, []],
    ["agency_custom_domain", "agency", { id: "hosted" }, []],
  ]) {
    const effects = [], calls = [], cleanups = []
    const { WhiteLabelSettingsLink } = load(source("../features/white-label/settings-link.tsx"), { AbortController,
      require: name => ({
        "react/jsx-runtime": require("react/jsx-runtime"),
        react: { ...React, useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect) },
        "next/link": { default: props => React.createElement("a", props) },
        "@/lib/api": {
          hostedSubdomainRequest: async () => { calls.push("subdomain"); return { commercially_available: true, portal: null } },
          hostedPortalRequest: async () => { calls.push("custom-domain"); return { commercially_available: true, portal: null } },
        },
        "@/features/hosted-subdomains/provider": { useHostedPortal: () => ({ portal: hostedPortal }) },
        "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: workspace }) },
      })[name],
    })
    renderToStaticMarkup(React.createElement(WhiteLabelSettingsLink, { userId: "agency", plan }))
    for (const effect of effects) cleanups.push(effect())
    await new Promise(resolve => setImmediate(resolve))
    for (const cleanup of cleanups) cleanup?.()
    assert.deepEqual(calls, expected, plan + " in " + workspace)
  }
  assert.match(source("../app/dashboard/settings/settings-client.tsx"), /<WhiteLabelSettingsLink userId=\{userId\} plan=\{billingStatus\?\.plan \|\| ""\}/)
})

test("preparation stops on DNS waiting, readiness or unmount without launching automatically", async () => {
  const prepareText = `export ${extract(setup, "prepare", "HostedPortalSetup")}`
  for (const terminal of ["waiting", "ready", "live"]) {
    let calls = 0
    const seen = [], mounted = { current: true }
    const { prepare } = load(prepareText, { userId: "owner", mounted, accept: value => seen.push(value),
      hostedPortalRequest: async (_, path) => { assert.equal(path, "/prepare"); calls++; return { status: calls === 1 ? "preparing" : terminal } },
    })
    await prepare()
    assert.equal(calls, 2)
    assert.equal(seen.at(-1).status, terminal)
    mounted.current = false
    await prepare()
    assert.equal(calls, 2)
  }
})

test("disabled custom-domain setup stays hidden even when a portal draft exists", () => {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
  for (const enabled of [false, true]) {
    const { CustomSettingsLink } = load(source("../features/white-label/settings-link.tsx").replace("function CustomSettingsLink", "export function CustomSettingsLink"), {
      process: { env: {} },
      require: name => ({
        "react/jsx-runtime": require("react/jsx-runtime"),
        react: { ...React, useState: () => [{ commercially_available: enabled, portal: { id: "existing" } }, () => {}], useEffect() {} },
        "next/link": { default: props => React.createElement("a", props) },
        "@/lib/api": {},
        "@/features/hosted-subdomains/provider": {},
        "@/lib/use-active-workspace": {},
      })[name],
    })
    const html = renderToStaticMarkup(React.createElement(CustomSettingsLink, { userId: "agency" }))
    assert.equal(html.includes("/white-label"), enabled)
  }
})

test("duplicate clicks are ignored and failures leave setup retryable", async () => {
  const working = { current: false }, busy = [], errors = []
  const { run } = load(`export ${extract(setup, "run", "HostedPortalSetup")}`, {
    working, mounted: { current: true }, setBusy: value => busy.push(value), setError: value => errors.push(value), setMessage() {},
  })
  let finish, calls = 0
  const pending = run(() => new Promise(resolve => { calls++; finish = resolve }))
  await run(async () => { calls++ })
  assert.equal(calls, 1)
  finish(); await pending
  await run(async () => { throw new Error("Provider unavailable") })
  assert.equal(errors.at(-1), "Provider unavailable")
  assert.equal(busy.at(-1), false)
  assert.equal(working.current, false)
})

test("failed launch reloads readiness and keeps the original error if refreshing also fails", async () => {
  for (const refreshFails of [false, true]) {
    let refreshed = false
    const { launch } = load(`export ${extract(setup, "launch", "HostedPortalSetup")}`, {
      userId: "owner", mounted: { current: true }, accept: () => assert.fail("Must not mark live"),
      hostedPortalRequest: async () => { throw new Error("Check setup again") },
      refresh: async () => { refreshed = true; if (refreshFails) throw new Error("Network unavailable") },
    })
    await assert.rejects(launch(), /Check setup again/)
    assert.equal(refreshed, true)
  }
})

test("hosted portal routing keeps default marketing and operator pages off customer domains", async () => {
  const portalBrand = { id: "portal-one", url: "https://portal.example", privacy: "https://company.example/privacy", terms: "https://company.example/terms" }
  class NextResponse { constructor(body, init) { this.body = body; this.status = init.status } static redirect(url) { return url.href } static next() { return "next" } }
  let authCalls = 0
  const { default: proxy } = load(source("../proxy.ts"), { require: name => {
    if (name === "./features/hosted-subdomains/server") return {}
    if (name === "./features/hosted-subdomains/unavailable-page") return load(source("../features/hosted-subdomains/unavailable-page.ts"))
    if (name === "./features/hosted-subdomains/types") return load(source("../features/hosted-subdomains/types.ts"))
    if (name === "./lib/application-routes") return load(source("../lib/application-routes.ts"))
    if (name === "./lib/portal-brand") return { portalBrand }
    if (name === "./lib/decisionate-domains") return load(source("../lib/decisionate-domains.ts"))
    if (name === "next/server") return { NextResponse, NextRequest: class { constructor(request, init) { Object.assign(this, request, init) } } }
    if (name.includes("auth-redirects")) return {}
    if (name === "@clerk/nextjs/server") return {
      createRouteMatcher: patterns => request => patterns.some(pattern => new RegExp(`^${pattern}$`).test(request.nextUrl.pathname)),
      clerkMiddleware: () => async () => { authCalls++; return "clerk" },
    }
    throw new Error(`Unexpected dependency: ${name}`)
  } })
  const run = path => proxy({ nextUrl: new URL(path, portalBrand.url), url: new URL(path, portalBrand.url).href }, {})
  assert.equal(await run("/"), "https://portal.example/sign-in")
  assert.equal(await run("/privacy"), portalBrand.privacy)
  assert.equal(await run("/terms"), portalBrand.terms)
  assert.equal((await run("/platform-admin")).status, 404)
  assert.equal((await run("/white-label")).status, 404)
  assert.equal((await run("/dashboard/white-label")).status, 404)
  assert.equal((await run("https://preview.vercel.app/dashboard")).status, 404)
  assert.equal(authCalls, 0)
  assert.equal(await run("/dashboard"), "clerk")
  assert.equal(authCalls, 1)
})
