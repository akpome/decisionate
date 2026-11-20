import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function load(relativePath, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  })
  const loaded = { exports: {} }
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports, URL, Event, Map, Headers, Response,
    require: name => {
      if (name === "./lib/portal-brand") return { portalBrand: { id: "" } }
      if (name === "./lib/decisionate-domains") return domains
      if (name === "./lib/application-routes" || name === "@/lib/application-routes") return routes
      if (name.endsWith("hosted-subdomains/types")) return hostedTypes
      if (name.endsWith("hosted-subdomains/unavailable-page")) return load("../features/hosted-subdomains/unavailable-page.ts")
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    }, ...globals,
  })
  return loaded.exports
}

const routes = load("../lib/application-routes.ts")
const hostedTypes = load("../features/hosted-subdomains/types.ts")
const redirects = load("../features/auth/lib/auth-redirects.ts")
const domains = load("../lib/decisionate-domains.ts")
const workspaces = load("../features/auth/lib/auth-workspaces.ts", { "./auth-redirects": redirects })
const own = { id: 1, owner_user_id: "reviewer", role: "owner" }
const shared = { id: 2, owner_user_id: "agency:client:2", role: "client_user" }

test("account menu sign-out uses the sign-in page without changing successful sign-in routing", () => {
  let options
  const { AppClerkProvider } = load("../app/clerk-provider.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: { useEffect() {} },
    "@clerk/nextjs": {
      ClerkProvider: props => { options = props; return props.children },
      useAuth: () => ({ getToken: async () => null }),
    },
    "@/lib/api": { setClerkSessionTokenProvider() {} },
    "@/features/auth/lib/auth-redirects": redirects,
  })
  const html = renderToStaticMarkup(React.createElement(AppClerkProvider, null, "Application content"))
  assert.equal(html, "Application content")
  assert.equal(options.afterSignOutUrl, "/sign-in")
  assert.equal(options.signInFallbackRedirectUrl, "/auth/redirect")
  assert.equal(options.signInForceRedirectUrl, "/auth/redirect")
  assert.equal(options.signUpFallbackRedirectUrl, "/auth/redirect")
  assert.equal(options.signUpForceRedirectUrl, "/auth/redirect")
})

test("the platform admin sign-out button redirects to sign in rather than the public landing page", () => {
  const source = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8")
  const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const handlers = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onClick" && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(tree).includes("signOut(")) {
      handlers.push(node.initializer.expression.getText(tree))
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(handlers.length, 1)
  const destinations = []
  const { outputText } = ts.transpileModule(`const handler = ${handlers[0]}; handler()`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } })
  vm.runInNewContext(outputText, { AUTH_REDIRECTS: redirects.AUTH_REDIRECTS, signOut: options => { destinations.push(options.redirectUrl) } })
  assert.deepEqual(destinations, ["/sign-in"])
  assert.doesNotMatch(source, /signOut\(\{\s*redirectUrl:\s*["']\/["']/)
})

test("return destinations preserve application paths, filters and fragments", () => {
  for (const path of ["/dashboard", "/datasets/56?tab=rows&range=90#details", "/decisions/new?title=Review%20ads", "/onboarding", "/platform-admin?tab=users"]) {
    assert.equal(redirects.getSafeReturnTo(path), path)
  }
  assert.equal(redirects.getSafeReturnTo(["/datasets", "https://other.test"]), "/datasets")
})

test("external destinations, auth loops, path traversal and encoded separators are rejected", () => {
  for (const path of [null, undefined, "", "https://other.test", "//other.test", "/\\other.test", "/dashboard\\other.test", "/sign-in", "/sign-up", "/auth/redirect", "/auth/redirect/child", "/dashboard-fake", "/platform-admin-fake", "/dashboard/../dashboard", "/dashboard/%2e%2e/dashboard", "/dashboard/%2Fother", "/dashboard/%5cother", "/dashboard/%252fother", "/dashboard/%00", "/dashboard/%0a", "/dashboard/%zz", "/dashboard\n", " /dashboard"]) {
    assert.equal(redirects.getSafeReturnTo(path), null, String(path))
    assert.equal(redirects.getAuthRedirectUrl(path), "/auth/redirect", String(path))
  }
})

test("all root workspace routes are safe return destinations without accepting lookalikes", () => {
  for (const { path, internal } of routes.workspaceRoutes) {
    for (const suffix of ["", "/detail?workspace_id=client%3Aone#evidence"]) {
      assert.equal(redirects.getSafeReturnTo(path + suffix), path + suffix)
      assert.equal(redirects.getSafeReturnTo(internal + suffix), path + suffix)
      assert.equal(redirects.getWorkspaceReturnTo(internal + suffix), path + suffix)
    }
    assert.equal(redirects.getSafeReturnTo(path + "-fake"), null)
  }
  assert.equal(redirects.getSafeReturnTo("/business-analysis/weekly?report=one"), "/weekly-reports?report=one")
})

test("Clerk's same-origin absolute return URLs become relative without allowing external redirects", () => {
  const origin = "https://decisionate.ca"
  assert.equal(redirects.getSafeReturnTo(`${origin}/datasets/56?tab=rows`, origin), "/datasets/56?tab=rows")
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
  const destination = "/datasets/56?tab=rows#details"
  for (const [builder, pathname] of [[redirects.getSignInUrl, "/sign-in"], [redirects.getSignUpUrl, "/sign-up"], [redirects.getAuthRedirectUrl, "/auth/redirect"], [redirects.getOnboardingUrl, "/onboarding"]]) {
    const url = new URL(builder(destination), "https://decisionate.test")
    assert.equal(url.pathname, pathname)
    assert.equal(url.searchParams.get("redirect_url"), destination)
  }
  assert.equal(redirects.getWorkspaceReturnTo(destination), destination)
  assert.equal(redirects.getWorkspaceReturnTo(redirects.getOnboardingUrl(destination)), destination)
})

test("existing users return to their destination and do not repeat onboarding", () => {
  assert.equal(workspaces.getAuthenticatedDestination(false, own, "/datasets/56"), "/datasets/56")
  assert.equal(workspaces.getAuthenticatedDestination(false, shared, "/onboarding"), "/dashboard")
  assert.equal(workspaces.getAuthenticatedDestination(false, own, "/platform-admin"), "/dashboard")
})

test("new users carry their intended page through workspace creation", () => {
  const destination = "/connections?provider=meta_ads"
  const setup = workspaces.getAuthenticatedDestination(false, undefined, destination)
  assert.equal(setup, redirects.getOnboardingUrl(destination))
  assert.equal(workspaces.getAuthenticatedDestination(false, undefined, setup), setup)
  assert.equal(workspaces.getAuthenticatedDestination(false, undefined, "/onboarding"), "/onboarding")
})

test("admins use administration by default but retain an explicit workspace destination", () => {
  assert.equal(workspaces.getAuthenticatedDestination(true, undefined), "/platform-admin")
  assert.equal(workspaces.getAuthenticatedDestination(true, undefined, "/platform-admin?tab=users"), "/platform-admin?tab=users")
  assert.equal(workspaces.getAuthenticatedDestination(true, own, "/decisions"), "/decisions")
  assert.equal(workspaces.getAuthenticatedDestination(true, undefined, "/decisions"), redirects.getOnboardingUrl("/decisions"))
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

test("all client roles open their client workspace instead of a default personal account", () => {
  for (const role of ["client", "client_owner", "client_user"]) {
    const client = { ...shared, role }
    assert.equal(workspaces.chooseAuthWorkspace([own, client], "reviewer", "reviewer"), client)
    const another = { ...client, id: 3, owner_user_id: "agency:client:three" }
    assert.equal(workspaces.chooseAuthWorkspace([own, client, another], "reviewer", another.owner_user_id), another)
  }
})

test("an independent former client still opens the same workspace after an agency removes it", () => {
  const independent = { ...shared, role: "owner", is_managed_client: false, agency_removed: true }
  assert.equal(workspaces.chooseAuthWorkspace([own, independent], "reviewer", "reviewer"), independent)
  assert.equal(workspaces.chooseAuthWorkspace([own, independent], "reviewer", independent.owner_user_id), independent)
})

test("invitation links choose only their authorized workspace and never fall back to another account", () => {
  assert.equal(workspaces.chooseAuthWorkspace([own, shared], "reviewer", "reviewer", shared.owner_user_id), shared)
  assert.equal(workspaces.chooseAuthWorkspace([own, shared], "reviewer", shared.owner_user_id, "unrelated:client:other"), undefined)
  const denied = { ...shared, role: "managed_client", agency_owner_access_enabled: false }
  assert.equal(workspaces.chooseAuthWorkspace([own, denied], "reviewer", "reviewer", denied.owner_user_id), undefined)
  const resolver = readFileSync(new URL("../app/auth/redirect/page.tsx", import.meta.url), "utf8")
  assert.match(resolver, /requestedWorkspaceId && !workspace/)
})

function proxyHarness({ selfRewrite = false, responseObjects = false, hostedPortal = null, hostedReturn = null } = {}) {
  let clerkCalls = 0
  let clerkOptions, forwardedHeaders
  const proxy = load("../proxy.ts", {
    "./features/hosted-subdomains/server": { resolveHostedPortal: async () => hostedPortal, safeHostedReturn: async () => hostedReturn },
    "./features/auth/lib/auth-redirects": redirects,
    "@clerk/nextjs/server": {
      createRouteMatcher: patterns => request => patterns.some(pattern => new RegExp(`^${pattern}$`).test(request.nextUrl.pathname)),
      clerkMiddleware: (callback, options) => async request => {
        clerkOptions = options
        forwardedHeaders = request.headers
        clerkCalls++
        const result = await callback(async () => ({ userId: request.userId }), request)
        return result ?? (selfRewrite ? new Response(null, { headers: {
          "x-middleware-rewrite": typeof selfRewrite === "string" ? selfRewrite : request.url,
          "x-middleware-request-x-clerk-auth-status": "signed-out",
          "x-middleware-override-headers": "x-clerk-auth-status",
        } }) : undefined)
      },
    },
    "next/server": { NextRequest: class { constructor(request, init) { Object.assign(this, request, init) } },
      NextResponse: class extends Response {
      static rewrite(url) { return new Response(null, { headers: { "x-middleware-rewrite": url.toString() } }) }
      static next(options) { return options ? undefined : "next" } static redirect(url, init = 307) { return (
      responseObjects ? new Response(null, { status: typeof init === "number" ? init : init.status,
        headers: { ...(typeof init === "number" ? {} : init.headers), location: url.toString() } }) : url.toString()) } } },
  }).default
  return {
    run: (path, userId = null, forwardingHeaders = {}) => {
      const url = new URL(path, "https://decisionate.test")
      url.clone = () => new URL(url)
      return proxy({ url: url.toString(), nextUrl: url, headers: new Headers({ host: url.host, "x-forwarded-proto": url.protocol.replace(":", ""), ...forwardingHeaders }), userId }, {})
    },
    clerkCalls: () => clerkCalls,
    options: () => clerkOptions,
    headers: () => forwardedHeaders,
  }
}

test("every clean workspace route retains Clerk protection, including nested pages", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  for (const { path, internal } of routes.workspaceRoutes) {
    for (const suffix of ["", "/detail?workspace_id=client%3Aone"]) {
      const url = `https://app.decisionate.ca${path}${suffix}`
      const response = await proxy.run(url)
      const login = new URL(response.headers.get("location"))
      assert.equal(login.pathname, "/sign-in")
      assert.equal(login.searchParams.get("redirect_url"), path + suffix)
      assert.equal((await proxy.run(url, "reviewer")).headers.get("x-middleware-rewrite"), `https://app.decisionate.ca${internal}${suffix}`)
    }
  }
})

test("legacy workspace links permanently redirect once and keep query parameters", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  for (const { path, internal } of routes.workspaceRoutes) {
    const suffix = "/detail?workspace_id=client%3Aone&state=a%2Bb%3D&checkout=success"
    for (const user of [null, "reviewer"]) {
      const response = await proxy.run(`https://app.decisionate.ca${internal}${suffix}`, user)
      assert.equal(response.status, 308)
      assert.equal(response.headers.get("location"), `https://app.decisionate.ca${path}${suffix}`)
      const next = await proxy.run(response.headers.get("location"), user)
      if (user) assert.equal(next.headers.get("x-middleware-rewrite"), `https://app.decisionate.ca${internal}${suffix}`)
      else assert.equal(new URL(next.headers.get("location")).searchParams.get("redirect_url"), path + suffix)
    }
  }
  assert.equal((await proxy.run("https://app.decisionate.ca/business-analysis/weekly?report=one")).headers.get("location"),
    "https://app.decisionate.ca/weekly-reports?report=one")
})

test("reports bookmarks and sign-in returns move to Business Analysis without losing report or workspace state", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  for (const oldPath of ["/reports", "/dashboard/reports", "/reports/impact"]) {
    const expected = routes.canonicalWorkspacePathname(oldPath)
    const query = "?report=saved%20report&workspace_id=client%3Aone&job=pending-job"
    const response = await proxy.run("https://app.decisionate.ca" + oldPath + query)
    assert.equal(response.status, 308)
    assert.equal(response.headers.get("location"), "https://app.decisionate.ca" + expected + query)
    assert.equal(redirects.getSafeReturnTo(oldPath + query + "#evidence"), expected + query + "#evidence")
    const login = await proxy.run(response.headers.get("location"))
    assert.equal(new URL(login.headers.get("location")).searchParams.get("redirect_url"), expected + query)
    assert.equal((await proxy.run(response.headers.get("location"), "reviewer")).headers.get("x-middleware-rewrite"),
      "https://app.decisionate.ca" + routes.internalWorkspacePathname(expected) + query)
    const apex = await proxy.run("https://decisionate.ca" + oldPath + query)
    assert.equal(apex.headers.get("location"), "https://app.decisionate.ca" + expected + query)
  }
  for (const path of ["/reports/weekly", "/business-analysis/weekly"]) {
    assert.equal((await proxy.run("https://app.decisionate.ca" + path + "?report=weekly")).headers.get("location"),
      "https://app.decisionate.ca/weekly-reports?report=weekly")
  }
})

test("signed-in users on either auth page reach the resolver with their return URL", async () => {
  const proxy = proxyHarness()
  for (const path of ["/sign-in", "/sign-up", "/sign-in/factor-one", "/sign-up/verify-email-address"]) {
    const result = new URL(await proxy.run(`${path}?redirect_url=%2Fdashboard%2Fdatasets%2F56`, "reviewer"))
    assert.equal(result.pathname, "/auth/redirect")
    assert.equal(result.searchParams.get("redirect_url"), "/datasets/56")
  }
  assert.equal(proxy.clerkCalls(), 4)
  const absolute = new URL(await proxy.run("/sign-in?redirect_url=https%3A%2F%2Fdecisionate.test%2Fdashboard%2Fdatasets%2F56", "reviewer"))
  assert.equal(absolute.searchParams.get("redirect_url"), "/datasets/56")
})

test("invitation login links keep the sign-in page public and retain the client workspace after login", async () => {
  const proxy = proxyHarness()
  const destination = "/dashboard?workspace_id=agency%3Aclient%3A2"
  const invitation = redirects.getSignInUrl(destination)
  assert.equal(new URL(invitation, "https://decisionate.test").pathname, "/sign-in")
  assert.equal(await proxy.run(invitation), undefined)
  const signedIn = new URL(await proxy.run(invitation, "reviewer"))
  assert.equal(signedIn.pathname, "/auth/redirect")
  assert.equal(signedIn.searchParams.get("redirect_url"), destination)
  assert.equal(workspaces.getAuthenticatedDestination(false, shared, destination), destination)
})

test("invitation account switching stays on login without bypassing any private routes", async () => {
  const proxy = proxyHarness()
  const destination = "/dashboard?workspace_id=agency%3Aclient%3A2"
  const login = redirects.getWorkspaceAccountSwitchUrl(destination)
  assert.equal(new URL(login, "https://decisionate.test").searchParams.get("switch_account"), "1")
  assert.equal(await proxy.run(login, "reviewer"), undefined)
  assert.equal(await proxy.run(login), undefined)
  const protectedResult = new URL(await proxy.run(`${destination}&switch_account=1`))
  assert.equal(protectedResult.pathname, "/sign-in")
  for (const value of ["/dashboard", "/platform-admin?workspace_id=someone", "https://other.test/dashboard?workspace_id=someone"]) {
    assert.equal(redirects.getInvitedWorkspaceId(value), null)
    assert.doesNotMatch(redirects.getWorkspaceAccountSwitchUrl(value), /switch_account/)
    const attempt = `/sign-in?switch_account=1&redirect_url=${encodeURIComponent(value)}`
    assert.equal(new URL(await proxy.run(attempt, "reviewer")).pathname, "/auth/redirect")
  }
})

test("signed-out users can reach auth pages while all private areas require sign in", async () => {
  const proxy = proxyHarness()
  for (const path of ["/sign-in", "/sign-up", "/auth/redirect"]) assert.equal(await proxy.run(path), undefined)
  for (const path of ["/datasets/56?tab=rows", "/onboarding", "/platform-admin?tab=users"]) {
    const result = new URL(await proxy.run(path))
    assert.equal(result.pathname, "/sign-in")
    assert.equal(result.searchParams.get("redirect_url"), path)
  }
})

test("public demo pages keep the fast path without bypassing auth pages", async () => {
  const proxy = proxyHarness()
  assert.equal(await proxy.run("/"), "next")
  assert.equal(await proxy.run("/demo/datasets"), "next")
  assert.equal(await proxy.run("/robots.txt"), "next")
  assert.equal(await proxy.run("/sitemap.xml"), "next")
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
  assert.equal(new URL(await proxy.run("/dashboard", null, headers)).origin, "https://app.decisionate.ca")
  assert.equal(new URL(await proxy.run("/sign-in", "reviewer", headers)).origin, "https://app.decisionate.ca")
})

test("apex keeps the public landing page and www permanently redirects with path and query intact", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  assert.equal(await proxy.run("https://decisionate.ca/"), "next")
  assert.equal(await proxy.run("https://decisionate.ca/demo?dashboard=business"), "next")
  for (const path of ["/", "/privacy", "/demo?dashboard=business&utm_source=review", "/billing?checkout=success"]) {
    const response = await proxy.run(`https://www.decisionate.ca${path}`)
    assert.equal(response.status, 308)
    assert.equal(response.headers.get("location"), `https://decisionate.ca${path}`)
  }
  assert.equal(proxy.clerkCalls(), 0)
})

test("app root uses Clerk and routes existing sessions through workspace authorization", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  for (const [user, destination] of [[null, "/sign-in"], ["reviewer", "/auth/redirect"]]) {
    const response = await proxy.run("https://app.decisionate.ca/", user)
    assert.equal(response.status, 307)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(response.headers.get("location"), `https://app.decisionate.ca${destination}`)
    assert.equal(await proxy.run(response.headers.get("location"), user), undefined)
  }
  assert.equal(proxy.clerkCalls(), 4)
  const headers = { "x-forwarded-host": "app.decisionate.ca", "x-forwarded-proto": "https" }
  assert.equal((await proxy.run("http://localhost:3000/", null, headers)).headers.get("location"), "https://app.decisionate.ca/sign-in")
})

test("direct app dashboard links remain protected and retain their authorized destination", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  for (const path of ["/dashboard", "/connections?provider=meta_ads&connected=true", "/onboarding", "/platform-admin"]) {
    const response = await proxy.run(`https://app.decisionate.ca${path}`)
    const login = new URL(response.headers.get("location"))
    assert.equal(login.origin, domains.DECISIONATE_APPLICATION_ORIGIN)
    assert.equal(login.pathname, "/sign-in")
    assert.equal(login.searchParams.get("redirect_url"), path)
    const authenticated = await proxy.run(`https://app.decisionate.ca${path}`, "reviewer")
    if (path.startsWith("/connections")) {
      assert.equal(authenticated.headers.get("x-middleware-rewrite"), `https://app.decisionate.ca/dashboard${path}`)
    } else assert.equal(authenticated, undefined)
  }
})

test("old application links move to app and preserve invitation, checkout and OAuth state without loops", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  const workspace = "/dashboard?workspace_id=agency%3Aclient%3A2"
  for (const origin of [domains.DECISIONATE_MARKETING_ORIGIN, "https://www.decisionate.ca"]) {
    for (const path of [
      `/sign-in?redirect_url=${encodeURIComponent(origin + workspace)}`,
      "/billing?checkout=success&session_id=cs_example",
      "/connections?provider=meta_ads&connected=true&state=a%2Bb%3D",
      "/sign-up/verify-email-address?ticket=opaque%2Bvalue",
    ]) {
      let current = origin + path
      const seen = new Set()
      for (let hop = 0; hop < 5; hop++) {
        assert.ok(!seen.has(current), `Redirect loop: ${current}`)
        seen.add(current)
        const response = await proxy.run(current)
        if (!(response instanceof Response)) break
        current = response.headers.get("location")
      }
      const result = new URL(current)
      assert.equal(result.origin, domains.DECISIONATE_APPLICATION_ORIGIN)
      if (path.startsWith("/sign-in")) {
        assert.equal(result.searchParams.get("redirect_url"), workspace)
        const switched = await proxy.run(`${current}&switch_account=1`, "reviewer")
        assert.equal(switched, undefined)
      }
      if (path.startsWith("/dashboard")) {
        assert.equal(result.pathname, "/sign-in")
        assert.equal(result.searchParams.get("redirect_url"), path)
      }
      if (path.startsWith("/sign-up")) assert.equal(result.searchParams.get("ticket"), "opaque+value")
    }
  }
})

test("password recovery, auth callbacks, API and shared links are not captured by the app-root rule", async () => {
  const proxy = proxyHarness({ responseObjects: true })
  for (const origin of [domains.DECISIONATE_APPLICATION_ORIGIN, "https://localhost:3000"]) {
    for (const path of ["/sign-in", "/sign-in/forgot-password", "/sign-in/reset-password", "/sign-in/sso-callback", "/sign-up/verify-email-address", "/auth/redirect", "/api/portal-health", "/__clerk/handshake", "/share/dashboard?token=opaque"]) {
      assert.equal(await proxy.run(origin + path), undefined, origin + path)
    }
  }
  for (const origin of ["https://localhost:3000", "https://preview.vercel.app", "https://app.decisionate.ca.attacker.test"]) {
    assert.equal(await proxy.run(origin + "/"), "next")
  }
  assert.equal(await proxy.run("https://decisionate.ca/api/portal-health"), undefined)
  const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server")
  const { config } = load("../proxy.ts", {
    "./features/hosted-subdomains/server": {},
    "./features/auth/lib/auth-redirects": redirects,
    "@clerk/nextjs/server": { createRouteMatcher: () => () => false, clerkMiddleware: () => () => {} },
    "next/server": {},
  })
  for (const path of ["/_next/static/chunks/app.js", "/_next/image?url=logo", "/icons/decisionate-logo.png", "/sw.js", "/manifest.webmanifest"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }), false, path)
  }
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/connections" }), true)
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/portal-health" }), true)
})

test("registered hosted roots use central Clerk satellites and retain normal workspace protection", async () => {
  const portal = { id: "north", hostname: "north.decisionate.app", origin: "https://north.decisionate.app", active: true }
  const h = proxyHarness({ hostedPortal: portal, responseObjects: true })
  assert.equal((await h.run(portal.origin + "/")).headers.get("location"), portal.origin + "/sign-in")
  assert.equal((await h.run(portal.origin + "/", "owner")).headers.get("location"), portal.origin + "/auth/redirect")
  assert.equal((await h.run(portal.origin + "/connections")).headers.get("location"), portal.origin + "/sign-in?redirect_url=%2Fconnections")
  assert.equal(h.options().domain, portal.hostname)
  assert.equal(h.options().isSatellite, true)
  assert.equal(h.options().frontendApiProxy.enabled, true)
  assert.equal(h.options().signInUrl, "https://app.decisionate.ca/sign-in")
  for (const path of ["/platform-admin", "/dashboard/white-label", "/dashboard/hosted-portal", "/hosted-portal", "/onboarding", "/demo"]) {
    assert.equal((await h.run(portal.origin + path, "owner")).status, 404, path)
  }
  assert.equal((await h.run(portal.origin + "/privacy")).headers.get("location"), "https://decisionate.ca/privacy")
})

test("unknown hosted domains never fall back to Decisionate, and inactive domains only bootstrap Clerk", async () => {
  const h = proxyHarness({ responseObjects: true })
  for (const origin of ["https://decisionate.app", "https://unknown.decisionate.app"]) {
    for (const path of ["/", "/sign-in", "/dashboard", "/__clerk/v1/client"]) {
      const response = await h.run(origin + path + "?redirect_url=https://app.decisionate.ca&token=private")
      assert.equal(response.status, 404, path)
      assert.match(response.headers.get("content-type"), /^text\/html/)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
      const html = await response.text()
      assert.match(html, /We can't open this portal/)
      assert.match(html, /href="\/">Try again/)
      assert.doesNotMatch(html, /decisionate\.ca|sign.in|private|redirect_url|<script/i)
    }
  }
  assert.equal(h.clerkCalls(), 0)
  const inactive = proxyHarness({ responseObjects: true, hostedPortal: { hostname: "north.decisionate.app", active: false } })
  assert.equal((await inactive.run("https://north.decisionate.app/sign-in")).status, 404)
  assert.equal(await inactive.run("https://north.decisionate.app/__clerk/v1/client"), undefined)
})

test("central sign-in only forwards server-validated portal returns and strips spoofed headers", async () => {
  const rejected = proxyHarness({ responseObjects: true })
  await rejected.run("https://app.decisionate.ca/sign-in?redirect_url=https://evil.test", null, { "x-decisionate-hosted-return": "https://evil.test" })
  assert.equal(rejected.headers().get("x-decisionate-hosted-return"), null)
  const target = "https://north.decisionate.app/auth/redirect?__clerk_synced=false"
  const accepted = proxyHarness({ hostedReturn: target, responseObjects: true })
  await accepted.run("https://app.decisionate.ca/sign-in?redirect_url=" + encodeURIComponent(target))
  assert.equal(accepted.headers().get("x-decisionate-hosted-return"), target)
  const loggedIn = await accepted.run("https://app.decisionate.ca/sign-in?redirect_url=" + encodeURIComponent(target), "owner")
  assert.equal(loggedIn.headers.get("location"), target)
})

test("agency invitation recovery retains the branded auth entry despite an existing Clerk session", async () => {
  const portal = { id: "north", hostname: "north.decisionate.app", origin: "https://north.decisionate.app", active: true }
  const destination = "/dashboard?workspace_id=agency%3Aclient%3A2"
  const target = hostedTypes.getHostedAuthReturnUrl(portal.origin + redirects.getAuthRedirectUrl(destination))
  const h = proxyHarness({ hostedPortal: portal, hostedReturn: target, responseObjects: true })
  const recovery = portal.origin + redirects.getWorkspaceAccountSwitchUrl(destination)
  assert.equal(await h.run(recovery, "other-account"), undefined, "Recovery must not loop to the same callback")
  for (const mode of ["sign-in", "sign-up"]) {
    const entry = hostedTypes.getHostedAuthUrl(mode, target)
    assert.equal(await h.run(entry, "other-account"), undefined)
    assert.equal(h.headers().get("x-decisionate-hosted-return"), target)
    assert.equal(await h.run(entry), undefined)
    const callback = new URL(entry)
    callback.pathname += "/sso-callback"
    const completed = await h.run(callback.href, "verified-account")
    assert.equal(completed.headers.get("location"), target)
  }
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
    context.clearActiveWorkspaceId("reviewer")
    assert.equal(context.getActiveWorkspaceId("reviewer"), "reviewer")
    assert.equal(changes, 1, "deletion must not remount protected pages before sign-out")
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
    "@/features/reports/analysis-jobs": {},
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
