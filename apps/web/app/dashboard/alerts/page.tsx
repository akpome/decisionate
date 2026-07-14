"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import {
  AlertCircle,
  Bell,
  Database,
  Target,
} from "lucide-react"

import {
  getDataSourceConnections,
  getDatasetDetails,
  getDatasets,
  getDecisionSummary,
  getWeeklyReportPreference,
  updateWeeklyReportPreference,
  type DataSourceConnection,
  type DatasetSummary,
  type DecisionSummary,
  type WeeklyReportPreference,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

type ReportDatasetMetric = {
  column: string
  total?: number
  average?: number
  min?: number
  max?: number
  minimum?: number
  maximum?: number
}

type ReportDatasetRow =
  Record<string, string | number | boolean | null | undefined>

type ReportDatasetDetails = {
  file_name: string
  metrics?: ReportDatasetMetric[]
  preview?: ReportDatasetRow[]
  chart?: {
    data?: ReportDatasetRow[]
    x_key?: string
    y_key?: string
  }
}

const defaultWeeklyReportPreference: WeeklyReportPreference = {
  enabled: false,
  cadence: "weekly",
  delivery_day: "monday",
  recipient_emails: [],
  metric_focus: [
    "revenue",
    "customers",
  ],
  include_recommendations: true,
}

const reportMetricOptions = [
  {
    value: "revenue",
    label: "Revenue",
  },
  {
    value: "customers",
    label: "Customer growth / decline",
  },
  {
    value: "profit",
    label: "Profit",
  },
  {
    value: "expenses",
    label: "Expenses",
  },
]

export default function AlertsPage() {
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    isClientWorkspace,
  } = useWorkspaceAccess(user?.id)
  const [decisionSummary, setDecisionSummary] =
    useState<DecisionSummary | null>(null)
  const [connections, setConnections] =
    useState<DataSourceConnection[]>([])
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [reportDataset, setReportDataset] =
    useState<ReportDatasetDetails | null>(null)
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
  const [savingReportSetup, setSavingReportSetup] =
    useState(false)
  const [reportSetupStatus, setReportSetupStatus] =
    useState("")
  const [alertsError, setAlertsError] =
    useState("")
  const [loading, setLoading] =
    useState(true)

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadAlerts(
      userId: string
    ) {
      setLoading(true)

      const [
        summaryResult,
        connectionResult,
        datasetResult,
        weeklyReportResult,
      ] = await Promise.allSettled([
        getDecisionSummary(
          userId,
          activeWorkspaceId
        ),
        getDataSourceConnections(
          userId,
          activeWorkspaceId
        ),
        getDatasets(
          userId,
          activeWorkspaceId
        ),
        getWeeklyReportPreference(
          userId,
          activeWorkspaceId
        ),
      ])

      if (ignoreResult) return

      if (summaryResult.status === "fulfilled") {
        setDecisionSummary(summaryResult.value)
      }

      if (connectionResult.status === "fulfilled") {
        setConnections(connectionResult.value)
      }

      if (datasetResult.status === "fulfilled") {
        setDatasets(datasetResult.value)

        const previewDataset =
          datasetResult.value[0]

        if (previewDataset) {
          try {
            const detailData =
              await getDatasetDetails(
                previewDataset.id,
                userId,
                activeWorkspaceId
              ) as ReportDatasetDetails

            if (!ignoreResult) {
              setReportDataset(detailData)
            }
          } catch (error) {
            console.error(error)

            if (!ignoreResult) {
              setReportDataset(null)
            }
          }
        } else {
          setReportDataset(null)
        }
      }

      if (weeklyReportResult.status === "fulfilled") {
        setWeeklyReportPreference(
          weeklyReportResult.value
        )
        setRecipientEmailText(
          weeklyReportResult.value.recipient_emails.join(
            "\n"
          )
        )
      }

      const failedResult = [
        summaryResult,
        connectionResult,
        datasetResult,
        weeklyReportResult,
      ].find(
        (result) => result.status === "rejected"
      )

      setAlertsError(
        failedResult?.status === "rejected"
          ? getErrorMessage(
            failedResult.reason,
            "Could not load alerts."
          )
          : ""
      )
      setLoading(false)
    }

    void loadAlerts(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  const decisionActionCount =
    getDecisionActionCount(decisionSummary)
  const connectionIssueCount =
    connections.filter(
      needsConnectionAttention
    ).length
  const hasDatasets =
    datasets.length > 0
  const activeAlertCount =
    decisionActionCount +
    connectionIssueCount +
    (hasDatasets ? 0 : 1)
  const weeklyReportRecipientCount =
    weeklyReportPreference.recipient_emails.length

  function updateWeeklyReportDraft(
    patch: Partial<WeeklyReportPreference>
  ) {
    setWeeklyReportPreference(
      (currentPreference) => ({
        ...currentPreference,
        ...patch,
      })
    )
    setReportSetupStatus("")
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
        : [
          "revenue",
          "customers",
        ],
    })
  }

  async function handleSaveWeeklyReportSetup() {
    if (
      !user?.id ||
      !canManageWorkspaceData ||
      savingReportSetup
    ) {
      return
    }

    setSavingReportSetup(true)
    setReportSetupStatus("")

    try {
      const payload = {
        ...weeklyReportPreference,
        recipient_emails:
          parseRecipientEmailText(
            recipientEmailText
          ),
      }
      const savedPreference =
        await updateWeeklyReportPreference(
          payload,
          user.id,
          activeWorkspaceId
        )

      setWeeklyReportPreference(
        savedPreference
      )
      setRecipientEmailText(
        savedPreference.recipient_emails.join(
          "\n"
        )
      )
      setReportSetupStatus(
        "Weekly report setup saved."
      )
    } catch (error) {
      console.error(error)
      setReportSetupStatus(
        getErrorMessage(
          error,
          "Could not save weekly report setup."
        )
      )
    } finally {
      setSavingReportSetup(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-blue-600">
              Monitoring
            </p>

            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              Alerts
            </h1>

            <p className="mt-3 max-w-3xl text-gray-600">
              Monitor decision follow-up, data-source readiness, and workspace data availability from one place.
            </p>

            {isClientWorkspace && (
              <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Client portal view: your agency manages data setup and connection fixes for this workspace.
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <Bell size={28} />
          </div>
        </div>
      </div>

      {alertsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {alertsError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <AlertMetric
          label="Active Alerts"
          value={loading ? "…" : activeAlertCount.toLocaleString()}
          tone={activeAlertCount > 0 ? "amber" : "green"}
        />
        <AlertMetric
          label="Decision Follow-ups"
          value={loading ? "…" : decisionActionCount.toLocaleString()}
          tone={decisionActionCount > 0 ? "amber" : "green"}
        />
        <AlertMetric
          label="Connection Issues"
          value={loading ? "…" : connectionIssueCount.toLocaleString()}
          tone={connectionIssueCount > 0 ? "amber" : "green"}
        />
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-blue-600">
              Weekly Email Report
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              Revenue, customer movement, and recommended actions
            </h2>

            <p className="mt-2 max-w-3xl text-sm text-gray-500">
              Set up the weekly agency-branded report that should eventually be sent by email. This stores the schedule and recipients now; delivery automation comes next.
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

        {!canManageWorkspaceData ? (
          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
            Your agency manages this weekly email report setup. Current setup:{" "}
            {weeklyReportPreference.enabled
              ? `${weeklyReportRecipientCount} recipient${weeklyReportRecipientCount === 1 ? "" : "s"} every ${formatDeliveryDay(weeklyReportPreference.delivery_day)}`
              : "not enabled yet"}
            .
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
              <input
                type="checkbox"
                checked={weeklyReportPreference.enabled}
                onChange={(event) =>
                  updateWeeklyReportDraft({
                    enabled: event.target.checked,
                  })
                }
                className="h-4 w-4"
              />

              <span>
                <span className="block text-sm font-medium text-gray-900">
                  Send weekly email report
                </span>
                <span className="block text-sm text-gray-500">
                  Weekly only for the MVP. Email delivery will use this saved setup once delivery is connected.
                </span>
              </span>
            </label>

            <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Delivery day
                </label>

                <select
                  value={weeklyReportPreference.delivery_day}
                  onChange={(event) =>
                    updateWeeklyReportDraft({
                      delivery_day:
                        event.target.value as WeeklyReportPreference["delivery_day"],
                    })
                  }
                  className="h-11 w-full rounded-xl border px-3 text-sm"
                >
                  {[
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                  ].map((day) => (
                    <option
                      key={day}
                      value={day}
                    >
                      {formatDeliveryDay(day)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Recipients
                </label>

                <textarea
                  value={recipientEmailText}
                  onChange={(event) => {
                    setRecipientEmailText(
                      event.target.value
                    )
                    setReportSetupStatus("")
                  }}
                  rows={4}
                  placeholder="owner@agency.com&#10;client@example.com"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                />

                <p className="mt-1 text-xs text-gray-500">
                  Add one recipient per line or separate them with commas.
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">
                Report focus
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                {reportMetricOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm"
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
                      className="h-4 w-4"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
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
                className="h-4 w-4"
              />

              <span className="text-sm text-gray-700">
                Include recommended actions in the weekly report
              </span>
            </label>

            {reportSetupStatus && (
              <p className="text-sm font-medium text-gray-700">
                {reportSetupStatus}
              </p>
            )}

            <button
              type="button"
              onClick={handleSaveWeeklyReportSetup}
              disabled={savingReportSetup}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
            >
              {savingReportSetup
                ? "Saving..."
                : "Save Weekly Report Setup"}
            </button>
          </div>
        )}
      </div>

      <WeeklyReportPreview
        preference={weeklyReportPreference}
        dataset={reportDataset}
        datasetCount={datasets.length}
        decisionActionCount={decisionActionCount}
        connectionIssueCount={connectionIssueCount}
        loading={loading}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <AlertWorkflowCard
          title="Decision action needed"
          description="Review pending outcomes, pending learning, and overdue reviews."
          href="/dashboard/action-needed"
          action="Open action queue"
          icon={<Target size={20} />}
          status={
            decisionActionCount > 0
              ? `${decisionActionCount} item${decisionActionCount === 1 ? "" : "s"} need attention`
              : "No decision follow-up alerts"
          }
          tone={decisionActionCount > 0 ? "amber" : "green"}
        />

        <AlertWorkflowCard
          title="Connection setup"
          description={
            canManageWorkspaceData
              ? "Configure saved data-source connections that still need setup details or credentials."
              : "Connection setup is managed by your agency for this workspace."
          }
          href="/dashboard/connections"
          action={
            canManageWorkspaceData
              ? "Manage connections"
              : "View connections"
          }
          icon={<Database size={20} />}
          status={
            connectionIssueCount > 0
              ? `${connectionIssueCount} connection${connectionIssueCount === 1 ? "" : "s"} need setup`
              : "Connections ready"
          }
          tone={connectionIssueCount > 0 ? "amber" : "green"}
        />

        <AlertWorkflowCard
          title="Workspace data"
          description={
            hasDatasets
              ? "Datasets are available for dashboards, forecasts, reports, and decisions."
              : canManageWorkspaceData
                ? "Upload or pull a dataset before analytics workflows can produce useful output."
                : "Your agency has not added datasets to this workspace yet."
          }
          href="/dashboard/datasets"
          action={
            hasDatasets
              ? "Review datasets"
              : canManageWorkspaceData
                ? "Add dataset"
                : "View datasets"
          }
          icon={<AlertCircle size={20} />}
          status={
            hasDatasets
              ? `${datasets.length} dataset${datasets.length === 1 ? "" : "s"} available`
              : "No datasets yet"
          }
          tone={hasDatasets ? "green" : "amber"}
        />
      </div>
    </div>
  )
}

function AlertMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "green" | "amber"
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">
        {label}
      </p>

      <p
        className={`mt-2 text-3xl font-semibold ${
          tone === "green"
            ? "text-green-700"
            : "text-amber-700"
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function AlertWorkflowCard({
  title,
  description,
  href,
  action,
  icon,
  status,
  tone,
}: {
  title: string
  description: string
  href: string
  action: string
  icon: React.ReactNode
  status: string
  tone: "green" | "amber"
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
            {icon}
          </div>

          <h2 className="text-lg font-semibold">
            {title}
          </h2>
        </div>

        <p className="mt-4 flex-1 text-sm text-gray-500">
          {description}
        </p>

        <span
          className={`mt-4 w-fit rounded-full border px-3 py-1 text-xs font-medium ${
            tone === "green"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {status}
        </span>

        <span className="mt-5 text-sm font-medium text-blue-600">
          {action} →
        </span>
      </div>
    </Link>
  )
}

function WeeklyReportPreview({
  preference,
  dataset,
  datasetCount,
  decisionActionCount,
  connectionIssueCount,
  loading,
}: {
  preference: WeeklyReportPreference
  dataset: ReportDatasetDetails | null
  datasetCount: number
  decisionActionCount: number
  connectionIssueCount: number
  loading: boolean
}) {
  const focusItems =
    buildWeeklyReportFocusItems(
      preference,
      dataset
    )
  const recommendedActions =
    buildRecommendedActions({
      dataset,
      datasetCount,
      decisionActionCount,
      connectionIssueCount,
      preference,
    })

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-blue-600">
            Report Preview
          </p>

          <h2 className="mt-2 text-2xl font-semibold">
            What the weekly email will summarize
          </h2>

          <p className="mt-2 max-w-3xl text-sm text-gray-500">
            Preview generated from the first available dataset in this workspace. Delivery automation will send this kind of summary once email is connected.
          </p>
        </div>

        <span className="w-fit rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
          {dataset?.file_name ||
            (loading
              ? "Loading dataset"
              : "No dataset selected")}
        </span>
      </div>

      {!dataset && !loading ? (
        <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
          Add a dataset before Decisionate can produce revenue, customer movement, and recommended-action report content.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Metric Highlights
            </h3>

            {focusItems.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-gray-100 bg-gray-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">
                    {item.label}
                  </p>

                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                      item.detected
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {item.detected
                      ? "Detected"
                      : "Not found"}
                  </span>
                </div>

                <p className="mt-2 text-sm text-gray-600">
                  {item.summary}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Recommended Actions
            </h3>

            {recommendedActions.map((action) => (
              <div
                key={action}
                className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800"
              >
                {action}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function buildWeeklyReportFocusItems(
  preference: WeeklyReportPreference,
  dataset: ReportDatasetDetails | null
) {
  const focusValues =
    preference.metric_focus.length
      ? preference.metric_focus
      : [
        "revenue",
        "customers",
      ]

  return focusValues.map((focus) => {
    const config =
      getReportMetricConfig(focus)
    const metric =
      findReportMetric(
        dataset,
        config.keywords
      )
    const trend =
      metric && dataset
        ? summarizeMetricTrend(
          dataset,
          metric.column
        )
        : ""

    if (!metric) {
      return {
        label: config.label,
        detected: false,
        summary:
          `No ${config.label.toLowerCase()} metric was detected. Add a column such as ${config.examples.join(", ")} to include it in the weekly report.`,
      }
    }

    return {
      label: config.label,
      detected: true,
      summary:
        `${formatMetricName(metric.column)} is available with ${formatMetricTotal(metric)}. ${trend}`.trim(),
    }
  })
}

function buildRecommendedActions({
  dataset,
  datasetCount,
  decisionActionCount,
  connectionIssueCount,
  preference,
}: {
  dataset: ReportDatasetDetails | null
  datasetCount: number
  decisionActionCount: number
  connectionIssueCount: number
  preference: WeeklyReportPreference
}) {
  if (!preference.include_recommendations) {
    return [
      "Recommended actions are disabled for this weekly report setup.",
    ]
  }

  const actions: string[] = []

  if (datasetCount === 0) {
    actions.push(
      "Add a dataset so the weekly report can include metric movement and concrete business recommendations."
    )
  }

  if (connectionIssueCount > 0) {
    actions.push(
      "Resolve connection setup issues so future weekly reports can use fresh business data."
    )
  }

  if (decisionActionCount > 0) {
    actions.push(
      "Clear the decision action queue: review pending outcomes, overdue reviews, and missing learning notes."
    )
  }

  const revenueMetric =
    findReportMetric(
      dataset,
      getReportMetricConfig("revenue").keywords
    )
  const customerMetric =
    findReportMetric(
      dataset,
      getReportMetricConfig("customers").keywords
    )

  if (
    revenueMetric &&
    dataset &&
    getMetricTrendDirection(
      dataset,
      revenueMetric.column
    ) === "down"
  ) {
    actions.push(
      "Investigate the revenue decline: compare recent campaigns, pricing changes, and customer segments before the next client review."
    )
  }

  if (
    customerMetric &&
    dataset &&
    getMetricTrendDirection(
      dataset,
      customerMetric.column
    ) === "down"
  ) {
    actions.push(
      "Review customer acquisition and retention drivers because customer movement is trending down."
    )
  }

  if (actions.length === 0) {
    actions.push(
      "No urgent action detected. Use the weekly report to keep the client aligned on trend movement and next decisions."
    )
  }

  return actions.slice(0, 4)
}

function getReportMetricConfig(
  focus: string
) {
  if (focus === "customers") {
    return {
      label: "Customer growth / decline",
      keywords: [
        "customer",
        "client",
        "user",
        "account",
      ],
      examples: [
        "customers",
        "new_customers",
        "active_clients",
      ],
    }
  }

  if (focus === "profit") {
    return {
      label: "Profit",
      keywords: [
        "profit",
        "margin",
        "net income",
      ],
      examples: [
        "profit",
        "gross_margin",
        "net_income",
      ],
    }
  }

  if (focus === "expenses") {
    return {
      label: "Expenses",
      keywords: [
        "expense",
        "cost",
        "spend",
      ],
      examples: [
        "expenses",
        "cost",
        "ad_spend",
      ],
    }
  }

  return {
    label: "Revenue",
    keywords: [
      "revenue",
      "sales",
      "income",
      "arr",
    ],
    examples: [
      "revenue",
      "sales",
      "monthly_revenue",
    ],
  }
}

function findReportMetric(
  dataset: ReportDatasetDetails | null,
  keywords: string[]
) {
  if (!dataset?.metrics?.length) {
    return null
  }

  return dataset.metrics.find((metric) => {
    const cleanColumn =
      metric.column
        .trim()
        .toLowerCase()
        .replaceAll("_", " ")

    return keywords.some((keyword) =>
      cleanColumn.includes(keyword)
    )
  }) ?? null
}

function summarizeMetricTrend(
  dataset: ReportDatasetDetails,
  column: string
) {
  const values =
    getMetricSeriesValues(
      dataset,
      column
    )

  if (values.length < 2) {
    return "Trend direction will appear once at least two rows are available."
  }

  const firstValue = values[0]
  const latestValue =
    values[values.length - 1]
  const direction =
    latestValue > firstValue
      ? "up"
      : latestValue < firstValue
        ? "down"
        : "flat"

  if (direction === "flat") {
    return `Trend is flat at ${formatReportNumber(latestValue)}.`
  }

  const changeText =
    firstValue !== 0
      ? ` (${formatReportNumber(
        ((latestValue - firstValue) /
          Math.abs(firstValue)) *
          100
      )}%)`
      : ""

  return `Trend is ${direction} from ${formatReportNumber(firstValue)} to ${formatReportNumber(latestValue)}${changeText}.`
}

function getMetricTrendDirection(
  dataset: ReportDatasetDetails,
  column: string
) {
  const values =
    getMetricSeriesValues(
      dataset,
      column
    )

  if (values.length < 2) {
    return "flat"
  }

  const firstValue = values[0]
  const latestValue =
    values[values.length - 1]

  if (latestValue > firstValue) {
    return "up"
  }

  if (latestValue < firstValue) {
    return "down"
  }

  return "flat"
}

function getMetricSeriesValues(
  dataset: ReportDatasetDetails,
  column: string
) {
  const rows =
    dataset.preview?.length
      ? dataset.preview
      : dataset.chart?.data ?? []

  return rows
    .map((row) =>
      getNumericCellValue(row[column])
    )
    .filter(
      (value): value is number =>
        typeof value === "number" &&
        Number.isFinite(value)
    )
}

function getNumericCellValue(
  value: string | number | boolean | null | undefined
) {
  if (typeof value === "number") {
    return value
  }

  if (typeof value !== "string") {
    return null
  }

  const numericValue =
    Number(
      value.replace(/[$,%\s,]/g, "")
    )

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function formatMetricTotal(
  metric: ReportDatasetMetric
) {
  if (typeof metric.total === "number") {
    return `total ${formatReportNumber(metric.total)}`
  }

  if (typeof metric.average === "number") {
    return `average ${formatReportNumber(metric.average)}`
  }

  return "summary values available"
}

function formatMetricName(
  metric: string
) {
  return metric
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

function formatReportNumber(
  value: number
) {
  return new Intl.NumberFormat(
    undefined,
    {
      maximumFractionDigits: 1,
    }
  ).format(value)
}

function getDecisionActionCount(
  summary: DecisionSummary | null
) {
  if (!summary) {
    return 0
  }

  return (
    summary.attention_required +
    summary.outcomes_pending +
    summary.learning_pending +
    summary.reviews_overdue
  )
}

function needsConnectionAttention(
  connection: DataSourceConnection
) {
  return (
    connection.status !== "connected" ||
    !connection.has_config ||
    connection.environment_configured === false
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
