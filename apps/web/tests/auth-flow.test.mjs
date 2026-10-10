import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function load(relativePath, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports, URL, Event, Map,
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    }, ...globals,
  })
  return loaded.exports
}

const redirects = load("../features/auth/lib/auth-redirects.ts")
const workspaces = load("../features/auth/lib/auth-workspaces.ts", { "./auth-redirects": redirects })
const own = { id: 1, owner_user_id: "reviewer", role: "owner" }
const shared = { id: 2, owner_user_id: "agency:client:2", role: "client_user" }

test("return destinations preserve application paths, filters and fragments", () => {
  for (const path of ["/dashboard", "/dashboard/datasets/56?tab=rows&range=90#details", "/dashboard/decisions/new?title=Review%20ads", "/onboarding", "/platform-admin?tab=users"]) {
    assert.equal(redirects.getSafeReturnTo(path), path)
  }
  assert.equal(redirects.getSafeReturnTo(["/dashboard/datasets", "https://other.test"]), "/dashboard/datasets")
})

test("external destinations, auth loops, path traversal and encoded separators are rejected", () => {
  for (const path of [null, undefined, "", "https://other.test", "//other.test", "/\\other.test", "/dashboard\\other.test", "/sign-in", "/sign-up", "/auth/redirect", "/auth/redirect/child", "/dashboard-fake", "/platform-admin-fake", "/dashboard/../dashboard", "/dashboard/%2e%2e/dashboard", "/dashboard/%2Fother", "/dashboard/%5cother", "/dashboard/%252fother", "/dashboard/%00", "/dashboard/%0a", "/dashboard/%zz", "/dashboard\n", " /dashboard"]) {
    assert.equal(redirects.getSafeReturnTo(path), null, String(path))
    assert.equal(redirects.getAuthRedirectUrl(path), "/auth/redirect", String(path))
  }
})

test("Clerk's same-origin absolute return URLs become relative without allowing external redirects", () => {
  const origin = "https://decisionate.ca"
  assert.equal(redirects.getSafeReturnTo(`${origin}/dashboard/datasets/56?tab=rows`, origin), "/dashboard/datasets/56?tab=rows")
  for (const value of ["https://other.test/dashboard", "https://decisionate.ca.other.test/dashboard", "https://decisionate.ca@other.test/dashboard", "https://user@decisionate.ca/dashboard", "http://decisionate.ca/dashboard", "//decisionate.ca/dashboard"]) {
    assert.equal(redirects.getSafeReturnTo(value, origin), null, value)
  }
  assert.equal(redirects.getSafeReturnTo("http://localhost:3001/dashboard", "http://localhost:3001"), "/dashboard")
})

test("request origins follow deployment forwarding headers without accepting malformed hosts", () => {
  const headers = new Headers({ host: "localhost:3001", "x-forwarded-host": "decisionate.ca", "x-forwarded-proto": "https" })
  assert.equal(redirects.getAuthRequestOrigin(headers, "http://localhost:3001"), "https://decisionate.ca")
  assert.equal(redirects.getAuthRequestOrigin(new Headers({ host: "other.test/path" }), "http://localhost:3001"), "http://localhost:3001")
})

test("sign in, sign up, account routing and onboarding keep the same intended destination", () => {
  const destination = "/dashboard/datasets/56?tab=rows#details"
  for (const [builder, pathname] of [[redirects.getSignInUrl, "/sign-in"], [redirects.getSignUpUrl, "/sign-up"], [redirects.getAuthRedirectUrl, "/auth/redirect"], [redirects.getOnboardingUrl, "/onboarding"]]) {
    const url = new URL(builder(destination), "https://decisionate.test")
    assert.equal(url.pathname, pathname)
    assert.equal(url.searchParams.get("redirect_url"), destination)
  }
  assert.equal(redirects.getWorkspaceReturnTo(destination), destination)
  assert.equal(redirects.getWorkspaceReturnTo(redirects.getOnboardingUrl(destination)), destination)
})

test("existing users return to their destination and do not repeat onboarding", () => {
  assert.equal(workspaces.getAuthenticatedDestination(false, own, "/dashboard/datasets/56"), "/dashboard/datasets/56")
  assert.equal(workspaces.getAuthenticatedDestination(false, shared, "/onboarding"), "/dashboard")
  assert.equal(workspaces.getAuthenticatedDestination(false, own, "/platform-admin"), "/dashboard")
})

test("new users carry their intended page through workspace creation", () => {
  const destination = "/dashboard/connections?provider=meta_ads"
  const setup = workspaces.getAuthenticatedDestination(false, undefined, destination)
  assert.equal(setup, redirects.getOnboardingUrl(destination))
  assert.equal(workspaces.getAuthenticatedDestination(false, undefined, setup), setup)
  assert.equal(workspaces.getAuthenticatedDestination(false, undefined, "/onboarding"), "/onboarding")
})

test("admins use administration by default but retain an explicit workspace destination", () => {
  assert.equal(workspaces.getAuthenticatedDestination(true, undefined), "/platform-admin")
  assert.equal(workspaces.getAuthenticatedDestination(true, undefined, "/platform-admin?tab=users"), "/platform-admin?tab=users")
  assert.equal(workspaces.getAuthenticatedDestination(true, own, "/dashboard/decisions"), "/dashboard/decisions")
  assert.equal(workspaces.getAuthenticatedDestination(true, undefined, "/dashboard/decisions"), redirects.getOnboardingUrl("/dashboard/decisions"))
})

test("workspace selection restores valid selections and replaces stale or revoked ones", () => {
  assert.equal(workspaces.chooseAuthWorkspace([own, shared], "reviewer", shared.owner_user_id), shared)
  assert.equal(workspaces.chooseAuthWorkspace([shared, own], "reviewer", "revoked"), own)
  assert.equal(workspaces.chooseAuthWorkspace([shared], "reviewer", "reviewer"), shared)
  assert.equal(workspaces.chooseAuthWorkspace([], "reviewer", "reviewer"), undefined)
})

test("managed client workspaces cannot be selected unless owner access is enabled", () => {
  const managed = { ...shared, role: "managed_client", agency_owner_access_enabled: false }
  assert.equal(workspaces.chooseAuthWorkspace([managed, own], "reviewer", managed.owner_user_id), own)
  assert.equal(workspaces.chooseAuthWorkspace([managed], "reviewer", managed.owner_user_id), undefined)
  const enabled = { ...managed, agency_owner_access_enabled: true }
  assert.equal(workspaces.chooseAuthWorkspace([enabled], "reviewer", enabled.owner_user_id), enabled)
})

function proxyHarness({ selfRewrite = false } = {}) {
  let clerkCalls = 0
  const proxy = load("../proxy.ts", {
    "./features/auth/lib/auth-redirects": redirects,
    "@clerk/nextjs/server": {
      createRouteMatcher: patterns => request => patterns.some(pattern => new RegExp(`^${pattern}$`).test(request.nextUrl.pathname)),
      clerkMiddleware: callback => async request => {
        clerkCalls++
        const result = await callback(async () => ({ userId: request.userId }), request)
        return result ?? (selfRewrite ? new Response(null, { headers: {
          "x-middleware-rewrite": typeof selfRewrite === "string" ? selfRewrite : request.url,
          "x-middleware-request-x-clerk-auth-status": "signed-out",
          "x-middleware-override-headers": "x-clerk-auth-status",
        } }) : undefined)
      },
    },
    "next/server": { NextResponse: { next: () => "next", redirect: url => url.toString() } },
  }).default
  return {
    run: (path, userId = null, forwardingHeaders = {}) => {
      const url = new URL(path, "https://decisionate.test")
      return proxy({ url: url.toString(), nextUrl: url, headers: new Headers({ host: url.host, "x-forwarded-proto": url.protocol.replace(":", ""), ...forwardingHeaders }), userId }, {})
    },
    clerkCalls: () => clerkCalls,
  }
}

test("signed-in users on either auth page reach the resolver with their return URL", async () => {
  const proxy = proxyHarness()
  for (const path of ["/sign-in", "/sign-up", "/sign-in/factor-one", "/sign-up/verify-email-address"]) {
    const result = new URL(await proxy.run(`${path}?redirect_url=%2Fdashboard%2Fdatasets%2F56`, "reviewer"))
    assert.equal(result.pathname, "/auth/redirect")
    assert.equal(result.searchParams.get("redirect_url"), "/dashboard/datasets/56")
  }
  assert.equal(proxy.clerkCalls(), 4)
  const absolute = new URL(await proxy.run("/sign-in?redirect_url=https%3A%2F%2Fdecisionate.test%2Fdashboard%2Fdatasets%2F56", "reviewer"))
  assert.equal(absolute.searchParams.get("redirect_url"), "/dashboard/datasets/56")
})

test("signed-out users can reach auth pages while all private areas require sign in", async () => {
  const proxy = proxyHarness()
  for (const path of ["/sign-in", "/sign-up", "/auth/redirect"]) assert.equal(await proxy.run(path), undefined)
  for (const path of ["/dashboard/datasets/56?tab=rows", "/onboarding", "/platform-admin?tab=users"]) {
    const result = new URL(await proxy.run(path))
    assert.equal(result.pathname, "/sign-in")
    assert.equal(result.searchParams.get("redirect_url"), path)
  }
})

test("public demo pages keep the fast path without bypassing auth pages", async () => {
  const proxy = proxyHarness()
  assert.equal(await proxy.run("/"), "next")
  assert.equal(await proxy.run("/demo/datasets"), "next")
  assert.equal(proxy.clerkCalls(), 0)
  await proxy.run("/sign-in")
  assert.equal(proxy.clerkCalls(), 1)
})

test("proxy refuses malicious and looping destinations for authenticated visitors", async () => {
  const proxy = proxyHarness()
  for (const value of ["https://other.test", "/\\other.test", "/sign-in", "/auth/redirect", "/dashboard/%2e%2e/sign-up"]) {
    assert.equal(await proxy.run(`/sign-in?redirect_url=${encodeURIComponent(value)}`, "reviewer"), "https://decisionate.test/auth/redirect")
  }
})

test("Clerk self-rewrites continue without an internal proxy loop and retain verified request headers", async () => {
  const proxy = proxyHarness({ selfRewrite: true })
  const response = await proxy.run("/sign-in")
  assert.equal(response.headers.get("x-middleware-next"), "1")
  assert.equal(response.headers.get("x-middleware-rewrite"), null)
  assert.equal(response.headers.get("x-middleware-request-x-clerk-auth-status"), "signed-out")
  assert.equal(response.headers.get("x-middleware-override-headers"), "x-clerk-auth-status")
})

test("the proxy does not alter genuine rewrites to another destination", async () => {
  const proxy = proxyHarness({ selfRewrite: "https://clerk.example.test/assets" })
  const response = await proxy.run("/sign-in")
  assert.equal(response.headers.get("x-middleware-rewrite"), "https://clerk.example.test/assets")
  assert.equal(response.headers.get("x-middleware-next"), null)
})

test("private and signed-in redirects use the public deployment origin", async () => {
  const proxy = proxyHarness()
  const headers = { "x-forwarded-host": "decisionate.ca", "x-forwarded-proto": "https" }
  assert.equal(new URL(await proxy.run("/dashboard", null, headers)).origin, "https://decisionate.ca")
  assert.equal(new URL(await proxy.run("/sign-in", "reviewer", headers)).origin, "https://decisionate.ca")
})

function browserStorage(blocked = false) {
  const values = new Map()
  const target = new EventTarget()
  return {
    localStorage: {
      getItem: key => { if (blocked) throw new Error("blocked"); return values.get(key) ?? null },
      setItem: (key, value) => { if (blocked) throw new Error("blocked"); values.set(key, value) },
      removeItem: key => { if (blocked) throw new Error("blocked"); values.delete(key) },
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
}

test("workspace selection stays user-scoped and works when browser storage is blocked", () => {
  for (const blocked of [false, true]) {
    const window = browserStorage(blocked)
    const context = load("../lib/workspace-context.ts", {}, { window, CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options.detail } } })
    let changes = 0
    window.addEventListener(context.activeWorkspaceChangedEvent, () => changes++)
    context.setActiveWorkspaceId("reviewer", "agency:client:2")
    assert.equal(context.getActiveWorkspaceId("reviewer"), "agency:client:2")
    assert.equal(context.getActiveWorkspaceId("other-user"), "other-user")
    assert.equal(changes, 1)
  }
})

test("sign-up acknowledgements survive verification reloads and clear after sign in", () => {
  const window = browserStorage()
  window.sessionStorage = window.localStorage
  const consent = load("../features/auth/lib/signup-consent.ts", {}, { window })
  let changes = 0
  const unsubscribe = consent.subscribeSignupConsent(() => changes++)
  assert.equal(consent.readSignupConsent(), false)
  consent.writeSignupConsent(true)
  const reloaded = load("../features/auth/lib/signup-consent.ts", {}, { window })
  assert.equal(reloaded.readSignupConsent(), true)
  reloaded.writeSignupConsent(false)
  assert.equal(consent.readSignupConsent(), false)
  assert.equal(changes, 2)
  unsubscribe()
})

test("disabled session storage does not crash the acknowledgement step", () => {
  const window = browserStorage(true)
  window.sessionStorage = window.localStorage
  const consent = load("../features/auth/lib/signup-consent.ts", {}, { window })
  assert.equal(consent.readSignupConsent(), false)
  assert.doesNotThrow(() => consent.writeSignupConsent(true))
})

test("admin access distinguishes ordinary users from failed or expired authorization", async () => {
  const cache = load("../lib/api-read-cache.ts")
  let status = 200
  let allowed = true
  const api = load("../lib/api.ts", {
    "@/lib/api-read-cache": cache,
    "@/lib/workspace-context": { getActiveWorkspaceId: userId => userId },
    "@/features/dashboards/dashboard-definitions": {},
  }, {
    process: { env: {} }, AbortController, DOMException, Headers, setTimeout, clearTimeout,
    fetch: async () => new Response(JSON.stringify({ allowed }), { status, headers: { "Content-Type": "application/json" } }),
  })
  assert.equal(await api.getPlatformAdminAccess("reviewer"), true)
  allowed = false
  assert.equal(await api.getPlatformAdminAccess("reviewer"), false)
  for (status of [403, 404]) assert.equal(await api.getPlatformAdminAccess("reviewer"), false)
  for (status of [401, 500, 503]) {
    await assert.rejects(api.getPlatformAdminAccess("reviewer"), error => error instanceof api.ApiError && error.status === status)
  }
})
