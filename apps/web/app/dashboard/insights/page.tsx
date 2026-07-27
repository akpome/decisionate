"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import {
  RefreshCw,
} from "lucide-react"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
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
import type {
  Insight,
} from "@/features/insights/utils/generate-insights"

import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"

import {
  createDecision,
  getDatasetAIAnalysis,
  getDatasetDetails,
  getDatasets,
  getDatasetPreference,
  updateDatasetPreference,
  type AIAnalysis,
  type DatasetMetricSummary,
  type DatasetSummary,
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
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import {
  buildInsightDecisionPayload,
} from "@/features/decisions/lib/decision-handoff"

type InsightRecord = Insight & {
  column?: string
  type?: string
}

type InsightDataset = DatasetSummary & {
  metrics?: DatasetMetricSummary[]
  insights?: InsightRecord[]
  ai_analysis?: AIAnalysis
}

function getInsightsPageErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallbackMessage
}

function getInitialInsightsDatasetId() {
  if (typeof window === "undefined") {
    return undefined
  }

  const datasetId = Number(
    new URLSearchParams(
      window.location.search
    ).get("dataset")
  )

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : undefined
}

export default function InsightsPage() {
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number | undefined>(
      () => getInitialInsightsDatasetId()
    )
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])

  const [dataset, setDataset] =
    useState<InsightDataset | null>(null)
  const [selectedMetric, setSelectedMetric] =
    useState<string>()

  const { user } = useUser()
  const router = useRouter()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)

  const [loading, setLoading] =
    useState(false)
  const [metricAnalysisLoading, setMetricAnalysisLoading] =
    useState(false)
  const [metricAnalysisError, setMetricAnalysisError] =
    useState(false)
  const [metricAnalysisRetryKey, setMetricAnalysisRetryKey] =
    useState(0)
  const [
    datasetsLoading,
    setDatasetsLoading,
  ] = useState(false)
  const [pageError, setPageError] =
    useState("")
  const [preferenceWarning, setPreferenceWarning] =
    useState("")
  const [
    insightsRefreshVersion,
    setInsightsRefreshVersion,
  ] = useState(0)
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [creatingDecisionKey, setCreatingDecisionKey] =
    useState<string>()

  const insights =
    useMemo(
      () => dataset?.insights ?? [],
      [dataset]
    )
  const metricColumns =
    useMemo(
      () =>
        dataset?.metrics?.map(
          metric => metric.column
        ) ?? [],
      [dataset]
    )
  const effectiveSelectedMetric =
    selectedMetric &&
    metricColumns.includes(selectedMetric)
      ? selectedMetric
      : undefined
  const aiRecommendationMetric =
    effectiveSelectedMetric ||
    (metricColumns.length === 1
      ? metricColumns[0]
      : undefined)
  const filteredInsights =
    useMemo(
      () =>
        getMetricFilteredInsights(
          insights,
          effectiveSelectedMetric
        ),
      [
        effectiveSelectedMetric,
        insights,
      ]
    )
  const datasetSourceDetails =
    dataset
      ? getDatasetSourceDetails(
          dataset.source_type,
          dataset.source_config,
          dataset.source_label
        )
      : null

  useEffect(() => {
    if (
      !user?.id ||
      !selectedDatasetId ||
      !selectedMetric ||
      !dataset ||
      metricColumns.includes(selectedMetric)
    ) {
      return
    }

    const datasetId = selectedDatasetId
    const userId = user.id

    async function clearStaleMetric() {
      setSelectedMetric(undefined)

      try {
        await updateDatasetPreference(
          datasetId,
          userId,
          "",
          undefined,
          undefined,
          activeWorkspaceId
        )
      } catch {
        // A stale metric should not block insight generation.
      }
    }

    void clearStaleMetric()
  }, [
    activeWorkspaceId,
    dataset,
    metricColumns,
    selectedDatasetId,
    selectedMetric,
    user?.id,
  ])

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id
    let ignoreResult = false

    async function loadDefaultDataset() {
      try {
        setDataset(null)
        setSelectedDatasetId(undefined)
        setSelectedMetric(undefined)
        setDatasets([])
        setDatasetsLoading(true)
        setPageError("")
        setPreferenceWarning("")

        const preferencePromise =
          Promise.allSettled([
            getDatasetPreference(
              userId,
              activeWorkspaceId
            ),
          ])
        const [datasetsResult] =
          await Promise.allSettled([
            getDatasets(
              userId,
              activeWorkspaceId
            ),
          ])

        if (ignoreResult) {
          return
        }

        if (datasetsResult.status === "rejected") {
          throw datasetsResult.reason
        }

        const datasetSummaries =
          datasetsResult.value

        setDatasets(datasetSummaries)
        setDatasetsLoading(false)

        const initialDatasetId =
          getInitialInsightsDatasetId()

        if (
          initialDatasetId &&
          datasetSummaries.some(
            (datasetSummary) =>
              datasetSummary.id === initialDatasetId
          )
        ) {
          setSelectedDatasetId(initialDatasetId)
        } else if (datasetSummaries.length > 0) {
          setSelectedDatasetId(
            datasetSummaries[0].id
          )
          setSelectedMetric(undefined)
        }

        const [preferenceResult] =
          await preferencePromise
        if (!ignoreResult) {
          const preference =
            preferenceResult.status === "fulfilled"
              ? preferenceResult.value
              : undefined

          if (preferenceResult.status === "rejected") {
            setPreferenceWarning(
              `${getInsightsPageErrorMessage(
                preferenceResult.reason,
                "Dataset preference service is unavailable."
              )} Using the first available dataset.`
            )
          } else {
            setPreferenceWarning("")
          }

          const preferredDataset =
            preference?.selected_dataset_id &&
            datasetSummaries.some(
              (datasetSummary) =>
                datasetSummary.id ===
                preference.selected_dataset_id
            )

          if (
            !initialDatasetId &&
            preferredDataset
          ) {
            setSelectedDatasetId(
              preference.selected_dataset_id ??
                undefined
            )
            setSelectedMetric(
              preference.selected_metric ??
                undefined
            )
          }
        }
      } catch (error) {
        if (ignoreResult) {
          return
        }

        console.error(error)
        setDataset(null)
        setDatasets([])
        setSelectedDatasetId(undefined)
        setPreferenceWarning("")
        setPageError(
          getInsightsPageErrorMessage(
            error,
            "Unable to load your saved insights dataset."
          )
        )
      } finally {
        if (!ignoreResult) {
          setDatasetsLoading(false)
        }
      }
    }

    void loadDefaultDataset()

    return () => {
      ignoreResult = true
    }
  }, [
    user?.id,
    activeWorkspaceId,
    datasetLoadRetryKey,
    workspaceVersion,
  ])

  async function handleDatasetChange(
    datasetId: number | undefined
  ) {
    const previousDatasetId = selectedDatasetId
    const previousMetric = selectedMetric
    setDataset(null)
    setPageError("")
    setSelectedDatasetId(datasetId)
    setSelectedMetric(undefined)

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)

      if (datasetId) {
        url.searchParams.set(
          "dataset",
          String(datasetId)
        )
      } else {
        url.searchParams.delete("dataset")
      }

      window.history.replaceState(
        null,
        "",
        url.toString()
      )
    }

    if (datasetId && user?.id) {
      try {
        await updateDatasetPreference(
          datasetId,
          user.id,
          "",
          undefined,
          undefined,
          activeWorkspaceId
        )
        setPreferenceWarning("")
      } catch (error) {
        setSelectedDatasetId(previousDatasetId)
        setSelectedMetric(previousMetric)
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href)

          if (previousDatasetId) {
            url.searchParams.set(
              "dataset",
              String(previousDatasetId)
            )
          } else {
            url.searchParams.delete("dataset")
          }

          window.history.replaceState(
            null,
            "",
            url.toString()
          )
        }
        setPageError(
          getInsightsPageErrorMessage(
            error,
            "Could not save insights dataset preference."
          )
        )
      }
    }
  }

  async function handleMetricChange(
    metric: string | undefined
  ) {
    const previousMetric = selectedMetric
    setSelectedMetric(metric)
    setPageError("")

    if (selectedDatasetId && user?.id) {
      try {
        await updateDatasetPreference(
          selectedDatasetId,
          user.id,
          metric ?? "",
          undefined,
          undefined,
          activeWorkspaceId
        )
        setPreferenceWarning("")
      } catch (error) {
        setSelectedMetric(previousMetric)
        setPageError(
          getInsightsPageErrorMessage(
            error,
            "Could not save insights metric preference."
          )
        )
      }
    }
  }

  function refreshInsights() {
    if (
      !selectedDatasetId ||
      datasetsLoading ||
      loading
    ) {
      return
    }

    setInsightsRefreshVersion(
      version => version + 1
    )
  }

  async function handleCreateDecision(
    insight: InsightRecord,
    insightKey: string
  ) {
    if (
      !user?.id ||
      !selectedDatasetId ||
      !canManageWorkspaceData ||
      creatingDecisionKey
    ) {
      return
    }

    try {
      setCreatingDecisionKey(insightKey)
      setPageError("")

      const createdDecision =
        await createDecision(
          buildInsightDecisionPayload(
            selectedDatasetId,
            insight,
            effectiveSelectedMetric,
            dataset?.file_name
          ),
          user.id,
          activeWorkspaceId
        )

      router.push(
        `/dashboard/decisions/${createdDecision.id}`
      )
    } catch (error) {
      setPageError(
        getInsightsPageErrorMessage(
          error,
          "Unable to create a decision from this insight."
        )
      )
    } finally {
      setCreatingDecisionKey(undefined)
    }
  }

  async function handleCreateAIRecommendation() {
    const recommendation =
      dataset?.ai_analysis?.recommendations[0]

    if (
      !user?.id ||
      !selectedDatasetId ||
      !dataset?.ai_analysis ||
      !aiRecommendationMetric ||
      !recommendation ||
      !canManageWorkspaceData ||
      creatingDecisionKey
    ) {
      return
    }

    const decisionPayload =
      buildAIRecommendationDecisionPayload(
        selectedDatasetId,
        aiRecommendationMetric,
        dataset.ai_analysis,
        dataset.file_name
      )

    if (!decisionPayload) {
      return
    }

    try {
      setCreatingDecisionKey("ai-analysis")
      setPageError("")

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
      setPageError(
        getInsightsPageErrorMessage(
          error,
          "Unable to create a decision from the analysis."
        )
      )
    } finally {
      setCreatingDecisionKey(undefined)
    }
  }

  const refreshButtonLabel =
    datasetsLoading
      ? "Loading..."
      : loading
      ? "Refreshing..."
      : "Refresh"

  useEffect(() => {
    if (!selectedDatasetId) {
      return
    }

    if (!user?.id) return
    const userId = user.id
    const datasetId = selectedDatasetId
    let ignoreResult = false

    async function loadDataset() {
      try {
        setDataset(null)
        setLoading(true)
        setPageError("")

        const data =
          await getDatasetDetails(
            datasetId,
            userId,
            activeWorkspaceId
          )

        if (!ignoreResult) {
          setDataset(data)
        }
      } catch (error) {
        if (!ignoreResult) {
          console.error(error)
          setDataset(null)
          setPageError(
            getInsightsPageErrorMessage(
              error,
              "Unable to load insights for this dataset."
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
    }
  }, [
    selectedDatasetId,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
    insightsRefreshVersion,
  ])

  useEffect(() => {
    if (
      !user?.id ||
      !selectedDatasetId ||
      !effectiveSelectedMetric
    ) {
      queueMicrotask(() => {
        setMetricAnalysisLoading(false)
        setMetricAnalysisError(false)
      })
      return
    }

    const safeDatasetId = selectedDatasetId
    const userId = user.id
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
            userId,
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
    effectiveSelectedMetric,
    metricAnalysisRetryKey,
    selectedDatasetId,
    user?.id,
  ])

  return (
    <div className="space-y-8">
      <div>
        <DashboardPageHeader
          title="Insights"
          description="Review generated patterns, anomalies, and recommendations for one selected dataset."
          actions={
            <button
            type="button"
            onClick={refreshInsights}
            disabled={
              !selectedDatasetId ||
              datasetsLoading ||
              loading
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 sm:w-auto"
          >
            <RefreshCw size={16} />
            {refreshButtonLabel}
            </button>
          }
        />

        <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Insights setup
              </h2>

              <p className="text-sm text-gray-500">
                Choose the dataset to analyze for generated patterns, anomalies, and recommendations.
              </p>
            </div>

            {loading && (
              <p
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-[var(--decisionate-brand-primary-text)]"
              >
                {dataset
                  ? "Refreshing insights..."
                  : "Loading insights..."}
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="min-w-0 space-y-2">
              <span className="text-sm font-medium text-gray-700">
                Dataset
              </span>

              <DatasetSelector
                ariaLabel="Select insights dataset"
                datasets={datasets}
                emptyMessage={
                  canManageWorkspaceData
                    ? undefined
                    : "Ask the workspace team to share a dataset before generating insights."
                }
                loading={
                  !user?.id ||
                  datasetsLoading
                }
                loadError={
                  Boolean(pageError) &&
                  datasets.length === 0
                }
                value={selectedDatasetId}
                onChange={(datasetId) => {
                  void handleDatasetChange(datasetId)
                }}
              />
            </label>

            <label className="min-w-0 space-y-2">
              <span className="text-sm font-medium text-gray-700">
                Metric
              </span>

              <MetricSelector
                ariaLabel="Select insights metric"
                metrics={metricColumns}
                value={effectiveSelectedMetric}
                disabled={
                  !selectedDatasetId ||
                  loading ||
                  metricColumns.length === 0
                }
                placeholder={
                  !selectedDatasetId
                    ? "Choose dataset first"
                    : metricColumns.length === 0
                      ? "No numeric metrics"
                      : "All Metrics"
                }
                onChange={(metric) => {
                  void handleMetricChange(metric)
                }}
              />
            </label>
          </div>

          <p className="mt-3 max-w-full break-words text-sm text-gray-500">
            {dataset ? (
              <>
                Insights generated from{" "}
                <span className="font-medium text-gray-700">
                  {dataset.file_name}
                </span>
                {datasetSourceDetails?.label
                  ? ` • ${datasetSourceDetails.label}`
                  : ""}
                {effectiveSelectedMetric
                  ? ` • Focused on ${formatMetricLabel(effectiveSelectedMetric)}`
                  : " • All metrics"}
                {selectedDatasetId && (
                  <Link
                    href={`/dashboard/datasets/${selectedDatasetId}`}
                    className="ml-2 font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
                  >
                    Open dataset details
                  </Link>
                )}
              </>
            ) : (
              "Select a dataset"
            )}
          </p>
        </section>
      </div>

      {pageError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{pageError}</span>

          {!selectedDatasetId && (
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
      )}

      {preferenceWarning && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{preferenceWarning}</span>

          <button
            type="button"
            onClick={() =>
              setDatasetLoadRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
          >
            Retry preference
          </button>
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Analysis and metric selection are available in this shared workspace. Workspace managers handle decision creation and data changes."
      />

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

      {!loading &&
        !metricAnalysisLoading &&
        selectedDatasetId &&
        dataset?.ai_analysis &&
        (!effectiveSelectedMetric ||
          dataset.ai_analysis.metric === effectiveSelectedMetric) && (
        <AIAnalysisPanel
          analysis={dataset.ai_analysis}
          title="Insight analysis"
          metric={effectiveSelectedMetric}
          className="rounded-2xl p-4"
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

      {!datasetsLoading &&
        !selectedDatasetId &&
        !pageError && (
        <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
          <h2 className="text-xl font-semibold">
            {datasets.length === 0
              ? "No datasets available"
              : "No dataset selected"}
          </h2>

          <p className="mt-2 text-gray-500">
            {datasets.length === 0
              ? canManageWorkspaceData
                ? "Upload or pull a dataset first to generate insights."
                : "Ask the workspace team to share a dataset before generating insights."
              : "Select a dataset to view insights."}
          </p>

          <Link
            href="/dashboard/datasets"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
          >
            {canManageWorkspaceData
              ? "Open datasets"
              : "View datasets"}
          </Link>
        </div>
      )}

      {!loading &&
        selectedDatasetId &&
        !pageError &&
        filteredInsights.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
            <h2 className="text-xl font-semibold">
              {effectiveSelectedMetric
                ? "No insights for selected metric"
                : "No insights available yet"}
            </h2>

            <p className="mt-2 text-gray-500">
              {effectiveSelectedMetric
                ? "Choose All Metrics or select another metric to review available insights."
                : "This dataset loaded successfully, but no automated insights were generated from its current fields."}
            </p>
          </div>
        )}

      {!loading && filteredInsights.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {filteredInsights.map(
            (
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
            )
          )}
        </div>
      )}
    </div>
  )
}

function getMetricFilteredInsights(
  insights: InsightRecord[],
  selectedMetric: string | undefined
) {
  if (!selectedMetric) {
    return insights
  }

  const selectedMetricText =
    normalizeInsightMetricText(selectedMetric)

  return insights.filter(insight => {
    const insightColumn =
      normalizeInsightMetricText(
        insight.column
      )

    if (
      insightColumn &&
      insightColumn === selectedMetricText
    ) {
      return true
    }

    const insightText =
      normalizeInsightMetricText(
        `${insight.title} ${insight.description}`
      )

    return insightText.includes(
      selectedMetricText
    )
  })
}

function normalizeInsightMetricText(
  value: string | undefined
) {
  return (value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}
