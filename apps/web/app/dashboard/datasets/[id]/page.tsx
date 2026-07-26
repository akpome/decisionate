"use client"

import {
  useEffect,
  useState,
} from "react"
import {
  useParams,
  useRouter,
} from "next/navigation"
import Link from "next/link"
import {
  useAuth,
} from "@clerk/nextjs"
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  FileText,
  LineChart,
  Sparkles,
} from "lucide-react"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  MetricSelector,
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import { InsightCard } from "@/features/insights/components/insight-card"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"
import {
  AnalysisStatus,
} from "@/features/ai/components/analysis-status"
import {
  buildAIRecommendationDecisionPayload,
} from "@/features/decisions/lib/ai-decision-handoff"
import { MetricTrendChart } from "@/features/dashboard/components/metric-trend-chart"

import {
  createDecision,
  getDatasetAIAnalysis,
  getDatasetDetails,
  getDatasetPreference,
  updateDatasetPreference,
  type AIAnalysis,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  formatSourceValue,
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import {
  buildInsightDecisionPayload,
} from "@/features/decisions/lib/decision-handoff"

type DatasetCellValue =
  | string
  | number
  | boolean
  | null
  | undefined

type DatasetRow =
  Record<string, DatasetCellValue>

type DatasetMetric = {
  column: string
  total: number
  average: number
}

type DatasetInsight = {
  column?: string
  type?: string
  title: string
  description: string
}

type DatasetDetails = {
  file_name: string
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  row_count: number
  column_count: number
  metrics?: DatasetMetric[]
  insights?: DatasetInsight[]
  ai_analysis?: AIAnalysis
  chart?: {
    data: DatasetRow[]
    x_key: string
    y_key: string
  }
  preview?: DatasetRow[]
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

function getDatasetRouteId(
  routeId: string | string[] | undefined
) {
  const rawRouteId =
    Array.isArray(routeId)
      ? routeId[0]
      : routeId

  if (!rawRouteId) {
    return null
  }

  const datasetId = Number(rawRouteId)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : null
}

function formatPreviewValue(
  value: DatasetCellValue
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—"
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False"
  }

  return String(value)
}

export default function DatasetDetailsPage() {
  const params = useParams()
  const router = useRouter()

  const [dataset, setDataset] =
    useState<DatasetDetails | null>(null)
  const [selectedMetric, setSelectedMetric] =
    useState<string>()

  const [loading, setLoading] =
    useState(true)
  const [metricAnalysisLoading, setMetricAnalysisLoading] =
    useState(false)
  const [metricAnalysisError, setMetricAnalysisError] =
    useState(false)
  const [metricAnalysisRetryKey, setMetricAnalysisRetryKey] =
    useState(0)
  const [errorMessage, setErrorMessage] =
    useState("")
  const [preferenceWarning, setPreferenceWarning] =
    useState("")
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [creatingDecisionKey, setCreatingDecisionKey] =
    useState<string>()

  const {
    isLoaded: authLoaded,
    isSignedIn,
    userId,
  } = useAuth()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(userId ?? undefined)
  const {
    canManageWorkspaceData,
  } = useWorkspaceAccess(userId ?? undefined)

  useEffect(() => {
    if (!authLoaded) {
      return
    }

    if (!isSignedIn || !userId) {
      queueMicrotask(() => {
        setLoading(false)
        setErrorMessage(
          "Sign in to view this dataset."
        )
      })
      return
    }

    const currentUserId = userId
    const datasetId =
      getDatasetRouteId(params.id)
    let ignoreResult = false

    async function loadDataset() {
      setDataset(null)
      setSelectedMetric(undefined)
      setErrorMessage("")
      setPreferenceWarning("")
      setLoading(true)

      if (datasetId === null) {
        if (ignoreResult) {
          return
        }

        setDataset(null)
        setErrorMessage("Dataset not found.")
        setLoading(false)
        return
      }

      try {
        const [
          datasetResult,
          preferenceResult,
        ] = await Promise.allSettled([
          getDatasetDetails(
            datasetId,
            currentUserId,
            activeWorkspaceId
          ),
          getDatasetPreference(
            currentUserId,
            activeWorkspaceId
          ),
        ])

        if (ignoreResult) {
          return
        }

        if (datasetResult.status === "rejected") {
          throw datasetResult.reason
        }

        const data = datasetResult.value
        const preference =
          preferenceResult.status === "fulfilled"
            ? preferenceResult.value
            : undefined

        if (preferenceResult.status === "rejected") {
          setPreferenceWarning(
            `${getErrorMessage(
              preferenceResult.reason,
              "Dataset preference service is unavailable."
            )} Select a metric manually if needed.`
          )
        } else {
          setPreferenceWarning("")
        }

        setDataset(data)
        setSelectedMetric(
          preference?.selected_dataset_id === datasetId
            ? preference.selected_metric ??
                undefined
            : undefined
        )
        setErrorMessage("")
      } catch (error) {
        if (!ignoreResult) {
          console.error(error)
          setDataset(null)
          setPreferenceWarning("")
          setErrorMessage(
            getErrorMessage(
              error,
              "Could not load dataset."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoading(false)
        }
      }
    }

    loadDataset()

    return () => {
      ignoreResult = true
      setLoading(false)
    }
  }, [
    params.id,
    activeWorkspaceId,
    authLoaded,
    datasetLoadRetryKey,
    isSignedIn,
    userId,
    workspaceVersion,
  ])

  useEffect(() => {
    const datasetId = getDatasetRouteId(params.id)
    const availableMetricColumns = new Set(
      dataset?.metrics?.map(metric => metric.column) ?? []
    )

    if (
      !userId ||
      !datasetId ||
      !selectedMetric ||
      availableMetricColumns.has(selectedMetric)
    ) {
      return
    }

    const safeDatasetId = datasetId
    const currentUserId = userId
    async function clearStaleMetric() {
      setSelectedMetric(undefined)

      try {
        await updateDatasetPreference(
          safeDatasetId,
          currentUserId,
          "",
          undefined,
          undefined,
          activeWorkspaceId
        )
      } catch {
        // A stale metric should not block dataset detail views.
      }
    }

    void clearStaleMetric()
  }, [
    activeWorkspaceId,
    dataset,
    params.id,
    selectedMetric,
    userId,
  ])

  const datasetId =
    getDatasetRouteId(params.id)
  const metricColumns =
    dataset?.metrics?.map(
      metric => metric.column
    ) ?? []
  const effectiveSelectedMetric =
    selectedMetric &&
    metricColumns.includes(selectedMetric)
      ? selectedMetric
      : undefined

  useEffect(() => {
    if (
      !userId ||
      !datasetId ||
      !effectiveSelectedMetric
    ) {
      queueMicrotask(() => {
        setMetricAnalysisLoading(false)
        setMetricAnalysisError(false)
      })
      return
    }

    const safeDatasetId = datasetId
    const currentUserId = userId
    const metric = effectiveSelectedMetric
    let ignoreResult = false
    queueMicrotask(() => {
      setMetricAnalysisLoading(true)
      setMetricAnalysisError(false)
    })

    async function loadMetricAIAnalysis() {
      try {
        const result =
          await getDatasetAIAnalysis(
            safeDatasetId,
            currentUserId,
            activeWorkspaceId,
            metric
          )

        if (!ignoreResult) {
          setDataset(current =>
            current
              ? {
                ...current,
                ai_analysis: {
                  ...result.ai_analysis,
                  metric: result.metric,
                },
              }
              : current
          )
        }
      } catch {
        if (!ignoreResult) {
          setMetricAnalysisError(true)
        }
      } finally {
        if (!ignoreResult) {
          setMetricAnalysisLoading(false)
        }
      }
    }

    void loadMetricAIAnalysis()

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    datasetId,
    effectiveSelectedMetric,
    metricAnalysisRetryKey,
    userId,
  ])

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border bg-white px-4 py-3 text-sm text-gray-600"
      >
        Loading dataset...
      </div>
    )
  }

  if (!dataset) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
      >
        <span>
          {errorMessage ||
            "Dataset not found."}
        </span>

        {getDatasetRouteId(params.id) !== null && (
          <button
            type="button"
            onClick={() =>
              setDatasetLoadRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50"
          >
            Retry dataset load
          </button>
        )}
      </div>
    )
  }

  const sourceDetails =
    getDatasetSourceDetails(
      dataset.source_type,
      dataset.source_config,
      dataset.source_label
    )
  const metrics =
    dataset.metrics ?? []
  const displayedMetrics =
    prioritizeDatasetMetrics(
      metrics,
      effectiveSelectedMetric
    )
  const displayedInsights =
    getMetricFilteredDatasetInsights(
      dataset.insights ?? [],
      effectiveSelectedMetric
    )
  const aiRecommendationMetric =
    effectiveSelectedMetric ||
    (metricColumns.length === 1
      ? metricColumns[0]
      : undefined)

  async function handleMetricChange(
    metric: string | undefined
  ) {
    const previousMetric = selectedMetric
    setSelectedMetric(metric)
    setErrorMessage("")

    if (datasetId && userId) {
      try {
        await updateDatasetPreference(
          datasetId,
          userId,
          metric ?? "",
          undefined,
          undefined,
          activeWorkspaceId
        )
        setPreferenceWarning("")
      } catch (error) {
        setSelectedMetric(previousMetric)
        setErrorMessage(
          getErrorMessage(
            error,
            "Could not save dataset metric preference."
          )
        )
      }
    }
  }

  async function handleCreateDecision(
    insight: DatasetInsight,
    insightKey: string
  ) {
    if (
      !userId ||
      !datasetId ||
      !canManageWorkspaceData ||
      creatingDecisionKey
    ) {
      return
    }

    try {
      setCreatingDecisionKey(insightKey)
      setErrorMessage("")

      const createdDecision =
        await createDecision(
          buildInsightDecisionPayload(
            datasetId,
            insight,
            effectiveSelectedMetric,
            dataset?.file_name
          ),
          userId,
          activeWorkspaceId
        )

      router.push(
        `/dashboard/decisions/${createdDecision.id}`
      )
    } catch (error) {
      setErrorMessage(
        getErrorMessage(
          error,
          "Unable to create a decision from this insight."
        )
      )
    } finally {
      setCreatingDecisionKey(undefined)
    }
  }

  async function handleCreateAIRecommendation() {
    const analysis = dataset?.ai_analysis
    const recommendation =
      analysis?.recommendations[0]

    if (
      !userId ||
      !datasetId ||
      !analysis ||
      !aiRecommendationMetric ||
      !recommendation ||
      !canManageWorkspaceData ||
      creatingDecisionKey
    ) {
      return
    }

    const decisionPayload =
      buildAIRecommendationDecisionPayload(
        datasetId,
        aiRecommendationMetric,
        analysis,
        dataset.file_name
      )

    if (!decisionPayload) {
      return
    }

    try {
      setCreatingDecisionKey("ai-analysis")
      setErrorMessage("")

      const createdDecision =
        await createDecision(
          decisionPayload,
          userId,
          activeWorkspaceId
        )

      router.push(
        `/dashboard/decisions/${createdDecision.id}`
      )
    } catch (error) {
      setErrorMessage(
        getErrorMessage(
          error,
          "Unable to create a decision from the analysis."
        )
      )
    } finally {
      setCreatingDecisionKey(undefined)
    }
  }

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        leading={
          <Link
            href="/dashboard/datasets"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft size={16} />
            Back to Datasets
          </Link>
        }
        title={dataset.file_name}
        description={
          <>
            {dataset.row_count} rows •{" "}
            {dataset.column_count} columns •{" "}
            {sourceDetails.label}
            {sourceDetails.originalFileName && (
              <span className="mt-1 block break-all text-xs text-gray-400">
                Original file: {sourceDetails.originalFileName}
              </span>
            )}
          </>
        }
        actions={
          <div className="flex min-w-0 flex-wrap gap-3">
        <Link
          href={`/dashboard/forecasts?dataset=${datasetId ?? ""}`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
        >
          <LineChart size={16} />
          Forecast
        </Link>

        <Link
          href={`/dashboard?dataset=${datasetId ?? ""}`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
        >
          <BarChart3 size={16} />
          Dashboard
        </Link>

        <Link
          href={`/dashboard/insights?dataset=${datasetId ?? ""}`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
        >
          <Sparkles size={16} />
          Insights
        </Link>

        <Link
          href={`/dashboard/reports?dataset=${datasetId ?? ""}`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
        >
          <FileText size={16} />
          Report
        </Link>

        {canManageWorkspaceData && (
          <Link
            href={`/dashboard/decisions/new?dataset=${datasetId ?? ""}&returnTo=${encodeURIComponent(`/dashboard/datasets/${datasetId ?? ""}`)}`}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
          >
            <ClipboardList size={16} />
            New Decision
          </Link>
        )}
          </div>
        }
      />

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Dataset metric
            </h2>

            <p className="text-sm text-gray-500">
              Choose a metric to focus the summary cards, insights, and trend chart.
            </p>
          </div>
        </div>

        <label className="mt-5 block max-w-xl space-y-2">
          <span className="text-sm font-medium text-gray-700">
            Metric
          </span>

          <MetricSelector
            ariaLabel="Select dataset metric"
            metrics={metricColumns}
            value={effectiveSelectedMetric}
            disabled={
              metricColumns.length === 0
            }
            placeholder={
              metricColumns.length === 0
                ? "No numeric metrics"
                : "All Metrics"
            }
            onChange={(metric) => {
              void handleMetricChange(metric)
            }}
          />
        </label>

        <p className="mt-3 max-w-full break-words text-sm text-gray-500">
          {effectiveSelectedMetric
            ? `Focused on ${formatMetricLabel(effectiveSelectedMetric)}.`
            : "Showing all detected numeric metrics."}
        </p>
      </section>

      {preferenceWarning && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{preferenceWarning}</span>

          <button
            type="button"
            onClick={() =>
              setDatasetLoadRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
          >
            Retry preference
          </button>
        </div>
      )}

      {metricAnalysisLoading && (
        <AnalysisStatus kind="loading" />
      )}

      {metricAnalysisError && (
        <AnalysisStatus
          kind="unavailable"
          onRetry={() =>
            setMetricAnalysisRetryKey(
              currentKey => currentKey + 1
            )
          }
        />
      )}

      {!metricAnalysisLoading &&
        dataset.ai_analysis &&
        (!effectiveSelectedMetric ||
          dataset.ai_analysis.metric === effectiveSelectedMetric) && (
        <AIAnalysisPanel
          analysis={dataset.ai_analysis}
          title="Dataset analysis"
          metric={effectiveSelectedMetric}
          className="rounded-2xl p-5 shadow-sm sm:p-6"
          onCreateDecision={
            canManageWorkspaceData &&
            aiRecommendationMetric &&
            dataset.ai_analysis.recommendations.length > 0
              ? () => {
                void handleCreateAIRecommendation()
              }
              : undefined
          }
          creatingDecision={
            creatingDecisionKey === "ai-analysis"
          }
        />
      )}

      {sourceDetails.config && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-xl font-semibold">
            Source
          </h2>

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <AnalyticsField
              label="Ingestion"
              value={
                sourceDetails.ingestionMode ||
                "Unknown"
              }
            />
            <AnalyticsField
              label="Format"
              value={formatSourceValue(
                sourceDetails.format
              )}
            />
            <AnalyticsField
              label="Original file"
              value={
                sourceDetails.originalFileName ||
                dataset.file_name
              }
            />
            <AnalyticsField
              label="Extension"
              value={
                sourceDetails.fileExtension ||
                "Unknown"
              }
            />
          </div>
        </div>
      )}

      {/* Metrics */}

      <div>
        <h2 className="mb-4 text-2xl font-bold">
          Metrics
        </h2>

        {displayedMetrics.length ? (
          <div className="grid gap-6 md:grid-cols-3">
            {displayedMetrics.map((metric) => (
                <MetricCard
                  key={metric.column}
                  title={formatMetricLabel(metric.column)}
                  value={metric.total}
                description={`Average ${metric.average}`}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-gray-50 p-4 text-sm text-gray-500">
            No numeric metrics were detected for this dataset yet.
          </div>
        )}
      </div>

      {/* Insights */}

      <div>
        <h2 className="mb-4 text-2xl font-bold">
          Insights
        </h2>

        {displayedInsights.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {displayedInsights.map((
              insight,
              index: number
            ) => (
              <InsightCard
                key={`${insight.title}-${index}`}
                insight={insight}
                label={insight.type || "Insight"}
                onCreateDecision={
                  canManageWorkspaceData
                    ? () => {
                      void handleCreateDecision(
                        insight,
                        `${index}:${insight.title}`
                      )
                    }
                    : undefined
                }
                creatingDecision={
                  creatingDecisionKey ===
                  `${index}:${insight.title}`
                }
                actionDisabled={
                  Boolean(creatingDecisionKey)
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-gray-50 p-4 text-sm text-gray-500">
            {effectiveSelectedMetric
              ? "No automated insights match the selected metric yet."
              : "No automated insights are available for this dataset yet."}
          </div>
        )}
      </div>

      {/* Chart */}

      {dataset.chart && (
        <MetricTrendChart
          data={dataset.chart.data}
          xKey={dataset.chart.x_key}
          yKey={
            effectiveSelectedMetric ??
            dataset.chart.y_key
          }
        />
      )}

      {/* Preview */}

      <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-xl font-semibold">
          Dataset Preview
        </h2>

        <div className="overflow-x-auto">
          <table
            aria-label={`Preview rows for ${dataset.file_name}`}
            className="min-w-full border-collapse text-sm"
          >
            <thead className="bg-gray-50">
              <tr>
                {dataset.preview?.[0] &&
                  Object.keys(
                    dataset.preview[0]
                  ).map((column) => (
                    <th
                      key={column}
                      className="border-b px-4 py-3 text-left font-medium text-gray-600"
                    >
                      {column}
                    </th>
                  ))}
              </tr>
            </thead>

            <tbody>
              {dataset.preview?.length ? (
                dataset.preview.map(
                  (
                    row,
                    index: number
                  ) => (
                    <tr key={index}>
                      {Object.values(row).map(
                        (value, i) => (
                          <td
                            key={i}
                            className="max-w-xs break-words border-b px-4 py-3 text-gray-700"
                          >
                            {formatPreviewValue(
                              value
                            )}
                          </td>
                        )
                      )}
                    </tr>
                  )
                )
              ) : (
                <tr>
                  <td
                    colSpan={
                      dataset.preview?.[0]
                        ? Object.keys(
                            dataset.preview[0]
                          ).length
                        : 1
                    }
                    className="px-4 py-6 text-sm text-gray-500"
                  >
                    No preview rows available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AnalyticsField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase text-gray-500">
        {label}
      </p>

      <p className="mt-2 break-all text-gray-800">
        {value}
      </p>
    </div>
  )
}

function prioritizeDatasetMetrics(
  metrics: DatasetMetric[],
  selectedMetric: string | undefined
) {
  if (!selectedMetric) {
    return metrics
  }

  return [
    ...metrics.filter(
      metric =>
        metric.column === selectedMetric
    ),
    ...metrics.filter(
      metric =>
        metric.column !== selectedMetric
    ),
  ]
}

function getMetricFilteredDatasetInsights(
  insights: DatasetInsight[],
  selectedMetric: string | undefined
) {
  if (!selectedMetric) {
    return insights
  }

  const selectedMetricText =
    normalizeDatasetMetricText(selectedMetric)

  return insights.filter(insight => {
    const insightColumn =
      normalizeDatasetMetricText(
        insight.column
      )

    if (
      insightColumn &&
      insightColumn === selectedMetricText
    ) {
      return true
    }

    const insightText =
      normalizeDatasetMetricText(
        `${insight.title} ${insight.description}`
      )

    return insightText.includes(
      selectedMetricText
    )
  })
}

function normalizeDatasetMetricText(
  value: string | undefined
) {
  return (value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}
