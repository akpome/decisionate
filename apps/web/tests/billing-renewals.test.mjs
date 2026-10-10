import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(import.meta.url)
const ts = require("typescript")
function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}
const renewal = load("../features/billing/lib/renewals.ts")
const upgrade = load("../features/billing/lib/upgrade.ts")
const active = {
  access_allowed: true,
  access_status: "active",
  raw_status: "active",
  requires_billing_action: false,
  cancel_at_period_end: false
}

test("monthly and annual paid periods are renewals, not expirations", () => {
  for (const billing_interval of ["month", "year"]) {
    const billing = { ...active, billing_interval }
    assert.equal(renewal.renewalDateLabel(billing), "Renews on")
    assert.equal(renewal.renewalStatusLabel(billing), "Active")
    assert.equal(
      renewal.subscriptionPortalLabel(billing),
      "Manage subscription"
    )
  }
})

test("scheduled cancellation is healthy with a resume action", () => {
  const billing = {
    ...active,
    access_status: "canceling",
    cancel_at_period_end: true
  }
  assert.equal(renewal.renewalStatusLabel(billing), "Auto-renew off")
  assert.equal(renewal.renewalDateLabel(billing), "Access ends")
  assert.equal(renewal.subscriptionPortalLabel(billing), "Resume subscription")
  assert.equal(upgrade.billingHeading(billing), "Your subscription will end")
})

test("failed renewal shows the grace deadline and payment recovery action", () => {
  const billing = {
    ...active,
    access_status: "grace_period",
    raw_status: "past_due",
    requires_billing_action: true,
    grace_period_end: "2026-10-15"
  }
  assert.equal(renewal.renewalStatusLabel(billing), "Payment needs attention")
  assert.equal(renewal.renewalDateLabel(billing), "Payment grace ends")
  assert.equal(
    renewal.subscriptionPortalLabel(billing),
    "Update payment details"
  )
  assert.equal(
    renewal.renewalDateLabel({ ...billing, access_allowed: false }),
    "Payment grace ends"
  )
})

test("canceled subscriptions offer checkout, not resumption of a canceled record", () => {
  const billing = {
    ...active,
    raw_status: "canceled",
    access_allowed: false,
    customer_portal_available: true,
    trial_started: true
  }
  assert.equal(upgrade.needsSubscriptionManagement(billing), false)
  assert.equal(upgrade.checkoutLabel(billing), "Subscribe")
  assert.equal(renewal.renewalDateLabel(billing), "Access ended")
})

test("an incomplete payment does not label its future billing period as ended", () => {
  const billing = {
    ...active,
    access_allowed: false,
    raw_status: "incomplete",
    requires_billing_action: true
  }
  assert.equal(renewal.renewalDateLabel(billing), "Subscription period")
  assert.equal(
    renewal.subscriptionPortalLabel(billing),
    "Update payment details"
  )
})

test("trials retain their expiry date and cannot confuse scheduled cancellation with payment failure", () => {
  const billing = {
    ...active,
    raw_status: "trialing",
    access_status: "trialing"
  }
  assert.equal(renewal.renewalDateLabel(billing), "Trial ends")
  assert.equal(renewal.renewalStatusLabel(billing), "Trial active")
  assert.equal(
    renewal.renewalStatusLabel({ ...billing, cancel_at_period_end: true }),
    "Auto-renew off"
  )
})

test("billing verifies status after portal returns, on request, focus and expiry", () => {
  const source = readFileSync(
    new URL("../app/dashboard/billing/page.tsx", import.meta.url),
    "utf8"
  )
  assert.ok(source.includes("portalReturned || verifyRequested.current"))
  assert.ok(source.includes('window.addEventListener("focus", verify)'))
  assert.ok(
    source.includes("current.grace_period_end || current.current_period_end")
  )
  assert.ok(source.includes("Check subscription status"))
})
