"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import {
  Bell,
  CalendarDays,
  Mail,
  PlusCircle,
  Save,
  Send,
} from "lucide-react"

import {
  getDatasetDetails,
  getDatasets,
  createDecision,
  getWeeklyReportDeliveryConfig,
  getWeeklyReportDigest,
  getWeeklyReportPreference,
  sendWeeklyReportTestEmail,
  sendWeeklyReportNow,
  updateWeeklyReportPreference,
  type DatasetSummary,
  type WeeklyReportDeliveryConfig,
  type WeeklyReportDigest,
  type WeeklyReportPreference,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  WorkspaceAccessNotice,
} from "@/features/dashboard/components/workspace-access-notice"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  buildAIRecommendationDecisionPayload,
} from "@/features/decisions/lib/ai-decision-handoff"
import {
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"

const defaultWeeklyReportPreference: WeeklyReportPreference = {
  enabled: false,
  cadence: "weekly",
  delivery_day: "monday",
  recipient_emails: [],
  metric_focus: [],
  include_recommendations: true,
  sender_name: "",
  sender_email: "",
  reply_to_email: "",
  subject_prefix: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_clear_password: false,
  smtp_password_set: false,
  smtp_use_tls: true,
  smtp_use_ssl: false,
  last_sent_at: null,
  last_send_status: null,
  last_send_error: null,
}

const deliveryDays: WeeklyReportPreference["delivery_day"][] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
]

type DatasetMetric = {
  column: string
  total?: number
  average?: number
}

type DatasetDetails = {
  file_name?: string
  metrics?: DatasetMetric[]
}

type DatasetMetricOption = {
  value: string
  label: string
  datasetNames: string[]
}

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

export default function AlertsPage() {
  const {
    user,
    isLoaded: authLoaded,
    isSignedIn,
  } = useUser()
  const router = useRouter()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)

  const [
    weeklyReportPreference,
    setWeeklyReportPreference,
  ] = useState<WeeklyReportPreference>(
    defaultWeeklyReportPreference
  )
  const [
    recipientEmailText,
    setRecipientEmailText,
  ] = useState("")
  const [metricOptions, setMetricOptions] =
    useState<DatasetMetricOption[]>([])
  const [weeklyReportDigest, setWeeklyReportDigest] =
    useState<WeeklyReportDigest | null>(null)
  const [
    weeklyReportDeliveryConfig,
    setWeeklyReportDeliveryConfig,
  ] = useState<WeeklyReportDeliveryConfig | null>(
    null
  )
  const [loading, setLoading] =
    useState(true)
  const [saving, setSaving] =
    useState(false)
  const [sending, setSending] =
    useState(false)
  const [sendingTestEmail, setSendingTestEmail] =
    useState(false)
  const [
    deliverySettingsDirty,
    setDeliverySettingsDirty,
  ] = useState(false)
  const [statusMessage, setStatusMessage] =
    useState("")
  const [errorMessage, setErrorMessage] =
    useState("")
  const [loadRetryKey, setLoadRetryKey] =
    useState(0)
  const [creatingDecision, setCreatingDecision] =
    useState(false)
  const [selectedDecisionMetricKey, setSelectedDecisionMetricKey] =
    useState("")

  const recipientEmails = useMemo(
    () => parseRecipientEmailText(recipientEmailText),
    [recipientEmailText]
  )
  const selectedMetricLabels =
    weeklyReportPreference.metric_focus.map(
      (metric) =>
        getMetricOptionLabel(
          metric,
          metricOptions
      )
    )
  const effectiveSelectedDecisionMetricKey = useMemo(() => {
    const metrics = weeklyReportDigest?.metrics ?? []
    const selectedMetricStillExists = metrics.some(
      (metric) =>
        `${metric.dataset_id}:${metric.column}` ===
        selectedDecisionMetricKey
    )

    return selectedMetricStillExists
      ? selectedDecisionMetricKey
      : metrics[0]
        ? `${metrics[0].dataset_id}:${metrics[0].column}`
        : ""
  }, [
    selectedDecisionMetricKey,
    weeklyReportDigest,
  ])
  const selectedDecisionMetric = useMemo(() => {
    const metrics = weeklyReportDigest?.metrics ?? []

    return (
      metrics.find(
        (metric) =>
          `${metric.dataset_id}:${metric.column}` ===
          effectiveSelectedDecisionMetricKey
      ) ?? metrics[0]
    )
  }, [
    effectiveSelectedDecisionMetricKey,
    weeklyReportDigest,
  ])

  async function handleCreateDigestDecision() {
    const digest = weeklyReportDigest
    const metric = selectedDecisionMetric
    const recommendation =
      digest?.ai_analysis?.recommendations[0]

    if (
      !user?.id ||
      !canManageWorkspaceData ||
      !metric ||
      !recommendation ||
      !digest?.ai_analysis ||
      creatingDecision
    ) {
      return
    }

    const decisionPayload =
      buildAIRecommendationDecisionPayload(
        metric.dataset_id,
        metric.column,
        digest.ai_analysis,
        metric.dataset_name
      )

    if (!decisionPayload) {
      return
    }

    try {
      setCreatingDecision(true)
      setErrorMessage("")

      const createdDecision =
        await createDecision(
          decisionPayload,
          user.id,
          activeWorkspaceId
        )

      router.push(
        `/dashboard/decisions/${createdDecision.id}`
      )
    } catch (error) {
      setErrorMessage(
        getErrorMessage(
          error,
          "Unable to create a decision from the alert analysis."
        )
      )
    } finally {
      setCreatingDecision(false)
    }
  }

  useEffect(() => {
    if (!authLoaded) {
      return
    }

    if (!isSignedIn || !user?.id) {
      setLoading(false)
      setErrorMessage(
        "Sign in to load notification setup."
      )
      return
    }

    let ignoreResult = false

    async function loadPreference(
      userId: string
    ) {
      try {
        setWeeklyReportPreference(
          defaultWeeklyReportPreference
        )
        setRecipientEmailText("")
        setMetricOptions([])
        setWeeklyReportDigest(null)
        setWeeklyReportDeliveryConfig(null)
        setStatusMessage("")
        setLoading(true)
        setErrorMessage("")

        const [
          preferenceResult,
          datasetsResult,
          digestResult,
          deliveryConfigResult,
        ] = await Promise.allSettled([
          getWeeklyReportPreference(
            userId,
            activeWorkspaceId
          ),
          getDatasets(
            userId,
            activeWorkspaceId
          ),
          getWeeklyReportDigest(
            userId,
            activeWorkspaceId
          ),
          getWeeklyReportDeliveryConfig(
            userId,
            activeWorkspaceId
          ),
        ])

        if (preferenceResult.status === "rejected") {
          throw preferenceResult.reason
        }

        const preference =
          preferenceResult.value
        const workspaceDatasets =
          datasetsResult.status === "fulfilled"
            ? datasetsResult.value
            : []

        const nextMetricOptions =
          await loadDatasetMetricOptions(
            workspaceDatasets,
            userId,
            activeWorkspaceId
          )

        if (ignoreResult) {
          return
        }

        const supportingDataUnavailable =
          datasetsResult.status === "rejected" ||
          digestResult.status === "rejected" ||
          deliveryConfigResult.status ===
            "rejected"

        setMetricOptions(nextMetricOptions)
        setWeeklyReportDigest(
          digestResult.status === "fulfilled"
            ? digestResult.value
            : null
        )
        setWeeklyReportDeliveryConfig(
          deliveryConfigResult.status ===
            "fulfilled"
            ? deliveryConfigResult.value
            : null
        )
        setWeeklyReportPreference(
          reconcileMetricFocusWithOptions(
            normalizeWeeklyReportPreference(
              preference
            ),
            nextMetricOptions
          )
        )
        setRecipientEmailText(
          preference.recipient_emails.join("\n")
        )
        setDeliverySettingsDirty(false)

        if (supportingDataUnavailable) {
          setErrorMessage(
            "Notification setup loaded, but some supporting status data is temporarily unavailable."
          )
        }
      } catch (error) {
        if (!ignoreResult) {
          setErrorMessage(
            getErrorMessage(
              error,
              "Notification setup could not be loaded."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoading(false)
        }
      }
    }

    void loadPreference(user.id)

    return () => {
      ignoreResult = true
      setLoading(false)
    }
  }, [
    activeWorkspaceId,
    authLoaded,
    isSignedIn,
    loadRetryKey,
    user?.id,
    workspaceVersion,
  ])

  function updateWeeklyReportDraft(
    patch: Partial<WeeklyReportPreference>
  ) {
    setWeeklyReportPreference(
      (currentPreference) =>
        normalizeWeeklyReportPreference({
          ...currentPreference,
          ...patch,
        })
    )
    setStatusMessage("")
    setErrorMessage("")
  }

  function updateDeliverySettingsDraft(
    patch: Partial<WeeklyReportPreference>
  ) {
    updateWeeklyReportDraft(patch)
    setDeliverySettingsDirty(true)
  }

  function toggleMetricFocus(
    metric: string
  ) {
    const currentFocus =
      weeklyReportPreference.metric_focus
    const nextFocus =
      currentFocus.includes(metric)
        ? currentFocus.filter(
          (item) => item !== metric
        )
        : [
          ...currentFocus,
          metric,
        ]

    updateWeeklyReportDraft({
      metric_focus: nextFocus.length
        ? nextFocus
        : defaultWeeklyReportPreference.metric_focus,
    })
  }

  async function handleSave() {
    if (
      !user?.id ||
      !canManageWorkspaceData ||
      saving
    ) {
      return
    }

    if (
      weeklyReportPreference.enabled &&
      recipientEmails.length === 0
    ) {
      setErrorMessage(
        "Add at least one recipient before enabling KPI email notifications."
      )
      return
    }

    if (
      weeklyReportPreference.enabled &&
      weeklyReportPreference.metric_focus.length === 0
    ) {
      setErrorMessage(
        "Select at least one KPI metric from your datasets before enabling notifications."
      )
      return
    }

    try {
      setSaving(true)
      setErrorMessage("")
      setStatusMessage("")

      const savedPreference =
        await updateWeeklyReportPreference(
          {
            ...weeklyReportPreference,
            cadence: "weekly",
            recipient_emails: recipientEmails,
          },
          user.id,
          activeWorkspaceId
        )

      const normalizedPreference =
        normalizeWeeklyReportPreference(
          savedPreference
        )

      setWeeklyReportPreference(
        normalizedPreference
      )
      setRecipientEmailText(
        normalizedPreference.recipient_emails.join(
          "\n"
        )
      )
      setDeliverySettingsDirty(false)

      const [
        digestResult,
        deliveryConfigResult,
      ] = await Promise.allSettled([
        getWeeklyReportDigest(
          user.id,
          activeWorkspaceId
        ),
        getWeeklyReportDeliveryConfig(
          user.id,
          activeWorkspaceId
        ),
      ])

      if (digestResult.status === "fulfilled") {
        setWeeklyReportDigest(digestResult.value)
      }

      if (
        deliveryConfigResult.status ===
        "fulfilled"
      ) {
        setWeeklyReportDeliveryConfig(
          deliveryConfigResult.value
        )
      }

      setStatusMessage(
        digestResult.status === "fulfilled" &&
          deliveryConfigResult.status ===
            "fulfilled"
          ? "Notification setup saved."
          : "Notification setup saved. Status refresh is temporarily unavailable."
      )
    } catch (error) {
      setErrorMessage(
        getErrorMessage(
          error,
          "Notification setup could not be saved."
        )
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleSendNow() {
    if (
      !user?.id ||
      !canManageWorkspaceData ||
      sending ||
      !weeklyReportPreference.enabled ||
      deliverySettingsDirty ||
      weeklyReportPreference.recipient_emails.length === 0 ||
      weeklyReportPreference.recipient_emails.join("\n") !==
        recipientEmails.join("\n") ||
      !weeklyReportDeliveryConfig?.email_delivery_configured
    ) {
      return
    }

    try {
      setSending(true)
      setErrorMessage("")
      setStatusMessage("")

      const deliveryResult =
        await sendWeeklyReportNow(
          user.id,
          activeWorkspaceId
        )

      setWeeklyReportPreference(
        (currentPreference) =>
          normalizeWeeklyReportPreference({
            ...currentPreference,
            last_send_status: "sent",
            last_send_error: null,
            last_sent_at: deliveryResult.sent_at,
          })
      )

      try {
        setWeeklyReportDigest(
          await getWeeklyReportDigest(
            user.id,
            activeWorkspaceId
          )
        )
      } catch {
        // Delivery already succeeded; keep the local sent status.
      }

      setStatusMessage(
        `KPI digest sent to ${deliveryResult.delivered_count} recipient${deliveryResult.delivered_count === 1 ? "" : "s"}.`
      )
    } catch (error) {
      setErrorMessage(
        getErrorMessage(
          error,
          "KPI digest could not be sent. Check email delivery configuration."
        )
      )
      try {
        setWeeklyReportPreference(
          normalizeWeeklyReportPreference(
            await getWeeklyReportPreference(
              user.id,
              activeWorkspaceId
            )
          )
        )
      } catch {
        // Keep the draft in place when status refresh fails.
      }
    } finally {
      setSending(false)
    }
  }

  async function handleSendTestEmail() {
    if (
      !user?.id ||
      !canManageWorkspaceData ||
      sendingTestEmail ||
      saving ||
      !weeklyReportDeliveryConfig?.email_delivery_configured ||
      deliverySettingsDirty ||
      weeklyReportPreference.recipient_emails.length === 0 ||
      weeklyReportPreference.recipient_emails.join("\n") !==
        recipientEmails.join("\n")
    ) {
      return
    }

    try {
      setSendingTestEmail(true)
      setErrorMessage("")
      setStatusMessage("")

      const deliveryResult =
        await sendWeeklyReportTestEmail(
          user.id,
          activeWorkspaceId
        )

      setWeeklyReportPreference(
        (currentPreference) =>
          normalizeWeeklyReportPreference({
            ...currentPreference,
            last_send_status: "test_sent",
            last_send_error: null,
          })
      )
      setStatusMessage(
        `Test KPI email sent to ${deliveryResult.delivered_count} recipient${deliveryResult.delivered_count === 1 ? "" : "s"} at ${formatDateTime(deliveryResult.sent_at)}.`
      )
    } catch (error) {
      setErrorMessage(
        getErrorMessage(
          error,
          "Test KPI email could not be sent. Check delivery configuration and saved recipients."
        )
      )
      try {
        setWeeklyReportPreference(
          normalizeWeeklyReportPreference(
            await getWeeklyReportPreference(
              user.id,
              activeWorkspaceId
            )
          )
        )
      } catch {
        // Keep the draft in place when status refresh fails.
      }
    } finally {
      setSendingTestEmail(false)
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Decision intelligence"
        title="Alerts & Notifications"
        description="Configure periodic KPI email messages and AI-assisted recommendations for workspace owners, teammates, or client recipients."
        actions={
          <div className="rounded-xl bg-[var(--decisionate-brand-primary-soft)] p-2.5 text-[var(--decisionate-brand-primary-text)]">
            <Bell size={22} />
          </div>
        }
      />

      {errorMessage && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{errorMessage}</span>

          {!loading && (
            <button
              type="button"
              onClick={() =>
                setLoadRetryKey(
                  currentKey => currentKey + 1
                )
              }
              className="w-fit rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
            >
              Retry notification setup
            </button>
          )}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {statusMessage}
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Notification setup is managed by workspace managers. Shared workspace users can review the current digest status."
        className="print:hidden"
      />

      <div className="space-y-5">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
                Email digest
              </p>

              <h2 className="mt-1.5 text-xl font-semibold">
                Periodic KPI notification
              </h2>

              <p className="mt-1.5 max-w-3xl text-sm text-gray-500">
                Choose which dataset metrics and recommendations should shape the email digest.
              </p>
            </div>

            <span
              className={`w-fit rounded-full border px-3 py-1 text-xs font-medium ${
                weeklyReportPreference.enabled
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              {weeklyReportPreference.enabled
                ? "Enabled"
                : "Disabled"}
            </span>
          </div>

          {loading ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-6 rounded-xl border bg-gray-50 p-4 text-sm text-gray-500"
            >
              Loading notification setup...
            </div>
          ) : !canManageWorkspaceData ? (
            <ReadOnlyNotificationSummary
              preference={weeklyReportPreference}
              selectedMetricLabels={selectedMetricLabels}
            />
          ) : (
            <div className="mt-5 space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  KPI focus
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  Metrics are pulled from the datasets in this workspace.
                </p>

                {metricOptions.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {metricOptions.map((option) => (
                      <label
                        key={option.value}
                        className="flex min-w-0 items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={weeklyReportPreference.metric_focus.includes(
                            option.value
                          )}
                          onChange={() =>
                            toggleMetricFocus(
                              option.value
                            )
                          }
                          className="mt-0.5 h-4 w-4 accent-[var(--decisionate-brand-primary)]"
                        />

                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-gray-900">
                            {option.label}
                          </span>
                          <span className="mt-1 block truncate text-xs text-gray-500">
                            Source:{" "}
                            {formatMetricDatasetNames(
                              option.datasetNames
                            )}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                    <p className="font-medium">
                      No dataset metrics available yet.
                    </p>

                    <p className="mt-1">
                      Upload or pull a dataset so notifications can use real KPIs from your data.
                    </p>

                    <Link
                      href="/dashboard/datasets"
                      className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-50 sm:w-auto"
                    >
                      Add dataset
                    </Link>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={
                    weeklyReportPreference.include_recommendations
                  }
                  onChange={(event) =>
                    updateWeeklyReportDraft({
                      include_recommendations:
                        event.target.checked,
                    })
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
                />

                <span className="text-sm text-gray-700">
                  Include recommendations and decision follow-ups
                </span>
              </label>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"
                >
                  <Save
                    size={16}
                    className="shrink-0"
                  />
                  {saving
                    ? "Saving..."
                    : "Save KPI Setup"}
                </button>
              </div>

              <p className="text-xs text-gray-500">
                Delivery settings, recipients, and manual sending are managed in the Delivery configuration card.
              </p>
            </div>
          )}
        </div>

        <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <WeeklyReportDigestPreview
            digest={weeklyReportDigest}
            loading={loading}
            selectedMetricLabels={selectedMetricLabels}
            onCreateDecision={
              canManageWorkspaceData &&
              Boolean(
                selectedDecisionMetric &&
                weeklyReportDigest?.ai_analysis?.recommendations.length
              )
                ? () => {
                  void handleCreateDigestDecision()
                }
                : undefined
            }
            selectedMetricKey={
              effectiveSelectedDecisionMetricKey
            }
            selectedDecisionMetricLabel={
              selectedDecisionMetric
                ? `${formatMetricName(selectedDecisionMetric.column)} · ${selectedDecisionMetric.dataset_name}`
                : undefined
            }
            onSelectMetric={setSelectedDecisionMetricKey}
            creatingDecision={creatingDecision}
          />

          {canManageWorkspaceData && (
            <DeliveryConfigurationStatus
              config={weeklyReportDeliveryConfig}
              loading={loading}
              preference={weeklyReportPreference}
              recipientEmailText={recipientEmailText}
              saving={saving}
              sending={sending}
              sendingTestEmail={sendingTestEmail}
              deliverySettingsDirty={deliverySettingsDirty}
              onPreferenceChange={updateDeliverySettingsDraft}
              onRecipientEmailTextChange={(value) => {
                setRecipientEmailText(value)
                setStatusMessage("")
                setErrorMessage("")
              }}
              onSave={handleSave}
              onSendTestEmail={handleSendTestEmail}
              onSendNow={handleSendNow}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function WeeklyReportDigestPreview({
  digest,
  loading,
  selectedMetricLabels,
  onCreateDecision,
  selectedMetricKey,
  selectedDecisionMetricLabel,
  onSelectMetric,
  creatingDecision,
}: {
  digest: WeeklyReportDigest | null
  loading: boolean
  selectedMetricLabels: string[]
  onCreateDecision?: () => void
  selectedMetricKey: string
  selectedDecisionMetricLabel?: string
  onSelectMetric: (value: string) => void
  creatingDecision: boolean
}) {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="h-full rounded-2xl border bg-white p-5 text-sm text-gray-500 shadow-sm"
      >
        Loading digest preview...
      </div>
    )
  }

  if (!digest) {
    return (
      <div className="h-full rounded-2xl border bg-white p-5 text-sm text-gray-500 shadow-sm">
        Save notification setup to preview the KPI digest.
      </div>
    )
  }

  return (
    <div className="h-full rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-sm font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
        Saved digest preview
      </p>

      <h2 className="mt-2 text-lg font-semibold">
        {digest.subject}
      </h2>

      <p className="mt-2 text-sm text-gray-500">
        {digest.preview_text}
      </p>

      {digest.ai_analysis && (
        <AIAnalysisPanel
          analysis={digest.ai_analysis}
          title="Alert analysis"
          metricContext={selectedDecisionMetricLabel}
          metrics={selectedMetricLabels}
          className="mt-4"
        />
      )}

      <div className="mt-3 space-y-2.5">
        {digest.metrics.slice(0, 5).map((metric) => (
          <div
            key={`${metric.dataset_id}-${metric.column}`}
            className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {formatMetricName(metric.column)}
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  {metric.dataset_name}
                </p>
              </div>

              <p className="text-sm font-semibold text-gray-900 sm:text-right">
                {formatMetricValue(metric.total)}
              </p>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Avg {formatMetricValue(metric.average)} · Min{" "}
              {formatMetricValue(metric.minimum)} · Max{" "}
              {formatMetricValue(metric.maximum)}
            </p>
          </div>
        ))}
      </div>

      {digest.metrics.length === 0 && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
          No saved KPI metrics match the current datasets yet.
        </div>
      )}

      {onCreateDecision && digest.metrics.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <label
            htmlFor="alert-decision-metric"
            className="text-xs font-semibold uppercase tracking-wide text-gray-600"
          >
            Decision metric
          </label>
          <select
            id="alert-decision-metric"
            value={selectedMetricKey}
            onChange={(event) => onSelectMetric(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
          >
            {digest.metrics.map((metric) => {
              const metricKey = `${metric.dataset_id}:${metric.column}`

              return (
                <option
                  key={metricKey}
                  value={metricKey}
                >
                  {formatMetricName(metric.column)} · {metric.dataset_name}
                </option>
              )
            })}
          </select>
          <p className="mt-1.5 text-xs text-gray-500">
            Choose the KPI that will receive this analysis as a decision.
          </p>
        </div>
      )}

      {onCreateDecision && (
        <button
          type="button"
          onClick={onCreateDecision}
          disabled={creatingDecision}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PlusCircle size={16} />
          {creatingDecision
            ? "Creating decision..."
            : "Create decision from analysis"}
        </button>
      )}

      {digest.unavailable_datasets.length > 0 && (
        <p className="mt-4 break-words text-xs text-amber-700">
          Could not read:{" "}
          {digest.unavailable_datasets.join(", ")}
        </p>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Preview updates after saving setup changes.
      </p>
    </div>
  )
}

function DeliveryConfigurationStatus({
  config,
  loading,
  preference,
  recipientEmailText,
  saving,
  sending,
  sendingTestEmail,
  deliverySettingsDirty,
  onPreferenceChange,
  onRecipientEmailTextChange,
  onSave,
  onSendTestEmail,
  onSendNow,
}: {
  config: WeeklyReportDeliveryConfig | null
  loading: boolean
  preference: WeeklyReportPreference
  recipientEmailText: string
  saving: boolean
  sending: boolean
  sendingTestEmail: boolean
  deliverySettingsDirty: boolean
  onPreferenceChange: (
    patch: Partial<WeeklyReportPreference>
  ) => void
  onRecipientEmailTextChange: (
    value: string
  ) => void
  onSave: () => void
  onSendTestEmail: () => void
  onSendNow: () => void
}) {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="h-full rounded-2xl border bg-white p-5 text-sm text-gray-500 shadow-sm"
      >
        Loading delivery configuration...
      </div>
    )
  }

  const emailDeliveryConfigured =
    Boolean(config?.email_delivery_configured)
  const schedulerConfigured =
    Boolean(config?.scheduler_configured)
  const draftWorkspaceEmailConfigured =
    Boolean(preference.sender_email.trim()) &&
    Boolean(preference.smtp_host.trim())
  const draftEmailDeliveryConfigured =
    emailDeliveryConfigured ||
    draftWorkspaceEmailConfigured
  const draftEmailDeliveryPendingSave =
    draftWorkspaceEmailConfigured &&
    !emailDeliveryConfigured
  const emailSenderReadyText =
    draftEmailDeliveryPendingSave
      ? "Ready after save"
      : deliverySettingsDirty && emailDeliveryConfigured
        ? "Saved settings ready"
        : "Ready"
  const draftRecipientEmails =
    parseRecipientEmailText(
      recipientEmailText
    )
  const recipientChangesPendingSave =
    preference.recipient_emails.join("\n") !==
    draftRecipientEmails.join("\n")
  const hasSavedRecipients =
    preference.recipient_emails.length > 0

  return (
    <div className="h-full rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            Delivery configuration
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Manage email delivery, schedule, and recipients.
          </p>
        </div>

        <span
          className={`w-fit rounded-full border px-3 py-1 text-xs font-medium ${
            preference.enabled
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-gray-200 bg-gray-50 text-gray-600"
          }`}
        >
          {preference.enabled
            ? "Enabled"
            : "Disabled"}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <input
            type="checkbox"
            checked={preference.enabled}
            onChange={(event) =>
              onPreferenceChange({
                enabled: event.target.checked,
              })
            }
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
          />

          <span>
            <span className="block text-sm font-medium text-gray-900">
              Email delivery
            </span>
            <span className="mt-1 block text-sm text-gray-500">
              Send the saved KPI digest to the recipients below.
            </span>
          </span>
        </label>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-800">
            Email send details
          </p>

          <p className="mt-1 text-xs text-gray-500">
            These fields control the sender identity and subject line used for outgoing KPI emails.
          </p>

          <div className="mt-3 grid gap-3">
            <div>
              <label
                htmlFor="weekly-report-sender-name"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                Sender name
              </label>

              <input
                id="weekly-report-sender-name"
                value={preference.sender_name}
                onChange={(event) =>
                  onPreferenceChange({
                    sender_name: event.target.value,
                  })
                }
                placeholder="Your workspace"
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
            </div>

            <div>
              <label
                htmlFor="weekly-report-sender-email"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                Sender email
              </label>

              <input
                id="weekly-report-sender-email"
                type="email"
                value={preference.sender_email}
                onChange={(event) =>
                  onPreferenceChange({
                    sender_email: event.target.value,
                  })
                }
                placeholder="reports@example.com"
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
              />

              <p className="mt-1 text-xs text-gray-500">
                Used as the From address. If left blank, the server SMTP sender is used.
              </p>
            </div>

            <div>
              <label
                htmlFor="weekly-report-reply-to-email"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                Reply-to email
              </label>

              <input
                id="weekly-report-reply-to-email"
                type="email"
                value={preference.reply_to_email}
                onChange={(event) =>
                  onPreferenceChange({
                    reply_to_email: event.target.value,
                  })
                }
                placeholder="support@example.com"
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
            </div>

            <div>
              <label
                htmlFor="weekly-report-subject-prefix"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                Subject prefix
              </label>

              <input
                id="weekly-report-subject-prefix"
                value={preference.subject_prefix}
                onChange={(event) =>
                  onPreferenceChange({
                    subject_prefix: event.target.value,
                  })
                }
                placeholder="[Weekly KPI]"
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
            </div>

            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                SMTP setup
              </p>

              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
                  <div>
                    <label
                      htmlFor="weekly-report-smtp-host"
                      className="mb-1.5 block text-xs font-medium text-gray-600"
                    >
                      SMTP host
                    </label>

                    <input
                      id="weekly-report-smtp-host"
                      value={preference.smtp_host}
                      onChange={(event) =>
                        onPreferenceChange({
                          smtp_host: event.target.value,
                        })
                      }
                      placeholder="smtp.example.com"
                      className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="weekly-report-smtp-port"
                      className="mb-1.5 block text-xs font-medium text-gray-600"
                    >
                      Port
                    </label>

                    <input
                      id="weekly-report-smtp-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={preference.smtp_port ?? ""}
                      onChange={(event) =>
                        onPreferenceChange({
                          smtp_port: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                      placeholder="587"
                      className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="weekly-report-smtp-username"
                    className="mb-1.5 block text-xs font-medium text-gray-600"
                  >
                    SMTP username
                  </label>

                  <input
                    id="weekly-report-smtp-username"
                    value={preference.smtp_username}
                    onChange={(event) =>
                      onPreferenceChange({
                        smtp_username: event.target.value,
                      })
                    }
                    placeholder="apikey or user@example.com"
                    className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="weekly-report-smtp-password"
                    className="mb-1.5 block text-xs font-medium text-gray-600"
                  >
                    SMTP password
                  </label>

                  <input
                    id="weekly-report-smtp-password"
                    type="password"
                    value={preference.smtp_password ?? ""}
                    onChange={(event) =>
                      onPreferenceChange({
                        smtp_password: event.target.value,
                      })
                    }
                    placeholder={
                      preference.smtp_password_set
                        ? "Password saved — enter a new one to replace it"
                        : "SMTP password or API key"
                    }
                    className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                  />

                  <p className="mt-1 text-xs text-gray-500">
                    {preference.smtp_password_set
                      ? "A password is saved. Leave this blank to keep it."
                      : "Needed only when your SMTP provider requires authentication."}
                  </p>

                  {preference.smtp_password_set && (
                    <label className="mt-2 flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={Boolean(
                          preference.smtp_clear_password
                        )}
                        onChange={(event) =>
                          onPreferenceChange({
                            smtp_clear_password: event.target.checked,
                            smtp_password: event.target.checked
                              ? ""
                              : preference.smtp_password,
                          })
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
                      />
                      Clear saved SMTP password on next save
                    </label>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={preference.smtp_use_tls}
                      onChange={(event) =>
                        onPreferenceChange({
                          smtp_use_tls: event.target.checked,
                          smtp_use_ssl: event.target.checked
                            ? false
                            : preference.smtp_use_ssl,
                        })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
                    />
                    Use TLS / STARTTLS
                  </label>

                  <label className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={preference.smtp_use_ssl}
                      onChange={(event) =>
                        onPreferenceChange({
                          smtp_use_ssl: event.target.checked,
                          smtp_use_tls: event.target.checked
                            ? false
                            : preference.smtp_use_tls,
                        })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
                    />
                    Use SSL
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label
            htmlFor="weekly-report-delivery-day"
            className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <CalendarDays
              size={16}
              className="shrink-0"
            />
            Scheduled sending
          </label>

          <select
            id="weekly-report-delivery-day"
            value={preference.delivery_day}
            onChange={(event) =>
              onPreferenceChange({
                delivery_day:
                  event.target.value as WeeklyReportPreference["delivery_day"],
              })
            }
            className="h-11 w-full rounded-xl border px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
          >
            {deliveryDays.map((day) => (
              <option
                key={day}
                value={day}
              >
                {formatDeliveryDay(day)}
              </option>
            ))}
          </select>

          <p className="mt-1 text-xs text-gray-500">
            Runs weekly on the selected day when email delivery is enabled.
          </p>
        </div>

        <div>
          <label
            htmlFor="weekly-report-recipients"
            className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <Mail
              size={16}
              className="shrink-0"
            />
            Recipient emails
          </label>

          <textarea
            id="weekly-report-recipients"
            value={recipientEmailText}
            onChange={(event) =>
              onRecipientEmailTextChange(
                event.target.value
              )
            }
            rows={4}
            placeholder="owner@example.com&#10;client@example.com"
            className="w-full rounded-xl border px-3 py-2 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
          />

          <p className="mt-1 text-xs text-gray-500">
            Add one email per line or separate addresses with commas.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            <Save
              size={16}
              className="shrink-0"
            />
            {saving
              ? "Saving..."
              : "Save Delivery Settings"}
          </button>

          <button
            type="button"
            onClick={onSendNow}
            disabled={
              sending ||
              sendingTestEmail ||
              saving ||
              deliverySettingsDirty ||
              recipientChangesPendingSave ||
              !hasSavedRecipients ||
              !preference.enabled ||
              !emailDeliveryConfigured
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            <Send
              size={16}
              className="shrink-0"
            />
            {sending
              ? "Sending..."
              : "Send Digest Now"}
          </button>

          <button
            type="button"
            onClick={onSendTestEmail}
            disabled={
              sendingTestEmail ||
              sending ||
              saving ||
              deliverySettingsDirty ||
              !emailDeliveryConfigured ||
              !hasSavedRecipients ||
              recipientChangesPendingSave
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-white px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-text)] shadow-sm transition hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            <Send
              size={16}
              className="shrink-0"
            />
            {sendingTestEmail
              ? "Sending test..."
              : "Send Test Email"}
          </button>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-800">
            Delivery readiness
          </p>

          <div className="mt-3 space-y-2.5">
            {config ? (
              <>
                <ConfigurationStatusRow
                  label="Email sender"
                  ready={draftEmailDeliveryConfigured}
                  readyText={emailSenderReadyText}
                  missingText="Needs setup"
                />

                <ConfigurationStatusRow
                  label="Schedule runner"
                  ready={schedulerConfigured}
                  readyText="Ready"
                  missingText="Needs setup"
                />

                <ConfigurationStatusRow
                  label="AI analysis"
                  ready={Boolean(config.ai_provider_configured)}
                  readyText={
                    config.ai_model
                      ? `Ready (${config.ai_model})`
                      : "Ready"
                  }
                  missingText="Fallback rules"
                />
              </>
            ) : (
              <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Delivery configuration status could not be loaded.
              </p>
            )}
          </div>

          <p className="mt-3 break-words text-xs text-gray-500">
            Current delivery status:{" "}
            <span className="font-medium text-gray-700">
              {formatDeliveryStatus(preference)}
            </span>
          </p>

          {!draftEmailDeliveryConfigured && (
            <p className="mt-2 break-words rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Add a sender email and SMTP host above, or complete server SMTP environment setup, then save delivery settings.
            </p>
          )}

          {draftEmailDeliveryPendingSave && (
            <p className="mt-2 break-words rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-xs text-[var(--decisionate-brand-primary-text)]">
              Sender details look complete. Save delivery settings before sending a digest.
            </p>
          )}

          {emailDeliveryConfigured && (
            <p className="mt-2 break-words text-xs text-gray-500">
              Test email uses the saved delivery settings and saved recipients.
            </p>
          )}

          {emailDeliveryConfigured && !hasSavedRecipients && (
            <p className="mt-2 break-words rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Save at least one recipient before sending or testing email.
            </p>
          )}

          {emailDeliveryConfigured && !preference.enabled && (
            <p className="mt-2 break-words rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Enable email delivery before sending the full KPI digest. You can still send a test email after recipients are saved.
            </p>
          )}

          {emailDeliveryConfigured && recipientChangesPendingSave && (
            <p className="mt-2 break-words rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-xs text-[var(--decisionate-brand-primary-text)]">
              Recipient changes need to be saved before sending or testing email.
            </p>
          )}

          {emailDeliveryConfigured && deliverySettingsDirty && (
            <p className="mt-2 break-words rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-xs text-[var(--decisionate-brand-primary-text)]">
              Delivery settings have unsaved changes. Save before sending or testing email.
            </p>
          )}

          {preference.last_send_error && (
            <p className="mt-2 break-words text-xs text-red-600">
              Last error: {preference.last_send_error}
            </p>
          )}
        </div>
      </div>

      {config && (
        <details className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-800">
            Administrator setup details
          </summary>

          <div className="mt-3 space-y-3">
            <div>
              <p className="font-medium text-gray-800">
                Required email settings
              </p>

              <p className="mt-1 break-words font-mono">
                {config.required_email_environment_keys.length > 0
                  ? config.required_email_environment_keys.join(
                    ", "
                  )
                  : "No server email environment settings required when workspace SMTP is saved."}
              </p>
            </div>

            <div>
              <p className="font-medium text-gray-800">
                Scheduler
              </p>

              <p className="mt-1 break-words">
                Call{" "}
                <span className="break-all font-mono">
                  POST {config.send_due_endpoint}
                </span>{" "}
                with{" "}
                <span className="break-all font-mono">
                  {config.scheduler_header_name}
                </span>
                .
              </p>

              <p className="mt-1 break-words font-mono">
                {config.scheduler_environment_key}
              </p>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

function ConfigurationStatusRow({
  label,
  ready,
  readyText,
  missingText,
}: {
  label: string
  ready: boolean
  readyText: string
  missingText: string
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="font-medium text-gray-700">
        {label}
      </span>

      <span
        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          ready
            ? "bg-green-50 text-green-700"
            : "bg-amber-50 text-amber-700"
        }`}
      >
        {ready ? readyText : missingText}
      </span>
    </div>
  )
}

function ReadOnlyNotificationSummary({
  preference,
  selectedMetricLabels,
}: {
  preference: WeeklyReportPreference
  selectedMetricLabels: string[]
}) {
  return (
    <div className="mt-6 break-words rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4 text-sm text-[var(--decisionate-brand-primary-text)]">
      The workspace owner manages notification setup. Current setup:{" "}
      {preference.enabled
        ? `${preference.recipient_emails.length} recipient${preference.recipient_emails.length === 1 ? "" : "s"} every ${formatDeliveryDay(preference.delivery_day)} for ${selectedMetricLabels.join(", ") || "no selected dataset metrics"}`
        : "not enabled"}
      .
    </div>
  )
}

function normalizeWeeklyReportPreference(
  preference: WeeklyReportPreference
): WeeklyReportPreference {
  return {
    ...defaultWeeklyReportPreference,
    ...preference,
    cadence: "weekly",
    metric_focus:
      preference.metric_focus.length > 0
        ? preference.metric_focus
        : defaultWeeklyReportPreference.metric_focus,
  }
}

async function loadDatasetMetricOptions(
  datasets: DatasetSummary[],
  userId: string,
  activeWorkspaceId: string | undefined
): Promise<DatasetMetricOption[]> {
  const detailResults =
    await Promise.allSettled(
      datasets.map((dataset) =>
        getDatasetDetails(
          dataset.id,
          userId,
          activeWorkspaceId
        ) as Promise<DatasetDetails>
      )
    )

  const metricOptionsByColumn =
    new Map<string, DatasetMetricOption>()

  detailResults.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      return
    }

    const datasetName =
      result.value.file_name ||
      datasets[index]?.file_name ||
      `Dataset ${datasets[index]?.id ?? index + 1}`

    result.value.metrics?.forEach((metric) => {
      const metricColumn =
        metric.column.trim()

      if (!metricColumn) {
        return
      }

      const metricKey =
        metricColumn.toLowerCase()
      const existingOption =
        metricOptionsByColumn.get(metricKey)

      if (existingOption) {
        if (
          !existingOption.datasetNames.includes(
            datasetName
          )
        ) {
          existingOption.datasetNames.push(
            datasetName
          )
        }

        return
      }

      metricOptionsByColumn.set(
        metricKey,
        {
          value: metricColumn,
          label: formatMetricName(metricColumn),
          datasetNames: [
            datasetName,
          ],
        }
      )
    })
  })

  return Array.from(
    metricOptionsByColumn.values()
  ).sort((firstOption, secondOption) =>
    firstOption.label.localeCompare(
      secondOption.label
    )
  )
}

function reconcileMetricFocusWithOptions(
  preference: WeeklyReportPreference,
  metricOptions: DatasetMetricOption[]
): WeeklyReportPreference {
  if (metricOptions.length === 0) {
    return {
      ...preference,
      metric_focus: [],
    }
  }

  const metricOptionsByKey =
    new Map(
      metricOptions.map((option) => [
        option.value.toLowerCase(),
        option.value,
      ])
    )
  const reconciledMetricFocus: string[] = []

  preference.metric_focus.forEach((metric) => {
    const metricValue =
      metricOptionsByKey.get(
        metric.toLowerCase()
      )

    if (
      metricValue &&
      !reconciledMetricFocus.includes(metricValue)
    ) {
      reconciledMetricFocus.push(metricValue)
    }
  })

  return {
    ...preference,
    metric_focus: reconciledMetricFocus,
  }
}

function getMetricOptionLabel(
  metric: string,
  metricOptions: DatasetMetricOption[]
) {
  return (
    metricOptions.find(
      (option) =>
        option.value.toLowerCase() ===
        metric.toLowerCase()
    )?.label ?? formatMetricName(metric)
  )
}

function formatMetricDatasetNames(
  datasetNames: string[]
) {
  if (datasetNames.length === 0) {
    return "Dataset metric"
  }

  if (datasetNames.length === 1) {
    return datasetNames[0]
  }

  if (datasetNames.length === 2) {
    return datasetNames.join(" and ")
  }

  return `${datasetNames[0]} and ${datasetNames.length - 1} more datasets`
}

function formatMetricName(
  metric: string
) {
  return formatMetricLabel(metric)
}

function formatMetricValue(
  value: number | null | undefined
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return "—"
  }

  return value.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 2,
    }
  )
}

function formatDeliveryStatus(
  preference: WeeklyReportPreference
) {
  if (preference.last_send_status === "sent") {
    return preference.last_sent_at
      ? `Sent ${formatDateTime(preference.last_sent_at)}`
      : "Sent"
  }

  if (preference.last_send_status === "failed") {
    return "Last send failed"
  }

  if (preference.last_send_status === "test_sent") {
    return "Test sent"
  }

  if (preference.last_send_status === "test_failed") {
    return "Last test failed"
  }

  if (preference.last_send_status === "configured") {
    return "Configured"
  }

  if (preference.last_send_status === "disabled") {
    return "Disabled"
  }

  return "Not sent yet"
}

function formatDateTime(
  value: string
) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(
    undefined,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }
  )
}

function parseRecipientEmailText(
  value: string
) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((email) =>
          email.trim().toLowerCase()
        )
        .filter(Boolean)
    )
  )
}

function formatDeliveryDay(
  day: string
) {
  return day
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}
