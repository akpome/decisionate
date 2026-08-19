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
  generateInsights,
} from "@/features/insights/utils/generate-insights"
import type {
  DatasetRow,
} from "@/features/datasets/store/dataset-store"
import {
  getNumericColumns,
} from "@/features/datasets/utils/dataset-analytics"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"
import {
  AnalysisStatus,
} from "@/features/ai/components/analysis-status"
import {
  AnomalyDetectionPanel,
} from "@/features/ai/components/anomaly-detection-panel"
import {
  MultiMetricAnalysisPanel,
} from "@/features/insights/components/multi-metric-analysis-panel"
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
  getDatasetAnomalies,
  getDatasetAIAnalysis,
  getDatasetDetails,
  getDatasets,
  type AIAnalysis,
  type DashboardAggregation,
  type DashboardValueAggregation,
  type DatasetAnomaliesResponse,
  type DatasetAnomalyPoint,
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
import {
  aggregateSummaryAwareValues,
  isInternalSummaryColumn,
} from "@/features/dashboard/lib/summary-aggregation"

type InsightRecord = Insight & {
  column?: string
  type?: string
}

type InsightDataset = DatasetSummary & {
  preview?: DatasetRow[]
  metrics?: DatasetMetricSummary[]
  insights?: InsightRecord[]
  ai_analysis?: AIAnalysis
  chart?: {
    x_key?: string
    data?: DatasetRow[]
  }
}

type InsightPeriodFilter =
  | "1m"
  | "1q"
  | "6m"
  | "1y"
  | "2y"
  | "3y"
  | "5y"
  | "all"

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
    useState<number | undefined>(undefined)
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])

  const [dataset, setDataset] =
    useState<InsightDataset | null>(null)
  const [selectedMetric, setSelectedMetric] =
    useState<string>()
  const [periodFilter, setPeriodFilter] =
    useState<InsightPeriodFilter>("all")
  const [aggregation, setAggregation] =
    useState<DashboardAggregation>("monthly")
  const [aggregationType, setAggregationType] =
    useState<DashboardValueAggregation>("sum")
  const [startDate, setStartDate] =
    useState("")

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
  const [anomalyResult, setAnomalyResult] =
    useState<DatasetAnomaliesResponse | null>(null)
  const [anomalyLoading, setAnomalyLoading] =
    useState(false)
  const [anomalyError, setAnomalyError] =
    useState("")
  const [anomalyRetryKey, setAnomalyRetryKey] =
    useState(0)
  const [anomalySensitivity, setAnomalySensitivity] =
    useState<"high" | "medium" | "low">("medium")
  const [
    datasetsLoading,
    setDatasetsLoading,
  ] = useState(false)
  const [pageError, setPageError] =
    useState("")
  const [
    insightsRefreshVersion,
    setInsightsRefreshVersion,
  ] = useState(0)
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [creatingDecisionKey, setCreatingDecisionKey] =
    useState<string>()

  const metricColumns =
    useMemo(
      () =>
        dataset?.metrics?.map(
          metric => metric.column
        ) ?? [],
      [dataset]
    )
  const insightRows = useMemo(
    () =>
      dataset?.chart?.data?.length
        ? dataset.chart.data
        : dataset?.preview ?? [],
    [dataset]
  )
  const insightXKey = useMemo(
    () =>
      dataset?.chart?.x_key ||
      getInsightDateColumn(insightRows),
    [dataset, insightRows]
  )
  const firstInsightDate = useMemo(
    () =>
      getFirstInsightDate(
        insightRows,
        insightXKey
      ),
    [insightRows, insightXKey]
  )
  const effectiveStartDate =
    startDate ||
    (periodFilter === "1m"
      ? firstInsightDate
      : "")
  const scopedInsightRows = useMemo(
    () =>
      buildInsightViewRows(
        insightRows,
        insightXKey,
        effectiveStartDate,
        periodFilter,
        aggregation,
        aggregationType
      ),
    [
      aggregation,
      aggregationType,
      effectiveStartDate,
      insightRows,
      insightXKey,
      periodFilter,
    ]
  )
  const insights = useMemo(() => {
    if (!insightRows.length) {
      return dataset?.insights ?? []
    }

    return buildInsightRecords(
      scopedInsightRows,
      metricColumns
    )
  }, [
    dataset,
    insightRows,
    metricColumns,
    scopedInsightRows,
  ])
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

    queueMicrotask(() =>
      setSelectedMetric(undefined)
    )
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
        setAnomalyResult(null)
        setAnomalyError("")
        setPeriodFilter("all")
        setAggregation("monthly")
        setAggregationType("sum")
        setStartDate("")
        setDatasets([])
        setDatasetsLoading(true)
        setPageError("")
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
        }

      } catch (error) {
        if (ignoreResult) {
          return
        }

        console.error(error)
        setDataset(null)
        setDatasets([])
        setSelectedDatasetId(undefined)
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

  function handleDatasetChange(
    datasetId: number | undefined
  ) {
    setDataset(null)
    setPageError("")
    setSelectedDatasetId(datasetId)
    setSelectedMetric(undefined)
    setAnomalyResult(null)
    setAnomalyError("")
    setPeriodFilter("all")
    setAggregation("monthly")
    setAggregationType("sum")
    setStartDate("")

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

  }

  function handleMetricChange(
    metric: string | undefined
  ) {
    setSelectedMetric(metric)
    setPageError("")
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

  async function handleCreateAnomalyDecision(
    metric: string,
    anomaly: DatasetAnomalyPoint
  ) {
    if (
      !user?.id ||
      !selectedDatasetId ||
      !canManageWorkspaceData ||
      creatingDecisionKey
    ) {
      return
    }

    const decisionKey = `anomaly:${metric}:${anomaly.period}:${anomaly.direction}`
    const metricLabel = formatMetricLabel(metric)
    const directionLabel =
      anomaly.direction === "high"
        ? "high"
        : "low"
    const periodLabel = anomaly.period.slice(0, 10)
    const action =
      `Investigate the ${directionLabel} ${metricLabel} signal for ${periodLabel}, verify the underlying data and business context, then record the outcome.`

    try {
      setCreatingDecisionKey(decisionKey)
      setPageError("")

      const createdDecision =
        await createDecision(
          {
            dataset_id: selectedDatasetId,
            metric_column: metric,
            recommendation_text: action,
            recommendation_source: "rules",
            recommendation_context: [
              `Observed value: ${anomaly.value}`,
              `Baseline: ${anomaly.baseline}`,
              `Score: ${Math.abs(anomaly.score).toFixed(2)}`,
              `Period: ${periodLabel}`,
            ].join("; "),
            title: `Investigate ${metricLabel} anomaly on ${periodLabel}`,
            action,
            description: [
              "A statistical anomaly was detected from the selected dataset window.",
              `Observed ${anomaly.value} against a baseline of ${anomaly.baseline}.`,
            ].join("\n\n"),
            expected_outcome: `Confirm whether the ${metricLabel} anomaly on ${periodLabel} is a valid business signal or a data-quality issue, then record the actual result and lesson learned.`,
          },
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
          "Unable to create a decision from this anomaly."
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
            activeWorkspaceId,
            { includeAllRows: true }
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

  useEffect(() => {
    if (
      !user?.id ||
      !selectedDatasetId ||
      loading ||
      dataset?.id !== selectedDatasetId
    ) {
      queueMicrotask(() => {
        setAnomalyLoading(false)
      })
      return
    }

    const userId = user.id
    const datasetId = selectedDatasetId
    let ignoreResult = false

    queueMicrotask(() => {
      setAnomalyLoading(true)
      setAnomalyError("")
    })

    async function loadAnomalies() {
      try {
        const result = await getDatasetAnomalies(
          datasetId,
          userId,
          activeWorkspaceId,
          {
            metric: effectiveSelectedMetric,
            startDate: effectiveStartDate || undefined,
            periodFilter,
            aggregation,
            aggregationType,
            sensitivity: anomalySensitivity,
          }
        )

        if (!ignoreResult) {
          setAnomalyResult(result)
        }
      } catch (error) {
        if (!ignoreResult) {
          setAnomalyResult(null)
          setAnomalyError(
            getInsightsPageErrorMessage(
              error,
              "Unable to detect anomalies for this dataset."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setAnomalyLoading(false)
        }
      }
    }

    void loadAnomalies()

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    aggregation,
    aggregationType,
    anomalyRetryKey,
    anomalySensitivity,
    dataset?.id,
    effectiveSelectedMetric,
    effectiveStartDate,
    loading,
    periodFilter,
    selectedDatasetId,
    user?.id,
  ])

  return (
    <div className="space-y-8">
      <div>
        <DashboardPageHeader
          title="Insights"
          description="Review generated patterns for one dataset or analyze selected metrics across multiple datasets."
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

          <div className="mt-4 grid min-w-0 gap-3 rounded-lg border border-gray-200 bg-gray-50 px-0 py-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end">
            <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
              <span className="block">Start date</span>
              <input
                type="date"
                value={effectiveStartDate}
                disabled={!dataset || loading}
                onChange={event =>
                  setStartDate(event.target.value)
                }
                className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-100"
              />
            </label>

            <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
              <span className="block">Period</span>
              <select
                value={periodFilter}
                disabled={!dataset || loading}
                onChange={event =>
                  setPeriodFilter(
                    event.target.value as InsightPeriodFilter
                  )
                }
                className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="1m">1 month</option>
                <option value="1q">1 quarter</option>
                <option value="6m">6 months</option>
                <option value="1y">1 year</option>
                <option value="2y">2 years</option>
                <option value="3y">3 years</option>
                <option value="5y">5 years</option>
                <option value="all">All data</option>
              </select>
            </label>

            <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
              <span className="block">Group by</span>
              <select
                value={aggregation}
                disabled={!dataset || loading}
                onChange={event =>
                  setAggregation(
                    event.target.value as DashboardAggregation
                  )
                }
                className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </label>

            <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
              <span className="block">Aggregate</span>
              <select
                value={aggregationType}
                disabled={!dataset || loading}
                onChange={event =>
                  setAggregationType(
                    event.target.value as DashboardValueAggregation
                  )
                }
                className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="sum">Sum</option>
                <option value="count">Count</option>
                <option value="avg">Average</option>
                <option value="min">Minimum</option>
                <option value="max">Maximum</option>
              </select>
            </label>

            <button
              type="button"
              disabled={!dataset || loading}
              onClick={() => {
                setPeriodFilter("all")
                setAggregation("monthly")
                setAggregationType("sum")
                setStartDate("")
              }}
              className="h-9 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              Reset range
            </button>

            <p className="col-span-full truncate text-xs text-gray-500">
              Showing {formatInsightPeriodLabel(periodFilter)} from {effectiveStartDate
                ? formatInsightMonth(effectiveStartDate)
                : "first available period"}
              {scopedInsightRows.length > 0
                ? ` • ${scopedInsightRows.length} grouped rows`
                : ""}
            </p>
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

        <MultiMetricAnalysisPanel
          datasets={datasets}
          userId={user?.id}
          workspaceId={activeWorkspaceId}
          startDate={startDate}
          periodFilter={periodFilter}
          grouping={aggregation}
          defaultAggregation={aggregationType}
        />
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

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Analysis and metric selection are available in this shared workspace. Workspace managers handle decision creation and data changes."
      />

      {selectedDatasetId && (
        <AnomalyDetectionPanel
          result={anomalyResult}
          loading={anomalyLoading}
          error={anomalyError}
          sensitivity={anomalySensitivity}
          onSensitivityChange={setAnomalySensitivity}
          onRetry={() =>
            setAnomalyRetryKey(
              currentKey => currentKey + 1
            )
          }
          onCreateDecision={
            canManageWorkspaceData
              ? handleCreateAnomalyDecision
              : undefined
          }
          creatingDecisionKey={creatingDecisionKey}
        />
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
        datasets.length === 0 &&
        !pageError && (
        <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
          <h2 className="text-xl font-semibold">
            No datasets available
          </h2>

          <p className="mt-2 text-gray-500">
            {canManageWorkspaceData
              ? "Upload or pull a dataset first to generate insights."
              : "Ask the workspace team to share a dataset before generating insights."}
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

function getInsightDateColumn(
  rows: DatasetRow[]
) {
  const dateHints = [
    "date",
    "time",
    "month",
    "week",
    "year",
    "period",
    "created",
    "updated",
  ]

  return Object.keys(rows[0] ?? {}).find(column => {
    const normalizedColumn =
      normalizeInsightMetricText(column)

    return (
      dateHints.some(hint =>
        normalizedColumn.includes(hint)
      ) &&
      rows.some(row =>
        parseInsightDate(row[column]) !== null
      )
    )
  })
}

function getFirstInsightDate(
  rows: DatasetRow[],
  xKey?: string
) {
  if (!xKey) {
    return ""
  }

  const dates = rows
    .map(row => parseInsightDate(row[xKey]))
    .filter((value): value is Date => value !== null)
    .sort(
      (first, second) =>
        first.getTime() - second.getTime()
    )

  return dates.length > 0
    ? formatInsightDate(dates[0])
    : ""
}

function buildInsightViewRows(
  rows: DatasetRow[],
  xKey: string | undefined,
  startDate: string,
  periodFilter: InsightPeriodFilter,
  aggregation: DashboardAggregation,
  aggregationType: DashboardValueAggregation
) {
  if (!rows.length || !xKey) {
    return rows
  }

  const datedRows = rows.map((row, index) => ({
    row,
    date: parseInsightDate(row[xKey]) ??
      new Date(0 + index),
  }))
  const hasDateValues = datedRows.some(
    item => item.date.getTime() > 0
  )

  if (!hasDateValues) {
    return rows
  }

  let selectedRows = datedRows

  if (periodFilter !== "all") {
    const firstDate = datedRows
      .filter(item => item.date.getTime() > 0)
      .map(item => item.date)
      .sort(
        (first, second) =>
          first.getTime() - second.getTime()
      )[0]
    const selectedDate =
      parseInsightDate(startDate) ?? firstDate

    if (selectedDate) {
      const periodStart = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1
      )
      const periodEnd = new Date(
        periodStart.getFullYear(),
        periodStart.getMonth() +
          getInsightPeriodMonths(periodFilter),
        1
      )

      selectedRows = datedRows.filter(item =>
        item.date >= periodStart &&
        item.date < periodEnd
      )
    }
  }

  return aggregateInsightRows(
    selectedRows.map(item => item.row),
    xKey,
    aggregation,
    aggregationType
  )
}

function aggregateInsightRows(
  rows: DatasetRow[],
  xKey: string,
  aggregation: DashboardAggregation,
  aggregationType: DashboardValueAggregation
) {
  const numericColumns = getNumericColumns(rows)
    .filter(column => !isInternalSummaryColumn(column))
  const buckets = new Map<
    string,
    { date: Date; rows: DatasetRow[] }
  >()

  rows.forEach((row, index) => {
    const date = parseInsightDate(row[xKey])

    if (!date) {
      buckets.set(`row-${index}`, {
        date: new Date(0 + index),
        rows: [row],
      })
      return
    }

    const bucketDate = getInsightBucketDate(
      date,
      aggregation
    )
    const bucketKey = formatInsightDate(bucketDate)
    const bucket =
      buckets.get(bucketKey) ?? {
        date: bucketDate,
        rows: [],
      }

    bucket.rows.push(row)
    buckets.set(bucketKey, bucket)
  })

  return Array.from(buckets.values())
    .sort((first, second) =>
      first.date.getTime() - second.date.getTime()
    )
    .map(bucket => ({
      [xKey]: formatInsightBucketLabel(
        bucket.date,
        aggregation
      ),
      ...Object.fromEntries(
        numericColumns.map(column => [
          column,
          aggregateSummaryAwareValues(
            bucket.rows,
            column,
            aggregationType
          ),
        ])
      ),
    }))
}

function buildInsightRecords(
  rows: DatasetRow[],
  metricColumns: string[]
): InsightRecord[] {
  return generateInsights(rows).map(insight => {
    const insightText = normalizeInsightMetricText(
      `${insight.title} ${insight.description}`
    )
    const column = metricColumns.find(metric =>
      insightText.includes(
        normalizeInsightMetricText(metric)
      )
    )

    return {
      ...insight,
      column,
      type: getGeneratedInsightType(insight.title),
    }
  })
}

function getGeneratedInsightType(title: string) {
  const normalizedTitle =
    normalizeInsightMetricText(title)

  if (normalizedTitle.includes("trend")) {
    return "Trend"
  }

  if (normalizedTitle.includes("peak")) {
    return "Peak"
  }

  if (normalizedTitle.includes("low")) {
    return "Low"
  }

  return "Insight"
}

function getInsightPeriodMonths(
  periodFilter: InsightPeriodFilter
) {
  return periodFilter === "1m"
    ? 1
    : periodFilter === "1q"
      ? 3
      : periodFilter === "6m"
        ? 6
        : periodFilter === "1y"
          ? 12
          : periodFilter === "2y"
            ? 24
            : periodFilter === "3y"
              ? 36
              : 60
}

function getInsightBucketDate(
  value: Date,
  aggregation: DashboardAggregation
) {
  const date = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  )

  if (aggregation === "monthly") {
    date.setDate(1)
  }

  if (aggregation === "quarterly") {
    date.setDate(1)
    date.setMonth(
      Math.floor(date.getMonth() / 3) * 3
    )
  }

  if (aggregation === "weekly") {
    const daysFromMonday =
      (date.getDay() + 6) % 7
    date.setDate(
      date.getDate() - daysFromMonday
    )
  }

  return date
}

function formatInsightBucketLabel(
  value: Date,
  aggregation: DashboardAggregation
) {
  const dateKey = formatInsightDate(value)

  return aggregation === "weekly"
    ? `Week of ${dateKey}`
    : aggregation === "quarterly"
      ? `${value.getFullYear()} Q${Math.floor(value.getMonth() / 3) + 1}`
      : aggregation === "monthly"
        ? dateKey.slice(0, 7)
        : dateKey
}

function parseInsightDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value !== "string") {
    return null
  }

  const cleanValue = value.trim()

  if (!cleanValue) {
    return null
  }

  const normalizedValue =
    /^\d{4}$/.test(cleanValue)
      ? `${cleanValue}-01-01`
      : /^\d{4}-\d{2}$/.test(cleanValue)
        ? `${cleanValue}-01`
        : cleanValue
  const parsed = new Date(
    normalizedValue.includes("T")
      ? normalizedValue
      : `${normalizedValue}T00:00:00`
  )

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed
}

function formatInsightDate(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-")
}

function formatInsightMonth(value: string) {
  const date = parseInsightDate(value)

  return date
    ? date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    })
    : value
}

function formatInsightPeriodLabel(
  periodFilter: InsightPeriodFilter
) {
  return periodFilter === "all"
    ? "all available data"
    : periodFilter === "1m"
      ? "1 month"
      : periodFilter === "1q"
        ? "1 quarter"
        : periodFilter === "6m"
          ? "6 months"
          : periodFilter === "1y"
            ? "1 year"
            : periodFilter === "2y"
              ? "2 years"
              : periodFilter === "3y"
                ? "3 years"
                : "5 years"
}
