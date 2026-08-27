"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import {
  BarChart3,
  FileText,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  getDatasetDetails,
  getDatasetAIAnalysis,
  getDatasets,
  getMyOrganization,
  getOrganizationWorkspaces,
  createDecision,
  type DatasetSummary,
  type AIAnalysis,
  type DashboardAggregation,
  type DashboardValueAggregation,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
  type ForecastPeriodFilter,
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
  getWorkspaceBrand,
  type WorkspaceBrand,
} from "@/lib/workspace-brand"
import {
  WorkspaceBrandMark,
} from "@/app/dashboard/workspace-brand-mark"
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
import { useRouter } from "next/navigation"
import {
  buildInsightDecisionPayload,
} from "@/features/decisions/lib/decision-handoff"

type ReportCellValue =
  | string
  | number
  | boolean
  | null
  | undefined

type ReportRow =
  Record<string, ReportCellValue>

type ReportMetric = {
  column: string
  total?: number
  average?: number
  min?: number
  max?: number
  minimum?: number
  maximum?: number
}

type ReportInsight = {
  type?: string
  column?: string
  title: string
  description: string
}

type ReportAIAnalysis = AIAnalysis

type ReportDatasetDetails = DatasetSummary & {
  metrics?: ReportMetric[]
  insights?: ReportInsight[]
  ai_analysis?: ReportAIAnalysis
  chart?: {
    data?: ReportRow[]
    x_key?: string
    y_key?: string
  }
  preview?: ReportRow[]
}

type OrganizationUpdatedEvent =
  CustomEvent<OrganizationRecord>

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

function getInitialReportDatasetId() {
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

function formatReportPeriodLabel(
  period: ForecastPeriodFilter
) {
  const labels: Record<ForecastPeriodFilter, string> = {
    "1m": "1 month",
    "1q": "1 quarter",
    "6m": "6 months",
    "1y": "1 year",
    "2y": "2 years",
    "3y": "3 years",
    "5y": "5 years",
    all: "all available data",
  }

  return labels[period]
}

function formatReportStartDate(value: string) {
  if (!value) {
    return "first available period"
  }

  const [year, month, day] = value.split("-")

  return year && month && day
    ? `${month}/${day}/${year}`
    : value
}

function formatReportAggregationLabel(
  aggregation: DashboardAggregation
) {
  return aggregation === "daily"
    ? "daily"
    : aggregation === "weekly"
      ? "weekly"
      : aggregation === "quarterly"
        ? "quarterly"
        : "monthly"
}

function formatReportValueAggregationLabel(
  aggregationType: DashboardValueAggregation
) {
  return aggregationType === "count"
    ? "counted"
    : aggregationType === "avg"
      ? "averaged"
      : aggregationType === "min"
        ? "minimum"
        : aggregationType === "max"
          ? "maximum"
          : "summed"
}

export default function ReportsPage() {
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
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [
    selectedDatasetId,
    setSelectedDatasetId,
  ] = useState<number | undefined>()
  const [dataset, setDataset] =
    useState<ReportDatasetDetails | null>(null)
  const [selectedMetric, setSelectedMetric] =
    useState<string>()
  const [periodFilter, setPeriodFilter] =
    useState<ForecastPeriodFilter>("all")
  const [aggregation, setAggregation] =
    useState<DashboardAggregation>("monthly")
  const [aggregationType, setAggregationType] =
    useState<DashboardValueAggregation>("sum")
  const [startDate, setStartDate] =
    useState("")
  const [loadingDatasets, setLoadingDatasets] =
    useState(true)
  const [loadingReport, setLoadingReport] =
    useState(false)
  const [metricAnalysisLoading, setMetricAnalysisLoading] =
    useState(false)
  const [metricAnalysisError, setMetricAnalysisError] =
    useState(false)
  const [metricAnalysisRetryKey, setMetricAnalysisRetryKey] =
    useState(0)
  const [
    reportRefreshVersion,
    setReportRefreshVersion,
  ] = useState(0)
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [errorMessage, setErrorMessage] =
    useState("")
  const [generatedAt, setGeneratedAt] =
    useState<Date>()
  const [organization, setOrganization] =
    useState<OrganizationRecord | null>(null)
  const [workspaces, setWorkspaces] =
    useState<OrganizationWorkspaceRecord[]>([])
  const [creatingDecisionKey, setCreatingDecisionKey] =
    useState<string>()

  const activeBrand = useMemo(
    () =>
      getWorkspaceBrand(
        activeWorkspaceId,
        user?.id,
        organization,
        workspaces,
        user?.fullName
      ),
    [
      activeWorkspaceId,
      organization,
      user?.fullName,
      user?.id,
      workspaces,
    ]
  )
  const sourceDetails = dataset
    ? getDatasetSourceDetails(
        dataset.source_type,
        dataset.source_config,
        dataset.source_label
      )
    : null
  const metrics = useMemo(
    () => dataset?.metrics ?? [],
    [dataset]
  )
  const metricColumns = useMemo(
    () =>
      metrics.map(
        metric => metric.column
      ),
    [metrics]
  )
  const effectiveSelectedMetric =
    selectedMetric &&
    metricColumns.includes(selectedMetric)
      ? selectedMetric
      : undefined
  const reportMetrics = useMemo(
    () =>
      prioritizeReportMetrics(
        metrics,
        effectiveSelectedMetric
      ),
    [
      effectiveSelectedMetric,
      metrics,
    ]
  )
  const insights = useMemo(
    () => dataset?.insights ?? [],
    [dataset]
  )
  const reportInsights = useMemo(
    () =>
      getMetricFilteredReportInsights(
        insights,
        effectiveSelectedMetric
      ),
    [
      effectiveSelectedMetric,
      insights,
    ]
  )
  const topMetrics = reportMetrics.slice(0, 4)
  const topInsights = reportInsights.slice(0, 4)
  const aiRecommendationMetric =
    effectiveSelectedMetric ||
    (metricColumns.length === 1
      ? metricColumns[0]
      : undefined)

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

    let ignoreResult = false

    async function loadReportBrand(
      userId: string
    ) {
      const [
        organizationResult,
        workspaceResult,
      ] = await Promise.allSettled([
        getMyOrganization(userId),
        getOrganizationWorkspaces(userId),
      ])

      if (!ignoreResult) {
        if (
          organizationResult.status ===
          "fulfilled"
        ) {
          setOrganization(
            organizationResult.value
          )
        }

        if (
          workspaceResult.status ===
          "fulfilled"
        ) {
          setWorkspaces(
            workspaceResult.value
          )
        }
      }
    }

    void loadReportBrand(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    user?.id,
    workspaceVersion,
  ])

  useEffect(() => {
    function handleOrganizationUpdated(
      event: Event
    ) {
      const organizationEvent =
        event as OrganizationUpdatedEvent

      setOrganization(
        organizationEvent.detail
      )
    }

    window.addEventListener(
      "decisionate:organization-updated",
      handleOrganizationUpdated
    )

    return () => {
      window.removeEventListener(
        "decisionate:organization-updated",
        handleOrganizationUpdated
      )
    }
  }, [])

  useEffect(() => {
    if (!authLoaded) {
      return
    }

    if (!isSignedIn || !user?.id) {
      return
    }

    let ignoreResult = false

    async function loadDatasets(
      userId: string
    ) {
      try {
        setLoadingDatasets(true)
        setErrorMessage("")
        setDataset(null)
        setDatasets([])
        setSelectedDatasetId(undefined)
        setSelectedMetric(undefined)
        setPeriodFilter("all")
        setAggregation("monthly")
        setAggregationType("sum")
        setStartDate("")

        const [datasetsResult] =
          await Promise.allSettled([
            getDatasets(
              userId,
              activeWorkspaceId,
              user?.primaryEmailAddress?.emailAddress
            ),
          ])

        if (ignoreResult) {
          return
        }

        if (datasetsResult.status === "rejected") {
          throw datasetsResult.reason
        }

        const workspaceDatasets =
          datasetsResult.value

        setDatasets(workspaceDatasets)

        const initialDatasetId =
          getInitialReportDatasetId()

        const initialDatasetIsAvailable =
          initialDatasetId &&
          workspaceDatasets.some(
            (item) =>
              item.id === initialDatasetId
          )
        setSelectedDatasetId(
          initialDatasetIsAvailable
            ? initialDatasetId
            : undefined
        )
        setSelectedMetric(undefined)
        setLoadingDatasets(false)

      } catch (error) {
        if (!ignoreResult) {
          setErrorMessage(
            getErrorMessage(
              error,
              "Reports could not load datasets."
            )
          )
          setDatasets([])
          setSelectedDatasetId(undefined)
        }
      } finally {
        if (!ignoreResult) {
          setLoadingDatasets(false)
        }
      }
    }

    void loadDatasets(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    authLoaded,
    datasetLoadRetryKey,
    isSignedIn,
    user?.id,
    workspaceVersion,
  ])

  useEffect(() => {
    if (!user?.id || !selectedDatasetId) {
      return
    }

    let ignoreResult = false

    async function loadReport(
      userId: string,
      datasetId: number
    ) {
      try {
        setLoadingReport(true)
        setErrorMessage("")

        const data =
          (await getDatasetDetails(
            datasetId,
            userId,
            activeWorkspaceId,
            {
              includeAIAnalysis: false,
              periodFilter,
              aggregation,
              aggregationType,
              startDate: startDate || undefined,
            }
          )) as ReportDatasetDetails

        if (!ignoreResult) {
          setDataset(data)
          setGeneratedAt(
            new Date()
          )
        }
      } catch (error) {
        if (!ignoreResult) {
          setDataset(null)
          setErrorMessage(
            getErrorMessage(
              error,
              "Report could not be generated from this dataset."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoadingReport(false)
        }
      }
    }

    void loadReport(
      user.id,
      selectedDatasetId
    )

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    aggregation,
    aggregationType,
    selectedDatasetId,
    periodFilter,
    startDate,
    user?.id,
    workspaceVersion,
    reportRefreshVersion,
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
            metric,
            {
              periodFilter,
              aggregation,
              aggregationType,
              startDate: startDate || undefined,
            }
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
    aggregation,
    aggregationType,
    effectiveSelectedMetric,
    metricAnalysisRetryKey,
    periodFilter,
    selectedDatasetId,
    startDate,
    user?.id,
  ])

  function handleDatasetChange(
    datasetId: number | undefined
  ) {
    setSelectedDatasetId(datasetId)
    setSelectedMetric(undefined)
    setPeriodFilter("all")
    setAggregation("monthly")
    setAggregationType("sum")
    setStartDate("")
    setDataset(null)
    setErrorMessage("")

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
    setErrorMessage("")
  }

  function refreshReport() {
    if (
      !selectedDatasetId ||
      loadingDatasets ||
      loadingReport
    ) {
      return
    }

    setReportRefreshVersion(
      version => version + 1
    )
  }

  async function handleCreateDecision(
    insight: ReportInsight,
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
      setErrorMessage("")

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
      setErrorMessage(
        getErrorMessage(
          error,
          "Unable to create a decision from this report insight."
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
          "Unable to create a decision from the report analysis."
        )
      )
    } finally {
      setCreatingDecisionKey(undefined)
    }
  }

  const refreshButtonLabel =
    loadingDatasets
      ? "Loading..."
      : loadingReport
      ? "Refreshing..."
      : "Refresh"

  return (
    <div className="space-y-8">
      <div className="print:hidden">
        <DashboardPageHeader
          title="Reports"
          description="Build a client-ready report package from one dataset: KPI snapshot, narrative insights, and a chart-backed summary."
          actions={
            <button
              type="button"
              onClick={refreshReport}
              disabled={
                !selectedDatasetId ||
                loadingDatasets ||
                loadingReport
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
                Report setup
              </h2>

              <p className="text-sm text-gray-500">
                Choose the dataset, reporting window, and aggregation used for the KPI snapshot, insights, and chart-backed summary.
              </p>
            </div>

            {loadingReport && (
              <p
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-[var(--decisionate-brand-primary-text)]"
              >
                {dataset
                  ? "Refreshing report..."
                  : "Generating report..."}
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="min-w-0 space-y-2">
              <span className="text-sm font-medium text-gray-700">
                Dataset
              </span>

              <DatasetSelector
                ariaLabel="Select report dataset"
                datasets={datasets}
                emptyMessage={
                  canManageWorkspaceData
                    ? undefined
                    : "Ask the workspace team to share a dataset before generating reports."
                }
                loading={
                  !user?.id ||
                  loadingDatasets
                }
                loadError={
                  Boolean(errorMessage) &&
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
                ariaLabel="Select report metric"
                metrics={metricColumns}
                value={effectiveSelectedMetric}
                disabled={
                  !selectedDatasetId ||
                  loadingReport ||
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
                value={startDate}
                disabled={!selectedDatasetId || loadingReport}
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
                disabled={!selectedDatasetId || loadingReport}
                onChange={event =>
                  setPeriodFilter(
                    event.target.value as ForecastPeriodFilter
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
                disabled={!selectedDatasetId || loadingReport}
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
                disabled={!selectedDatasetId || loadingReport}
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
              disabled={!selectedDatasetId || loadingReport}
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
              Showing {formatReportPeriodLabel(periodFilter)} from {formatReportStartDate(startDate)}
              {` • grouped ${formatReportAggregationLabel(aggregation)}`}
              {` • ${formatReportValueAggregationLabel(aggregationType)}`}
            </p>
          </div>

          <p className="mt-3 max-w-full break-words text-sm text-gray-500">
            {dataset ? (
              <>
                Reporting from{" "}
                <span className="font-medium text-gray-700">
                  {dataset.file_name}
                </span>
                {sourceDetails?.label
                  ? ` • ${sourceDetails.label}`
                  : ""}
                {effectiveSelectedMetric
                  ? ` • Focused on ${formatMetricLabel(effectiveSelectedMetric)}`
                  : " • All metrics"}
                {` • ${formatReportPeriodLabel(periodFilter)}`}
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

      {errorMessage && (
        <div
          className="print:hidden flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>{errorMessage}</span>

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

          {selectedDatasetId && (
            <button
              type="button"
              onClick={refreshReport}
              disabled={loadingReport}
              className="w-fit rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Retry report
            </button>
          )}
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Analysis and metric selection are available in this shared workspace. Workspace managers handle decision creation and data changes."
        className="print:hidden"
      />

      {!loadingDatasets &&
        !errorMessage &&
        datasets.length === 0 && (
          <EmptyReportState
            canManageWorkspaceData={canManageWorkspaceData}
          />
        )}

      {dataset && (
        <article className="rounded-3xl border bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <ReportHeader
            brand={activeBrand}
            dataset={dataset}
            sourceLabel={
              sourceDetails?.label ?? "Dataset"
            }
            generatedAt={generatedAt}
          />

          <ExecutiveSummary
            dataset={dataset}
            metrics={metrics}
            insights={reportInsights}
            selectedMetric={effectiveSelectedMetric}
            analysisLoading={metricAnalysisLoading}
            analysisError={metricAnalysisError}
            onRetryAnalysis={() =>
              setMetricAnalysisRetryKey(
                currentKey => currentKey + 1
              )
            }
            onCreateRecommendation={
              canManageWorkspaceData &&
              aiRecommendationMetric &&
              dataset.ai_analysis?.recommendations.length
                ? () => {
                  void handleCreateAIRecommendation()
                }
                : undefined
            }
            creatingRecommendation={
              creatingDecisionKey === "ai-analysis"
            }
          />

          <ReportMetricGrid
            metrics={topMetrics}
          />

          <ReportChart
            chart={dataset.chart}
            metrics={reportMetrics}
            selectedMetric={effectiveSelectedMetric}
          />

          <ReportInsights
            insights={topInsights}
            selectedMetric={effectiveSelectedMetric}
            onCreateDecision={(insight, insightKey) => {
              if (canManageWorkspaceData) {
                void handleCreateDecision(
                  insight,
                  insightKey
                )
              }
            }}
            allowDecisionCreation={canManageWorkspaceData}
            creatingDecisionKey={creatingDecisionKey}
          />

          <ReportFooter
            dataset={dataset}
          />
        </article>
      )}
    </div>
  )
}

function EmptyReportState({
  canManageWorkspaceData,
}: {
  canManageWorkspaceData: boolean
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-white p-12 text-center shadow-sm">
      <FileText
        className="mx-auto text-gray-300"
        size={40}
      />

      <h2 className="mt-4 text-xl font-semibold">
        No report data yet
      </h2>

      <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500">
        {canManageWorkspaceData
          ? "Upload or connect a dataset first. Reports use numeric dataset metrics and generated insights from your workspace data."
          : "Ask the workspace team to share a dataset first. Reports use numeric dataset metrics and generated insights from shared workspace data."}
      </p>

      <Link
        href="/dashboard/datasets"
        className="mt-5 inline-flex w-full justify-center rounded-xl bg-[var(--decisionate-brand-primary)] px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 sm:w-auto"
      >
        {canManageWorkspaceData
          ? "Open datasets"
          : "View datasets"}
      </Link>
    </div>
  )
}

function ReportHeader({
  brand,
  dataset,
  sourceLabel,
  generatedAt,
}: {
  brand: WorkspaceBrand
  dataset: ReportDatasetDetails
  sourceLabel: string
  generatedAt?: Date
}) {
  return (
    <header className="border-b pb-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <WorkspaceBrandMark
              name={brand.name}
              logoUrl={brand.logoUrl}
              primaryColor={brand.primaryColor}
              className="h-11 w-11 rounded-xl text-sm"
            />

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-950">
                {brand.name}
              </p>

              <p className="text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
                Performance Report
              </p>
            </div>
          </div>

          <h2 className="mt-5 break-words text-3xl font-bold text-gray-950">
            {dataset.file_name}
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            {dataset.row_count.toLocaleString()} rows •{" "}
            {dataset.column_count.toLocaleString()} columns •{" "}
            {sourceLabel}
          </p>
        </div>

        <p className="text-sm text-gray-500 lg:text-right">
          {generatedAt
            ? `Generated ${formatReportDate(generatedAt)}`
            : "Generating report"}
        </p>
      </div>
    </header>
  )
}

function ExecutiveSummary({
  dataset,
  metrics,
  insights,
  selectedMetric,
  analysisLoading,
  analysisError,
  onRetryAnalysis,
  onCreateRecommendation,
  creatingRecommendation,
}: {
  dataset: ReportDatasetDetails
  metrics: ReportMetric[]
  insights: ReportInsight[]
  selectedMetric?: string
  analysisLoading: boolean
  analysisError: boolean
  onRetryAnalysis: () => void
  onCreateRecommendation?: () => void
  creatingRecommendation: boolean
}) {
  return (
    <section className="grid gap-5 py-6 lg:grid-cols-[1fr_18rem]">
      <div className="rounded-2xl bg-gray-50 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <Sparkles size={16} />
          Executive summary
        </div>

        <p className="mt-3 text-sm leading-6 text-gray-700">
          This report summarizes{" "}
          <span className="break-words font-medium">
            {dataset.file_name}
          </span>{" "}
          using {metrics.length} numeric KPI metric
          {metrics.length === 1 ? "" : "s"} and{" "}
          {insights.length} generated insight
          {insights.length === 1 ? "" : "s"}. Use this as a client-ready snapshot for discussion, review, and decision follow-up.
        </p>

        {analysisLoading && (
          <AnalysisStatus
            kind="loading"
            className="mt-4"
          />
        )}

        {analysisError && (
          <AnalysisStatus
            kind="unavailable"
            className="mt-4"
            onRetry={onRetryAnalysis}
          />
        )}

        {!analysisLoading &&
          dataset.ai_analysis &&
          (!selectedMetric ||
            dataset.ai_analysis.metric === selectedMetric) && (
          <AIAnalysisPanel
            analysis={dataset.ai_analysis}
            title="Report analysis"
            metric={selectedMetric}
            className="mt-4 bg-white"
            actionClassName="print:hidden"
            onCreateDecision={onCreateRecommendation}
            creatingDecision={creatingRecommendation}
          />
        )}
      </div>

      <div className="rounded-2xl bg-[var(--decisionate-brand-primary-soft)] p-5 text-[var(--decisionate-brand-primary-text)]">
        <p className="text-sm font-medium">
          Report readiness
        </p>

        <p className="mt-3 text-3xl font-bold">
          {metrics.length > 0
            ? "Ready"
            : "Needs KPIs"}
        </p>

        <p className="mt-2 text-sm opacity-80">
          {metrics.length > 0
            ? "Dataset includes numeric metrics for reporting."
            : "Upload data with numeric KPI columns."}
        </p>
      </div>
    </section>
  )
}

function ReportMetricGrid({
  metrics,
}: {
  metrics: ReportMetric[]
}) {
  if (metrics.length === 0) {
    return (
      <section className="rounded-2xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-800">
        No numeric KPI metrics were found in this dataset. Choose a dataset with numeric columns such as revenue, orders, conversion rate, cost, volume, or other measurable business values.
      </section>
    )
  }

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.column}
          className="rounded-2xl border bg-white p-5"
        >
          <p className="truncate text-sm font-medium text-gray-500">
            {formatMetricLabel(metric.column)}
          </p>

          <p className="mt-2 text-2xl font-bold text-gray-950">
            {formatMetricValue(metric.total)}
          </p>

          <p className="mt-2 text-xs text-gray-500">
            Avg {formatMetricValue(metric.average)} • Range{" "}
            {formatMetricValue(
              metric.minimum ?? metric.min
            )}
            {" – "}
            {formatMetricValue(
              metric.maximum ?? metric.max
            )}
          </p>
        </div>
      ))}
    </section>
  )
}

function ReportChart({
  chart,
  metrics,
  selectedMetric,
}: {
  chart: ReportDatasetDetails["chart"]
  metrics: ReportMetric[]
  selectedMetric?: string
}) {
  const chartRows = chart?.data ?? []
  const xKey = chart?.x_key
  const yKey =
    selectedMetric ??
    chart?.y_key ??
    metrics[0]?.column
  const chartDescription =
    xKey && yKey
      ? getReportChartDescription(
          chartRows,
          xKey,
          yKey
        )
      : "No report trend chart data is available."

  if (
    !chartRows.length ||
    !xKey ||
    !yKey
  ) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed p-6 text-sm text-gray-500">
        No chartable report trend is available for this dataset. Add a date, month, quarter, or period column alongside numeric metrics to unlock trend charts.
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3
          size={18}
          className="text-[var(--decisionate-brand-primary-text)]"
        />

        <h3 className="font-semibold text-gray-950">
          KPI trend
        </h3>
      </div>

      <p className="mb-3 text-xs text-gray-500">
        {formatMetricLabel(yKey)} by {formatMetricLabel(xKey)}
        {selectedMetric
          ? " • selected report metric"
          : " • primary report metric"}
      </p>

      <div
        className="h-[350px]"
        role="img"
        aria-label={chartDescription}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey={xKey}
              angle={-35}
              textAnchor="end"
              height={64}
              tick={{ fontSize: 11 }}
              tickMargin={8}
            />
            <YAxis />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={yKey}
              name={formatMetricLabel(yKey)}
              stroke="var(--decisionate-brand-primary)"
              strokeWidth={3}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function prioritizeReportMetrics(
  metrics: ReportMetric[],
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

function getReportChartDescription(
  rows: ReportRow[],
  xKey: string,
  yKey: string
) {
  if (rows.length === 0) {
    return "No report trend chart data is available."
  }

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]

  return `KPI trend chart for ${formatMetricLabel(yKey)} across ${
    rows.length
  } period${rows.length === 1 ? "" : "s"} from ${formatReportChartValue(
    firstRow[xKey]
  )} to ${formatReportChartValue(
    lastRow[xKey]
  )}. Latest value is ${formatReportChartValue(lastRow[yKey])}.`
}

function formatReportChartValue(
  value: ReportCellValue
) {
  if (typeof value === "number") {
    return value.toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2,
      }
    )
  }

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "unknown"
  }

  return String(value)
}

function ReportInsights({
  insights,
  selectedMetric,
  onCreateDecision,
  allowDecisionCreation = true,
  creatingDecisionKey,
}: {
  insights: ReportInsight[]
  selectedMetric?: string
  onCreateDecision?: (
    insight: ReportInsight,
    insightKey: string
  ) => void
  allowDecisionCreation?: boolean
  creatingDecisionKey?: string
}) {
  if (insights.length === 0) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed p-6 text-sm text-gray-500">
        {selectedMetric
          ? "No generated insights match the selected report metric yet. Choose All Metrics to review every available insight."
          : "No generated insights are available for this report yet. Review the KPI snapshot above, or upload a richer dataset with categorical and numeric columns for stronger insight generation."}
      </section>
    )
  }

  return (
    <section className="mt-6">
      <h3 className="text-xl font-semibold">
        Key insights
      </h3>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {insights.map((insight, index) => (
          <InsightCard
            key={`${insight.title}-${index}`}
            insight={insight}
            label={insight.type || "Insight"}
            onCreateDecision={
              onCreateDecision && allowDecisionCreation
                ? () => {
                  onCreateDecision(
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
    </section>
  )
}

function getMetricFilteredReportInsights(
  insights: ReportInsight[],
  selectedMetric: string | undefined
) {
  if (!selectedMetric) {
    return insights
  }

  const selectedMetricText =
    normalizeReportMetricText(selectedMetric)

  return insights.filter(insight => {
    const insightColumn =
      normalizeReportMetricText(
        insight.column
      )

    if (
      insightColumn &&
      insightColumn === selectedMetricText
    ) {
      return true
    }

    const insightText =
      normalizeReportMetricText(
        `${insight.title} ${insight.description}`
      )

    return insightText.includes(
      selectedMetricText
    )
  })
}

function normalizeReportMetricText(
  value: string | undefined
) {
  return (value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function ReportFooter({
  dataset,
}: {
  dataset: ReportDatasetDetails
}) {
  return (
    <footer className="mt-8 break-words border-t pt-5 text-xs text-gray-400">
      Prepared from {dataset.file_name}. Review source data before making external commitments.
    </footer>
  )
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

function formatReportDate(
  value: Date
) {
  return value.toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  )
}
