import type { BillingStatus } from "@/lib/api"

export function hasStartedTrial(billing: BillingStatus) {
  return billing.trial_started ?? Boolean(billing.current_period_end)
}

export function needsSubscriptionManagement(billing: BillingStatus) {
  return (
    billing.subscription_management_required ??
    (billing.customer_portal_available &&
      !["canceled", "incomplete_expired"].includes(
        billing.raw_status || billing.status
      ))
  )
}

export function checkoutLabel(billing: BillingStatus) {
  if (billing.access_status === "trialing" && hasStartedTrial(billing))
    return "Add payment method"
  return hasStartedTrial(billing) ? "Subscribe" : "Start 30-day trial"
}

export function formatPrice(cents: number | null | undefined) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD"
  }).format((cents ?? 0) / 100)
}

export function checkoutTotal(
  billing: BillingStatus,
  plan: string,
  interval: "month" | "year",
  workspaces: number,
  packs: number
) {
  const option = billing.plan_options.find((option) => option.plan === plan)
  const base =
    interval === "year"
      ? option?.annual_price_cents
      : option?.monthly_price_cents
  const addon =
    interval === "year"
      ? billing.additional_client_workspace_annual_price_cents
      : billing.additional_client_workspace_price_cents
  return (
    (base ?? 0) +
    (plan === "agency" ? workspaces * addon : 0) +
    (interval === "month" ? packs * billing.ai_credit_pack_price_cents : 0)
  )
}

export function billingHeading(billing: BillingStatus) {
  if (billing.raw_status === "trialing" && !billing.access_allowed)
    return "Your trial has ended"
  if (billing.access_status === "trialing") return "Your trial is active"
  if (!billing.access_allowed) return "Workspace access is paused"
  if (billing.cancel_at_period_end && !billing.requires_billing_action)
    return "Your subscription will end"
  if (billing.requires_billing_action) return "Payment needs attention"
  return "Your subscription"
}
