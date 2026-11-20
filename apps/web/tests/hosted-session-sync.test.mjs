import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { createClerkClient } = require("@clerk/backend"), { renderToStaticMarkup } = require("react-dom/server")
const { parsePublishableKey } = require("@clerk/shared/keys")
function load(path, dependencies = {}, globals = {}) {
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: loaded, exports: loaded.exports, URL, AbortSignal, ...globals, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name]
  } })
  return loaded.exports
}
const types = load("../features/hosted-subdomains/types.ts")
const routes = load("../lib/application-routes.ts")
const redirects = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })
const workspaces = load("../features/auth/lib/auth-workspaces.ts", { "./auth-redirects": redirects })
const portal = { id: "north", hostname: "north.decisionate.app", origin: "https://north.decisionate.app", active: true }
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
const publishableKey = "pk_live_" + Buffer.from("clerk.primary.test$").toString("base64")
const clerk = createClerkClient({ secretKey: "sk_live_local_fixture", publishableKey,
  jwtKey: key.publicKey.export({ type: "spki", format: "pem" }) })
const options = { isSatellite: true, domain: portal.hostname, proxyUrl: portal.origin + "/__clerk", signInUrl: types.hostedPrimaryOrigin + "/sign-in" }
const now = Math.floor(Date.now() / 1000)
function token(payload) {
  const encoded = [ { alg: "RS256", typ: "JWT", kid: "local-fixture" }, payload ]
    .map(part => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".")
  return encoded + "." + sign("RSA-SHA256", Buffer.from(encoded), key.privateKey).toString("base64url")
}
function request(url, cookie = "") {
  return new Request(url, { headers: { accept: "text/html", "sec-fetch-dest": "document", ...(cookie ? { cookie } : {}) } })
}
function session(origin) {
  const issuer = parsePublishableKey(publishableKey, origin === portal.origin ? { domain: portal.hostname, isSatellite: true } : {}).frontendApi
  return token({ sub: "user_local_fixture", sid: "sess_local_fixture", iss: "https://" + issuer, azp: origin,
    iat: now, nbf: now - 10, exp: now + 300 })
}

test("every new hosted sign-in action requests Clerk's sync, preserving the intended workspace destination", () => {
  for (const marker of [null, "false", "true"]) {
    const value = new URL(portal.origin + "/auth/redirect?redirect_url=%2Fconnections%3Fworkspace_id%3Dclient#resume")
    if (marker !== null) value.searchParams.set("__clerk_synced", marker)
    const result = new URL(types.getHostedAuthReturnUrl(value.href))
    assert.equal(result.searchParams.get("__clerk_synced"), "false")
    assert.equal(result.searchParams.get("redirect_url"), "/connections?workspace_id=client")
    assert.equal(result.hash, "#resume")
    assert.equal(Array.from(result.searchParams.keys()).filter(key => key === "__clerk_synced").length, 1)
  }
  for (const value of ["/auth/redirect", "https://evil.test/auth/redirect", "http://north.decisionate.app/auth/redirect",
    "https://user@north.decisionate.app/auth/redirect", "https://north.decisionate.app:4000/auth/redirect", "javascript:alert(1)"]) {
    assert.throws(() => types.getHostedAuthReturnUrl(value))
  }
})

test("legacy primary login links also request a sync after the active portal has been verified", async () => {
  const { safeHostedReturn } = load("../features/hosted-subdomains/server.ts", {
    "server-only": {}, react: { cache: fn => fn }, "next/headers": {}, "./types": types,
    "@/features/auth/lib/auth-redirects": redirects,
  }, { process: { env: { NEXT_PUBLIC_API_URL: "https://api.test" } }, fetch: async () => ({ ok: true, json: async () => portal }) })
  const returned = new URL(await safeHostedReturn(portal.origin + "/auth/redirect?redirect_url=%2Fdashboard"))
  assert.equal(returned.searchParams.get("__clerk_synced"), "false")
  assert.equal(returned.searchParams.get("redirect_url"), "/dashboard")
  assert.equal(await safeHostedReturn("https://evil.test/auth/redirect"), null)
})

async function authenticatedReturn(destination) {
  const returnTo = portal.origin + redirects.getAuthRedirectUrl(destination)
  const primarySession = session(types.hostedPrimaryOrigin)
  const primary = await clerk.authenticateRequest(request(types.hostedPrimaryOrigin + "/sign-in", `__session=${primarySession}; __client_uat=${now}`))
  assert.equal(primary.status, "signed-in")
  const link = new URL(types.getHostedAuthUrl("sign-in", returnTo, types.hostedPrimaryOrigin + "/sign-in"))
  const callback = link.searchParams.get("redirect_url")
  const before = await clerk.authenticateRequest(request(returnTo), options)
  assert.equal(before.status, "signed-out", "An unmarked return reproduces the original signed-out loop")
  const sync = await clerk.authenticateRequest(request(callback), options)
  assert.equal(sync.status, "handshake")
  assert.equal(sync.reason, "satellite-needs-syncing")
  const handshake = new URL(sync.headers.get("location"))
  assert.equal(handshake.pathname, "/__clerk/v1/client/handshake")
  assert.equal(new URL(handshake.searchParams.get("redirect_url")).searchParams.get("redirect_url"), destination)

  const satelliteSession = session(portal.origin)
  const completed = new URL(callback)
  completed.searchParams.set("__clerk_synced", "true")
  completed.searchParams.set("__clerk_handshake", token({ handshake: [
    `__session=${satelliteSession}; Path=/; Secure; SameSite=None`, `__client_uat=${now}; Path=/; Secure; SameSite=None`,
  ] }))
  const authenticated = await clerk.authenticateRequest(request(completed), options)
  assert.equal(authenticated.status, "signed-in")
  assert.equal(authenticated.toAuth().userId, primary.toAuth().userId)
  assert.equal(authenticated.toAuth().sessionId, primary.toAuth().sessionId)
  const cookies = authenticated.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ")
  completed.searchParams.delete("__clerk_handshake")
  const recognized = await clerk.authenticateRequest(request(completed, cookies), options)
  assert.equal(recognized.status, "signed-in", "A completed sync must not start another handshake")
  assert.equal(recognized.headers.get("location"), null)
  return { completed, cookies, auth: recognized.toAuth() }
}

async function openWorkspace(auth, completed, accessible) {
  const effects = [], destinations = [], errors = [], selected = [], user = auth.userId ? { id: auth.userId } : null
  const { default: AuthRedirectPage } = load("../app/auth/redirect/page.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: { ...React, useEffect: effect => effects.push(effect), useState: value => [value, error => { if (error) errors.push(error) }] },
    "@clerk/nextjs": { useUser: () => ({ isLoaded: true, isSignedIn: Boolean(user), user }), useClerk: () => ({ signOut() {} }) },
    "next/navigation": { useRouter: () => ({ replace: path => destinations.push(path) }) },
    "lucide-react": { LoaderCircle: () => null, LogOut: () => null, RefreshCw: () => null },
    "@/lib/api": { ApiError: class extends Error {}, getOrganizationWorkspaces: async () => accessible,
      getPlatformAdminAccess: () => assert.fail("Hosted sessions must not probe platform admin access") },
    "@/features/auth/lib/auth-redirects": redirects, "@/features/auth/lib/auth-workspaces": workspaces,
    "@/features/auth/lib/signup-consent": { writeSignupConsent() {} },
    "@/features/auth/lib/marketing-consent": { completeSignupMarketing: () => assert.fail("Hosted login does not enroll marketing") },
    "@/lib/workspace-context": { getActiveWorkspaceId: () => auth.userId, setActiveWorkspaceId: (...ids) => selected.push(ids) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
    "@/features/hosted-subdomains/provider": { useHostedPortal: () => ({ portal }) },
  }, { URLSearchParams, window: { location: { origin: portal.origin, search: completed.search } } })
  renderToStaticMarkup(React.createElement(AuthRedirectPage))
  const cleanups = effects.map(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  cleanups.forEach(cleanup => cleanup?.())
  return { destinations, errors, selected }
}

test("a verified primary session syncs to the portal and opens its authorized dashboard, not the welcome page", async () => {
  const returned = await authenticatedReturn(null)
  const workspace = { owner_user_id: returned.auth.userId, role: "owner" }
  const result = await openWorkspace(returned.auth, returned.completed, [workspace])
  assert.deepEqual(result.destinations, ["/dashboard"])
  assert.deepEqual(result.errors, [])
  const dashboard = await clerk.authenticateRequest(request(portal.origin + result.destinations[0], returned.cookies), options)
  assert.equal(dashboard.status, "signed-in")
  assert.equal(dashboard.headers.get("location"), null)
})

test("a synced client session retains its invitation destination and still needs workspace membership", async () => {
  const destination = "/connections?workspace_id=agency%3Aclient%3Aone"
  const returned = await authenticatedReturn(destination)
  const workspace = { owner_user_id: "agency:client:one", role: "client_owner" }
  const allowed = await openWorkspace(returned.auth, returned.completed, [workspace])
  assert.deepEqual(allowed.destinations, [destination])
  assert.equal(allowed.selected[0][1], workspace.owner_user_id)
  const denied = await openWorkspace(returned.auth, returned.completed, [])
  assert.deepEqual(denied.destinations, [])
  assert.deepEqual(denied.selected, [])
  assert.deepEqual(denied.errors, ["invitation"])
})

test("a handshake with no signed session cannot grant access", async () => {
  const callback = new URL(types.getHostedAuthReturnUrl(portal.origin + "/auth/redirect"))
  callback.searchParams.set("__clerk_synced", "true")
  callback.searchParams.set("__clerk_handshake", token({ handshake: [] }))
  const state = await clerk.authenticateRequest(request(callback), options)
  assert.equal(state.status, "signed-out")
  assert.equal(state.toAuth().userId, null)
})
