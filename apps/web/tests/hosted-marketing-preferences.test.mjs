import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const source = readFileSync(new URL("../features/marketing/email-preferences.tsx", import.meta.url), "utf8")
const config = { available: true, text: "Product updates", version: "v1", language: "en", sender_identity: "Decisionate", mailing_address: "Test", reply_to: "help@example.test" }

function renderPreferences(component, { portal = null, authPortal = null, portalId = "", ready = false } = {}) {
  const loaded = { exports: {} }, calls = [], effects = [], consent = []
  let stateIndex = 0
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    module: loaded, exports: loaded.exports, process: { env: { NEXT_PUBLIC_PORTAL_ID: portalId } },
    require: name => ({
      "react/jsx-runtime": require("react/jsx-runtime"),
      react: { ...React, useEffect: effect => effects.push(effect), useState: initial => {
        const index = stateIndex++
        return [ready && index === 0 ? config : ready && component === "EmailPreferences" && index === 1
          ? { marketing_status: "unsubscribed", suppression_reason: null } : initial, () => {}]
      } },
      "next/link": { default: props => React.createElement("a", props) }, "lucide-react": require("lucide-react"),
      "@/lib/api": {
        getMarketingConsent: async () => { calls.push("consent"); return config },
        marketingRequest: async (...args) => { calls.push(args); return { marketing_status: "unsubscribed" } },
      },
      "@/features/auth/lib/marketing-consent": { storeMarketingChoice: (...args) => consent.push(args) },
      "@/app/use-decisionate-language": { useDecisionateText: () => ({ t: value => value, language: "en" }) },
      "@/features/hosted-subdomains/provider": { useHostedPortal: () => ({ portal, authPortal }) },
    })[name],
  })
  const html = renderToStaticMarkup(React.createElement(loaded.exports[component], { userId: "owner" }))
  return { html, calls, consent, async runEffects() {
    const cleanups = effects.map(effect => effect())
    await new Promise(resolve => setImmediate(resolve))
    for (const cleanup of cleanups) cleanup?.()
  } }
}

test("hosted portals and agency-branded signup neither display nor request Decisionate marketing preferences", async () => {
  for (const component of ["EmailPreferences", "SignupMarketingOptIn"]) {
    for (const scope of [{ portal: { id: "north" } }, { authPortal: { id: "north" } }, { portalId: "custom" }]) {
      for (const ready of [false, true]) {
        const h = renderPreferences(component, { ...scope, ready })
        assert.equal(h.html, "", component)
        await h.runEffects()
        assert.deepEqual(h.calls, [])
        assert.deepEqual(h.consent, [])
      }
    }
  }
})

test("ordinary Decisionate preferences and optional signup consent still load without automatic subscription", async () => {
  const preferences = renderPreferences("EmailPreferences", { ready: true })
  assert.match(preferences.html, /Email preferences|Product updates/)
  await preferences.runEffects()
  assert.equal(preferences.calls[0], "consent")
  assert.deepEqual(preferences.calls[1], ["owner", "/preferences"])
  const signup = renderPreferences("SignupMarketingOptIn", { ready: true })
  assert.match(signup.html, /Optional/)
  assert.doesNotMatch(signup.html, /checked=""/)
  await signup.runEffects()
  assert.deepEqual(signup.calls, ["consent"])
  assert.deepEqual(signup.consent, [[false, "v1", "en"]])
})

test("portal preferences cannot write consent even when earlier settings remain loaded", async () => {
  const ast = ts.createSourceFile("email-preferences.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "EmailPreferences")
  const save = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "save")
  const run = vm.runInNewContext(ts.transpileModule(`${save.getText(ast)}\nsave`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    disabled: true, config, marketingRequest: () => assert.fail("Portal contexts must not update Decisionate consent"),
  })
  await run()
  assert.match(source, /\[language, disabled\]/)
  assert.match(source, /\[userId, language, disabled\]/)
})
