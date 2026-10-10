import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const source = readFileSync(new URL("../features/billing/lib/upgrade.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const loaded = { exports: {} }
vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports, Intl })
const upgrade = loaded.exports
const trial = { plan: "professional", access_status: "trialing", raw_status: "trialing", access_allowed: true, current_period_end: "2026-10-15", trial_started: true, subscription_management_required: false }

test("expired trials subscribe instead of advertising another free trial", () => {
  for (const plan of ["free", "professional", "agency"]) {
    const billing = { ...trial, plan, access_status: "expired", access_allowed: false }
    assert.equal(upgrade.checkoutLabel(billing), "Subscribe")
    assert.equal(upgrade.billingHeading(billing), "Your trial has ended")
    assert.equal(upgrade.hasStartedTrial(billing), true)
  }
})

test("active trials add payment details without restarting the trial", () => {
  assert.equal(upgrade.checkoutLabel(trial), "Add payment method")
  assert.equal(upgrade.billingHeading(trial), "Your trial is active")
  assert.equal(upgrade.needsSubscriptionManagement(trial), false)
})

test("new legacy workspaces can start a trial, without relying on the plan name", () => {
  assert.equal(upgrade.checkoutLabel({ ...trial, access_status: "untracked", trial_started: false, current_period_end: null }), "Start 30-day trial")
  assert.equal(upgrade.hasStartedTrial({ plan: "free", current_period_end: "2026-01-01" }), true)
})

test("existing provider subscriptions use the portal even if access has expired", () => {
  for (const status of ["past_due", "incomplete", "active", "trialing", "unpaid"]) {
    assert.equal(upgrade.needsSubscriptionManagement({ customer_portal_available: true, raw_status: status }), true)
  }
  for (const status of ["canceled", "incomplete_expired"]) {
    assert.equal(upgrade.needsSubscriptionManagement({ customer_portal_available: true, raw_status: status }), false)
  }
})

test("money uses dollar values and retains cents", () => {
  assert.equal(upgrade.formatPrice(7900), "$79.00")
  assert.equal(upgrade.formatPrice(79000), "$790.00")
  assert.equal(upgrade.formatPrice(750), "$7.50")
  assert.equal(upgrade.formatPrice(0), "$0.00")
})

test("the total includes only add-ons supported by the selected plan and interval", () => {
  const billing = {
    plan_options: [{ plan: "professional", monthly_price_cents: 7900, annual_price_cents: 79000 }, { plan: "agency", monthly_price_cents: 19900, annual_price_cents: 199000 }],
    additional_client_workspace_price_cents: 2000,
    additional_client_workspace_annual_price_cents: 20000,
    ai_credit_pack_price_cents: 750,
  }
  assert.equal(upgrade.checkoutTotal(billing, "professional", "month", 5, 2), 9400)
  assert.equal(upgrade.checkoutTotal(billing, "agency", "month", 2, 1), 24650)
  assert.equal(upgrade.checkoutTotal(billing, "agency", "year", 2, 10), 239000)
})

test("the expired gate provides a single billing destination and refreshes after confirmation", () => {
  const shell = readFileSync(new URL("../app/dashboard/dashboard-shell.tsx", import.meta.url), "utf8")
  const panel = shell.slice(shell.indexOf("function SubscriptionRequiredPanel"), shell.indexOf("function getWorkspaceOptions"))
  assert.equal((panel.match(/href="\/dashboard\/billing"/g) || []).length, 1)
  assert.ok(!panel.includes("billing_interval=month"))
  assert.ok(shell.includes('window.addEventListener("decisionate:billing-updated", refreshAccess)'))
})
