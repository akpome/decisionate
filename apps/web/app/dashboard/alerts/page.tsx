"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import {
  Bell,
  PlusCircle,
  Save,
} from "lucide-react"

import {
  getDatasetRelationships,
  createDecision,
  getWeeklyReportDigest,
  getWeeklyReportPreference,
  updateWeeklyReportPreference,
  type DatasetRelationship,
  type WeeklyReportDigest,
  type WeeklyReportDigestMetric,
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
  metric_targets: {},
  relationship_focus: [],
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

const notificationSetupUiTimeoutMs = 10000
const digestPreviewUiTimeoutMs = 10000

type DatasetMetricOption = {
  value: string
  column: string
  label: string
  datasetName: string
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
  const { user } = useUser()
  const {
    canManageAlerts,
    canManageWorkspaceData,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)

  if (loadingWorkspaceAccess) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Alerts"
          description="Select the data and relationships that should shape alert analysis."
        />
        <div
          role="status"
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500"
        >
          Checking workspace access...
        </div>
      </div>
    )
  }

  if (!canManageAlerts) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Alerts"
          description="Select the data and relationships that should shape alert analysis."
        />
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Only workspace owners, client workspace owners, and approved agency owners can configure alert analysis. Delivery settings are managed in agency Settings.
        </div>
      </div>
    )
  }

  return (
    <AlertsPageContent
      canManageAlertAnalysis={canManageAlerts}
      canManageWorkspaceData={canManageWorkspaceData}
      loadingWorkspaceAccess={loadingWorkspaceAccess}
    />
  )
}

function AlertsPageContent({
  canManageAlertAnalysis,
  canManageWorkspaceData,
  loadingWorkspaceAccess,
}: {
  canManageAlertAnalysis: boolean
  canManageWorkspaceData: boolean
  loadingWorkspaceAccess: boolean
}) {
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

  const [
    weeklyReportPreference,
    setWeeklyReportPreference,
  ] = useState<WeeklyReportPreference>(
    defaultWeeklyReportPreference
  )
  const [metricOptions, setMetricOptions] =
    useState<DatasetMetricOption[]>([])
  const [relationshipOptions, setRelationshipOptions] =
    useState<DatasetRelationship[]>([])
  const [weeklyReportDigest, setWeeklyReportDigest] =
    useState<WeeklyReportDigest | null>(null)
  const [setupRequestPending, setSetupRequestPending] =
    useState(true)
  const [setupUnavailable, setSetupUnavailable] =
    useState(false)
  const [supportingDataLoading, setSupportingDataLoading] =
    useState(true)
  const [supportingDataUnavailable, setSupportingDataUnavailable] =
    useState(false)
  const [saving, setSaving] =
    useState(false)
  const [statusMessage, setStatusMessage] =
    useState("")
  const [warningMessage, setWarningMessage] =
    useState("")
  const [errorMessage, setErrorMessage] =
    useState("")
  const [loadRetryKey, setLoadRetryKey] =
    useState(0)
  const [creatingDecision, setCreatingDecision] =
    useState(false)
  const [selectedDecisionMetricKey, setSelectedDecisionMetricKey] =
    useState("")

  const selectedMetricLabels =
    weeklyReportPreference.metric_focus.map(
      (metric) =>
        getMetricOptionLabel(
          metric,
          metricOptions
      )
    )
  const selectedRelationshipLabels =
    weeklyReportPreference.relationship_focus.map(
      relationshipId => {
        const relationship = relationshipOptions.find(
          option => option.id === relationshipId
        )
        return relationship
          ? `${relationship.name} · ${relationship.left.metric_column} → ${relationship.right.metric_column}`
          : `Relationship ${relationshipId}`
      }
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
  const selectedDecisionRelationship = useMemo(
    () => weeklyReportDigest?.relationships?.[0],
    [weeklyReportDigest]
  )

  async function handleCreateDigestDecision() {
    const digest = weeklyReportDigest
    const metric = selectedDecisionMetric
    const relationship = selectedDecisionRelationship
    const recommendation =
      digest?.ai_analysis?.recommendations[0]

    if (
      !user?.id ||
      !canManageWorkspaceData ||
      (!metric && !relationship) ||
      !recommendation ||
      !digest?.ai_analysis ||
      creatingDecision
    ) {
      return
    }

    const decisionPayload =
      buildAIRecommendationDecisionPayload(
        metric?.dataset_id ?? relationship?.left_dataset_id ?? 0,
        metric?.column ?? relationship?.left_metric,
        digest.ai_analysis,
        metric?.dataset_name ?? relationship?.left_dataset_name
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
      queueMicrotask(() => {
        setSetupRequestPending(false)
        setSetupUnavailable(true)
        setSupportingDataLoading(false)
        setSupportingDataUnavailable(true)
        setErrorMessage(
          "Sign in to load notification setup."
        )
      })
      return
    }

    let ignoreResult = false
    let setupTimeoutId: number | undefined
    let supportingDataTimeoutId: number | undefined

    async function loadPreference(
      userId: string
    ) {
      try {
        setWeeklyReportPreference(
          defaultWeeklyReportPreference
        )
        setMetricOptions([])
        setRelationshipOptions([])
        setWeeklyReportDigest(null)
        setStatusMessage("")
        setWarningMessage("")
        setSetupUnavailable(false)
        setSetupRequestPending(true)
        setSupportingDataUnavailable(false)
        setSupportingDataLoading(false)
        setErrorMessage("")

        setupTimeoutId = window.setTimeout(() => {
          if (!ignoreResult) {
            setSetupRequestPending(false)
            setSetupUnavailable(true)
            setSupportingDataLoading(false)
            setSupportingDataUnavailable(true)
            setErrorMessage(
              "Notification setup is taking longer than expected. Please retry."
            )
          }
        }, notificationSetupUiTimeoutMs)

        let preference: WeeklyReportPreference
        try {
          preference =
            await getWeeklyReportPreference(
              userId,
              activeWorkspaceId
            )
        } catch (error) {
          if (setupTimeoutId !== undefined) {
            window.clearTimeout(setupTimeoutId)
          }
          if (!ignoreResult) {
            setSetupUnavailable(true)
            setSupportingDataUnavailable(true)
            setErrorMessage(
              getErrorMessage(
                error,
                "Notification setup could not be loaded."
              )
            )
            setSetupRequestPending(false)
            setSupportingDataLoading(false)
          }
          return
        }

        if (ignoreResult) {
          return
        }

        if (setupTimeoutId !== undefined) {
          window.clearTimeout(setupTimeoutId)
        }

        const normalizedPreference =
          normalizeWeeklyReportPreference(
            preference
          )
        setWeeklyReportPreference(
          normalizedPreference
        )
        setSetupUnavailable(false)
        setSetupRequestPending(false)
        setErrorMessage("")
        setSupportingDataLoading(true)

        supportingDataTimeoutId = window.setTimeout(() => {
          if (!ignoreResult) {
            setSupportingDataLoading(false)
            setSupportingDataUnavailable(true)
            setWarningMessage(
              "Notification settings are ready, but the digest preview is taking longer than expected."
            )
          }
        }, digestPreviewUiTimeoutMs)

        const [
          relationshipsResult,
          digestResult,
        ] = await Promise.allSettled([
          getDatasetRelationships(
            userId,
            activeWorkspaceId,
            { notifyAvailability: false }
          ),
          getWeeklyReportDigest(
            userId,
            activeWorkspaceId,
            {
              notifyAvailability: false,
              includeAIAnalysis: false,
            }
          ),
        ])

        if (ignoreResult) {
          return
        }

        if (supportingDataTimeoutId !== undefined) {
          window.clearTimeout(supportingDataTimeoutId)
        }

        const nextMetricOptions =
          loadDatasetMetricOptions(
            digestResult.status === "fulfilled"
              ? digestResult.value.available_metrics ??
                digestResult.value.metrics
              : []
          )

        setMetricOptions(nextMetricOptions)
        setRelationshipOptions(
          relationshipsResult.status === "fulfilled"
            ? relationshipsResult.value
            : []
        )
        setWeeklyReportDigest(
          digestResult.status === "fulfilled"
            ? digestResult.value
            : null
        )
        setWeeklyReportPreference(
          reconcileMetricFocusWithOptions(
            normalizedPreference,
            nextMetricOptions
          )
        )

        const supportingDataRequestFailed =
          relationshipsResult.status === "rejected" ||
          digestResult.status === "rejected"

        setSupportingDataUnavailable(
          supportingDataRequestFailed
        )
        if (supportingDataRequestFailed) {
          setWarningMessage(
            "Notification setup loaded, but some supporting status data is temporarily unavailable."
          )
        } else {
          setWarningMessage("")
        }
      } catch (error) {
        if (!ignoreResult) {
          setSetupUnavailable(true)
          setSupportingDataUnavailable(true)
          setErrorMessage(
            getErrorMessage(
              error,
              "Notification setup could not be loaded."
            )
          )
          setSetupRequestPending(false)
          setSupportingDataLoading(false)
        }
      } finally {
        if (setupTimeoutId !== undefined) {
          window.clearTimeout(setupTimeoutId)
        }
        if (supportingDataTimeoutId !== undefined) {
          window.clearTimeout(supportingDataTimeoutId)
        }
        if (!ignoreResult) {
          setSupportingDataLoading(false)
        }
      }
    }

    void loadPreference(user.id)

    return () => {
      ignoreResult = true
      if (setupTimeoutId !== undefined) {
        window.clearTimeout(setupTimeoutId)
      }
      if (supportingDataTimeoutId !== undefined) {
        window.clearTimeout(supportingDataTimeoutId)
      }
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
    setWarningMessage("")
    setErrorMessage("")
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

    const nextTargets = {
      ...weeklyReportPreference.metric_targets,
    }

    if (currentFocus.includes(metric)) {
      delete nextTargets[metric]
    }

    updateWeeklyReportDraft({
      metric_focus: nextFocus,
      metric_targets: nextTargets,
    })
  }

  function updateMetricTarget(
    metric: string,
    value: string
  ) {
    const nextTargets = {
      ...weeklyReportPreference.metric_targets,
    }

    if (!value.trim()) {
      delete nextTargets[metric]
    } else {
      const numericValue = Number(value)
      if (!Number.isFinite(numericValue)) {
        return
      }
      nextTargets[metric] = numericValue
    }

    updateWeeklyReportDraft({
      metric_targets: nextTargets,
    })
  }

  function toggleRelationshipFocus(
    relationshipId: number
  ) {
    const currentFocus =
      weeklyReportPreference.relationship_focus
    const nextFocus = currentFocus.includes(relationshipId)
      ? currentFocus.filter(item => item !== relationshipId)
      : [...currentFocus, relationshipId]

    updateWeeklyReportDraft({
      relationship_focus: nextFocus,
    })
  }

  async function handleSave() {
    if (
      !user?.id ||
      !canManageAlertAnalysis ||
      saving
    ) {
      return
    }

    try {
      setSaving(true)
      setErrorMessage("")
      setStatusMessage("")
      setWarningMessage("")

      const savedPreference =
        await updateWeeklyReportPreference(
          {
            ...weeklyReportPreference,
            cadence: "weekly",
            recipient_emails: weeklyReportPreference.recipient_emails,
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

      try {
        setWeeklyReportDigest(
          await getWeeklyReportDigest(
            user.id,
            activeWorkspaceId,
            { notifyAvailability: false }
          )
        )
        setStatusMessage("Notification setup saved.")
      } catch {
        setStatusMessage("Notification setup saved.")
        setWarningMessage(
          "Digest preview is temporarily unavailable."
        )
      }
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

          {!setupRequestPending && (
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

      {warningMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {warningMessage}
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageAlertAnalysis}
        message="Notification setup is managed by workspace owners and approved agency owners."
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

          {setupUnavailable ? (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <p className="font-medium">
                Notification setup is temporarily unavailable.
              </p>
              <p className="mt-1">
                Retry to load your saved notification settings.
              </p>
              <button
                type="button"
                onClick={() =>
                  setLoadRetryKey(
                    currentKey => currentKey + 1
                  )
                }
                className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
              >
                Retry notification setup
              </button>
            </div>
          ) : !canManageAlertAnalysis ? (
            <ReadOnlyNotificationSummary
              preference={weeklyReportPreference}
              selectedMetricLabels={selectedMetricLabels}
              selectedRelationshipLabels={selectedRelationshipLabels}
            />
          ) : (
            <fieldset
              disabled={setupRequestPending}
              className="mt-5 space-y-4 disabled:opacity-60"
            >
              {setupRequestPending && (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800"
                >
                  Preparing your saved notification settings...
                </p>
              )}

              <div>
                <p className="text-sm font-medium text-gray-700">
                  KPI focus by dataset
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  Select the specific dataset metrics that should shape the digest.
                </p>

                {metricOptions.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {metricOptions.map((option) => (
                      <div
                        key={option.value}
                        className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                      >
                        <label className="flex min-w-0 items-start gap-2.5">
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
                              Dataset: {option.datasetName}
                            </span>
                          </span>
                        </label>

                        {weeklyReportPreference.metric_focus.includes(
                          option.value
                        ) && (
                          <div className="mt-2 pl-6">
                            <label
                              htmlFor={`alert-target-${option.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                              className="mb-1 block text-xs font-medium text-gray-600"
                            >
                              Optional KPI target
                            </label>
                            <input
                              id={`alert-target-${option.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                              type="number"
                              inputMode="decimal"
                              step="any"
                              value={
                                weeklyReportPreference.metric_targets[
                                  option.value
                                ] ?? ""
                              }
                              onChange={(event) =>
                                updateMetricTarget(
                                  option.value,
                                  event.target.value
                                )
                              }
                              placeholder="e.g. 10000"
                              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            />
                          </div>
                        )}
                      </div>
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

              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-700">
                    Cross-source relationships
                  </p>
                  <Link
                    href="/dashboard/relationships"
                    className="text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
                  >
                    Define relationships
                  </Link>
                </div>

                <p className="mt-1 text-xs text-gray-500">
                  Add confirmed relationships to this digest so AI can explain movement across datasets.
                </p>

                {relationshipOptions.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {relationshipOptions.map((relationship) => (
                      <label
                        key={relationship.id}
                        className="flex min-w-0 items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={weeklyReportPreference.relationship_focus.includes(
                            relationship.id ?? -1
                          )}
                          onChange={() => {
                            if (relationship.id) {
                              toggleRelationshipFocus(relationship.id)
                            }
                          }}
                          className="mt-0.5 h-4 w-4 accent-[var(--decisionate-brand-primary)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-gray-900">
                            {relationship.name}
                          </span>
                          <span className="mt-1 block truncate text-xs text-gray-500">
                            {relationship.left_dataset_name} · {relationship.left.metric_column} → {relationship.right_dataset_name} · {relationship.right.metric_column}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
                    No saved relationships yet. Define one to monitor cross-source evidence in this alert.
                  </p>
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
                Delivery settings, recipients, and manual sending are managed in Settings.
                {" "}
                <Link
                  href="/dashboard/settings"
                  className="font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
                >
                  Open alert delivery settings
                </Link>
              </p>
            </fieldset>
          )}
        </div>

        <div>
          <WeeklyReportDigestPreview
            digest={weeklyReportDigest}
            setupPending={setupRequestPending}
            loading={supportingDataLoading}
            unavailable={supportingDataUnavailable}
            selectedMetricLabels={selectedMetricLabels}
            onCreateDecision={
              canManageWorkspaceData &&
              Boolean(
                (selectedDecisionMetric || selectedDecisionRelationship) &&
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
                  : selectedDecisionRelationship
                    ? `${formatMetricName(selectedDecisionRelationship.left_metric)} · ${selectedDecisionRelationship.left_dataset_name} relationship`
                    : undefined
            }
            onSelectMetric={setSelectedDecisionMetricKey}
            creatingDecision={creatingDecision}
          />

        </div>
      </div>
    </div>
  )
}

function WeeklyReportDigestPreview({
  digest,
  setupPending,
  loading,
  unavailable,
  selectedMetricLabels,
  onCreateDecision,
  selectedMetricKey,
  selectedDecisionMetricLabel,
  onSelectMetric,
  creatingDecision,
}: {
  digest: WeeklyReportDigest | null
  setupPending: boolean
  loading: boolean
  unavailable: boolean
  selectedMetricLabels: string[]
  onCreateDecision?: () => void
  selectedMetricKey: string
  selectedDecisionMetricLabel?: string
  onSelectMetric: (value: string) => void
  creatingDecision: boolean
}) {
  if (setupPending) {
    return (
      <div className="h-full rounded-2xl border bg-white p-5 text-sm text-gray-500 shadow-sm">
        The digest preview will appear after notification settings load.
      </div>
    )
  }

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

  if (!digest && unavailable) {
    return (
      <div className="h-full rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm">
        Digest preview is temporarily unavailable. Your notification settings are ready.
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

      {digest.decision_template_url && (
        <Link
          href={digest.decision_template_url}
          className="mt-3 inline-flex items-center rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:opacity-80"
        >
          Start from a decision template
        </Link>
      )}

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

            {metric.target !== null &&
              metric.target !== undefined && (
                <p className="mt-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                  KPI target: {formatMetricValue(metric.target)}
                </p>
              )}
          </div>
        ))}
      </div>

      {digest.relationships.length > 0 && (
        <div className="mt-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Cross-source evidence
          </p>
          {digest.relationships.map((relationship) => (
            <div
              key={relationship.id}
              className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-sm font-medium text-blue-950">
                  {relationship.name}
                </p>
                <p className="text-sm font-semibold capitalize text-blue-900">
                  {relationship.correlation === null || relationship.correlation === undefined
                    ? relationship.relationship_strength
                    : `${relationship.direction} ${relationship.correlation.toFixed(2)}`}
                </p>
              </div>
              <p className="mt-1 text-xs text-blue-800">
                {relationship.left_dataset_name} · {relationship.left_metric} → {relationship.right_dataset_name} · {relationship.right_metric}
              </p>
              <p className="mt-2 text-xs text-blue-900">
                {relationship.matched_period_count} shared {relationship.period} periods · {relationship.method} · {relationship.aggregation}
              </p>
            </div>
          ))}
        </div>
      )}

      {digest.metrics.length === 0 && digest.relationships.length === 0 && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
          No saved KPI metrics or relationships match the current datasets yet.
        </div>
      )}

      {onCreateDecision && (digest.metrics.length > 0 || digest.relationships.length > 0) && (
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
          {digest.metrics.length > 0 ? (
            <>
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
            </>
          ) : (
            <p className="text-sm text-gray-600">
              This decision will use the selected cross-source relationship as its evidence target.
            </p>
          )}
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

function ReadOnlyNotificationSummary({
  preference,
  selectedMetricLabels,
  selectedRelationshipLabels,
}: {
  preference: WeeklyReportPreference
  selectedMetricLabels: string[]
  selectedRelationshipLabels: string[]
}) {
  const focusLabels = [
    ...selectedMetricLabels,
    ...selectedRelationshipLabels,
  ]
  return (
    <div className="mt-6 break-words rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4 text-sm text-[var(--decisionate-brand-primary-text)]">
      The workspace owner manages notification setup. Current setup:{" "}
      {preference.enabled
        ? `${preference.recipient_emails.length} recipient${preference.recipient_emails.length === 1 ? "" : "s"} every ${formatDeliveryDay(preference.delivery_day)} for ${focusLabels.join(", ") || "no selected metrics or relationships"}`
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
    metric_targets: preference.metric_targets ?? {},
    metric_focus:
      preference.metric_focus.length > 0
        ? preference.metric_focus
        : defaultWeeklyReportPreference.metric_focus,
    relationship_focus: preference.relationship_focus ?? [],
  }
}

function loadDatasetMetricOptions(
  metrics: WeeklyReportDigestMetric[]
): DatasetMetricOption[] {
  const metricOptionsByKey =
    new Map<string, DatasetMetricOption>()

  metrics.forEach((metric) => {
    const metricColumn = metric.column.trim()

    if (!metricColumn) {
      return
    }

    const metricKey = `${metric.dataset_id}:${metricColumn}`

    metricOptionsByKey.set(
      metricKey.toLowerCase(),
      {
        value: metricKey,
        column: metricColumn,
        label: formatMetricName(metricColumn),
        datasetName:
          metric.dataset_name ||
          `Dataset ${metric.dataset_id}`,
      }
    )
  })

  return Array.from(
    metricOptionsByKey.values()
  ).sort((firstOption, secondOption) =>
    firstOption.label.localeCompare(secondOption.label) ||
    firstOption.datasetName.localeCompare(secondOption.datasetName)
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
      metric_targets: {},
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
    const exactMetricValue =
      metricOptionsByKey.get(
        metric.toLowerCase()
      )

    if (exactMetricValue) {
      if (!reconciledMetricFocus.includes(exactMetricValue)) {
        reconciledMetricFocus.push(exactMetricValue)
      }
      return
    }

    metricOptions
      .filter(
        option =>
          option.column.toLowerCase() ===
          metric.toLowerCase()
      )
      .forEach(option => {
        if (!reconciledMetricFocus.includes(option.value)) {
          reconciledMetricFocus.push(option.value)
        }
      })
  })

  const focusKeys = new Set(
    reconciledMetricFocus.map(metric => metric.toLowerCase())
  )
  const metricValuesByKey = new Map(
    metricOptions.map(option => [
      option.value.toLowerCase(),
      option.value,
    ])
  )
  const reconciledMetricTargets: Record<string, number> = {}

  Object.entries(preference.metric_targets).forEach(
    ([metric, target]) => {
      const canonicalMetric = metricValuesByKey.get(
        metric.toLowerCase()
      )

      if (
        canonicalMetric &&
        focusKeys.has(canonicalMetric.toLowerCase()) &&
        target !== null &&
        Number.isFinite(target)
      ) {
        reconciledMetricTargets[canonicalMetric] = target
      }
    }
  )

  return {
    ...preference,
    metric_focus: reconciledMetricFocus,
    metric_targets: reconciledMetricTargets,
  }
}

function getMetricOptionLabel(
  metric: string,
  metricOptions: DatasetMetricOption[]
) {
  const option = metricOptions.find(
    candidate =>
      candidate.value.toLowerCase() ===
      metric.toLowerCase()
  )

  return option
    ? `${option.label} · ${option.datasetName}`
    : formatMetricName(metric)
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

function formatDeliveryDay(
  day: string
) {
  return day
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}
