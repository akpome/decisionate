"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useUser } from "@clerk/nextjs"
import { ArrowRight, CreditCard, ExternalLink, RefreshCw } from "lucide-react"

import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  creditPurchaseMessage,
  creditPurchaseQuote
} from "@/features/billing/lib/ai-credit-purchases"
import {
  renewalDateLabel,
  renewalStatusLabel,
  subscriptionPortalLabel
} from "@/features/billing/lib/renewals"
import {
  billingHeading,
  checkoutLabel,
  checkoutTotal,
  formatPrice,
  hasStartedTrial,
  needsSubscriptionManagement
} from "@/features/billing/lib/upgrade"
import {
  confirmBillingCheckout,
  confirmAICreditTopup,
  createAICreditTopup,
  createBillingCheckout,
  createBillingPortal,
  getBillingStatus,
  refreshBillingSubscription,
  type BillingStatus,
  type AICreditPurchaseConfirmation
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { setActiveWorkspaceId } from "@/lib/workspace-context"
import { useDecisionateText } from "@/app/use-decisionate-language"

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Billing service is unavailable. Please try again."
}

export default function BillingPage() {
  return (
    <Suspense fallback={<p role="status">Loading billing...</p>}>
      <BillingPageContent />
    </Suspense>
  )
}

function BillingPageContent() {
  const { t, language } = useDecisionateText()
  const { user } = useUser()
  const search = useSearchParams()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  const access = useWorkspaceAccess(user?.id)
  const returnWorkspaceId = search.get("workspace_id")
  const checkout = search.get("checkout")
  const topup = search.get("topup")
  const sessionId = search.get("session_id")
  const returnMismatch = Boolean(
    returnWorkspaceId && returnWorkspaceId !== activeWorkspaceId
  )
  const isClient = activeWorkspaceId.includes(":client:")
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [selectedPlan, setSelectedPlan] = useState("professional")
  const [interval, setInterval] = useState<"month" | "year">("month")
  const [extraWorkspaces, setExtraWorkspaces] = useState(0)
  const [extraPacks, setExtraPacks] = useState(0)
  const [topupPacks, setTopupPacks] = useState("1")
  const [creditConfirmation, setCreditConfirmation] =
    useState<AICreditPurchaseConfirmation | null>(null)
  const [confirmation, setConfirmation] = useState<
    | "checking"
    | "pending"
    | "confirmed"
    | "expired"
    | "requires_action"
    | "none"
  >("none")
  const [loadedKey, setLoadedKey] = useState("")
  const key = `${user?.id || ""}:${activeWorkspaceId}`
  const intervalQuery = search.get("billing_interval")
  const portalReturned = search.get("portal") === "returned"
  const confirmedThisReturn = useRef("")
  const verifyRequested = useRef(false)

  useEffect(() => {
    if (!user?.id || !returnMismatch || access.loadingWorkspaceAccess) return
    if (
      access.workspaces.some(
        (workspace) =>
          workspace.owner_user_id === returnWorkspaceId &&
          workspace.role === "owner"
      )
    ) {
      setActiveWorkspaceId(user.id, returnWorkspaceId!)
    }
  }, [
    user?.id,
    returnMismatch,
    returnWorkspaceId,
    access.loadingWorkspaceAccess,
    access.workspaces
  ])

  useEffect(() => {
    if (!user?.id || !access.canConfigureWorkspace || returnMismatch) return
    const userId = user.id
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    async function load() {
      await Promise.resolve()
      if (stopped) return
      if (attempts === 0) {
        setLoading(true)
        setError("")
        setConfirmation(
          checkout === "success" || topup === "success" ? "checking" : "none"
        )
        setCreditConfirmation(null)
      }
      try {
        let nextConfirmation: typeof confirmation = "none"
        let result = await getBillingStatus(userId, activeWorkspaceId)
        if (stopped) return
        if (
          (portalReturned || verifyRequested.current) &&
          result.billing_enabled !== false
        ) {
          result = await refreshBillingSubscription(userId, activeWorkspaceId)
          verifyRequested.current = false
          window.dispatchEvent(new Event("decisionate:billing-updated"))
        }
        let confirmationError = ""
        if (topup === "success" && result.billing_enabled !== false) {
          if (!sessionId) nextConfirmation = "pending"
          else {
            try {
              const confirmed = await confirmAICreditTopup(
                userId,
                activeWorkspaceId,
                sessionId
              )
              nextConfirmation =
                confirmed.status === "failed"
                  ? "requires_action"
                  : confirmed.status
              if (stopped) return
              setCreditConfirmation(confirmed)
              if (confirmed.status === "confirmed") {
                result = {
                  ...result,
                  ai_credits_remaining: confirmed.credits_remaining,
                  ai_credit_topup_credits: confirmed.purchased_credits_remaining
                }
                try {
                  result = await getBillingStatus(userId, activeWorkspaceId)
                } catch (failure) {
                  confirmationError = errorMessage(failure)
                }
              }
            } catch (failure) {
              confirmationError = errorMessage(failure)
              nextConfirmation = "pending"
            }
          }
        } else if (checkout === "success" && result.billing_enabled !== false) {
          // The return URL is not proof of payment. Only the API can confirm it.
          if (!sessionId) nextConfirmation = "pending"
          else {
            try {
              const confirmed = await confirmBillingCheckout(
                userId,
                activeWorkspaceId,
                sessionId
              )
              nextConfirmation = confirmed.status
              if (
                confirmed.status === "confirmed" ||
                confirmed.status === "requires_action"
              )
                result = await getBillingStatus(userId, activeWorkspaceId)
            } catch (failure) {
              confirmationError = errorMessage(failure)
              nextConfirmation = "pending"
            }
          }
        }
        if (stopped) return
        setError(confirmationError)
        setBilling(result)
        setLoadedKey(key)
        setConfirmation(nextConfirmation)
        if (attempts === 0) {
          setSelectedPlan(result.plan === "agency" ? "agency" : "professional")
          setInterval(
            intervalQuery === "year" || intervalQuery === "month"
              ? intervalQuery
              : result.billing_interval === "year"
                ? "year"
                : "month"
          )
          setExtraWorkspaces(
            Math.max(0, result.additional_client_workspaces || 0)
          )
          setExtraPacks(Math.max(0, result.additional_ai_credit_packs || 0))
        }
        setLoading(false)
        if (
          nextConfirmation === "pending" &&
          sessionId &&
          !confirmationError &&
          ++attempts < 6
        )
          timer = setTimeout(() => void load(), 3000)
      } catch (failure) {
        if (!stopped) {
          setError(errorMessage(failure))
          setLoading(false)
          setConfirmation(
            checkout === "success" || topup === "success" ? "pending" : "none"
          )
        }
      }
    }
    void load()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [
    user?.id,
    activeWorkspaceId,
    access.canConfigureWorkspace,
    returnMismatch,
    key,
    checkout,
    topup,
    sessionId,
    intervalQuery,
    portalReturned,
    refresh
  ])

  // A workspace switch must never expose the previous workspace's payment controls.
  const current = loadedKey === key ? billing : null
  const currentConfirmation = current ? confirmation : "none"
  const managing = current ? needsSubscriptionManagement(current) : false
  const paymentPending =
    (checkout === "success" || topup === "success") &&
    ["none", "checking", "pending"].includes(currentConfirmation)

  useEffect(() => {
    if (
      !current ||
      current.billing_enabled === false ||
      !managing ||
      paymentPending
    )
      return
    const deadline = current.grace_period_end || current.current_period_end
    const verify = () => {
      if (operation.current || document.visibilityState !== "visible") return
      verifyRequested.current = true
      setRefresh((value) => value + 1)
    }
    const timestamp = deadline
      ? Date.parse(
          /(Z|[+-]\d{2}:\d{2})$/.test(deadline) ? deadline : `${deadline}Z`
        )
      : NaN
    const delay = timestamp - Date.now() + 1000
    const timer =
      delay > 0 ? setTimeout(verify, Math.min(delay, 2147483647)) : undefined
    window.addEventListener("focus", verify)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("focus", verify)
    }
  }, [current, managing, paymentPending])
  const selectedOption = current?.plan_options.find(
    (option) => option.plan === selectedPlan
  )
  const priceConfigured =
    interval === "year"
      ? selectedOption?.annual_configured
      : selectedOption?.monthly_configured
  const canCheckout = Boolean(
    current?.configured &&
    priceConfigured &&
    !managing &&
    !paymentPending &&
    !error &&
    !busy
  )
  const returnConfirmed =
    currentConfirmation === "confirmed" && Boolean(current?.access_allowed)
  const topupQuote = current
    ? creditPurchaseQuote(
        topupPacks,
        current.ai_credit_pack_size,
        current.ai_credit_topup_price_cents
      )
    : null
  const canBuyCredits = Boolean(
    current?.configured &&
    current?.ai_credit_purchase_allowed &&
    topupQuote &&
    !paymentPending &&
    !busy &&
    !error
  )
  const effectiveExtraPacks =
    current?.ai_configured &&
    current.ai_credit_pack_configured &&
    interval === "month"
      ? extraPacks
      : 0

  useEffect(() => {
    if (
      returnConfirmed &&
      confirmedThisReturn.current !== `${key}:${sessionId}`
    ) {
      confirmedThisReturn.current = `${key}:${sessionId}`
      window.dispatchEvent(new Event("decisionate:billing-updated"))
    }
  }, [returnConfirmed, key, sessionId])

  async function pay(action: "checkout" | "portal" | "topup") {
    if (
      !user?.id ||
      !current ||
      !access.canConfigureWorkspace ||
      operation.current ||
      returnMismatch
    )
      return
    if (action === "checkout" && !canCheckout) return
    if (action === "topup" && (!canBuyCredits || !topupQuote)) return
    if (!current.configured || current.billing_enabled === false) return
    operation.current = true
    setBusy(true)
    setError("")
    try {
      if (action === "portal") {
        const result = await createBillingPortal(user.id, activeWorkspaceId)
        window.location.assign(result.portal_url)
      } else if (action === "topup") {
        const result = await createAICreditTopup(
          user.id,
          activeWorkspaceId,
          topupQuote!.packs,
          {
            packSize: current.ai_credit_pack_size,
            priceCents: current.ai_credit_topup_price_cents
          }
        )
        window.location.assign(result.checkout_url)
      } else {
        const result = await createBillingCheckout(user.id, activeWorkspaceId, {
          plan: selectedPlan,
          billing_interval: interval,
          additional_client_workspaces:
            selectedPlan === "agency" ? extraWorkspaces : 0,
          additional_ai_credit_packs: effectiveExtraPacks
        })
        window.location.assign(result.checkout_url)
      }
    } catch (failure) {
      setError(errorMessage(failure))
      operation.current = false
      setBusy(false)
    }
  }

  const header = (
    <DashboardPageHeader
      title="Billing"
      description="Review your plan and manage workspace access."
    />
  )
  const retry = (
    <button
      type="button"
      className={secondaryButton}
      onClick={() => {
        access.retryWorkspaceAccess()
        setRefresh((value) => value + 1)
      }}
    >
      <RefreshCw size={16} />
      {t("Try again")}
    </button>
  )
  if (access.loadingWorkspaceAccess)
    return (
      <div className="space-y-5">
        {header}
        <p role="status">{t("Checking workspace access...")}</p>
      </div>
    )
  if (access.workspaceAccessError)
    return (
      <div className="space-y-5">
        {header}
        <p role="alert" className="text-sm text-red-700">
          {access.workspaceAccessError}
        </p>
        {retry}
      </div>
    )
  if (returnMismatch)
    return (
      <div className="space-y-5">
        {header}
        <p role="alert" className="text-sm text-red-700">
          {t(
            "This checkout belongs to another workspace. Select that workspace to check your payment."
          )}
        </p>
        <Link href="/dashboard/billing" className={secondaryButton}>
          {t("Open current workspace billing")}
        </Link>
      </div>
    )
  if (!access.canConfigureWorkspace)
    return (
      <div className="space-y-5">
        {header}
        <p className="text-sm text-gray-600">
          {isClient
            ? t(
                "This client workspace is managed by an agency. Contact the agency to renew the subscription or restore access."
              )
            : t(
                "Only the business owner can manage billing and subscriptions for this workspace."
              )}
        </p>
        <Link href="/dashboard/help" className={secondaryButton}>
          {t("Contact support")}
        </Link>
      </div>
    )
  if (current?.billing_enabled === false)
    return (
      <div className="space-y-5">
        {header}
        <p role="status" className="text-sm text-gray-600">
          {t("Billing is not enabled. No payment is required.")}
        </p>
        <Link href="/dashboard" className={secondaryButton}>
          {t("Return to workspace")}
          <ArrowRight size={16} />
        </Link>
      </div>
    )

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {header}
      {error && (
        <div
          role="alert"
          className="space-y-3 border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-800"
        >
          <p>{t(error)}</p>
          {retry}
        </div>
      )}
      {loading && (
        <p role="status" className="text-sm text-gray-600">
          {t("Loading billing...")}
        </p>
      )}
      {current && (
        <>
          {checkout === "cancelled" && (
            <p
              role="status"
              className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900"
            >
              {t(
                "Checkout was cancelled. Your plan has not changed. You can try again below."
              )}
            </p>
          )}
          {topup === "cancelled" && (
            <p
              role="status"
              className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900"
            >
              {t(
                "Credit checkout was cancelled. No credits were added. Your subscription has not changed."
              )}
            </p>
          )}
          {topup === "success" && (
            <div
              role="status"
              className={`space-y-3 border-l-4 p-4 text-sm ${currentConfirmation === "confirmed" ? "border-green-500 bg-green-50 text-green-900" : "border-amber-500 bg-amber-50 text-amber-900"}`}
            >
              <p>
                {t(
                  creditPurchaseMessage(
                    creditConfirmation?.status || currentConfirmation
                  )
                )}
              </p>
              {creditConfirmation?.status === "confirmed" && (
                <p>
                  {creditConfirmation.credits.toLocaleString()}{" "}
                  {t("credits purchased")}
                </p>
              )}
              {paymentPending && sessionId && (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy || loading}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <RefreshCw size={16} />
                  {t("Check payment status")}
                </button>
              )}
              {paymentPending && !sessionId && (
                <p>
                  {t(
                    "The checkout session is missing. Contact support so we can verify your purchase."
                  )}
                </p>
              )}
              {paymentPending && (
                <Link href="/dashboard/help" className="inline-block underline">
                  {t("Contact support")}
                </Link>
              )}
              {currentConfirmation === "confirmed" && (
                <Link href="/dashboard/billing" className={secondaryButton}>
                  {t("Back to billing")}
                </Link>
              )}
            </div>
          )}
          {checkout === "success" && (
            <div
              role="status"
              className={`space-y-3 border-l-4 p-4 text-sm ${returnConfirmed ? "border-green-500 bg-green-50 text-green-900" : "border-amber-500 bg-amber-50 text-amber-900"}`}
            >
              <p>
                {returnConfirmed
                  ? t(
                      "Your subscription is confirmed. Workspace access is available."
                    )
                  : currentConfirmation === "requires_action"
                    ? t(
                        "Your subscription needs attention. Review your payment details below or contact support."
                      )
                    : currentConfirmation === "expired"
                      ? t(
                          "This checkout has expired. Choose a plan below to start again."
                        )
                      : t(
                          "Payment has not been confirmed yet. Access will resume after confirmation. Do not start another checkout while payment is pending."
                        )}
              </p>
              {returnConfirmed ? (
                <Link href="/dashboard" className={primaryButton}>
                  {t("Return to workspace")}
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={loading}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <RefreshCw size={16} />
                  {t("Check payment status")}
                </button>
              )}
            </div>
          )}
          <section className="border-b border-gray-200 pb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t(billingHeading(current))}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {access.activeWorkspace?.name} · {current.plan_name}
                </p>
              </div>
              {managing && (
                <div className="flex max-w-full flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={
                      busy || loading || !current.configured || paymentPending
                    }
                    onClick={() => {
                      verifyRequested.current = true
                      setRefresh((value) => value + 1)
                    }}
                  >
                    <RefreshCw size={16} />
                    {t(loading ? "Checking..." : "Check subscription status")}
                  </button>
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={
                      busy ||
                      !current.configured ||
                      !current.customer_portal_available
                    }
                    onClick={() => void pay("portal")}
                  >
                    <ExternalLink size={16} />
                    {t(busy ? "Opening..." : subscriptionPortalLabel(current))}
                  </button>
                </div>
              )}
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-gray-500">{t("Status")}</dt>
                <dd className="mt-1 font-medium">
                  {t(renewalStatusLabel(current))}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">
                  {t(renewalDateLabel(current))}
                </dt>
                <dd className="mt-1 font-medium">
                  {current.grace_period_end || current.current_period_end
                    ? formatDate(
                        (current.grace_period_end ||
                          current.current_period_end)!,
                        language
                      )
                    : t("Not available")}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">{t("Billing interval")}</dt>
                <dd className="mt-1 font-medium">
                  {t(
                    current.billing_interval === "year" ? "Annual" : "Monthly"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">{t("Client workspaces")}</dt>
                <dd className="mt-1 font-medium">
                  {current.client_workspaces_used} /{" "}
                  {current.client_workspace_limit ?? t("Unlimited")}
                </dd>
              </div>
            </dl>
            {current.cancel_at_period_end &&
              current.access_allowed &&
              !current.requires_billing_action && (
                <p role="status" className="mt-4 text-sm text-gray-700">
                  {t(
                    "Auto-renewal is off. Access remains available until the end date above. Resume your subscription before that date to keep access without interruption."
                  )}
                </p>
              )}
            {managing &&
              current.access_allowed &&
              !current.cancel_at_period_end &&
              !current.requires_billing_action && (
                <p className="mt-4 text-sm text-gray-600">
                  {t(
                    current.billing_interval === "year"
                      ? "Renews automatically each year until cancelled. Manage your subscription to change plans, view invoices or turn off auto-renewal."
                      : "Renews automatically each month until cancelled. Manage your subscription to change plans, view invoices or turn off auto-renewal."
                  )}
                </p>
              )}
            {!current.access_allowed && (
              <p className="mt-4 text-sm text-amber-800">
                {t(
                  current.raw_status === "trialing"
                    ? "Your trial has ended. Choose a paid plan to resume using this workspace."
                    : managing
                      ? "Update your payment details to restore workspace access."
                      : "Choose a paid plan to restore workspace access."
                )}
              </p>
            )}
            {current.access_status === "grace_period" && (
              <p className="mt-4 text-sm text-amber-800">
                {t(
                  "Payment needs attention. Update your payment details before"
                )}{" "}
                {current.grace_period_end
                  ? formatDate(current.grace_period_end, language)
                  : ""}
                .
              </p>
            )}
            {!current.configured && (
              <p role="status" className="mt-4 text-sm text-amber-800">
                {t(
                  "Online payments are not available yet. Contact support for help with your workspace."
                )}{" "}
                <Link href="/dashboard/help" className="underline">
                  {t("Contact support")}
                </Link>
              </p>
            )}
          </section>

          {!managing && (
            <section className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {t("Choose your plan")}
              </h2>
              <div
                role="group"
                aria-label={t("Billing interval")}
                className="inline-flex max-w-full gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1"
              >
                {(["month", "year"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={interval === value}
                    disabled={busy || paymentPending}
                    onClick={() => {
                      setInterval(value)
                      if (value === "year") setExtraPacks(0)
                    }}
                    className={`rounded-md px-4 py-2 text-sm font-medium ${interval === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}
                  >
                    {t(value === "month" ? "Monthly" : "Annual")}
                  </button>
                ))}
              </div>
              <fieldset
                disabled={busy || paymentPending}
                className="grid min-w-0 gap-4 sm:grid-cols-2"
              >
                <legend className="sr-only">{t("Choose your plan")}</legend>
                {current.plan_options.map((option) => (
                  <label
                    key={option.plan}
                    className={`flex min-w-0 cursor-pointer gap-3 rounded-lg border p-5 ${selectedPlan === option.plan ? "border-[var(--decisionate-brand-primary)] bg-[var(--decisionate-brand-primary-soft)]" : "border-gray-200 bg-white"}`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={option.plan}
                      checked={selectedPlan === option.plan}
                      onChange={() => setSelectedPlan(option.plan)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
                    />
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900">
                        {option.name}
                      </h3>
                      <p className="mt-3 text-xl font-semibold">
                        {formatPrice(
                          interval === "year"
                            ? option.annual_price_cents
                            : option.monthly_price_cents
                        )}{" "}
                        <span className="text-sm font-normal text-gray-500">
                          CAD/{t(interval === "year" ? "year" : "month")}
                        </span>
                      </p>
                      <p className="mt-3 text-sm text-gray-600">
                        {option.billing_model === "agency"
                          ? `${option.included_client_workspaces} ${t("client workspaces")}`
                          : t("1 workspace with full access")}
                      </p>
                      <p className="mt-2 text-sm text-gray-600">
                        {t(
                          option.billing_model === "agency"
                            ? "Client portal, agency branding, dashboards and decision tracking."
                            : "Datasets, dashboards, decisions and outcome tracking."
                        )}
                      </p>
                      {!(interval === "year"
                        ? option.annual_configured
                        : option.monthly_configured) && (
                        <p className="mt-3 text-xs text-amber-800">
                          {t("Not available for this billing interval")}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </fieldset>
              {selectedPlan === "agency" && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
                  <div>
                    <label
                      htmlFor="extra-workspaces"
                      className="text-sm font-medium"
                    >
                      {t("Additional client workspaces")}
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      {formatPrice(
                        interval === "year"
                          ? current.additional_client_workspace_annual_price_cents
                          : current.additional_client_workspace_price_cents
                      )}{" "}
                      CAD/{t(interval === "year" ? "year" : "month")}{" "}
                      {t("per workspace")}
                    </p>
                  </div>
                  <input
                    id="extra-workspaces"
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    disabled={busy || paymentPending}
                    value={extraWorkspaces}
                    onChange={(event) =>
                      setExtraWorkspaces(
                        Math.min(
                          1000,
                          Math.max(
                            0,
                            Math.floor(Number(event.target.value) || 0)
                          )
                        )
                      )
                    }
                    className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              )}
              {current.ai_configured &&
                current.ai_credit_pack_configured &&
                interval === "month" && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
                    <div>
                      <label
                        htmlFor="extra-packs"
                        className="text-sm font-medium"
                      >
                        {t("Recurring AI credit packs")}
                      </label>
                      <p className="mt-1 text-sm text-gray-500">
                        {current.ai_credit_pack_size.toLocaleString()}{" "}
                        {t("credits at")}{" "}
                        {formatPrice(current.ai_credit_pack_price_cents)} CAD/
                        {t("month")}
                      </p>
                    </div>
                    <input
                      id="extra-packs"
                      type="number"
                      min={0}
                      step={1}
                      disabled={busy || paymentPending}
                      value={extraPacks}
                      onChange={(event) =>
                        setExtraPacks(
                          Math.max(
                            0,
                            Math.floor(Number(event.target.value) || 0)
                          )
                        )
                      }
                      className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              <div className="flex flex-wrap items-end justify-between gap-4 border-t border-gray-200 pt-5">
                <div>
                  <p className="font-semibold">
                    {t("Plan total")}:{" "}
                    {formatPrice(
                      checkoutTotal(
                        current,
                        selectedPlan,
                        interval,
                        extraWorkspaces,
                        effectiveExtraPacks
                      )
                    )}{" "}
                    CAD/{t(interval === "year" ? "year" : "month")}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t(
                      "Before applicable taxes. Renews automatically until cancelled."
                    )}
                  </p>
                  <p className="mt-2 max-w-xl text-sm text-gray-600">
                    {t(
                      current.access_status === "trialing"
                        ? "Your remaining trial is preserved. Billing starts when your trial ends."
                        : hasStartedTrial(current)
                          ? "Your trial has already been used. Payment is required to activate this plan."
                          : "30-day trial. Billing starts at the end of the trial."
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canCheckout || loading}
                  className={primaryButton}
                  onClick={() => void pay("checkout")}
                >
                  <CreditCard size={16} />
                  {t(busy ? "Opening..." : checkoutLabel(current))}
                </button>
              </div>
            </section>
          )}

          <section
            className={`space-y-4 ${managing ? "" : "border-t border-gray-200 pt-6"}`}
          >
            <h2 className="font-semibold">
              {t("AI credit balance")}:{" "}
              {current.ai_credits_remaining.toLocaleString()}
            </h2>
            <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
              <div>
                <dt className="text-gray-500">{t("Plan credits remaining")}</dt>
                <dd className="mt-1 font-medium">
                  {Math.max(
                    0,
                    current.ai_credits_remaining -
                      current.ai_credit_topup_credits
                  ).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">
                  {t("Purchased credits remaining")}
                </dt>
                <dd className="mt-1 font-medium">
                  {current.ai_credit_topup_credits.toLocaleString()}
                </dd>
              </div>
            </dl>
            {current.plan === "agency" && (
              <p className="text-sm text-gray-600">
                {t(
                  "This credit balance is shared with your agency's client workspaces."
                )}
              </p>
            )}
            {current.ai_configured &&
              current.access_allowed &&
              current.ai_credit_low_balance && (
                <p role="status" className="text-sm text-amber-800">
                  {t(
                    "Your AI credit balance is running low. Add credits to keep analysis available."
                  )}
                </p>
              )}
            {!current.ai_credit_purchase_allowed ? (
              <p role="status" className="text-sm text-gray-600">
                {t(
                  current.ai_credit_purchase_reason ||
                    "AI credit payments are not available. Please contact support."
                )}
              </p>
            ) : (
              <>
                <h3 className="text-sm font-semibold">{t("Buy AI credits")}</h3>
                <p className="text-sm text-gray-600">
                  {current.ai_credit_pack_size.toLocaleString()} {t("credits")}{" "}
                  · {formatPrice(current.ai_credit_topup_price_cents)} CAD{" "}
                  {t("per pack")}
                </p>
                <p className="text-sm text-gray-600">
                  {t(
                    "One-time purchase. No recurring charge. Purchased credits carry over until used and require an active subscription to use."
                  )}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label htmlFor="topup-packs" className="text-sm">
                    {t("Packs")}
                    <input
                      id="topup-packs"
                      type="number"
                      min={1}
                      step={1}
                      value={topupPacks}
                      disabled={busy || paymentPending}
                      aria-invalid={!topupQuote}
                      aria-describedby="topup-summary"
                      onChange={(event) => setTopupPacks(event.target.value)}
                      className="mt-1 block w-24 rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!canBuyCredits}
                    onClick={() => void pay("topup")}
                    className={secondaryButton}
                  >
                    <CreditCard size={16} />
                    {t(busy ? "Opening checkout..." : "Buy AI credits")}
                  </button>
                </div>
                <p id="topup-summary" className="text-sm text-gray-600">
                  {topupQuote ? (
                    <>
                      {formatPrice(topupQuote.totalCents)} CAD ·{" "}
                      {topupQuote.credits.toLocaleString()} {t("credits")}.{" "}
                      {t("Taxes, if applicable, are shown at checkout.")}
                    </>
                  ) : (
                    t(
                      "Enter a positive whole number of packs within the credit limit."
                    )
                  )}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function formatDate(value: string, language: "en" | "fr") {
  const date = new Date(
    /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
  )
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString(language === "fr" ? "fr-CA" : "en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      })
}
