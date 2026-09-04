"use client"

import {
  useEffect,
  useRef,
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
import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import {
  MetricSelector,
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"
import {
  AnalysisStatus,
} from "@/features/ai/components/analysis-status"
import {
  buildAIRecommendationDecisionPayload,
} from "@/features/decisions/lib/ai-decision-handoff"
import {
  createDecision,
  getDatasetAIAnalysis,
  getDatasetDetails,
  updateDatasetMetricSelection,
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

type DatasetDetails = {
  file_name: string
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  row_count: number
  column_count: number
  columns?: string[]
  numeric_columns?: string[]
  selected_metric_columns?: string[]
  metrics?: DatasetMetric[]
  ai_analysis?: AIAnalysis
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

function getPreviewNumericColumns(
  columns: string[],
  preview: DatasetRow[] | undefined
) {
  if (!preview?.length) {
    return []
  }

  return columns.filter(column => {
    const values = preview
      .map(row => row[column])
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value)
      )

    return (
      values.length === preview.length &&
      values.length > 0
    )
  })
}

function isIdentifierColumn(
  column: string
) {
  const words = column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)

  return words.some(
    word => word.toLowerCase() === "id"
  )
}

function excludeIdentifierColumns(
  columns: string[]
) {
  return columns.filter(
    column => !isIdentifierColumn(column)
  )
}

function getSelectedMetricColumns(
  dataset: DatasetDetails
) {
  return excludeIdentifierColumns(
    dataset.selected_metric_columns ??
    dataset.numeric_columns ??
    dataset.metrics?.map(
      metric => metric.column
    ) ??
    []
  )
}

export default function DatasetDetailsPage() {
  const params = useParams()
  const router = useRouter()

  const [dataset, setDataset] =
    useState<DatasetDetails | null>(null)
  const [selectedMetric, setSelectedMetric] =
    useState<string>()
  const [selectedMetricColumns, setSelectedMetricColumns] =
    useState<string[]>([])
  const [columnSearch, setColumnSearch] =
    useState("")
  const [savingMetricSelection, setSavingMetricSelection] =
    useState(false)
  const [metricSelectionError, setMetricSelectionError] =
    useState("")

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
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [creatingDecisionKey, setCreatingDecisionKey] =
    useState<string>()
  const [previewTableWidth, setPreviewTableWidth] =
    useState(0)
  const previewTableRef =
    useRef<HTMLTableElement>(null)
  const previewTopScrollRef =
    useRef<HTMLDivElement>(null)
  const previewHorizontalScrollRef =
    useRef<HTMLDivElement>(null)

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
      setSelectedMetricColumns([])
      setColumnSearch("")
      setMetricSelectionError("")
      setErrorMessage("")
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
        const data = await getDatasetDetails(
          datasetId,
          currentUserId,
          activeWorkspaceId,
          { includeAIAnalysis: false }
        )

        if (ignoreResult) {
          return
        }

        setDataset(data)
        setSelectedMetric(undefined)
        setSelectedMetricColumns(
          getSelectedMetricColumns(data)
        )
        setErrorMessage("")
      } catch (error) {
        if (!ignoreResult) {
          console.error(error)
          setDataset(null)
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

    queueMicrotask(() =>
      setSelectedMetric(undefined)
    )
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
    excludeIdentifierColumns(
      dataset?.metrics?.map(
        metric => metric.column
      ) ?? []
    )
  const previewColumns =
    dataset?.columns ??
    (dataset?.preview?.[0]
      ? Object.keys(dataset.preview[0])
      : [])
  const normalizedColumnSearch =
    columnSearch.trim().toLowerCase()
  const visiblePreviewColumns = normalizedColumnSearch
    ? previewColumns.filter(column =>
      column.toLowerCase().includes(normalizedColumnSearch)
    )
    : previewColumns
  const numericMetricColumns = new Set([
    ...excludeIdentifierColumns([
      ...(dataset?.numeric_columns ?? []),
      ...getPreviewNumericColumns(
        previewColumns,
        dataset?.preview
      ),
      ...(dataset?.numeric_columns?.length
        ? []
        : metricColumns),
    ]),
  ])
  const selectedMetricColumnSet = new Set(
    selectedMetricColumns
  )
  const effectiveSelectedMetric =
    selectedMetric &&
    metricColumns.includes(selectedMetric)
      ? selectedMetric
      : undefined
  const previewColumnSignature =
    visiblePreviewColumns.join("\u0000")

  useEffect(() => {
    const table = previewTableRef.current
    if (!table) {
      return
    }

    const updateTableWidth = () => {
      setPreviewTableWidth(table.scrollWidth)
    }
    const frame = window.requestAnimationFrame(
      updateTableWidth
    )
    const observer = new ResizeObserver(
      updateTableWidth
    )

    observer.observe(table)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [
    dataset?.file_name,
    dataset?.preview?.length,
    previewColumnSignature,
  ])

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
    (dataset.metrics ?? []).filter(
      metric => !isIdentifierColumn(metric.column)
    )
  const displayedMetrics =
    prioritizeDatasetMetrics(
      metrics,
      effectiveSelectedMetric
    )
  const aiRecommendationMetric =
    effectiveSelectedMetric ||
    (metricColumns.length === 1
      ? metricColumns[0]
      : undefined)

  function handleMetricChange(
    metric: string | undefined
  ) {
    setSelectedMetric(metric)
    setErrorMessage("")
  }

  function handleMetricColumnToggle(
    column: string,
    checked: boolean
  ) {
    setSelectedMetricColumns(currentColumns => {
      if (checked) {
        return currentColumns.includes(column)
          ? currentColumns
          : [...currentColumns, column]
      }

      return currentColumns.filter(
        currentColumn => currentColumn !== column
      )
    })
    setMetricSelectionError("")
  }

  async function saveMetricSelection(
    columns: string[]
  ) {
    if (
      !userId ||
      !datasetId ||
      !canManageWorkspaceData ||
      savingMetricSelection
    ) {
      return
    }

    try {
      setSavingMetricSelection(true)
      setMetricSelectionError("")
      setErrorMessage("")

      await updateDatasetMetricSelection(
        datasetId,
        columns,
        userId,
        activeWorkspaceId
      )

      const refreshedDataset = await getDatasetDetails(
        datasetId,
        userId,
        activeWorkspaceId,
        { includeAIAnalysis: false }
      )
      setDataset(refreshedDataset)
      setSelectedMetricColumns(
        getSelectedMetricColumns(refreshedDataset)
      )
      setSelectedMetric(currentMetric =>
        refreshedDataset.metrics?.some(
          (metric: DatasetMetric) =>
            metric.column === currentMetric
        )
          ? currentMetric
          : undefined
      )
    } catch (error) {
      setMetricSelectionError(
        getErrorMessage(
          error,
          "Could not save metric selection."
        )
      )
    } finally {
      setSavingMetricSelection(false)
    }
  }

  async function handleSaveMetricSelection() {
    await saveMetricSelection(selectedMetricColumns)
  }

  async function handleResetMetricSelection() {
    const defaultColumns = Array.from(numericMetricColumns)
    setSelectedMetricColumns(defaultColumns)
    await saveMetricSelection(defaultColumns)
  }

  async function handleUnselectAllMetricSelection() {
    setSelectedMetricColumns([])
    await saveMetricSelection([])
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
            <div className="w-full min-w-0 sm:w-72">
              <DatasetSelector
                value={datasetId ?? undefined}
                onChange={(nextDatasetId) => {
                  if (
                    nextDatasetId &&
                    nextDatasetId !== datasetId
                  ) {
                    router.push(
                      `/dashboard/datasets/${nextDatasetId}`
                    )
                  }
                }}
                ariaLabel="Select dataset details"
              />
            </div>

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
              Choose a metric to focus the summary cards and analysis.
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
            {sourceDetails.storedFileFormat && (
              <AnalyticsField
                label="Stored format"
                value={formatSourceValue(
                  sourceDetails.storedFileFormat
                )}
              />
            )}
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
        <div className="mb-4">
          <h2 className="text-2xl font-bold">
            Metrics
          </h2>
        </div>

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

      {/* Preview */}

      <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">
                Dataset Preview
              </h2>
              <label className="block w-full sm:w-64">
                <span className="sr-only">
                  Search columns
                </span>
                <input
                  type="search"
                  value={columnSearch}
                  onChange={(event) => {
                    setColumnSearch(event.target.value)
                  }}
                  placeholder="Search columns"
                  aria-label="Search dataset columns by name"
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Select the numeric columns Decisionate should use as metrics across the app.
            </p>
          </div>

          {canManageWorkspaceData && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleUnselectAllMetricSelection()
                }}
                disabled={savingMetricSelection}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Unselect all columns
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleResetMetricSelection()
                }}
                disabled={savingMetricSelection}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset to system defaults
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSaveMetricSelection()
                }}
                disabled={savingMetricSelection}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingMetricSelection
                  ? "Saving..."
                  : "Save column selection"}
              </button>
            </div>
          )}
        </div>

        {metricSelectionError && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {metricSelectionError}
          </p>
        )}

        {previewTableWidth > 0 && (
          <div
            ref={previewTopScrollRef}
            className="dataset-preview-top-scroll mb-2 overflow-x-auto"
            onScroll={(event) => {
              const tableScroll =
                previewHorizontalScrollRef.current
              if (
                tableScroll &&
                tableScroll.scrollLeft !==
                  event.currentTarget.scrollLeft
              ) {
                tableScroll.scrollLeft =
                  event.currentTarget.scrollLeft
              }
            }}
            role="region"
            aria-label="Horizontal scroll for dataset preview"
          >
            <div
              aria-hidden="true"
              className="h-px"
              style={{
                width: `${previewTableWidth}px`,
              }}
            />
          </div>
        )}

        <div>
          <div
            ref={previewHorizontalScrollRef}
            className="dataset-preview-horizontal-scroll overflow-x-auto"
            onScroll={(event) => {
              const topScroll =
                previewTopScrollRef.current
              if (
                topScroll &&
                topScroll.scrollLeft !==
                  event.currentTarget.scrollLeft
              ) {
                topScroll.scrollLeft =
                  event.currentTarget.scrollLeft
              }
            }}
          >
            <table
              ref={previewTableRef}
              aria-label={`Preview rows for ${dataset.file_name}`}
              className="min-w-full border-collapse text-sm"
            >
            <thead className="bg-gray-50">
              <tr>
                {visiblePreviewColumns.map((column) => {
                  const isNumericMetric =
                    numericMetricColumns.has(column)

                  return (
                    <th
                      key={column}
                      className="border-b px-4 py-3 text-left font-medium text-gray-600"
                    >
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            selectedMetricColumnSet.has(column)
                          }
                          disabled={
                            !canManageWorkspaceData ||
                            savingMetricSelection
                          }
                          onChange={(event) => {
                            handleMetricColumnToggle(
                              column,
                              event.target.checked
                            )
                          }}
                          title={
                            isNumericMetric
                              ? "Include this column as a metric"
                              : "Keep this source column available for dashboard dimensions"
                          }
                          aria-label={
                            isNumericMetric
                              ? `Use ${column} as a metric`
                              : `Use ${column} as a dashboard dimension`
                          }
                          className="h-4 w-4 shrink-0 accent-blue-600"
                        />
                        <span className="truncate">
                          {column}
                        </span>
                      </label>
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {dataset.preview?.length &&
              visiblePreviewColumns.length > 0 ? (
                dataset.preview.map(
                  (
                    row,
                    index: number
                  ) => (
                    <tr key={index}>
                      {visiblePreviewColumns.map(
                        column => (
                          <td
                            key={column}
                            className="max-w-xs break-words border-b px-4 py-3 text-gray-700"
                          >
                            {formatPreviewValue(
                              row[column]
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
                    colSpan={visiblePreviewColumns.length || 1}
                    className="px-4 py-6 text-sm text-gray-500"
                  >
                    {normalizedColumnSearch
                      ? "No columns match your search."
                      : "No preview rows available."}
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>

        {previewColumns.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No columns are available in this dataset.
          </p>
        ) : numericMetricColumns.size === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No numeric columns were detected in this dataset.
          </p>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            Numeric columns are selected as metrics by default. Other selected columns remain available for dashboard dimensions such as Channel Mix. Reset restores the initial numeric selection.
          </p>
        )}
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
