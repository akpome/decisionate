import type { BillingStatus } from "@/lib/api"

export function renewalStatusLabel(billing: BillingStatus) {
  if (!billing.access_allowed) return "Access paused"
  if (billing.access_status === "grace_period") return "Payment needs attention"
  if (billing.cancel_at_period_end) return "Auto-renew off"
  if (billing.raw_status === "trialing") return "Trial active"
  return "Active"
}

export function renewalDateLabel(billing: BillingStatus) {
  if (billing.grace_period_end) return "Payment grace ends"
  if (billing.raw_status === "trialing") return "Trial ends"
  if (billing.cancel_at_period_end || billing.raw_status === "canceled")
    return billing.access_allowed ? "Access ends" : "Access ended"
  return billing.access_allowed ? "Renews on" : "Subscription period"
}

export function subscriptionPortalLabel(billing: BillingStatus) {
  if (billing.requires_billing_action) return "Update payment details"
  if (billing.cancel_at_period_end && billing.access_allowed)
    return "Resume subscription"
  return "Manage subscription"
}
