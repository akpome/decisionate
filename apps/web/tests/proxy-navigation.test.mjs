import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
require("next/dist/server/node-environment")
const ts = require("typescript")
const nextServer = require("next/server")
const { adapter } = require("next/dist/server/web/adapter")
const { createRouteMatcher } = require("@clerk/nextjs/server")
const { createClerkRequest } = require("@clerk/backend/internal")
// Exercise the installed Clerk header handling and Next Flight adapter, not
// just a mock Response. Only the session lookup and portal registry are stubbed.
const { decorateRequest } = require(join(dirname(require.resolve("@clerk/nextjs/server")), "utils.js"))

function load(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    module: loaded, exports: loaded.exports, URL, Headers,
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return loaded.exports
}

const routes = load("../lib/application-routes.ts")
const redirects = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })
const domains = load("../lib/decisionate-domains.ts")
const hostedTypes = load("../features/hosted-subdomains/types.ts")
const hostedPortal = { hostname: "north.decisionate.app", origin: "https://north.decisionate.app", active: true }

function navigationProxy(userId) {
  return load("../proxy.ts", {
    "next/server": nextServer,
    "./lib/portal-brand": { portalBrand: { id: "" } },
    "./lib/decisionate-domains": domains,
    "./lib/application-routes": routes,
    "./features/auth/lib/auth-redirects": redirects,
    "./features/hosted-subdomains/types": hostedTypes,
    "./features/hosted-subdomains/unavailable-page": load("../features/hosted-subdomains/unavailable-page.ts"),
    "./features/hosted-subdomains/server": {
      resolveHostedPortal: async hostname => hostname === hostedPortal.hostname ? hostedPortal : null,
      safeHostedReturn: async () => null,
    },
    "@clerk/nextjs/server": {
      createRouteMatcher,
      clerkMiddleware: callback => async (request, event) => {
        const response = await callback(async () => ({ userId }), request, event) ?? nextServer.NextResponse.next()
        decorateRequest(createClerkRequest(request), response, {
          status: userId ? "signed-in" : "signed-out", token: userId ? "fixture-session" : "",
        }, {}, { secretKey: "sk_test_routing_fixture" }, null)
        response.cookies.set("routing-fixture", "retained", { httpOnly: true, secure: true })
        return response
      },
    },
  }).default
}

const modes = [
  { name: "document", query: "", headers: {} },
  { name: "RSC navigation", query: "&_rsc=navigation", headers: { rsc: "1", "next-router-state-tree": '["",{}]' } },
  { name: "RSC prefetch", query: "&_rsc=prefetch", headers: { rsc: "1", "next-router-prefetch": "1", "next-router-state-tree": '["",{}]' } },
]

async function run(proxy, url, headers = {}) {
  const result = await adapter({
    page: "/proxy", handler: proxy,
    request: { url, method: "GET", nextConfig: {}, headers: { host: new URL(url).host, ...headers } },
  })
  await result.waitUntil
  return result.response
}

for (const mode of modes) {
  test(`${mode.name} resolves every root workspace link directly and preserves Clerk authentication`, async () => {
    const proxy = navigationProxy("user_fixture")
    for (const { path, internal } of routes.workspaceRoutes) {
      for (const suffix of ["", "/detail"]) {
        const query = "?workspace_id=agency%3Aclient%3A2&state=a%2Bb%3D&report=saved" + mode.query
        const response = await run(proxy, "https://app.decisionate.ca" + path + suffix + query, {
          ...mode.headers, "x-decisionate-hosted-return": "https://attacker.example/dashboard",
          "x-clerk-auth-status": "spoofed", "x-clerk-auth-token": "spoofed",
        })
        assert.equal(response.status, 200, path)
        assert.equal(response.headers.get("location"), null, path)
        assert.equal(response.headers.get("x-middleware-next"), null, path)
        assert.equal(response.headers.get("x-middleware-rewrite"), "https://app.decisionate.ca" + internal + suffix + query)
        assert.equal(response.headers.get("x-middleware-request-x-clerk-auth-status"), "signed-in")
        assert.equal(response.headers.get("x-middleware-request-x-clerk-auth-token"), "fixture-session")
        assert.ok(response.headers.get("x-middleware-request-x-clerk-auth-signature"))
        assert.equal(response.headers.get("x-middleware-request-x-decisionate-hosted-return"), null)
        assert.match(response.headers.get("set-cookie"), /routing-fixture=retained/)
        for (const [name, value] of Object.entries(mode.headers)) {
          assert.equal(response.headers.get("x-middleware-request-" + name), value)
        }
        if (mode.headers.rsc) assert.equal(response.headers.get("x-nextjs-rewritten-path"), internal + suffix)
      }
    }
  })

  test(`${mode.name} cannot bypass sign-in through a root workspace link`, async () => {
    const proxy = navigationProxy(null)
    for (const { path } of routes.workspaceRoutes) {
      const response = await run(proxy, "https://app.decisionate.ca" + path + "?workspace_id=client" + mode.query, mode.headers)
      assert.equal(response.status, 307)
      const destination = new URL(response.headers.get("location"), "https://app.decisionate.ca")
      assert.equal(destination.pathname, "/sign-in")
      assert.equal(destination.searchParams.get("redirect_url"), path + "?workspace_id=client")
      assert.equal(response.headers.get("x-middleware-rewrite"), null)
    }
  })
}

test("authorized hosted portals use the same RSC routing without opening restricted administration", async () => {
  const proxy = navigationProxy("user_fixture")
  for (const { path, internal } of routes.workspaceRoutes) {
    const response = await run(proxy, hostedPortal.origin + path + "?_rsc=hosted", { rsc: "1" })
    if (["/hosted-portal", "/white-label"].includes(path)) assert.equal(response.status, 404)
    else assert.equal(response.headers.get("x-middleware-rewrite"), hostedPortal.origin + internal + "?_rsc=hosted")
  }
})

test("authentication, API and public links are not rewritten into the dashboard", async () => {
  const proxy = navigationProxy(null)
  for (const path of ["/sign-in", "/sign-in/forgot-password", "/sign-up", "/auth/redirect", "/api/portal-health", "/privacy", "/share/dashboard"]) {
    const response = await run(proxy, "https://app.decisionate.ca" + path + "?_rsc=public", { rsc: "1" })
    assert.equal(response.headers.get("x-middleware-rewrite"), null, path)
    assert.equal(response.headers.get("x-middleware-next"), "1", path)
  }
})

test("unavailable portals return a non-indexable HTML page before Clerk for document and RSC requests", async () => {
  const proxy = navigationProxy(null)
  for (const mode of modes) {
    const response = await run(proxy, "https://unknown.decisionate.app/connections?workspace_id=private" + mode.query, mode.headers)
    assert.equal(response.status, 404)
    assert.match(response.headers.get("content-type"), /^text\/html/)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
    assert.equal(response.headers.get("location"), null)
    assert.equal(response.headers.get("set-cookie"), null)
    assert.equal(response.headers.get("x-middleware-rewrite"), null)
    const html = await response.text()
    assert.match(html, /We can't open this portal/)
    assert.match(html, /If you already have an account, sign in through Decisionate\.ca/)
    assert.match(html, /href="https:\/\/app\.decisionate\.ca\/sign-in">Sign in to Decisionate<\/a>/)
    assert.doesNotMatch(html, /private|<script/i)
  }
})
