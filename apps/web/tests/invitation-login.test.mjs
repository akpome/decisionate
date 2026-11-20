import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const jsx = require("react/jsx-runtime"), { renderToStaticMarkup } = require("react-dom/server")
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"), loaded = { exports: {} }
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } })
  vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports, URL, URLSearchParams, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]
  }, ...globals })
  return loaded.exports
}
const routes = load("../lib/application-routes.ts")
const redirects = load("../features/auth/lib/auth-redirects.ts", { "@/lib/application-routes": routes })
const hostedTypes = load("../features/hosted-subdomains/types.ts")
const workspaces = load("../features/auth/lib/auth-workspaces.ts", { "./auth-redirects": redirects })
const destination = "/dashboard?workspace_id=agency%3Aclient%3Aone"
class ApiError extends Error { constructor(message, status) { super(message); this.status = status } }

async function resolveInvitation({ workspaceList = [], failure, returnTo = destination, portal = null } = {}) {
  const effects = [], routes = [], errors = [], active = [], reads = []
  const Page = load("../app/auth/redirect/page.tsx", {
    "@/features/hosted-subdomains/provider": { useHostedPortal: () => ({ portal }) },
    "@/features/hosted-subdomains/types": hostedTypes,
    "react/jsx-runtime": jsx, react: { useEffect: callback => effects.push(callback), useState: () => [null, error => errors.push(error)] },
    "@clerk/nextjs": { useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: "current", primaryEmailAddress: { emailAddress: "current@example.test" }, emailAddresses: [] } }), useClerk: () => ({ signOut() { throw new Error("Unexpected automatic logout") } }) },
    "next/navigation": { useRouter: () => ({ replace: route => routes.push(route) }) },
    "lucide-react": { LoaderCircle: () => null, LogOut: () => null, RefreshCw: () => null },
    "@/lib/api": { ApiError, getPlatformAdminAccess: async () => false, getOrganizationWorkspaces: async (...args) => {
      reads.push(args); if (failure) throw failure; return workspaceList
    } },
    "@/features/auth/lib/auth-redirects": redirects, "@/features/auth/lib/auth-workspaces": workspaces,
    "@/features/auth/lib/signup-consent": { writeSignupConsent() {} }, "@/features/auth/lib/marketing-consent": { completeSignupMarketing: async () => {} },
    "@/lib/workspace-context": { getActiveWorkspaceId: id => id, setActiveWorkspaceId: (_id, workspace) => active.push(workspace) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) },
  }, { window: { location: { origin: portal?.origin ?? "https://app.example.test", search: `?redirect_url=${encodeURIComponent(returnTo)}` } } }).default
  Page(); effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  return { routes, errors, active, reads }
}

test("a signed-in account without the invited workspace returns to login instead of access denied or personal onboarding", async () => {
  const result = await resolveInvitation({ workspaceList: [{ owner_user_id: "current", role: "owner" }] })
  assert.deepEqual(result.routes, [redirects.getWorkspaceAccountSwitchUrl(destination)])
  assert.deepEqual(result.errors, [null]); assert.deepEqual(result.active, [])
})

test("the invited account still opens its authorized workspace after login", async () => {
  const result = await resolveInvitation({ workspaceList: [{ owner_user_id: "agency:client:one", role: "client_owner" }] })
  assert.deepEqual(result.routes, [destination]); assert.deepEqual(result.active, ["agency:client:one"])
})

test("invitation permission failures go to login but service failures and expired sessions keep their own recovery", async () => {
  const denied = await resolveInvitation({ failure: new ApiError("Forbidden", 403) })
  assert.deepEqual(denied.routes, [redirects.getWorkspaceAccountSwitchUrl(destination)])
  for (const [status, state] of [[503, "workspace"], [401, "session"]]) {
    const result = await resolveInvitation({ failure: new ApiError("Unavailable", status) })
    assert.deepEqual(result.routes, []); assert.equal(result.errors.at(-1), state)
  }
  const ordinary = await resolveInvitation({ failure: new ApiError("Forbidden", 403), returnTo: "/dashboard" })
  assert.deepEqual(ordinary.routes, []); assert.equal(ordinary.errors.at(-1), "access")
})

test("hosted invitations with an unrelated session return to the agency's invitation entry without an error", async () => {
  const portal = { origin: "https://north.decisionate.app", branding: { name: "North Star" } }
  for (const failure of [undefined, new ApiError("Forbidden", 403)]) {
    const result = await resolveInvitation({ portal, failure, workspaceList: [{ owner_user_id: "other", role: "client_owner" }] })
    assert.deepEqual(result.routes, [redirects.getWorkspaceAccountSwitchUrl(destination)])
    assert.deepEqual(result.active, [])
    assert.deepEqual(result.errors, [null])
    assert.equal(result.reads[0][2]?.forceRefresh, true)
  }
  const matched = await resolveInvitation({ portal, workspaceList: [{ owner_user_id: "agency:client:one", role: "client_owner" }] })
  assert.deepEqual(matched.routes, [destination])
  assert.deepEqual(matched.active, ["agency:client:one"])
  const withoutInvite = await resolveInvitation({ portal, returnTo: "/dashboard" })
  assert.equal(withoutInvite.errors.at(-1), "portal")
  assert.deepEqual(withoutInvite.routes, [])
  assert.deepEqual(withoutInvite.active, [])
  const recovery = new URL(hostedTypes.hostedWorkspaceRecoveryUrl)
  assert.equal(recovery.origin, hostedTypes.hostedPrimaryOrigin)
  assert.equal(recovery.pathname, "/sign-in")
  assert.equal(recovery.searchParams.get("redirect_url"), "/settings")
})

function invitationCard(session, signOut = () => { throw new Error("Unexpected automatic logout") }) {
  return load("../features/auth/components/workspace-invitation-sign-in.tsx", {
    "react/jsx-runtime": jsx, react: React, "@clerk/nextjs": { useUser: () => session, useClerk: () => ({ signOut }) },
    "lucide-react": { LoaderCircle: () => null, LogOut: () => null },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: text => text }) }, "../lib/auth-redirects": redirects,
  }).WorkspaceInvitationSignIn
}

test("the login prompt requires a user action before signing out and shows the existing account", () => {
  const Card = invitationCard({ isLoaded: true, isSignedIn: true, user: { primaryEmailAddress: { emailAddress: "agency@example.test" } } })
  const html = renderToStaticMarkup(React.createElement(Card, { returnTo: destination }, "LOGIN FORM"))
  assert.match(html, /Use the invited account/); assert.match(html, /agency@example.test/)
  assert.match(html, /Use invited account/); assert.doesNotMatch(html, /LOGIN FORM|access was denied/)
})

test("signed-out visitors see the login form and loading sessions do not show an incorrect account warning", () => {
  for (const [session, expected, absent] of [
    [{ isLoaded: true, isSignedIn: false }, "LOGIN FORM", "Use the invited account"],
    [{ isLoaded: false, isSignedIn: false }, "Loading sign in", "LOGIN FORM"],
  ]) {
    const Card = invitationCard(session), html = renderToStaticMarkup(React.createElement(Card, { returnTo: destination }, "LOGIN FORM"))
    assert.ok(html.includes(expected)); assert.ok(!html.includes(absent))
  }
})

test("account switching preserves the invitation, blocks double clicks and recovers from sign-out failure", async () => {
  const source = readFileSync(new URL("../features/auth/components/workspace-invitation-sign-in.tsx", import.meta.url), "utf8")
  const tree = ts.createSourceFile("card.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSwitchAccount") handler = node.getText(tree); ts.forEachChild(node, visit) }
  visit(tree); assert.ok(handler)
  const code = ts.transpileModule(`${handler}\nhandleSwitchAccount`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const fails of [false, true]) {
    const calls = [], context = { switching: false, returnTo: destination, getSignInUrl: redirects.getSignInUrl,
      setSwitching: value => { context.switching = value }, setFailed: value => { context.failed = value },
      signOut: async options => { calls.push(options.redirectUrl); if (fails) throw new Error("Unavailable") } }
    const run = vm.runInNewContext(code, context); await run()
    assert.deepEqual(calls, [redirects.getSignInUrl(destination)])
    assert.equal(context.failed, fails); assert.equal(context.switching, !fails)
    context.switching = true; await run(); assert.equal(calls.length, 1)
  }
})
