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
    "./types": types,
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

function imageUpload(field) {
  const source = read("../features/hosted-subdomains/setup.tsx")
  const ast = ts.createSourceFile("setup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const editor = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HostedSubdomainEditor")
  const imageField = editor.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "imageField")
  const state = { reads: 0, error: "", brand: { logo_url: "", favicon_url: "", background_url: "" } }
  const context = { require, exports: {}, brand: state.brand, buttonClass: "", Error, logoError: "", getHostedLogo: types.getHostedLogo,
    setFailedLogo: () => {},
    setBrand: update => { state.brand = update(state.brand) },
    perform: action => { state.pending = action().catch(reason => { state.error = reason.message }) },
    FileReader: class {
      readAsDataURL(file) { state.reads++; this.result = `data:${file.type};base64,cG5n`; this.onload() }
    },
  }
  const render = vm.runInNewContext(ts.transpileModule(`${imageField.getText(ast)}\nimageField`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context)
  function findInput(node) {
    if (!node || typeof node !== "object") return null
    if (node.type === "input") return node
    return [].concat(node.props?.children || []).map(findInput).find(Boolean)
  }
  const input = findInput(render(field, field))
  return { state, async choose(size, type = "image/png") {
    const target = { files: [{ size, type }], value: "selected-file" }
    input.props.onChange({ target }); await state.pending
    assert.equal(target.value, "")
  } }
}

test("hosted logo picker accepts exactly 1 MB while other images retain their 128 KB limit", async () => {
  for (const [field, limit, label] of [["logo_url", 1024 * 1024, "1 MB"], ["background_url", 128 * 1024, "128 KB"]]) {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      const accepted = imageUpload(field)
      await accepted.choose(limit, type)
      assert.equal(accepted.state.error, "")
      assert.equal(accepted.state.reads, 1)
      assert.ok(accepted.state.brand[field].startsWith(`data:${type};base64,`))
    }
    const oversized = imageUpload(field)
    await oversized.choose(limit + 1)
    assert.match(oversized.state.error, new RegExp(`no larger than ${label}`))
    assert.equal(oversized.state.reads, 0)
    assert.equal(oversized.state.brand[field], "")
  }
  const svg = imageUpload("logo_url")
  await svg.choose(100, "image/svg+xml")
  assert.equal(svg.state.reads, 0)
  assert.match(svg.state.error, /PNG, JPEG or WebP/)
})

function renderSetup({ entitled = true, available = true, slug = "", addressCheck = null, portal = null } = {}) {
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server")
  const brand = { name: "North Star", support_email: "help@northstar.test", logo_url: "", favicon_url: "", background_url: "",
    primary_color: "#2563EB", accent_color: "#059669", background_color: "#FFFFFF", welcome_heading: "Welcome", welcome_text: "" }
  const states = [{ portal, entitled, commercially_available: available, blockers: [], defaults: brand },
    brand, slug, "", "", false, false, false, 0, "", addressCheck, 0]
  let index = 0
  const { HostedSubdomainSetup } = load("../features/hosted-subdomains/setup.tsx", {
    "./types": types,
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
  assert.match(html, /Logo URL/)
  assert.match(html, /Upload logo/)
  assert.doesNotMatch(html, /Browser icon/)
  assert.doesNotMatch(html, /View subscription price|Cancel hosted white label|Subscription options|Add hosted white label/)
})

test("one hosted logo is used consistently, preserving older icon-only branding", () => {
  assert.equal(types.getHostedLogo({ logo_url: "logo.png", favicon_url: "old-icon.png" }), "logo.png")
  assert.equal(types.getHostedLogo({ logo_url: "", favicon_url: "old-icon.png" }), "old-icon.png")
  assert.equal(types.getHostedLogo({ logo_url: "", favicon_url: "" }), "")
  assert.equal(types.isHostedLogoUrl("https://cdn.agency.test/images/logo?version=2"), true)
  for (const value of ["http://agency.test/logo.png", "javascript:alert(1)", "data:image/svg+xml;base64,abc",
    "https://user:secret@agency.test/logo.png", "https://agency.test:444/logo.png", "https://agency.test/a b.png", "https://agency.test/\\bad"]) {
    assert.equal(types.isHostedLogoUrl(value), false, value)
  }
  const editor = read("../features/hosted-subdomains/setup.tsx")
  assert.match(editor, /const logo = getHostedLogo\(brand\)/)
  assert.match(editor, /logo_url: logo.trim\(\), favicon_url: ""/)
  assert.match(editor, /uploadedLogo \? "" : logo/)
  assert.doesNotMatch(editor, /imageField\("favicon_url"/)
  assert.match(editor, /<img src=\{logo\}/)
  assert.match(editor, /The logo could not be loaded/)
  assert.match(read("../features/hosted-subdomains/sign-in.tsx"), /const logo = getHostedLogo\(brand\)/)
  assert.match(read("../app/layout.tsx"), /icons: portal.branding.logo_url \|\| portal.branding.favicon_url/)
})

test("saved hosted logo URLs and uploads replace legacy icons without exposing encoded images in the URL field", async () => {
  const source = read("../features/hosted-subdomains/setup.tsx")
  const ast = ts.createSourceFile("setup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const editor = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HostedSubdomainEditor")
  const save = editor.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "save")
  for (const logo of ["https://cdn.agency.test/logo.png", "data:image/png;base64,cG5n", ""]) {
    const calls = []
    const context = { logo, uploadedLogo: logo.startsWith("data:"), isHostedLogoUrl: types.isHostedLogoUrl, Error, JSON,
      userId: "owner", slug: "north-star", brand: { logo_url: logo, favicon_url: "old.png" }, data: { portal: { revision: 2 } },
      hostedSubdomainRequest: async (...args) => { calls.push(args); return { configuration: JSON.parse(args[2].body).configuration, slug: "north-star" } },
      setData() {}, setBrand() {}, setSlug() {}, setNotice() {}, setPreview() {},
    }
    const run = vm.runInNewContext(ts.transpileModule(`${save.getText(ast)}\nsave`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    await run(true)
    const payload = JSON.parse(calls[0][2].body)
    assert.equal(payload.configuration.logo_url, logo)
    assert.equal(payload.configuration.favicon_url, "")
    assert.equal(payload.revision, 2)
  }
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

test("new portal saves wait for an available name, while existing reserved addresses remain editable", () => {
  const buttons = html => [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .map(match => match[0]).filter(button => /Save draft|Preview portal/.test(button))
  for (const [status, message] of [[null, "Checking address..."], ["taken", "This address is already taken. Choose another name."],
    ["invalid", "Use 3-40 letters"], ["error", "Could not check this address. Try again."]]) {
    const html = renderSetup({ slug: "north-star", addressCheck: status && { input: "north-star", status, message } })
    assert.ok(html.includes(message), html)
    assert.equal(buttons(html).length, 2)
    assert.ok(buttons(html).every(button => /disabled=""/.test(button)), status)
    if (status) assert.match(html, /aria-invalid="true"/)
    if (status === "error") assert.match(html, />Try again<\/button>/)
  }
  const ready = renderSetup({ slug: "north-star", addressCheck: { input: "north-star", status: "available", message: "This address is available." } })
  assert.ok(buttons(ready).every(button => !/disabled=""/.test(button)))
  const stale = renderSetup({ slug: "another-name", addressCheck: { input: "north-star", status: "available", message: "Available" } })
  assert.match(stale, /Checking address/)
  assert.ok(buttons(stale).every(button => /disabled=""/.test(button)))
  const existing = renderSetup({ slug: "north-star", portal: { slug: "north-star", configuration: {}, revision: 1 } })
  assert.match(existing, /This is your reserved address/)
  assert.ok(buttons(existing).every(button => !/disabled=""/.test(button)))
})

function addressAvailability({ slug = "north-star", portal = null, canEdit = true, failure = false } = {}) {
  const source = read("../features/hosted-subdomains/setup.tsx")
  const ast = ts.createSourceFile("setup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const editor = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HostedSubdomainEditor")
  const effect = editor.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useEffect" && node.getText(ast).includes("/availability?slug="))
  const state = { calls: [], checks: [], timer: null, cleared: [], wait: 0 }
  let settle, reject
  const pending = new Promise((resolve, fail) => { settle = resolve; reject = fail })
  const context = { userId: "agency", slug, data: { portal }, canEdit, AbortController, encodeURIComponent,
    window: { setTimeout(fn, wait) { state.timer = fn; state.wait = wait; return 7 }, clearTimeout: id => state.cleared.push(id) },
    setAddressCheck: check => state.checks.push(check),
    hostedSubdomainRequest: (...args) => { state.calls.push(args); return pending },
  }
  const effectFunction = vm.runInNewContext(ts.transpileModule(`(${effect.expression.arguments[0].getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  const cleanup = effectFunction()
  return { state, cleanup, async finish(status = "available") {
    if (failure) reject(new Error("Offline"))
    else settle({ status, available: status === "available", message: status })
    await new Promise(resolve => setImmediate(resolve))
  } }
}

test("address checks are debounced, encoded, abortable and ignore old responses after typing another name", async () => {
  const h = addressAvailability({ slug: "North & Star" })
  assert.equal(h.state.calls.length, 0)
  assert.equal(h.state.wait, 350)
  h.state.timer()
  assert.equal(h.state.calls[0][1], "/availability?slug=North%20%26%20Star")
  const signal = h.state.calls[0][2].signal
  assert.equal(signal.aborted, false)
  h.cleanup()
  assert.equal(signal.aborted, true)
  assert.deepEqual(h.state.cleared, [7])
  await h.finish()
  assert.equal(h.state.checks.length, 0)
  for (const options of [{ portal: { id: "existing" } }, { slug: "   " }, { canEdit: false }]) {
    const skipped = addressAvailability(options)
    assert.equal(skipped.state.timer, null)
    assert.equal(skipped.cleanup, undefined)
  }
  for (const status of ["available", "taken", "invalid"]) {
    const current = addressAvailability()
    current.state.timer(); await current.finish(status)
    assert.equal(current.state.checks[0].input, "north-star")
    assert.equal(current.state.checks[0].status, status)
    current.cleanup()
  }
  const failed = addressAvailability({ failure: true })
  failed.state.timer(); await failed.finish()
  assert.equal(failed.state.checks[0].status, "error")
  assert.match(failed.state.checks[0].message, /Try again/)
  failed.cleanup()
})

test("programmatic saves cannot bypass an unavailable or unchecked new address", async () => {
  const source = read("../features/hosted-subdomains/setup.tsx")
  const ast = ts.createSourceFile("setup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const editor = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HostedSubdomainEditor")
  const save = editor.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "save")
  const run = vm.runInNewContext(ts.transpileModule(`${save.getText(ast)}\nsave`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { data: { portal: null }, addressReady: false, addressMessage: "This address is already taken.", Error,
    hostedSubdomainRequest: () => assert.fail("An unchecked address must not be saved") })
  await assert.rejects(run(), /already taken/)
})
