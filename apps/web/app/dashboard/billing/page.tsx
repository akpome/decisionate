"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { CreditCard, ExternalLink, Plus } from "lucide-react"

import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  createAICreditTopup,
  createBillingCheckout,
  createBillingPortal,
  getBillingStatus,
  type BillingStatus,
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { useDecisionateText } from "@/app/use-decisionate-language"

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Billing service is unavailable."
}

function isGlobalApiAvailabilityError(message: string) {
  return message ===
      "The service is taking longer than expected. Please try again shortly." ||
    message ===
      "The service is temporarily unavailable. Please try again shortly."
}

export default function BillingPage() {
  return <BillingPageContent />
}

function BillingPageContent() {
  const { t } = useDecisionateText()
  const { user } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  const {
    activeWorkspace,
    canConfigureWorkspace,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)
  const isClientWorkspaceContext = Boolean(
    activeWorkspace?.owner_user_id.includes(":client:") ||
      activeWorkspaceId.includes(":client:")
  )
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [selectedPlan, setSelectedPlan] = useState("professional")
  const [billingInterval, setBillingInterval] =
    useState<"month" | "year">(getBillingIntervalFromUrl)
  const [additionalClientWorkspaces, setAdditionalClientWorkspaces] =
    useState(0)
  const [additionalAICreditPacks, setAdditionalAICreditPacks] =
    useState(0)
  const [topupCreditPacks, setTopupCreditPacks] = useState(1)

  useEffect(() => {
    if (
      !user?.id ||
      loadingWorkspaceAccess ||
      !canConfigureWorkspace
    ) {
      return
    }
    const userId = user.id
    let ignore = false

    async function load() {
      setLoading(true)
      setError("")
      try {
        const result = await getBillingStatus(
          userId,
          activeWorkspaceId
        )
        if (!ignore) {
          setBilling(result)
          if (result.plan === "professional" || result.plan === "agency") {
            setSelectedPlan(result.plan)
          }
          if (result.plan === "agency") {
            setAdditionalClientWorkspaces(
              Math.max(
                0,
                Math.min(1000, result.additional_client_workspaces || 0)
              )
            )
          }
        }
      } catch (loadError) {
        if (!ignore) {
          const message = getErrorMessage(loadError)
          setError(
            isGlobalApiAvailabilityError(message)
              ? ""
              : message
          )
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void load()
    return () => {
      ignore = true
    }
  }, [
    activeWorkspaceId,
    canConfigureWorkspace,
    loadingWorkspaceAccess,
    user?.id,
  ])

  async function startCheckout(plan = selectedPlan) {
    if (!user?.id) return
    setSelectedPlan(plan)
    setBusy(true)
    setError("")
    try {
      const result = await createBillingCheckout(
        user.id,
        activeWorkspaceId,
        {
          plan,
          billing_interval: billingInterval,
          additional_client_workspaces:
            plan === "agency"
              ? additionalClientWorkspaces
              : 0,
          additional_ai_credit_packs: additionalAICreditPacks,
        }
      )
      window.location.assign(result.checkout_url)
    } catch (checkoutError) {
      setError(getErrorMessage(checkoutError))
      setBusy(false)
    }
  }

  async function openPortal() {
    if (!user?.id) return
    setBusy(true)
    setError("")
    try {
      const result = await createBillingPortal(
        user.id,
        activeWorkspaceId
      )
      window.location.assign(result.portal_url)
    } catch (portalError) {
      setError(getErrorMessage(portalError))
      setBusy(false)
    }
  }

  async function startAICreditTopup() {
    if (!user?.id) return
    setBusy(true)
    setError("")
    try {
      const result = await createAICreditTopup(
        user.id,
        activeWorkspaceId,
        topupCreditPacks
      )
      window.location.assign(result.checkout_url)
    } catch (topupError) {
      setError(getErrorMessage(topupError))
      setBusy(false)
    }
  }

  if (loadingWorkspaceAccess) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Billing"
          description="Billing configuration is available to the business owner."
        />
        <div
          role="status"
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500"
        >
          {t("Checking workspace access...")}
        </div>
      </div>
    )
  }

  if (!canConfigureWorkspace) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Billing"
          description="Billing configuration is available to the business owner."
        />
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {isClientWorkspaceContext
            ? t("This client workspace is managed by an agency. Contact the agency to renew the subscription or restore access.")
            : t("Only the business owner can manage billing and subscriptions for this workspace.")}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Billing"
        description="Review your current plan, trial status, usage, and billing options."
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[var(--decisionate-brand-primary-soft)] p-2 text-[var(--decisionate-brand-primary-text)]">
            <CreditCard size={20} />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{t("Workspace plan")}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t("Start with a 30-day full-access trial without a credit card. Add payment details only when you choose to continue. Additional client capacity is added to the existing subscription and billed on the next renewal invoice.")}
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-gray-500">{t("Loading billing status...")}</p>
        ) : billing ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <BillingValue label={t("Plan")} value={billing.plan_name || formatBillingPlan(billing.plan)} />
            <BillingValue label={t("Status")} value={billing.status} />
            <BillingValue
              label={t("Renewal")}
              value={
                billing.current_period_end
                  ? new Date(billing.current_period_end).toLocaleDateString()
                  : t("Not scheduled")
              }
            />
            <BillingValue
              label={t("Client workspaces")}
              value={
                billing.client_workspace_limit === null
                  ? `${billing.client_workspaces_used} / ${t("Unlimited")}`
                  : `${billing.client_workspaces_used} / ${billing.client_workspace_limit ?? 0}`
              }
            />
            <BillingValue
              label={t("AI credits")}
              value={`${billing.ai_credits_used.toLocaleString()} used · ${billing.ai_credits_remaining.toLocaleString()} remaining`}
            />
          </div>
        ) : null}

        {!loading && billing && (
          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-900">{t("AI credit pool")}</p>
                <p className="mt-1 text-sm text-gray-600">
                  {billing.billing_model === "agency"
                    ? t("Agency and client workspaces draw from this shared balance.")
                    : t("Purchase additional credits whenever your workspace needs them.")}
                </p>
                {billing.ai_credit_low_balance && (
                  <p className="mt-2 text-sm font-medium text-amber-800">
                    {t("Your AI credit balance is running low. Add credits to keep analysis available.")}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs font-medium text-gray-600">
                  {t("Packs to purchase")}
                  <input
                    type="number"
                    min="1"
                    value={topupCreditPacks}
                    onChange={event => setTopupCreditPacks(
                      Math.max(1, Number(event.target.value) || 1)
                    )}
                    className="mt-1 block w-36 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void startAICreditTopup()
                  }}
                  disabled={busy || !billing.ai_credit_topup_configured}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus size={16} />
                  {busy ? t("Opening...") : t("Top up AI credits")}
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {t("Each pack adds")} {billing.ai_credit_pack_size.toLocaleString()} {t("credits. There is no workspace limit on the number of packs purchased.")}
            </p>
            {!billing.ai_credit_topup_configured && (
              <p className="mt-2 text-xs text-amber-700">
                {t("AI credit top-ups are not configured on this server yet.")}
              </p>
            )}
          </div>
        )}

        {!loading && billing && billing.requires_billing_action && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p className="font-semibold">
              {billing.access_status === "grace_period"
                ? t("Payment needs attention")
                : billing.access_status === "expired"
                  ? t("Subscription access is paused")
                  : t("Subscription action required")}
            </p>
            <p className="mt-1">
              {billing.access_reason || t("Review billing to keep this workspace active.")}
            </p>
          </div>
        )}

        {!loading && billing && (
          <div className="mt-6 flex flex-wrap gap-3">
            {isSubscribed(billing) ? (
              <button
                type="button"
                onClick={openPortal}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ExternalLink size={16} />
                {busy ? t("Opening...") : t("Manage subscription")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void startCheckout()
                }}
                disabled={busy || !billing.plan_options.some(
                  option => option.plan === selectedPlan && option.configured
                )}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CreditCard size={16} />
                {busy ? t("Opening...") : t(getCheckoutButtonLabel(billing, billingInterval))}
              </button>
            )}
          </div>
        )}

        {!loading && billing && !billing.configured && (
          <p className="mt-4 text-sm text-amber-700">
            {t("Billing is not configured on this server yet. Set the Stripe environment values before enabling checkout.")}
          </p>
        )}
      </section>

      {!loading && billing && shouldShowPlanSelection(billing) && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
          <div>
            <h2 className="font-semibold text-gray-900">{t("Choose your Decisionate plan")}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t("Agency pricing scales with client workspaces, not employee seats.")}
            </p>
          </div>

          <div className="mt-5 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1" role="group" aria-label={t("Billing interval")}>
            {([
              ["month", t("Monthly")],
              ["year", t("Annual · 2 months free")],
            ] as const).map(([interval, label]) => (
              <button
                key={interval}
                type="button"
                aria-pressed={billingInterval === interval}
                onClick={() => {
                  setBillingInterval(interval)
                  if (interval === "year") {
                    setAdditionalAICreditPacks(0)
                  }
                }}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                  billingInterval === interval
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {billing.plan_options.map(option => {
                const selected = selectedPlan === option.plan
                const isAgency = option.billing_model === "agency"
                return (
                  <button
                    key={option.plan}
                    type="button"
                    onClick={() => setSelectedPlan(option.plan)}
                    className={`rounded-xl border p-5 text-left transition ${
                      selected
                        ? "border-[var(--decisionate-brand-primary)] bg-[var(--decisionate-brand-primary-soft)] ring-1 ring-[var(--decisionate-brand-primary)]"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{option.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                          {isAgency ? t("Agency") : t("Direct business")}
                        </p>
                      </div>
                      {selected && (
                        <span className="text-xs font-semibold text-[var(--decisionate-brand-primary-text)]">
                          {t("Selected")}
                        </span>
                      )}
                    </div>
                    <p className="mt-5 text-2xl font-semibold text-gray-900">
                      ${(
                        (billingInterval === "year"
                          ? option.annual_price_cents
                          : option.monthly_price_cents) || 0
                      )
                        .toLocaleString()}
                      <span className="ml-1 text-sm font-normal text-gray-500">
                        CAD
                      </span>
                      <span className="text-sm font-normal text-gray-500">
                        /{billingInterval === "year" ? t("year") : t("month")}
                      </span>
                    </p>
                    <p className="mt-3 text-sm text-gray-600">
                      {isAgency
                        ? `${t("Up to")} ${option.included_client_workspaces} ${t("client workspaces")}`
                        : t("1 workspace with full access")}
                    </p>
                    <p className="mt-2 text-sm text-gray-600">
                      {(billingInterval === "year"
                        ? option.annual_ai_credit_limit
                        : option.ai_credit_limit
                      ).toLocaleString()} included AI credits per {billingInterval === "year" ? "year" : "month"}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-gray-500">
                      {isAgency
                        ? t("Client portal, agency branding, industry dashboards, decision tracking, and priority support.")
                        : t("Unlimited datasets, all dashboards, AI recommendations, decision management, and outcome tracking.")}
                    </p>
                    {!(billingInterval === "year"
                      ? option.annual_configured
                      : option.monthly_configured) && (
                      <p className="mt-4 text-xs text-amber-700">
                        {t("Stripe price not configured yet")}
                      </p>
                    )}
                  </button>
                )
              })}
          </div>

          {selectedPlan === "agency" && (
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{t("Additional client workspaces")}</p>
                <p className="mt-1 text-sm text-gray-500">
                  Add capacity at ${(
                    (billingInterval === "year"
                      ? billing.additional_client_workspace_annual_price_cents
                      : billing.additional_client_workspace_price_cents) / 100
                  ).toLocaleString()} CAD/{billingInterval === "year" ? "year" : "month"} per workspace. Each added workspace includes {(
                    billingInterval === "year"
                      ? billing.annual_additional_client_workspace_ai_credits
                      : billing.additional_client_workspace_ai_credits
                  ).toLocaleString()} AI credits.
                </p>
              </div>
              <label className="text-xs font-medium text-gray-600">
                {t("Extra workspaces")}
                <input
                  type="number"
                  min="0"
                  max="1000"
                  aria-label="Additional client workspaces"
                  value={additionalClientWorkspaces}
                  onChange={event => setAdditionalClientWorkspaces(
                    Math.max(0, Math.min(1000, Number(event.target.value) || 0))
                  )}
                  className="mt-1 block w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                />
              </label>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{t("Additional AI credit packs")}</p>
              <p className="mt-1 text-sm text-gray-500">
                {t("Each monthly pack adds")} {billing.ai_credit_pack_size.toLocaleString()} {t("credits.")}
              </p>
            </div>
            <label className="text-xs font-medium text-gray-600">
              {t("Packs")}
              <input
                type="number"
                min="0"
                value={additionalAICreditPacks}
                onChange={event => setAdditionalAICreditPacks(
                  Math.max(0, Number(event.target.value) || 0)
                )}
                disabled={!billing.ai_credit_pack_configured || billingInterval === "year"}
                className="mt-1 block w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
              {!billing.ai_credit_pack_configured && (
                <span className="mt-1 block font-normal text-amber-700">
                  {t("Add-on price not configured")}
                </span>
              )}
              {billingInterval === "year" && (
                <span className="mt-1 block font-normal text-gray-500">
                  {t("Available with monthly billing.")}
                </span>
              )}
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500">
              {selectedPlan === "professional"
                ? t("Includes a 30-day full-access trial.")
                : t("Includes a 30-day full-access trial and agency client portal features.")}
            </p>
            <button
              type="button"
              onClick={() => {
                void startCheckout(selectedPlan)
              }}
              disabled={busy || !billing.plan_options.some(
                option => option.plan === selectedPlan && (
                  billingInterval === "year"
                    ? option.annual_configured
                    : option.monthly_configured
                )
              )}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CreditCard size={16} />
              {busy
                ? t("Opening...")
                : hasStartedTrial(billing)
                  ? billingInterval === "year"
                    ? t("Continue to annual plan")
                    : t("Continue to paid plan")
                : billingInterval === "year"
                  ? t("Start 30-day free trial")
                  : t("Start 30-day free trial")}
            </button>
          </div>

        </section>
      )}

      {!loading && billing && billing.billing_model === "agency" && (
        <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900 shadow-sm sm:p-6">
          <p className="font-semibold">{t("Agency billing is portfolio-based")}</p>
          <p className="mt-1">
            Your plan includes {billing.included_client_workspaces ?? "unlimited"} client workspaces. Employee seats remain outside the billing metric; manage them from workspace settings.
          </p>
        </section>
      )}
    </div>
  )
}

function isSubscribed(billing: BillingStatus) {
  return billing.plan !== "free" && billing.customer_portal_available
}

function getBillingIntervalFromUrl(): "month" | "year" {
  if (typeof window === "undefined") {
    return "month"
  }

  return new URLSearchParams(window.location.search).get(
    "billing_interval"
  ) === "year"
    ? "year"
    : "month"
}

function shouldShowPlanSelection(billing: BillingStatus) {
  return billing.plan === "free" ||
    billing.access_status === "expired"
}

function hasStartedTrial(billing: BillingStatus) {
  return billing.plan !== "free" && Boolean(billing.current_period_end)
}

function getCheckoutButtonLabel(
  billing: BillingStatus,
  billingInterval: "month" | "year"
) {
  if (hasStartedTrial(billing)) {
    return billingInterval === "year"
      ? "Continue to annual plan"
      : "Continue to paid plan"
  }

  return "Start 30-day free trial"
}

function formatBillingPlan(plan: string) {
  return {
    professional: "Professional",
    agency: "Agency",
  }[plan] || "Free"
}

function BillingValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  )
}
