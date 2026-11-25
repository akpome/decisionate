import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const next = require("next/server")
function load(file, deps = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, URL, AbortSignal, Headers, ...globals,
    require: specifier => { assert.ok(specifier in deps, specifier); return deps[specifier] },
  })
  return loaded.exports
}

const before = "https://old-agency.decisionate.app"
const after = "https://new-agency.decisionate.app"
const oldPortal = { id: "same-portal", hostname: new URL(before).hostname, origin: before, active: false, redirect_origin: after, branding: null }
const newPortal = { id: oldPortal.id, hostname: new URL(after).hostname, origin: after, active: true, branding: { name: "Agency" } }
const types = load("../features/hosted-subdomains/types.ts")
const routes = load("../lib/application-routes.ts")
const domains = load("../lib/decisionate-domains.ts")
const auth = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })
function service(old = oldPortal, current = newPortal) {
  return load("../features/hosted-subdomains/server.ts", {
    "server-only": {}, react: { cache: fn => fn }, "next/headers": {},
    "./types": types, "@/features/auth/lib/auth-redirects": auth,
  }, { process: { env: { NEXT_PUBLIC_API_URL: "https://api.example.test" } }, fetch: async value => {
    const host = new URL(value).searchParams.get("hostname")
    const row = [old, current].find(item => item.hostname === host)
    return { ok: Boolean(row), json: async () => row }
  } })
}

test("an invitation saved on the old address returns to the same portal on the new address", async () => {
  const value = new URL("/auth/redirect", before)
  value.searchParams.set("redirect_url", before + "/dashboard?workspace_id=agency%3Aclient%3A1")
  value.searchParams.set("__clerk_handshake", "previous-session")
  const forwarded = new URL(await service().safeHostedReturn(value.href))
  assert.equal(forwarded.origin, after)
  assert.equal(forwarded.searchParams.get("redirect_url"), "/dashboard?workspace_id=agency%3Aclient%3A1")
  assert.equal(forwarded.searchParams.get("__clerk_synced"), "false")
  assert.equal(forwarded.searchParams.has("__clerk_handshake"), false)
  assert.equal(await service(oldPortal, { ...newPortal, id: "other" }).safeHostedReturn(value.href), null)
  assert.equal(await service(oldPortal, { ...newPortal, active: false }).safeHostedReturn(value.href), null)
})

test("forwarding a portal address preserves page links but not old Clerk credentials", async () => {
  let clerkRequests = 0
  const { default: proxy } = load("../proxy.ts", {
    "@clerk/nextjs/server": {
      createRouteMatcher: () => () => false,
      clerkMiddleware: () => () => { clerkRequests++; return next.NextResponse.next() },
    },
    "next/server": next,
    "./features/auth/lib/auth-redirects": auth,
    "./lib/portal-brand": { portalBrand: { id: "" } },
    "./lib/application-routes": routes, "./lib/decisionate-domains": domains,
    "./features/hosted-subdomains/server": service(),
    "./features/hosted-subdomains/types": types,
    "./features/hosted-subdomains/unavailable-page": {},
  })
  const response = await proxy(new next.NextRequest(before + "/connections?workspace_id=one&__session=previous&__clerk_synced=true"), {})
  assert.equal(response.status, 307)
  assert.equal(response.headers.get("location"), after + "/connections?workspace_id=one")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(clerkRequests, 0)
  const post = await proxy(new next.NextRequest(before + "/connections", { method: "POST" }), {})
  assert.equal(post.status, 404)
  await proxy(new next.NextRequest(before + "/__clerk/v1/client/handshake"), {})
  assert.equal(clerkRequests, 1)
})

test("the server rejects invalid or self-referential forwarding origins", async () => {
  for (const target of ["https://evil.test", before, after + "/path", "http://new-agency.decisionate.app", "https://user@new-agency.decisionate.app"]) {
    assert.equal(await service({ ...oldPortal, redirect_origin: target }).resolveHostedPortal(oldPortal.hostname), null)
  }
})
