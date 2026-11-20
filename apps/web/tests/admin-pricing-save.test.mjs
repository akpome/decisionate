import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url), ts = require("typescript")
const source = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("admin.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PlatformAdminPage")
const save = page.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handleSaveCreditSettings")

function harness(send) {
  const state = { saving: false, error: "", message: "", settings: null, prevented: false, calls: [] }
  const creditForm = { free_ai_credits: "0", professional_monthly_price_cents: "8900", agency_subdomain_monthly_price_cents: "32900", professional_price_id: " price_updated ", agency_monthly_price_cents: "19900", agency_custom_domain_monthly_price_cents: "59900", agency_custom_domain_price_id: "price_hidden" }
  const context = { Error, Math, Object, Number, user: { id: "operator" }, creditForm,
    creditSettingFields: [{ key: "free_ai_credits" }], visiblePriceFields: [{ key: "professional_monthly_price_cents" }, { key: "agency_subdomain_monthly_price_cents" }],
    visibleStripeFields: [{ key: "professional_price_id" }],
    setCreditSettingsSaving: value => { state.saving = value }, setCreditSettingsError: value => { state.error = value },
    setCreditSettingsMessage: value => { state.message = value }, setCreditSettings: value => { state.settings = value },
    updatePlatformAdminCreditSettings: async (...args) => { state.calls.push(args); return send(...args) },
  }
  vm.runInNewContext(ts.transpileModule(save.getText(ast) + ";globalThis.submit=handleSaveCreditSettings;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return { state, creditForm, submit: () => context.submit({ preventDefault: () => { state.prevented = true } }) }
}

test("pricing save sends integer-cent values and trimmed Stripe IDs", async () => {
  const response = { professional_monthly_price_cents: 8900, agency_subdomain_monthly_price_cents: 32900 }
  const h = harness(() => response)
  await h.submit()
  assert.equal(h.state.prevented, true)
  assert.equal(h.state.calls[0][0], "operator")
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.calls[0][1])), {
    free_ai_credits: 0, professional_monthly_price_cents: 8900,
    agency_subdomain_monthly_price_cents: 32900, professional_price_id: "price_updated",
  })
  assert.equal(h.state.settings, response)
  assert.equal(h.state.message, "Pricing and credits saved.")
  assert.equal(h.state.saving, false)
})

test("pricing errors preserve the entered values and allow a retry without claiming success", async () => {
  let attempts = 0
  const h = harness(() => { if (!attempts++) throw new Error("Pricing could not be saved"); return { source: "database" } })
  const before = JSON.stringify(h.creditForm)
  await h.submit()
  assert.equal(h.state.error, "Pricing could not be saved")
  assert.equal(h.state.message, "")
  assert.equal(h.state.settings, null)
  assert.equal(h.state.saving, false)
  assert.equal(JSON.stringify(h.creditForm), before)
  await h.submit()
  assert.equal(h.state.calls.length, 2)
  assert.equal(h.state.error, "")
  assert.equal(h.state.message, "Pricing and credits saved.")
})

test("an existing pricing form stays visible after save errors and exposes an accessible error", () => {
  assert.match(source, /!creditSettingsLoading && creditSettings && \(/)
  assert.doesNotMatch(source, /!creditSettingsLoading && !creditSettingsError && creditSettings/)
  assert.match(source, /!creditSettingsLoading && creditSettingsError && \(\s*<p role="alert"/)
})
