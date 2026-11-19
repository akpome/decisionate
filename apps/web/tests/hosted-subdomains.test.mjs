import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
function load(path, dependencies = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, URL, AbortSignal, ...globals,
    require: name => { assert.ok(name in dependencies, name); return dependencies[name] } })
  return loaded.exports
}
const types = load("../features/hosted-subdomains/types.ts")
const routes = load("../lib/application-routes.ts")
const redirects = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })

function resolution({ active = true, ok = true, wrongHost = false } = {}) {
  const calls = []
  const service = load("../features/hosted-subdomains/server.ts", {
    "server-only": {}, react: { cache: fn => fn }, "next/headers": { headers: async () => new Headers({ host: "north.decisionate.app" }) },
    "@/features/auth/lib/auth-redirects": redirects, "./types": types,
  }, { process: { env: { NEXT_PUBLIC_API_URL: "https://api.decisionate.test/" } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok, json: async () => ({
      hostname: wrongHost ? "wrong.decisionate.app" : "north.decisionate.app", origin: "https://north.decisionate.app", active,
    }) } } })
  return { ...service, calls }
}

test("portal resolution uses the fixed backend without cookies and fails closed on outages and mismatches", async () => {
  const h = resolution()
  assert.equal((await h.resolveHostedPortal("north.decisionate.app")).active, true)
  assert.equal(h.calls[0].url, "https://api.decisionate.test/api/v2/hosted-subdomains/resolve?hostname=north.decisionate.app")
  assert.equal(h.calls[0].options.cache, "no-store")
  assert.equal(h.calls[0].options.headers, undefined)
  for (const hostname of ["north.decisionate.app.evil.test", "evil.test", "decisionate.app", "https://north.decisionate.app", "a/b.decisionate.app"])
    assert.equal(await h.resolveHostedPortal(hostname), null)
  assert.equal(h.calls.length, 1)
  assert.equal(await resolution({ ok: false }).resolveHostedPortal("north.decisionate.app"), null)
  assert.equal(await resolution({ wrongHost: true }).resolveHostedPortal("north.decisionate.app"), null)
})

test("return allowlisting requires a registered active HTTPS portal and a safe application route", async () => {
  const h = resolution()
  const target = "https://north.decisionate.app/auth/redirect?redirect_url=%2Fdashboard&__clerk_synced=false"
  assert.equal(await h.safeHostedReturn(target), target)
  assert.equal(await h.safeHostedReturn("https://north.decisionate.app/connections"), "https://north.decisionate.app/connections")
  for (const path of ["http://north.decisionate.app/dashboard", "https://evil.test/dashboard", "//north.decisionate.app/dashboard",
    "https://user@north.decisionate.app/dashboard", "https://north.decisionate.app:3000/dashboard", "https://north.decisionate.app/sign-in",
    "https://north.decisionate.app/sign-up", "https://north.decisionate.app/%2f/evil.test", "https://north.decisionate.app/dashboard\\evil", "https://north.decisionate.app/"])
    assert.equal(await h.safeHostedReturn(path), null, path)
  assert.equal(await resolution({ active: false }).safeHostedReturn(target), null)
})

function renderHostedAuth(signup = false) {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), calls = []
  const { HostedSignIn } = load("../features/hosted-subdomains/sign-in.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"), "@clerk/nextjs": { useClerk: () => ({
      buildSignInUrl: options => { calls.push({ mode: "sign-in", ...options }); return "https://app.decisionate.ca/sign-in?sdk-sync=1" },
      buildSignUpUrl: options => { calls.push({ mode: "sign-up", ...options }); return "https://app.decisionate.ca/sign-up?sdk-sync=1" },
    }) }, "lucide-react": { ArrowRight: () => null }, "@/lib/workspace-brand": { getBrandSurfaceTextColor: () => "#ffffff" },
  })
  const returnTo = "/connections?workspace_id=client"
  const html = renderToStaticMarkup(React.createElement(HostedSignIn, { signup, brand: { name: "North Star", welcome_heading: "Welcome back",
    support_email: "help@example.test", primary_color: "#2563EB", background_color: "#FFFFFF", welcome_text: "Your business results" },
    returnTo: "https://north.decisionate.app" + redirects.getAuthRedirectUrl(returnTo),
    alternateUrl: signup ? redirects.getSignInUrl(returnTo) : redirects.getSignUpUrl(returnTo) }))
  return { html, calls, returnTo }
}

test("hosted login builds central links with Clerk and exposes a branded signup entry preserving invitations", () => {
  const { html, calls, returnTo } = renderHostedAuth()
  assert.deepEqual(calls, [{ mode: "sign-in", redirectUrl: "https://north.decisionate.app" + redirects.getAuthRedirectUrl(returnTo) }])
  assert.match(html, /sdk-sync=1/)
  assert.match(html, /North Star/)
  assert.ok(html.includes(`href="${redirects.getSignUpUrl(returnTo)}"`))
  assert.match(html, /Create an account/)
  assert.match(html, /https:\/\/decisionate.ca\/privacy/)
})

test("hosted signup has its own heading and central signup action with an invitation-preserving sign-in link", () => {
  const { html, calls, returnTo } = renderHostedAuth(true)
  assert.deepEqual(calls, [{ mode: "sign-up", redirectUrl: "https://north.decisionate.app" + redirects.getAuthRedirectUrl(returnTo) }])
  assert.match(html, /Create your account/)
  assert.match(html, /Continue to sign up/)
  assert.match(html, /email address from your agency invitation/)
  assert.match(html, /Already have an account/)
  assert.doesNotMatch(html, /Welcome back|Your business results/)
  assert.ok(html.includes(`href="${redirects.getSignInUrl(returnTo)}"`))
})

test("hosted auth pages keep safe workspace destinations on the portal when switching modes", async () => {
  const brand = { name: "North Star" }, origin = "https://north.decisionate.app"
  for (const signup of [false, true]) {
    const HostedSignIn = () => null
    const page = load(`../app/${signup ? "sign-up/[[...sign-up]]" : "sign-in/[[...sign-in]]"}/page.tsx`, {
      "react/jsx-runtime": require("react/jsx-runtime"),
      "next/headers": { headers: async () => new Headers({ host: "north.decisionate.app", "x-forwarded-proto": "https" }) },
      "@/features/auth/lib/auth-redirects": redirects,
      "@/app/auth-card": { AuthCard: () => null },
      "@/features/auth/components/auth-layout": { AuthLayout: () => null },
      "@/features/auth/components/workspace-invitation-sign-in": { WorkspaceInvitationSignIn: () => null },
      "@/features/hosted-subdomains/server": { requestHostedPortal: async () => ({ branding: brand, origin }) },
      "@/features/hosted-subdomains/sign-in": { HostedSignIn },
    }).default
    for (const destination of ["/connections?workspace_id=client", undefined, "https://evil.test/dashboard", "//evil.test", "/sign-in", "/dashboard/%2f%2fevil.test"]) {
      const element = await page({ searchParams: Promise.resolve({ redirect_url: destination }) })
      const safe = redirects.getSafeReturnTo(destination, origin)
      assert.equal(element.type, HostedSignIn)
      assert.equal(element.props.returnTo, origin + redirects.getAuthRedirectUrl(safe))
      assert.equal(element.props.alternateUrl, signup ? redirects.getSignInUrl(safe) : redirects.getSignUpUrl(safe))
      assert.equal(Boolean(element.props.signup), signup)
      assert.equal(element.props.brand, brand)
    }
  }
})

test("hosted setup uses a native modal, immutable addresses, explicit publish and separate draft saves", () => {
  const source = read("../features/hosted-subdomains/setup.tsx")
  assert.match(source, /<dialog ref=\{previewDialog\}/)
  assert.match(source, /\.showModal\(\)/)
  assert.match(source, /onCancel=/)
  assert.match(source, /disabled=\{Boolean\(data.portal\)\}/)
  assert.match(source, /confirmation: "PUBLISH PORTAL"/)
  assert.match(source, /Save draft/)
  assert.match(source, /data.blockers.length > 0/)
  assert.match(source, /working.current = true/)
  assert.match(source, /Hosted portal included/)
  assert.match(source, /White-label subscription required/)
  assert.doesNotMatch(source, /HOSTED_PORTALS_|Stripe Connect|Clerk API key|subscription-offer|Add hosted white label|Cancel hosted white label|View subscription price|\/subscription["']/)
})

function renderSetup({ entitled = true, available = true } = {}) {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
  const brand = { name: "North Star", support_email: "help@northstar.test", logo_url: "", favicon_url: "", background_url: "",
    primary_color: "#2563EB", accent_color: "#059669", background_color: "#FFFFFF", welcome_heading: "Welcome", welcome_text: "" }
  const states = [{ portal: null, entitled, commercially_available: available, blockers: [], defaults: brand },
    brand, "", "", "", false, false, false, 0]
  let index = 0
  const { HostedSubdomainSetup } = load("../features/hosted-subdomains/setup.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: { ...React, useState: initial => [index < states.length ? states[index++] : initial, () => {}], useEffect() {}, useRef: value => ({ current: value }) },
    "next/link": { default: props => React.createElement("a", props) }, "lucide-react": require("lucide-react"),
    "@/lib/api": { hostedSubdomainRequest: () => assert.fail("Server render must not request a purchase") },
    "@/lib/use-active-workspace": { useActiveWorkspace: () => ({ activeWorkspaceId: "agency" }) },
    "@/lib/workspace-brand": { getBrandSurfaceTextColor: () => "#ffffff" },
  })
  return renderToStaticMarkup(React.createElement(HostedSubdomainSetup, { userId: "owner" }))
}

test("eligible agencies go directly to portal setup without a price, purchase or extra subscription", () => {
  const html = renderSetup()
  assert.match(html, /Hosted portal included/)
  assert.match(html, /Portal address/)
  assert.match(html, /Preview portal/)
  assert.doesNotMatch(html, /View subscription price|Cancel hosted white label|Subscription options|Add hosted white label/)
})

test("inactive Agency access and closed availability keep setup blocked without offering an add-on", () => {
  const inactive = renderSetup({ entitled: false })
  assert.match(inactive, /White-label subscription required/)
  assert.match(inactive, /href="\/billing"/)
  assert.doesNotMatch(inactive, /<form|Preview portal|Add hosted white label/)
  const closed = renderSetup({ available: false })
  assert.match(closed, /New hosted portals are not available yet/)
  assert.doesNotMatch(closed, /<form|Preview portal|Add hosted white label/)
})
