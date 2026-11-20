import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server"), jsx = require("react/jsx-runtime")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, dependencies = {}, context = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, URL, AbortSignal, ...context, require: name => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } })
  return loaded.exports
}
const types = load("../features/hosted-subdomains/types.ts")
const routes = load("../lib/application-routes.ts")
const redirects = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })
const brand = { name: "North Star", logo_url: "https://cdn.agency.test/logo.png", favicon_url: "", primary_color: "#047857",
  support_email: "help@agency.test", welcome_heading: "Welcome back", welcome_text: "Your business results", background_color: "#F8FAFC" }
const portal = { id: "north", hostname: "north.decisionate.app", origin: "https://north.decisionate.app", active: true, branding: brand }
const returnTo = portal.origin + "/auth/redirect?redirect_url=%2Fconnections%3Fworkspace_id%3Dclient&__clerk_synced=false"
const defaultBrand = { id: "", name: "Decisionate", logo: "/icons/decisionate-logo.png", privacy: "/privacy", terms: "/terms" }

function serverHarness({ host = "app.decisionate.ca", target = returnTo, result = portal, ok = true } = {}) {
  const calls = []
  return { calls, ...load("../features/hosted-subdomains/server.ts", {
    "server-only": {}, react: { cache: fn => fn },
    "next/headers": { headers: async () => new Headers({ host, "x-forwarded-proto": "https", ...(target ? { "x-decisionate-hosted-return": target } : {}) }) },
    "@/features/auth/lib/auth-redirects": redirects, "./types": types,
  }, { process: { env: { NEXT_PUBLIC_API_URL: "https://api.test" } }, fetch: async url => {
    calls.push(url); return { ok, json: async () => result }
  } }) }
}

test("central authentication resolves branding only from a verified active hosted return", async () => {
  const service = serverHarness()
  assert.equal(await service.requestHostedAuthPortal(), portal)
  assert.deepEqual(service.calls, ["https://api.test/api/v2/hosted-subdomains/resolve?hostname=north.decisionate.app"])
  for (const target of [null, "https://evil.test/auth/redirect", "http://north.decisionate.app/auth/redirect",
    "https://north.decisionate.app/sign-in", "https://north.decisionate.app/", "https://user@north.decisionate.app/auth/redirect"]) {
    const rejected = serverHarness({ target })
    assert.equal(await rejected.requestHostedAuthPortal(), null, String(target))
    assert.equal(rejected.calls.length, 0)
  }
  for (const options of [{ host: "north.decisionate.app" }, { host: "evil.test" }, { ok: false },
    { result: { ...portal, active: false } }, { result: { ...portal, branding: null } },
    { result: { ...portal, hostname: "another.decisionate.app" } }]) {
    assert.equal(await serverHarness(options).requestHostedAuthPortal(), null)
  }
})

function providerOptions(authPortal, target = null) {
  let captured
  const { AppClerkProvider } = load("../app/clerk-provider.tsx", {
    "react/jsx-runtime": jsx, react: { useEffect() {} },
    "@clerk/nextjs": { ClerkProvider: props => { captured = props; return props.children }, useAuth: () => ({ getToken() {} }) },
    "@/lib/api": { setClerkSessionTokenProvider() {} }, "@/features/auth/lib/auth-redirects": redirects,
    "@/features/hosted-subdomains/types": types,
  })
  renderToStaticMarkup(React.createElement(AppClerkProvider, { authPortal, hostedReturn: target }, "Credentials"))
  return captured
}

test("agency authentication branding does not turn the primary Clerk provider into a satellite", () => {
  const options = providerOptions(portal, returnTo)
  assert.equal(options.isSatellite, undefined)
  assert.equal(options.domain, undefined)
  assert.equal(options.proxyUrl, undefined)
  assert.equal(options.appearance.options.logoImageUrl, brand.logo_url)
  assert.equal(options.appearance.options.logoLinkUrl, portal.origin)
  assert.equal(options.appearance.options.helpPageUrl, "mailto:help@agency.test")
  assert.equal(options.appearance.variables.colorPrimary, brand.primary_color)
  assert.equal(options.appearance.elements.logoBox.display, "none", "The page header displays the logo once")
  assert.equal(options.localization.signIn.start.title, "Sign in")
  assert.equal(options.signInForceRedirectUrl, returnTo)
  assert.equal(options.signUpForceRedirectUrl, returnTo)
  assert.deepEqual(Array.from(options.allowedRedirectOrigins), [portal.origin])
  assert.equal(options.afterSignOutUrl, "/sign-in")
  for (const stage of ["emailCode", "emailCodeMfa", "emailLink", "emailLinkMfa", "phoneCode"]) {
    assert.equal(options.localization.signIn[stage].subtitle, "to continue to your workspace")
  }
  assert.equal(options.localization.signUp.emailLink.subtitle, "to continue to your workspace")
  assert.doesNotMatch(JSON.stringify(options.localization), /Decisionate|applicationName/)
  const regular = providerOptions(null)
  assert.equal(regular.appearance, undefined)
  assert.equal(regular.localization, undefined)
  assert.equal(regular.signInForceRedirectUrl, "/auth/redirect")
})

function renderLayout(authPortal = portal, mode = "sign-in", target = returnTo, showAccountLink = true) {
  const { AuthLayout } = load("../features/auth/components/auth-layout.tsx", {
    "react/jsx-runtime": jsx,
    "next/image": { default: props => React.createElement("img", Object.fromEntries(Object.entries(props).filter(([key]) => !["priority", "unoptimized"].includes(key)))) },
    "next/link": { default: props => React.createElement("a", props) },
    "@/app/auth-page-copy": { AuthPageCopy: props => React.createElement("p", {}, props.description) },
    "@/app/theme-toggle": { ThemeToggle: () => null },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
    "../lib/auth-redirects": redirects, "@/lib/portal-brand": { portalBrand: defaultBrand },
    "@/features/hosted-subdomains/provider": { useHostedPortal: () => ({ authPortal, returnTo: authPortal ? target : null }) },
    "@/features/hosted-subdomains/types": types,
  })
  return renderToStaticMarkup(React.createElement(AuthLayout, { mode, title: "Sign in", description: "Welcome back to Decisionate.", showAccountLink }, "Credentials"))
}

test("invited clients can create a login from branded credentials without losing the agency or workspace", () => {
  const html = renderLayout()
  assert.match(html, /src="https:\/\/cdn.agency.test\/logo.png"/)
  assert.match(html, /href="https:\/\/north.decisionate.app"/)
  assert.match(html, /Use the email address that received your invitation/)
  assert.match(html, /Invited to this workspace\?/)
  assert.match(html, /Create your login/)
  assert.doesNotMatch(html, /New here|Create an account/)
  assert.doesNotMatch(html, /Decisionate|decisionate-logo.png/)
  assert.ok(html.includes(`/sign-up?redirect_url=${encodeURIComponent(returnTo)}`))
  const signup = renderLayout(portal, "sign-up")
  assert.match(signup, /Use the email address that received your invitation/)
  assert.ok(signup.includes(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`))
  const regular = renderLayout(null)
  assert.match(regular, /Welcome back to Decisionate/)
  assert.match(regular, /src="\/icons\/decisionate-logo.png"/)
  assert.match(regular, /Create an account/)
  const withoutLogo = renderLayout({ ...portal, branding: { ...brand, logo_url: "" } })
  assert.match(withoutLogo, /North Star/)
  assert.doesNotMatch(withoutLogo, /<img|decisionate-logo.png/)
  const literalName = renderLayout({ ...portal, branding: { ...brand, name: "Agency {{applicationName}} & Co" } })
  assert.match(literalName, /Agency \{\{applicationName\}\} &amp; Co/)
})

test("ordinary agency sign-in hides public signup while retaining invitation and existing-account navigation", () => {
  for (const path of ["/auth/redirect", "/auth/redirect?redirect_url=%2Fconnections", "/connections",
    "/auth/redirect?redirect_url=%2Fdashboard%3Fworkspace_id%3D", "/auth/redirect?redirect_url=https%3A%2F%2Fevil.test%2Fdashboard%3Fworkspace_id%3Dclient"]) {
    const html = renderLayout(portal, "sign-in", portal.origin + path)
    assert.match(html, /Welcome back to North Star/)
    assert.match(html, /Credentials/)
    assert.doesNotMatch(html, /New here|Create an account|Create your login|sign-up/)
  }
  const directInvite = portal.origin + "/dashboard?workspace_id=client&__clerk_synced=false"
  const invited = renderLayout(portal, "sign-in", directInvite)
  assert.match(invited, /Create your login/)
  assert.ok(invited.includes(`/sign-up?redirect_url=${encodeURIComponent(directInvite)}`))
  assert.doesNotMatch(renderLayout(portal, "sign-in", returnTo, false), /Create your login/)
  assert.match(renderLayout(portal, "sign-up"), /Already have an account/)
})

test("only an existing Clerk session at a hosted invitation entry sees the continuation action", async () => {
  const ContinueHostedInvitation = () => null, ClerkAuthCard = () => null
  for (const mode of ["sign-in", "sign-up"]) {
    for (const [target, sessionId, isInvitation] of [[returnTo, "session_existing", true], [returnTo, null, true],
      [portal.origin + "/auth/redirect", "session_existing", false], [null, "session_existing", false]]) {
      let sessionLookups = 0
      const { AuthCard } = load("../app/auth-card.tsx", {
        "react/jsx-runtime": jsx,
        "@clerk/nextjs/server": { auth: async () => { sessionLookups++; return { sessionId } } },
        "next/headers": { headers: async () => new Headers(target ? { "x-decisionate-hosted-return": target } : {}) },
        "@/features/auth/lib/auth-redirects": redirects,
        "@/features/auth/components/continue-hosted-invitation": { ContinueHostedInvitation },
        "./clerk-auth-card": { ClerkAuthCard },
      })
      const card = await AuthCard({ mode })
      assert.equal(sessionLookups, Number(isInvitation))
      assert.equal(card.type, isInvitation && sessionId ? ContinueHostedInvitation : ClerkAuthCard)
      assert.equal(card.props.mode, mode)
      if (card.type === ContinueHostedInvitation) {
        assert.equal(card.props.hostedReturn, target)
        assert.equal(card.props.sessionId, sessionId)
      }
    }
  }
})

test("continuing an invitation signs out only the selected Clerk session and keeps the original auth mode", async () => {
  for (const mode of ["sign-in", "sign-up"]) {
    let calls = [], fail = true, stateIndex = 0
    const state = [false, false]
    const { ContinueHostedInvitation } = load("../features/auth/components/continue-hosted-invitation.tsx", {
      "react/jsx-runtime": jsx,
      react: { useState: () => { const index = stateIndex++; return [state[index], value => { state[index] = value }] } },
      "@clerk/nextjs": { useClerk: () => ({ signOut: async options => { calls.push(options); if (fail) throw new Error("Unavailable") } }) },
      "lucide-react": { ArrowRight: () => null },
      "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
    })
    function view() {
      stateIndex = 0
      return ContinueHostedInvitation({ mode, hostedReturn: returnTo, sessionId: "session_current" })
    }
    const rendered = view()
    assert.match(renderToStaticMarkup(rendered), /Continuing signs out the current account/)
    assert.deepEqual(calls, [], "Opening the invitation must not sign out the visitor")
    rendered.props.children[0].props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    assert.match(renderToStaticMarkup(view()), /Please try again/)
    fail = false
    view().props.children[0].props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(view().props.children[0].props.disabled, true)
    assert.equal(calls.length, 2)
    for (const { redirectUrl, sessionId } of calls) {
      const url = new URL(redirectUrl, "https://app.decisionate.ca")
      assert.equal(url.origin, "https://app.decisionate.ca")
      assert.equal(url.pathname, `/${mode}`)
      assert.equal(url.searchParams.get("redirect_url"), returnTo)
      assert.equal(sessionId, "session_current")
    }
  }
})

test("Clerk's sign-in widget keeps the existing hosted return and recovery routing", () => {
  let props
  const { ClerkAuthCard } = load("../app/clerk-auth-card.tsx", {
    "react/jsx-runtime": jsx, react: React, "lucide-react": { ArrowRight: () => null, RefreshCw: () => null },
    "@clerk/nextjs": { ClerkLoaded: ({ children }) => children, ClerkLoading: () => null, ClerkFailed: () => null,
      SignIn: value => { props = value; return null } },
    "next/link": { default: value => React.createElement("a", value) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: value => value }) },
    "@/features/auth/lib/auth-redirects": redirects, "@/features/auth/lib/signup-consent": {},
    "@/features/marketing/email-preferences": {},
    "@/features/hosted-subdomains/provider": { useHostedPortal: () => ({ authPortal: portal, returnTo }) },
  })
  renderToStaticMarkup(React.createElement(ClerkAuthCard, { mode: "sign-in" }))
  assert.equal(props.forceRedirectUrl, returnTo)
  assert.equal(props.fallbackRedirectUrl, returnTo)
  assert.equal(props.path, "/sign-in")
  assert.equal(props.routing, "path")
  assert.equal(props.transferable, false)
  assert.equal(props.signUpUrl, "/sign-up?redirect_url=" + encodeURIComponent(returnTo))
})

test("root layout separates central authentication presentation from portal authorization and sets the branded favicon", async () => {
  let authCalls = 0
  const Provider = () => null, ClerkProvider = () => null, FaviconBootstrap = () => null
  const { default: RootLayout, generateMetadata } = load("../app/layout.tsx", {
    "./globals.css": {}, "react/jsx-runtime": jsx,
    "next/headers": { headers: async () => new Headers({ "x-decisionate-hosted-return": returnTo }) },
    "./clerk-provider": { AppClerkProvider: ClerkProvider }, "./pwa-registration": { PwaRegistration: () => null },
    "./theme-bootstrap": { ThemeBootstrap: () => null }, "./language-bootstrap": { LanguageBootstrap: () => null },
    "./workspace-favicon-bootstrap": { WorkspaceFaviconBootstrap: FaviconBootstrap },
    "@/lib/portal-brand": { portalBrand: defaultBrand },
    "@/features/hosted-subdomains/server": { requestHostedPortal: async () => null, requestHostedAuthPortal: async () => { authCalls++; return portal } },
    "@/features/hosted-subdomains/provider": { HostedPortalProvider: Provider },
  })
  const metadata = await generateMetadata()
  assert.equal(metadata.title, brand.name)
  assert.equal(metadata.icons, brand.logo_url)
  assert.equal(metadata.manifest, undefined)
  const html = await RootLayout({ children: "Credentials" })
  const [head, body] = html.props.children
  assert.ok(head.props.children.every(child => !child || child.type !== FaviconBootstrap))
  const provider = body.props.children
  assert.equal(provider.type, Provider)
  assert.equal(provider.props.portal, null)
  assert.equal(provider.props.authPortal, portal)
  assert.equal(provider.props.children.type, ClerkProvider)
  assert.equal(provider.props.children.props.portal, null)
  assert.equal(provider.props.children.props.authPortal, portal)
  assert.equal(authCalls, 2)
})
