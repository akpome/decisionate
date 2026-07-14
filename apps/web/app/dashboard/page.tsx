"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useUser } from "@clerk/nextjs"
import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"

import {
  getDatasetDetails,
  getDatasetShareLink,
  getDatasetShareStatus,
  getDatasets,
  getDatasetPreference,
  stopDatasetSharing,
  updateDatasetPreference,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

import {
  Database,
  Download,
  Gauge,
  LineChart as LineChartIcon,
  Printer,
  Share2,
  Unlink,
} from "lucide-react"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

/* =========================
   Types
========================= */

type ChartType = "line" | "bar" | "area"
type ScaleMode = "actual" | "indexed"
type DashboardTemplate = "executive" | "performance" | "comparison"
type ShareAction = "share" | "stop"

type PeriodFilter =
  | "1m"
  | "1q"
  | "6m"
  | "1y"
  | "2y"
  | "3y"
  | "5y"
  | "all"

type DashboardCellValue =
  | string
  | number
  | Date
  | null
  | undefined

type DashboardRow = Record<string, DashboardCellValue>

type DashboardMetric = {
  column: string
  total?: number
  average?: number
  min?: number
  max?: number
  minimum?: number
  maximum?: number
}

type DashboardDataset = {
  file_name: string
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  preview: DashboardRow[]
  metrics: DashboardMetric[]
  chart?: {
    x_key?: string
    y_key?: string
    data?: DashboardRow[]
  }
}

type ReportSectionProps = {
  dataset: DashboardDataset
  metrics: DashboardMetric[]
  rows: DashboardRow[]
  chartRows: DashboardRow[]
  xKey: string
  selectedMetrics: string[]
  chartType: ChartType
  scaleMode: ScaleMode
  periodFilter: PeriodFilter
  startDate: string
  primaryMetric: string
  selectedTarget: number
  latestValue: number
  targetProgress: number
  targetMet: boolean
  showNarrative: boolean
  setShowNarrative: (value: boolean) => void
  setChartType: (value: ChartType) => void
  setScaleMode: (value: ScaleMode) => void
  setPeriodFilter: (value: PeriodFilter) => void
  setStartDate: (value: string) => void
  setTargets: Dispatch<SetStateAction<Record<string, number>>>
  onResetView: () => void
}

type DashboardViewPreference = {
  selectedMetrics?: string[]
  chartType?: ChartType
  scaleMode?: ScaleMode
  periodFilter?: PeriodFilter
  dashboardTemplate?: DashboardTemplate
  startDate?: string
}

type SharedDashboardConfig = {
  datasetId?: number
  dashboardTemplate?: DashboardTemplate
}

/* =========================
   Constants
========================= */

const colorPalette = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#4f46e5",
]

const chartTypes: ChartType[] = [
  "line",
  "bar",
  "area",
]

const scaleModes: ScaleMode[] = [
  "actual",
  "indexed",
]

const periodFilters: PeriodFilter[] = [
  "1m",
  "1q",
  "6m",
  "1y",
  "2y",
  "3y",
  "5y",
  "all",
]

const dashboardTemplates: DashboardTemplate[] = [
  "executive",
  "performance",
  "comparison",
]

const emptyDashboardDataset: DashboardDataset = {
  file_name: "",
  preview: [],
  metrics: [],
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

/* =========================
   Page Component
========================= */

export default function DashboardPage() {
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    isClientWorkspace,
  } =
    useWorkspaceAccess(user?.id)

  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()

  const [dataset, setDataset] =
    useState<DashboardDataset | null>(null)

  const [selectedMetrics, setSelectedMetrics] =
    useState<string[]>([])

  const [chartType, setChartType] =
    useState<ChartType>("line")

  const [scaleMode, setScaleMode] =
    useState<ScaleMode>("actual")

  const [periodFilter, setPeriodFilter] =
    useState<PeriodFilter>("1y")

  const [dashboardTemplate, setDashboardTemplate] =
    useState<DashboardTemplate>("executive")

  const [startDate, setStartDate] =
    useState("")

  const [targets, setTargets] =
    useState<Record<string, number>>({})

  const [metricTargetsByDataset, setMetricTargetsByDataset] =
    useState<Record<string, Record<string, number>>>({})

  const [
    dashboardPreferencesByDataset,
    setDashboardPreferencesByDataset,
  ] = useState<Record<string, DashboardViewPreference>>({})

  const [showNarrative, setShowNarrative] =
    useState(true)

  const [shareStatus, setShareStatus] =
    useState("")
  const [shareAction, setShareAction] =
    useState<ShareAction | null>(null)
  const [shareEnabled, setShareEnabled] =
    useState(false)
  const shareStatusTimeoutRef =
    useRef<number | null>(null)

  const [sharedConfig] =
    useState<SharedDashboardConfig>(
      () => getSharedDashboardConfig()
    )

  const [loading, setLoading] =
    useState(false)
  const [dashboardError, setDashboardError] =
    useState("")

  useEffect(() => {
    return () => {
      if (shareStatusTimeoutRef.current) {
        window.clearTimeout(
          shareStatusTimeoutRef.current
        )
      }
    }
  }, [])

  const clearShareStatus =
    useCallback(() => {
      if (shareStatusTimeoutRef.current) {
        window.clearTimeout(
          shareStatusTimeoutRef.current
        )
        shareStatusTimeoutRef.current = null
      }

      setShareStatus("")
    }, [])

  const clearSelectedDashboard =
    useCallback(() => {
      setDataset(null)
      setSelectedMetrics([])
      setTargets({})
      setShareEnabled(false)
      setLoading(false)
      clearShareStatus()
    }, [
      clearShareStatus,
    ])

  /* =========================
     Load Selected Dataset
  ========================= */

  useEffect(() => {
    if (!selectedDatasetId || !user?.id) {
      return
    }

    const userId = user.id
    const datasetId = selectedDatasetId
    let isCurrent = true

    async function loadDataset() {
      try {
        setLoading(true)

        const [
          data,
          preference,
          shareState,
        ] = await Promise.all([
          getDatasetDetails(
            datasetId,
            userId,
            activeWorkspaceId
          ),
          getDatasetPreference(
            userId,
            activeWorkspaceId
          ),
          getDatasetShareStatus(
            datasetId,
            userId,
            activeWorkspaceId
          ).catch(() => ({
            share_enabled: false,
          })),
        ])

        if (!isCurrent) {
          return
        }

        const savedTargets =
          preference.metric_targets ?? {}

        const savedDashboardPreferences =
          preference.dashboard_preferences ?? {}

        const datasetKey =
          String(datasetId)

        const savedDashboardPreference =
          savedDashboardPreferences[datasetKey] ?? {}

        const availableMetrics =
          data?.metrics?.map(
            (metric: DashboardMetric) => metric.column
          ) ?? []
        const datasetTargets =
          getSavedMetricTargets(
            savedTargets[datasetKey],
            availableMetrics
          )

        const safePeriodFilter =
          getSavedPeriodFilter(
            savedDashboardPreference.periodFilter
          )
        const savedChartRows =
          data?.chart?.data?.length
            ? data.chart.data
            : data?.preview ?? []

        const safeStartDate =
          getSafeStartDate(
            savedDashboardPreference.startDate,
            savedChartRows,
            data?.chart?.x_key ?? "month",
            safePeriodFilter
          )

        setDataset(data)
        setShareEnabled(
          shareState.share_enabled
        )
        setMetricTargetsByDataset(savedTargets)
        setDashboardPreferencesByDataset(
          savedDashboardPreferences
        )

        setSelectedMetrics(
          getSavedSelectedMetrics(
            savedDashboardPreference.selectedMetrics,
            availableMetrics
          )
        )

        setChartType(
          getSavedChartType(
            savedDashboardPreference.chartType
          )
        )

        setScaleMode(
          getSavedScaleMode(
            savedDashboardPreference.scaleMode
          )
        )

        setPeriodFilter(
          safePeriodFilter
        )

        setDashboardTemplate(
          getSavedDashboardTemplate(
            sharedConfig?.dashboardTemplate ??
              savedDashboardPreference.dashboardTemplate
          )
        )

        setStartDate(
          safeStartDate
        )

        setTargets(
          {
            ...buildDefaultTargets(
              data?.metrics ?? []
            ),
            ...datasetTargets,
          }
        )
        setDashboardError("")
      } catch (error) {
        if (isCurrent) {
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to load dashboard."
            )
          )
          console.error(error)
        }
      } finally {
        if (isCurrent) {
          setLoading(false)
        }
      }
    }

    loadDataset()

    return () => {
      isCurrent = false
    }
  }, [
    selectedDatasetId,
    activeWorkspaceId,
    sharedConfig,
    user?.id,
    workspaceVersion,
  ])

  /* =========================
     Load Default Dataset
  ========================= */

  useEffect(() => {
    if (!user?.id) return

    const userId = user.id
    let isCurrent = true

    async function loadDefaultDataset() {
      try {
        clearSelectedDashboard()
        setSelectedDatasetId(undefined)

        const preference =
          await getDatasetPreference(
            userId,
            activeWorkspaceId
          )

        if (!isCurrent) {
          return
        }

        setMetricTargetsByDataset(
          preference.metric_targets ?? {}
        )

        setDashboardPreferencesByDataset(
          preference.dashboard_preferences ?? {}
        )

        if (sharedConfig?.datasetId) {
          setSelectedDatasetId(
            sharedConfig.datasetId
          )
          return
        }

        if (preference.selected_dataset_id) {
          setSelectedDatasetId(
            preference.selected_dataset_id
          )
          return
        }

        const datasets =
          await getDatasets(
            userId,
            activeWorkspaceId
          )

        if (!isCurrent) {
          return
        }

        if (datasets.length > 0) {
          setSelectedDatasetId(
            datasets[0].id
          )
          return
        }

        setSelectedDatasetId(undefined)
      } catch (error) {
        if (isCurrent) {
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to load dashboard defaults."
            )
          )
          console.error(error)
        }
      }
    }

    loadDefaultDataset()

    return () => {
      isCurrent = false
    }
  }, [
    sharedConfig,
    activeWorkspaceId,
    clearSelectedDashboard,
    user?.id,
    workspaceVersion,
  ])

  /* =========================
     Persist Metric Targets
  ========================= */

  useEffect(() => {
    if (
      !user?.id ||
      !selectedDatasetId ||
      !dataset ||
      loading
    ) {
      return
    }

    const datasetKey =
      String(selectedDatasetId)

    const savedDatasetTargets =
      metricTargetsByDataset[datasetKey] ?? {}

    if (
      JSON.stringify(savedDatasetTargets) ===
      JSON.stringify(targets)
    ) {
      return
    }

    const nextMetricTargets = {
      ...metricTargetsByDataset,
      [datasetKey]: targets,
    }

    const saveTargetTimeout =
      window.setTimeout(async () => {
        try {
          await updateDatasetPreference(
            selectedDatasetId,
            user.id,
            undefined,
            nextMetricTargets,
            undefined,
            activeWorkspaceId
          )

          setMetricTargetsByDataset(
            nextMetricTargets
          )
          setDashboardError("")
        } catch (error) {
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to save metric targets."
            )
          )
          console.error(error)
        }
      }, 500)

    return () => {
      window.clearTimeout(saveTargetTimeout)
    }
  }, [
    dataset,
    loading,
    metricTargetsByDataset,
    selectedDatasetId,
    targets,
    activeWorkspaceId,
    user?.id,
  ])

  /* =========================
     Derived Dashboard Data
  ========================= */

  const allRows = useMemo(
    () =>
      dataset?.chart?.data?.length
        ? dataset.chart.data
        : dataset?.preview ?? [],
    [dataset]
  )
  const metrics = useMemo(
    () => dataset?.metrics ?? [],
    [dataset]
  )
  const xKey = dataset?.chart?.x_key ?? "month"

  const rows =
    filterRowsByPeriod(
      allRows,
      xKey,
      startDate,
      periodFilter
    )

  const primaryMetric =
    selectedMetrics[0] ??
    metrics[0]?.column ??
    ""

  const selectedTarget =
    targets[primaryMetric] ?? 0

  const latestValue =
    getLatestValue(rows, primaryMetric)

  const targetProgress =
    getTargetProgress(
      latestValue,
      selectedTarget
    )

  const targetMet =
    selectedTarget > 0 &&
    targetProgress >= 100

  const chartRows =
    scaleMode === "indexed" &&
    selectedMetrics.length > 1
      ? buildIndexedRows(
          rows,
          selectedMetrics,
          xKey
        )
      : rows

  /* =========================
     Persist Dashboard View
  ========================= */

  useEffect(() => {
    if (
      !user?.id ||
      !selectedDatasetId ||
      !dataset ||
      loading
    ) {
      return
    }

    const datasetKey =
      String(selectedDatasetId)

    const nextDashboardPreference: DashboardViewPreference = {
      selectedMetrics:
        getValidSelectedMetrics(
          selectedMetrics,
          metrics.map((metric) => metric.column)
        ),
      chartType,
      scaleMode,
      periodFilter,
      dashboardTemplate,
      startDate,
    }

    const savedDashboardPreference =
      dashboardPreferencesByDataset[datasetKey] ?? {}

    if (
      JSON.stringify(savedDashboardPreference) ===
      JSON.stringify(nextDashboardPreference)
    ) {
      return
    }

    const nextDashboardPreferences = {
      ...dashboardPreferencesByDataset,
      [datasetKey]: nextDashboardPreference,
    }

    const saveViewTimeout =
      window.setTimeout(async () => {
        try {
          await updateDatasetPreference(
            selectedDatasetId,
            user.id,
            undefined,
            undefined,
            nextDashboardPreferences,
            activeWorkspaceId
          )

          setDashboardPreferencesByDataset(
            nextDashboardPreferences
          )
          setDashboardError("")
        } catch (error) {
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to save dashboard view."
            )
          )
          console.error(error)
        }
      }, 500)

    return () => {
      window.clearTimeout(saveViewTimeout)
    }
  }, [
    chartType,
    dashboardPreferencesByDataset,
    dashboardTemplate,
    dataset,
    loading,
    periodFilter,
    scaleMode,
    selectedDatasetId,
    selectedMetrics,
    startDate,
    activeWorkspaceId,
    user?.id,
    metrics,
  ])

  const templateProps: ReportSectionProps = {
    dataset: dataset ?? emptyDashboardDataset,
    metrics,
    rows,
    chartRows,
    xKey,
    selectedMetrics,
    chartType,
    scaleMode,
    periodFilter,
    startDate,
    primaryMetric,
    selectedTarget,
    latestValue,
    targetProgress,
    targetMet,
    showNarrative,
    setShowNarrative,
    setChartType,
    setScaleMode,
    setPeriodFilter,
    setStartDate,
    setTargets,
    onResetView: handleResetView,
  }

  /* =========================
     Event Handlers
  ========================= */

  function handleMetricToggle(metric: string) {
    setSelectedMetrics((current) => {
      if (current.includes(metric)) {
        if (current.length === 1) {
          return current
        }

        return current.filter(
          item => item !== metric
        )
      }

      return [
        ...current,
        metric,
      ]
    })
  }

  function handleResetView() {
    setPeriodFilter("1y")
    setStartDate("")
    setScaleMode("actual")
    setChartType("line")
  }

  function setTemporaryShareStatus(
    status: string,
    duration = 2500
  ) {
    if (shareStatusTimeoutRef.current) {
      window.clearTimeout(
        shareStatusTimeoutRef.current
      )
    }

    setShareStatus(status)

    shareStatusTimeoutRef.current =
      window.setTimeout(() => {
        setShareStatus("")
        shareStatusTimeoutRef.current = null
      }, duration)
  }

  async function handleShareDashboard() {
    if (shareAction) {
      return
    }

    if (!selectedDatasetId || !user?.id) {
      setTemporaryShareStatus(
        "Select a dataset before sharing."
      )
      return
    }

    let shareUrl = ""

    try {
      setShareAction("share")

      const shareLink =
        await getDatasetShareLink(
          selectedDatasetId,
          user.id,
          activeWorkspaceId
        )
      shareUrl =
        buildDashboardShareUrl(
          selectedDatasetId,
          dashboardTemplate,
          shareLink.share_token
        )

      const copied =
        await copyTextToClipboard(shareUrl)

      setTemporaryShareStatus(
        copied ? "Copied" : shareUrl,
        copied ? 2500 : 8000
      )
      setShareEnabled(
        shareLink.share_enabled
      )
    } catch (error) {
      setTemporaryShareStatus(
        shareUrl ||
          `Unable to create share link. ${getErrorMessage(
            error,
            ""
          )}`.trim()
      )
    } finally {
      setShareAction(null)
    }
  }

  async function handleStopSharing() {
    if (shareAction) {
      return
    }

    if (!selectedDatasetId || !user?.id) {
      setTemporaryShareStatus(
        "Select a dataset before stopping sharing."
      )
      return
    }

    const confirmed =
      window.confirm(
        "Stopping sharing will make all existing shared dashboard links stop working. Continue?"
      )

    if (!confirmed) {
      return
    }

    try {
      setShareAction("stop")

      const shareState =
        await stopDatasetSharing(
          selectedDatasetId,
          user.id,
          activeWorkspaceId
        )

      setTemporaryShareStatus(
        "SharingStopped",
        3500
      )
      setShareEnabled(
        shareState.share_enabled
      )
    } catch (error) {
      setTemporaryShareStatus(
        `Unable to stop sharing. ${getErrorMessage(
          error,
          ""
        )}`.trim(),
        3500
      )
    } finally {
      setShareAction(null)
    }
  }

  const shareControlsDisabled =
    !selectedDatasetId ||
    !user?.id ||
    shareAction !== null ||
    !canManageWorkspaceData
  const stopSharingDisabled =
    shareControlsDisabled ||
    !shareEnabled
  const shareButtonLabel =
    shareAction === "share"
      ? shareEnabled
        ? "Copying..."
        : "Sharing..."
      : shareEnabled
        ? "Share link"
        : "Share"
  const shareButtonTitle =
    shareEnabled
      ? "Copy the current public dashboard link."
      : "Create and copy a public dashboard link."
  const shareButtonAriaLabel =
    shareEnabled
      ? "Copy public dashboard share link"
      : "Create public dashboard share link"

  return (
    <div className="screen-page space-y-4">
      {/* =========================
          Page Header
      ========================= */}

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">
            Dashboard
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Monitor performance, compare metrics, and track targets.
          </p>

          {selectedDatasetId && (
            <div className="mt-3">
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                  shareEnabled
                    ? "border-green-100 bg-green-50 text-green-700"
                    : "border-gray-200 bg-white text-gray-500"
                }`}
              >
                {shareEnabled
                  ? "Sharing on"
                  : "Sharing off"}
              </span>
            </div>
          )}

          {isClientWorkspace && (
            <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Client portal view: your agency manages public dashboard sharing for this workspace.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm"
          >
            <Printer size={16} />
            Print
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm"
          >
            <Download size={16} />
            PDF
          </button>

          {canManageWorkspaceData && (
            <>
              <button
                type="button"
                onClick={handleShareDashboard}
                disabled={shareControlsDisabled}
                title={shareButtonTitle}
                aria-label={shareButtonAriaLabel}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Share2 size={16} />
                {shareButtonLabel}
              </button>

              <button
                type="button"
                onClick={handleStopSharing}
                disabled={stopSharingDisabled}
                title="Turn off public access for this dashboard."
                aria-label="Stop sharing public dashboard"
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Unlink size={16} />
                {shareAction === "stop"
                  ? "Stopping..."
                  : "Stop sharing"}
              </button>
            </>
          )}

          <div className="flex items-center rounded-xl border border-gray-200 bg-white p-1">
            {([
              ["executive", "Executive"],
              ["performance", "Performance"],
              ["comparison", "Comparison"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setDashboardTemplate(value)
                }
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  dashboardTemplate === value
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-w-64 flex-1 xl:w-80 xl:flex-none">
            <DatasetSelector
              value={selectedDatasetId}
              onChange={(id) => {
                clearSelectedDashboard()
                setSelectedDatasetId(id)
              }}
            />
          </div>
        </div>
      </div>

      {shareStatus && (
        <div
          className={getShareStatusClassName(shareStatus)}
          role="status"
          aria-live="polite"
        >
          {getShareStatusMessage(shareStatus)}
        </div>
      )}

      {dashboardError && (
        <div
          className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {dashboardError}
        </div>
      )}

      {/* =========================
          Empty State
      ========================= */}

      {!selectedDatasetId && (
        <DashboardCard>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database
              size={36}
              className="text-gray-400"
            />

            <h2 className="mt-4 text-lg font-semibold">
              No dataset selected
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              Select a dataset to view your dashboard.
            </p>
          </div>
        </DashboardCard>
      )}

      {/* =========================
          Loading State
      ========================= */}

      {loading && (
        <DashboardCard>
          <p className="text-sm text-gray-500">
            Loading dashboard...
          </p>
        </DashboardCard>
      )}

      {/* =========================
          Dashboard Templates
      ========================= */}

      {dataset && !loading && (
        <>
          <div className="dashboard-report space-y-4 bg-white">
            {dashboardTemplate === "executive" && (
              <ExecutiveTemplate {...templateProps} />
            )}

            {dashboardTemplate === "performance" && (
              <PerformanceTemplate {...templateProps} />
            )}

            {dashboardTemplate === "comparison" && (
              <ComparisonTemplate {...templateProps} />
            )}

          </div>

          {/* =========================
              Metric Selection Cards
          ========================= */}

          <div className="grid gap-4 md:grid-cols-3">
            {metrics.map((metric, index) => (
              <MetricCard
                key={metric.column}
                metric={metric}
                index={index}
                rows={rows}
                xKey={xKey}
                chartType={chartType}
                selected={selectedMetrics.includes(
                  metric.column
                )}
                target={targets[metric.column] ?? 0}
                onTargetChange={(value) =>
                  setTargets((current) => ({
                    ...current,
                    [metric.column]: value,
                  }))
                }
                onToggle={() =>
                  handleMetricToggle(metric.column)
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* =========================
   Template: Executive
========================= */

function ExecutiveTemplate(
  props: ReportSectionProps
) {
  return <ReportSection {...props} />
}

/* =========================
   Template: Performance
========================= */

function PerformanceTemplate(
  props: ReportSectionProps
) {
  const hasChartData =
    props.chartRows.length > 0 &&
    props.selectedMetrics.length > 0

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <DashboardCard className="flex h-[660px] min-w-0 flex-col">
          <CardHeader
            title="Performance Target"
            description={getDashboardDatasetDescription(
              props.dataset
            )}
            icon={
              <IconBadge
                className={
                  props.targetMet
                    ? "bg-green-50 text-green-600"
                    : "bg-amber-50 text-amber-600"
                }
                icon={<Gauge size={22} />}
              />
            }
          />

          <div className="mt-5 flex justify-center">
            <TargetGauge
              value={props.targetProgress}
              actualValue={props.latestValue}
              targetValue={props.selectedTarget}
            />
          </div>

          <div className="mt-5 space-y-3">
            <TargetInput
              key={props.primaryMetric}
              label={`${formatMetricName(
                props.primaryMetric
              )} Target`}
              value={props.selectedTarget}
              onChange={(value) =>
                props.setTargets((current) => ({
                  ...current,
                  [props.primaryMetric]: value,
                }))
              }
            />

            <SnapshotRow
              label="Primary Metric"
              value={formatMetricName(
                props.primaryMetric
              )}
            />

            <SnapshotRow
              label="Current Value"
              value={formatNumber(
                props.latestValue
              )}
            />

            <SnapshotRow
              label="Target"
              value={formatNumber(
                props.selectedTarget
              )}
            />
          </div>

          <div
            className={`mt-4 rounded-xl border p-4 text-sm ${
              props.targetMet
                ? "border-green-100 bg-green-50 text-green-700"
                : "border-amber-100 bg-amber-50 text-amber-700"
            }`}
          >
            {getTargetInsight(
              props.primaryMetric,
              props.latestValue,
              props.selectedTarget
            )}
          </div>
        </DashboardCard>

        <DashboardCard className="flex h-[660px] min-w-0 flex-col">
          <CardHeader
            title={`${formatMetricName(
              props.primaryMetric
            )} Trend`}
            icon={
              <IconBadge
                className="bg-blue-50 text-blue-600"
                icon={<LineChartIcon size={22} />}
              />
            }
          />

          <DashboardControls
            chartType={props.chartType}
            scaleMode={props.scaleMode}
            periodFilter={props.periodFilter}
            startDate={props.startDate}
            selectedMetrics={props.selectedMetrics}
            setChartType={props.setChartType}
            setScaleMode={props.setScaleMode}
            setPeriodFilter={props.setPeriodFilter}
            setStartDate={props.setStartDate}
            onResetView={props.onResetView}
          />

          {hasChartData ? (
            <div className="mt-4 min-h-[320px] flex-1">
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <MainChart
                  chartType={props.chartType}
                  rows={props.chartRows}
                  xKey={props.xKey}
                  metrics={props.selectedMetrics}
                  allMetrics={props.metrics}
                  target={props.selectedTarget}
                  showTarget={
                    props.scaleMode === "actual"
                  }
                />
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmptyState className="mt-4 min-h-[320px] flex-1" />
          )}
        </DashboardCard>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {props.metrics.slice(0, 4).map((metric) => (
          <KpiCard
            key={metric.column}
            label={formatMetricName(metric.column)}
            value={metric.total ?? 0}
          />
        ))}
      </div>
    </>
  )
}

/* =========================
   Template: Comparison
========================= */

function ComparisonTemplate({
  metrics,
  chartRows,
  xKey,
  selectedMetrics,
  chartType,
  scaleMode,
  periodFilter,
  startDate,
  primaryMetric,
  selectedTarget,
  setChartType,
  setScaleMode,
  setPeriodFilter,
  setStartDate,
  onResetView,
}: ReportSectionProps) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        {metrics.slice(0, 4).map((metric) => (
          <KpiCard
            key={metric.column}
            label={formatMetricName(metric.column)}
            value={metric.total ?? 0}
          />
        ))}
      </div>

      <DashboardCard className="flex h-[720px] min-w-0 flex-col">
        <CardHeader
          title={
            selectedMetrics.length > 3
              ? `${formatMetricName(primaryMetric)} + ${
                  selectedMetrics.length - 1
                } more`
              : selectedMetrics.length > 1
                ? selectedMetrics
                    .map(formatMetricName)
                    .join(" vs ")
                : `${formatMetricName(
                    primaryMetric
                  )} Performance`
          }
          icon={
            <IconBadge
              className="bg-blue-50 text-blue-600"
              icon={<LineChartIcon size={22} />}
            />
          }
        />

        <DashboardControls
          chartType={chartType}
          scaleMode={scaleMode}
          periodFilter={periodFilter}
          startDate={startDate}
          selectedMetrics={selectedMetrics}
          setChartType={setChartType}
          setScaleMode={setScaleMode}
          setPeriodFilter={setPeriodFilter}
          setStartDate={setStartDate}
          onResetView={onResetView}
        />

        {hasChartData ? (
          <div className="mt-4 min-h-[360px] flex-1">
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <MainChart
                chartType={chartType}
                rows={chartRows}
                xKey={xKey}
                metrics={selectedMetrics}
                allMetrics={metrics}
                target={selectedTarget}
                showTarget={
                  scaleMode === "actual"
                }
              />
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartEmptyState className="mt-4 min-h-[360px] flex-1" />
        )}
      </DashboardCard>
    </>
  )
}

/* =========================
   Template: Executive Content
========================= */

function ReportSection({
  dataset,
  metrics,
  chartRows,
  xKey,
  selectedMetrics,
  chartType,
  scaleMode,
  periodFilter,
  startDate,
  primaryMetric,
  selectedTarget,
  latestValue,
  targetProgress,
  targetMet,
  showNarrative,
  setShowNarrative,
  setChartType,
  setScaleMode,
  setPeriodFilter,
  setStartDate,
  setTargets,
  onResetView,
}: ReportSectionProps) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0

  return (
    <>
      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-4">
        {metrics.slice(0, 4).map((metric) => (
          <KpiCard
            key={metric.column}
            label={formatMetricName(metric.column)}
            value={metric.total ?? 0}
          />
        ))}
      </div>

      {/* Executive Insight */}
      <div className="flex h-9 items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs text-blue-700">
        <div className="flex min-w-0 items-center">
          <span className="shrink-0 font-medium">
            Insight:
          </span>

          {showNarrative ? (
            <span className="ml-2 truncate">
              {getExecutiveNarrative(
                chartRows,
                selectedMetrics,
                primaryMetric
              )}
            </span>
          ) : (
            <span className="ml-2 text-blue-600">
              Hidden
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() =>
            setShowNarrative(!showNarrative)
          }
          className="ml-3 shrink-0 font-medium text-blue-700 hover:text-blue-900"
        >
          {showNarrative ? "Hide" : "Show"}
        </button>
      </div>

      {/* Main Executive Grid */}
      <div className="grid items-stretch gap-5 xl:h-[660px] xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Executive Chart Card */}
        <DashboardCard className="flex h-[560px] min-w-0 flex-col sm:h-[620px] xl:h-full">
          <CardHeader
            title={
              selectedMetrics.length > 3
                ? `${formatMetricName(primaryMetric)} + ${
                    selectedMetrics.length - 1
                  } more`
                : selectedMetrics.length > 1
                  ? selectedMetrics
                      .map(formatMetricName)
                      .join(" vs ")
                  : `${formatMetricName(
                      primaryMetric
                    )} Performance`
            }
            icon={
              <IconBadge
                className="bg-blue-50 text-blue-600"
                icon={<LineChartIcon size={22} />}
              />
            }
          />

          <DashboardControls
            chartType={chartType}
            scaleMode={scaleMode}
            periodFilter={periodFilter}
            startDate={startDate}
            selectedMetrics={selectedMetrics}
            setChartType={setChartType}
            setScaleMode={setScaleMode}
            setPeriodFilter={setPeriodFilter}
            setStartDate={setStartDate}
            onResetView={onResetView}
          />

          {hasChartData ? (
            <div className="mt-4 min-h-[320px] flex-1">
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <MainChart
                  chartType={chartType}
                  rows={chartRows}
                  xKey={xKey}
                  metrics={selectedMetrics}
                  allMetrics={metrics}
                  target={selectedTarget}
                  showTarget={
                    scaleMode === "actual"
                  }
                />
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmptyState className="mt-4 min-h-[320px] flex-1" />
          )}
        </DashboardCard>

        {/* Executive Target Card */}
        <DashboardCard className="flex min-w-0 flex-col justify-between xl:h-full">
          <div>
            <CardHeader
              title="Target Snapshot"
              description={getDashboardDatasetDescription(
                dataset
              )}
              icon={
                <IconBadge
                  className={
                    targetMet
                      ? "bg-green-50 text-green-600"
                      : "bg-amber-50 text-amber-600"
                  }
                  icon={<Gauge size={22} />}
                />
              }
            />

            <div className="mt-4 flex justify-center">
              <TargetGauge
                value={targetProgress}
                actualValue={latestValue}
                targetValue={selectedTarget}
              />
            </div>

            <div className="mt-4 space-y-3">
              <TargetInput
                key={primaryMetric}
                label={`${formatMetricName(
                  primaryMetric
                )} Target`}
                value={selectedTarget}
                onChange={(value) =>
                  setTargets((current) => ({
                    ...current,
                    [primaryMetric]: value,
                  }))
                }
              />

              <SnapshotRow
                label="Primary Metric"
                value={formatMetricName(
                  primaryMetric
                )}
              />

              <SnapshotRow
                label="Current Value"
                value={formatNumber(latestValue)}
              />

              <SnapshotRow
                label="Target"
                value={formatNumber(selectedTarget)}
              />
            </div>
          </div>

          <div
            className={`rounded-xl border p-4 text-sm ${
              targetMet
                ? "border-green-100 bg-green-50 text-green-700"
                : "border-amber-100 bg-amber-50 text-amber-700"
            }`}
          >
            {getTargetInsight(
              primaryMetric,
              latestValue,
              selectedTarget
            )}
          </div>
        </DashboardCard>
      </div>
    </>
  )
}

/* =========================
   Shared: Dashboard Controls
========================= */

function DashboardControls({
  chartType,
  scaleMode,
  periodFilter,
  startDate,
  selectedMetrics,
  setChartType,
  setScaleMode,
  setPeriodFilter,
  setStartDate,
  onResetView,
}: {
  chartType: ChartType
  scaleMode: ScaleMode
  periodFilter: PeriodFilter
  startDate: string
  selectedMetrics: string[]
  setChartType: (value: ChartType) => void
  setScaleMode: (value: ScaleMode) => void
  setPeriodFilter: (value: PeriodFilter) => void
  setStartDate: (value: string) => void
  onResetView: () => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <CompactSelect
        label="Chart"
        value={chartType}
        onChange={(value) =>
          setChartType(value as ChartType)
        }
        options={[
          ["line", "Line"],
          ["bar", "Bar"],
          ["area", "Area"],
        ]}
      />

      <CompactSelect
        label="Scale"
        value={scaleMode}
        onChange={(value) =>
          setScaleMode(value as ScaleMode)
        }
        options={[
          ["actual", "Actual"],
          ["indexed", "Indexed"],
        ]}
      />

      <CompactSelect
        label="Period"
        value={periodFilter}
        onChange={(value) =>
          setPeriodFilter(value as PeriodFilter)
        }
        options={[
          ["1m", "1M"],
          ["1q", "1Q"],
          ["6m", "6M"],
          ["1y", "1Y"],
          ["2y", "2Y"],
          ["3y", "3Y"],
          ["5y", "5Y"],
          ["all", "All"],
        ]}
      />

      <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 text-xs">
        <span className="whitespace-nowrap font-medium text-gray-500">
          Start
        </span>

        <input
          type="date"
          value={startDate}
          onChange={(event) =>
            setStartDate(event.target.value)
          }
          className="h-7 bg-transparent text-xs outline-none"
        />
      </label>

      <div className="flex h-9 items-center rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs text-blue-700">
        Showing&nbsp;
        <span className="font-semibold">
          {formatPeriodLabel(periodFilter)}
        </span>
        &nbsp;from&nbsp;
        <span className="font-semibold">
          {startDate
            ? formatMonthYear(startDate)
            : "first available period"}
        </span>
      </div>

      <button
        type="button"
        onClick={onResetView}
        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
      >
        Reset view
      </button>

      <div className="flex h-9 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs text-gray-600">
        Metrics:&nbsp;
        <span className="font-semibold text-gray-800">
          {selectedMetrics.length}
        </span>
      </div>

      {selectedMetrics.length > 5 && (
        <div className="flex h-9 items-center rounded-lg border border-amber-100 bg-amber-50 px-3 text-xs font-medium text-amber-700">
          Many metrics selected. Use Indexed scale.
        </div>
      )}
    </div>
  )
}

/* =========================
   Shared: Main Chart
========================= */

function MainChart({
  chartType,
  rows,
  xKey,
  metrics,
  allMetrics,
  target,
  showTarget,
}: {
  chartType: ChartType
  rows: DashboardRow[]
  xKey: string
  metrics: string[]
  allMetrics: DashboardMetric[]
  target: number
  showTarget: boolean
}) {
  const margin = {
    top: 20,
    right: 32,
    left: 8,
    bottom: 16,
  }

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={xKey} tickLine={false} />
      <YAxis
        width={70}
        tickLine={false}
        domain={["auto", "auto"]}
      />
      <Tooltip />
      <Legend />

      {showTarget && target > 0 && (
        <ReferenceLine
          y={target}
          stroke="#111827"
          strokeDasharray="4 4"
          label={{
            value: "Target",
            position: "insideTopRight",
            fill: "#111827",
            fontSize: 12,
          }}
        />
      )}
    </>
  )

  if (chartType === "bar") {
    return (
      <BarChart data={rows} margin={margin}>
        {common}

        {metrics.map(metric => (
          <Bar
            key={metric}
            dataKey={metric}
            name={formatMetricName(metric)}
            fill={getMetricColor(
              getMetricIndex(allMetrics, metric)
            )}
            radius={[8, 8, 0, 0]}
          />
        ))}
      </BarChart>
    )
  }

  if (chartType === "area") {
    return (
      <AreaChart data={rows} margin={margin}>
        {common}

        {metrics.map((metric, index) => (
          <Area
            key={metric}
            type="monotone"
            dataKey={metric}
            name={formatMetricName(metric)}
            stroke={getMetricColor(
              getMetricIndex(allMetrics, metric)
            )}
            fill={getMetricColor(
              getMetricIndex(allMetrics, metric)
            )}
            fillOpacity={
              index === 0 ? 0.18 : 0.1
            }
            strokeWidth={
              index === 0 ? 4 : 3
            }
            dot={false}
          />
        ))}
      </AreaChart>
    )
  }

  return (
    <LineChart data={rows} margin={margin}>
      {common}

      {metrics.map((metric, index) => (
        <Line
          key={metric}
          type="monotone"
          dataKey={metric}
          name={formatMetricName(metric)}
          stroke={getMetricColor(
            getMetricIndex(allMetrics, metric)
          )}
          strokeWidth={
            index === 0 ? 5 : 4
          }
          dot={{ r: index === 0 ? 4 : 3 }}
          activeDot={{ r: 7 }}
        />
      ))}
    </LineChart>
  )
}

/* =========================
   Shared: Metric Cards
========================= */

function MetricCard({
  metric,
  index,
  rows,
  xKey,
  chartType,
  selected,
  target,
  onToggle,
  onTargetChange,
}: {
  metric: DashboardMetric
  index: number
  rows: DashboardRow[]
  xKey: string
  chartType: ChartType
  selected: boolean
  target: number
  onToggle: () => void
  onTargetChange: (value: number) => void
}) {
  const latestValue =
    getLatestValue(rows, metric.column)

  const targetProgress =
    getTargetProgress(
      latestValue,
      target
    )

  const targetMet =
    target > 0 &&
    targetProgress >= 100

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault()
          onToggle()
        }
      }}
      className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
        selected
          ? "border-blue-300 bg-blue-50"
          : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">
            {formatMetricName(metric.column)}
          </h3>

          <p className="mt-1 text-sm text-gray-500">
            {getGrowth(rows, metric.column)}% growth
          </p>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            selected
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {selected ? "Selected" : "Select"}
        </button>
      </div>

      <div className="mt-3 h-20">
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <MiniChart
            rows={rows}
            xKey={xKey}
            metric={metric.column}
            chartType={chartType}
            color={getMetricColor(index)}
          />
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex justify-between text-sm">
        <span className="text-gray-500">
          Latest
        </span>

        <span className="font-semibold text-gray-900">
          {formatNumber(latestValue)}
        </span>
      </div>

      <div
        className="mt-3 rounded-xl border border-gray-200 bg-white p-3"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <label className="block text-xs font-medium text-gray-500">
          Target
        </label>

        <input
          type="number"
          min={0}
          value={
            target > 0
              ? target
              : ""
          }
          placeholder="Set target"
          onChange={(event) => {
            const nextValue =
              event.target.value

            onTargetChange(
              nextValue === ""
                ? 0
                : Number(nextValue)
            )
          }}
          className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-2 flex items-center justify-between text-xs">
          <span
            className={
              targetMet
                ? "text-green-600"
                : "text-gray-500"
            }
          >
            {target > 0
              ? `${targetProgress}% of target`
              : "No target set"}
          </span>

          {target > 0 && (
            <span className="font-medium text-gray-700">
              {formatNumber(target)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/* =========================
   Shared: Mini Chart
========================= */

function MiniChart({
  rows,
  xKey,
  metric,
  chartType,
  color,
}: {
  rows: DashboardRow[]
  xKey: string
  metric: string
  chartType: ChartType
  color: string
}) {
  if (chartType === "bar") {
    return (
      <BarChart data={rows}>
        <XAxis dataKey={xKey} hide />
        <YAxis hide />
        <Tooltip />
        <Bar
          dataKey={metric}
          fill={color}
          radius={[6, 6, 0, 0]}
        />
      </BarChart>
    )
  }

  if (chartType === "area") {
    return (
      <AreaChart data={rows}>
        <XAxis dataKey={xKey} hide />
        <YAxis hide />
        <Tooltip />

        <Area
          type="monotone"
          dataKey={metric}
          stroke={color}
          fill={color}
          fillOpacity={0.18}
          strokeWidth={3}
          dot={false}
        />
      </AreaChart>
    )
  }

  return (
    <LineChart data={rows}>
      <XAxis dataKey={xKey} hide />
      <YAxis hide />
      <Tooltip />

      <Line
        type="monotone"
        dataKey={metric}
        stroke={color}
        strokeWidth={3}
        dot={false}
      />
    </LineChart>
  )
}

/* =========================
   Shared: Gauge
========================= */

function TargetGauge({
  value,
  actualValue,
  targetValue,
}: {
  value: number
  actualValue: number
  targetValue: number
}) {
  const clampedValue =
    Math.min(Math.max(value, 0), 100)

  const angle =
    -90 + (clampedValue / 100) * 180

  const status =
    getTargetStatus(
      actualValue,
      targetValue
    )

  return (
    <div className="mx-auto w-52">
      <div className="relative h-32 w-52">
        <svg
          viewBox="0 0 220 135"
          className="h-full w-full"
        >
          {[
            "#ef4444",
            "#fb923c",
            "#f97316",
            "#facc15",
            "#84cc16",
            "#16a34a",
            "#166534",
          ].map((color, index) => {
            const start =
              -180 + index * (180 / 7)

            const end =
              -180 +
              (index + 1) * (180 / 7) -
              3

            return (
              <GaugeSegment
                key={color}
                startAngle={start}
                endAngle={end}
                color={color}
              />
            )
          })}

          <g
            transform={`rotate(${angle} 110 112)`}
          >
            <path
              d="M110 112 L104 48 Q110 30 116 48 Z"
              fill="#111827"
            />

            <circle
              cx="110"
              cy="112"
              r="10"
              fill="#111827"
            />
          </g>
        </svg>
      </div>

      <div className="-mt-2 text-center">
        <p className="text-3xl font-bold text-gray-900">
          {value}%
        </p>

        <p
          className={`text-xs font-medium ${status.className}`}
        >
          {status.text}
        </p>
      </div>
    </div>
  )
}

function GaugeSegment({
  startAngle,
  endAngle,
  color,
}: {
  startAngle: number
  endAngle: number
  color: string
}) {
  const centerX = 110
  const centerY = 112
  const radius = 82

  const start =
    polarToCartesian(
      centerX,
      centerY,
      radius,
      endAngle
    )

  const end =
    polarToCartesian(
      centerX,
      centerY,
      radius,
      startAngle
    )

  const d = [
    "M",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    0,
    0,
    end.x,
    end.y,
  ].join(" ")

  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth="24"
      strokeLinecap="round"
    />
  )
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians =
    (angleInDegrees * Math.PI) / 180

  return {
    x:
      centerX +
      radius * Math.cos(angleInRadians),
    y:
      centerY +
      radius * Math.sin(angleInRadians),
  }
}

/* =========================
   Shared: Inputs and Cards
========================= */

function TargetInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-500">
        {label}
      </span>

      <input
        type="number"
        value={value > 0 ? value : ""}
        min={0}
        placeholder="Set target"
        onChange={(event) => {
          const nextValue =
            event.target.value

          onChange(
            nextValue === ""
              ? 0
              : Number(nextValue)
          )
        }}
        className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  )
}

function CompactSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 text-xs">
      <span className="font-medium text-gray-500">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="h-7 bg-transparent text-xs font-medium text-gray-800 outline-none"
      >
        {options.map(
          ([optionValue, optionLabel]) => (
            <option
              key={optionValue}
              value={optionValue}
            >
              {optionLabel}
            </option>
          )
        )}
      </select>
    </label>
  )
}

function DashboardCard({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  )
}

function ChartEmptyState({
  className = "",
}: {
  className?: string
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center ${className}`}
    >
      <p className="max-w-sm text-sm text-gray-500">
        No chartable metrics are available for this dashboard.
      </p>
    </div>
  )
}

function CardHeader({
  title,
  description,
  icon,
}: {
  title: string
  description?: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {title}
        </h2>

        {description && (
          <p className="mt-1 text-sm text-gray-600">
            {description}
          </p>
        )}
      </div>

      {icon}
    </div>
  )
}

function IconBadge({
  icon,
  className,
}: {
  icon: React.ReactNode
  className: string
}) {
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${className}`}
    >
      {icon}
    </div>
  )
}

function KpiCard({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">
        {label}
      </p>

      <p className="mt-1 truncate text-2xl font-bold">
        {typeof value === "number"
          ? value.toLocaleString()
          : value}
      </p>
    </div>
  )
}

function SnapshotRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <span className="text-sm text-gray-500">
        {label}
      </span>

      <span className="font-semibold text-gray-900">
        {value}
      </span>
    </div>
  )
}

/* =========================
   Helpers: Data Preparation
========================= */

function buildDefaultTargets(
  metrics: DashboardMetric[]
) {
  return metrics.reduce(
    (
      result: Record<string, number>,
      metric
    ) => {
      result[metric.column] = 0
      return result
    },
    {}
  )
}

function getSavedMetricTargets(
  savedTargets: unknown,
  availableMetrics: string[]
) {
  if (
    !savedTargets ||
    typeof savedTargets !== "object" ||
    Array.isArray(savedTargets)
  ) {
    return {}
  }

  return availableMetrics.reduce<
    Record<string, number>
  >((result, metric) => {
    const value = (
      savedTargets as Record<string, unknown>
    )[metric]
    const numericValue =
      toFiniteDashboardNumber(value)

    if (numericValue !== null) {
      result[metric] = numericValue
    }

    return result
  }, {})
}

/* =========================
   Saved View Validation
========================= */

function getValidSelectedMetrics(
  selectedMetrics: unknown,
  availableMetrics: string[]
) {
  if (!Array.isArray(selectedMetrics)) {
    return []
  }

  return (
    selectedMetrics.filter(
      (metric): metric is string =>
        typeof metric === "string" &&
        availableMetrics.includes(metric)
    )
  )
}

function getSavedSelectedMetrics(
  savedMetrics: unknown,
  availableMetrics: string[]
) {
  const validSavedMetrics =
    getValidSelectedMetrics(
      savedMetrics,
      availableMetrics
    )

  if (validSavedMetrics.length > 0) {
    return validSavedMetrics
  }

  return availableMetrics.length > 0
    ? [availableMetrics[0]]
    : []
}

function getSavedChartType(
  savedChartType: unknown
): ChartType {
  return isSavedChartType(savedChartType)
    ? savedChartType
    : "line"
}

function getSavedScaleMode(
  savedScaleMode: unknown
): ScaleMode {
  return isSavedScaleMode(savedScaleMode)
    ? savedScaleMode
    : "actual"
}

function getSavedPeriodFilter(
  savedPeriodFilter: unknown
): PeriodFilter {
  return isSavedPeriodFilter(savedPeriodFilter)
    ? savedPeriodFilter
    : "1y"
}

function getSavedDashboardTemplate(
  savedDashboardTemplate: unknown
): DashboardTemplate {
  return isSavedDashboardTemplate(
    savedDashboardTemplate
  )
    ? savedDashboardTemplate
    : "executive"
}

function isSavedChartType(
  value: unknown
): value is ChartType {
  return (
    typeof value === "string" &&
    chartTypes.includes(value as ChartType)
  )
}

function isSavedScaleMode(
  value: unknown
): value is ScaleMode {
  return (
    typeof value === "string" &&
    scaleModes.includes(value as ScaleMode)
  )
}

function isSavedPeriodFilter(
  value: unknown
): value is PeriodFilter {
  return (
    typeof value === "string" &&
    periodFilters.includes(value as PeriodFilter)
  )
}

function isSavedDashboardTemplate(
  value: unknown
): value is DashboardTemplate {
  return (
    typeof value === "string" &&
    dashboardTemplates.includes(
      value as DashboardTemplate
    )
  )
}

function getSafeStartDate(
  savedStartDate: unknown,
  rows: DashboardRow[],
  xKey: string,
  periodFilter: PeriodFilter
) {
  if (
    typeof savedStartDate !== "string" ||
    !savedStartDate
  ) {
    return ""
  }

  const filteredRows =
    filterRowsByPeriod(
      rows,
      xKey,
      savedStartDate,
      periodFilter
    )

  return filteredRows.length > 0
    ? savedStartDate
    : ""
}

function getSharedDashboardConfig(): SharedDashboardConfig {
  if (typeof window === "undefined") {
    return {}
  }

  const params =
    new URLSearchParams(
      window.location.search
    )
  const datasetId =
    getQueryDatasetId(
      params.get("dataset")
    )
  const template =
    params.get("template")

  return {
    datasetId,
    dashboardTemplate:
      template
        ? getSavedDashboardTemplate(
            template as DashboardTemplate
          )
        : undefined,
  }
}

function getQueryDatasetId(
  value: string | null
) {
  if (!value) {
    return undefined
  }

  const datasetId = Number(value)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : undefined
}

function buildDashboardShareUrl(
  datasetId: number | undefined,
  dashboardTemplate: DashboardTemplate,
  token: string
) {
  if (typeof window === "undefined") {
    return "/share/dashboard"
  }

  const url =
    new URL(
      "/share/dashboard",
      window.location.origin
    )

  if (datasetId) {
    url.searchParams.set(
      "dataset",
      String(datasetId)
    )
  }

  url.searchParams.set(
    "template",
    dashboardTemplate
  )
  url.searchParams.set(
    "token",
    token
  )

  return url.toString()
}

function buildIndexedRows(
  rows: DashboardRow[],
  metrics: string[],
  xKey: string
) {
  return rows.map((row) => {
    const next: DashboardRow = {
      [xKey]: row[xKey],
    }

    metrics.forEach((metric) => {
      const first =
        toFiniteDashboardNumber(
          rows[0]?.[metric]
        )

      next[metric] =
        getSafeRatioPercent(
          toFiniteDashboardNumber(
            row[metric]
          ),
          first
        )
    })

    return next
  })
}

function filterRowsByPeriod(
  rows: DashboardRow[],
  xKey: string,
  startDate: string,
  period: PeriodFilter
) {
  if (rows.length === 0) return []

  const normalizedRows =
    rows.map((row, index) => ({
      ...row,
      __periodDate:
        getRowPeriodStartDate(
          row,
          xKey,
          index
        ),
    }))

  if (period === "all") {
    return normalizedRows
  }

  const monthCount =
    period === "1m"
      ? 1
      : period === "1q"
        ? 3
        : period === "6m"
          ? 6
          : period === "1y"
            ? 12
            : period === "2y"
              ? 24
              : period === "3y"
                ? 36
                : 60

  if (!startDate) {
    return normalizedRows.slice(
      0,
      monthCount
    )
  }

  const selected =
    new Date(`${startDate}T00:00:00`)

  const periodStart =
    new Date(
      selected.getFullYear(),
      selected.getMonth(),
      1
    )

  const periodEnd =
    new Date(
      periodStart.getFullYear(),
      periodStart.getMonth() +
        monthCount,
      1
    )

  return normalizedRows.filter((row) => {
    return (
      row.__periodDate >= periodStart &&
      row.__periodDate < periodEnd
    )
  })
}

function getRowPeriodStartDate(
  row: DashboardRow,
  xKey: string,
  index: number
) {
  const value = row?.[xKey]

  const yearCandidate =
    row.year ??
    row.Year ??
    row.fiscal_year ??
    row.FiscalYear

  const monthCandidate =
    row.month ??
    row.Month ??
    row.period ??
    row.Period ??
    value

  if (
    typeof yearCandidate === "number" &&
    typeof monthCandidate === "string"
  ) {
    const monthIndex =
      getMonthIndex(monthCandidate)

    if (monthIndex >= 0) {
      return new Date(
        yearCandidate,
        monthIndex,
        1
      )
    }
  }

  if (typeof value === "string") {
    const normalized =
      value.trim().toLowerCase()

    const parsed =
      new Date(`${value}T00:00:00`)

    if (!Number.isNaN(parsed.getTime())) {
      return new Date(
        parsed.getFullYear(),
        parsed.getMonth(),
        1
      )
    }

    const monthIndex =
      getMonthIndex(normalized)

    const yearMatch =
      normalized.match(
        /\b(20\d{2}|19\d{2})\b/
      )

    if (monthIndex >= 0 && yearMatch) {
      return new Date(
        Number(yearMatch[0]),
        monthIndex,
        1
      )
    }

    if (monthIndex >= 0) {
      const inferredYear =
        new Date().getFullYear() +
        Math.floor(index / 12)

      return new Date(
        inferredYear,
        monthIndex,
        1
      )
    }
  }

  return new Date(
    new Date().getFullYear(),
    index,
    1
  )
}

/* =========================
   Helpers: Metrics
========================= */

function getLatestValue(
  rows: DashboardRow[],
  metric: string
) {
  if (rows.length === 0) return 0

  return toFiniteDashboardNumber(
    rows[rows.length - 1]?.[metric] ?? 0
  ) ?? 0
}

function getTargetProgress(
  value: number,
  target: number
) {
  const cleanValue =
    toFiniteDashboardNumber(value) ?? 0
  const cleanTarget =
    toFiniteDashboardNumber(target)

  if (
    cleanTarget === null ||
    cleanTarget <= 0
  ) {
    return 0
  }

  return getSafeRatioPercent(
    cleanValue,
    cleanTarget
  )
}

function getTargetStatus(
  value: number,
  target: number
) {
  const cleanValue =
    toFiniteDashboardNumber(value) ?? 0
  const cleanTarget =
    toFiniteDashboardNumber(target)

  if (
    cleanTarget === null ||
    cleanTarget <= 0
  ) {
    return {
      text: "No target set",
      className: "text-gray-500",
    }
  }

  const progress =
    getSafeRatioPercent(
      cleanValue,
      cleanTarget
    )

  if (progress < 100) {
    return {
      text: `${progress}% of target`,
      className: "text-amber-600",
    }
  }

  if (progress === 100) {
    return {
      text: "100% of target",
      className: "text-green-600",
    }
  }

  return {
    text: `${progress}% of target`,
    className: "text-blue-600",
  }
}

function getGrowth(
  rows: DashboardRow[],
  metric: string
) {
  if (rows.length < 2) return 0

  const first =
    toFiniteDashboardNumber(
      rows[0]?.[metric]
    )

  const last =
    toFiniteDashboardNumber(
      rows[rows.length - 1]?.[metric]
    )

  if (
    first === null ||
    first === 0 ||
    last === null
  ) {
    return 0
  }

  return Math.round(
    ((last - first) / first) * 100
  )
}

function getExecutiveNarrative(
  rows: DashboardRow[],
  selectedMetrics: string[],
  primaryMetric: string
) {
  if (rows.length < 2 || !primaryMetric) {
    return "Not enough data to generate an executive summary."
  }

  const primaryGrowth =
    getGrowth(rows, primaryMetric)

  const metricLabel =
    formatMetricName(primaryMetric)

  if (selectedMetrics.length === 1) {
    return `${metricLabel} changed by ${primaryGrowth}% over the selected period.`
  }

  const comparisons =
    selectedMetrics
      .filter(metric => metric !== primaryMetric)
      .map(metric => {
        const growth =
          getGrowth(rows, metric)

        return `${formatMetricName(metric)} changed by ${growth}%`
      })
      .join(", ")

  return `${metricLabel} changed by ${primaryGrowth}% over the selected period. Compared metrics: ${comparisons}.`
}

function getTargetInsight(
  metric: string,
  value: number,
  target: number
) {
  const cleanValue =
    toFiniteDashboardNumber(value) ?? 0
  const cleanTarget =
    toFiniteDashboardNumber(target)

  if (
    cleanTarget === null ||
    cleanTarget <= 0
  ) {
    return `Set a target for ${formatMetricName(metric)} to monitor performance.`
  }

  if (cleanValue >= cleanTarget) {
    return `${formatMetricName(metric)} has reached ${getTargetProgress(cleanValue, cleanTarget)}% of target.`
  }

  return `${formatMetricName(metric)} is ${formatNumber(cleanTarget - cleanValue)} below target.`
}

/* =========================
   Helpers: Formatting
========================= */

function getMonthIndex(value: string) {
  const normalized =
    value.trim().toLowerCase()

  return [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].findIndex(month =>
    normalized.includes(month)
  )
}

function getMetricIndex(
  metrics: DashboardMetric[],
  metric: string
) {
  const index =
    metrics.findIndex(
      (item) =>
        item.column === metric
    )

  return Math.max(index, 0)
}

function getMetricColor(index: number) {
  return colorPalette[
    index % colorPalette.length
  ]
}

function formatMetricName(metric: string) {
  if (!metric) return "None"

  return metric
    .split("_")
    .map(
      word =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ")
}

function getDashboardDatasetDescription(
  dataset: DashboardDataset
) {
  const sourceDetails =
    getDatasetSourceDetails(
      dataset.source_type,
      dataset.source_config,
      dataset.source_label
    )

  if (!dataset.file_name) {
    return sourceDetails.label
  }

  return `${dataset.file_name} • ${sourceDetails.label}`
}

function formatNumber(value: number) {
  return (
    toFiniteDashboardNumber(value) ?? 0
  ).toLocaleString(
    undefined,
    {
      maximumFractionDigits: 2,
    }
  )
}

function toFiniteDashboardNumber(
  value: unknown
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null
  }

  if (
    typeof value === "string" &&
    !value.trim()
  ) {
    return null
  }

  const numericValue = Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function getSafeRatioPercent(
  value: number | null,
  baseline: number | null
) {
  if (
    value === null ||
    baseline === null ||
    baseline === 0
  ) {
    return 0
  }

  return Math.round(
    (value / baseline) * 100
  )
}

function getShareStatusMessage(status: string) {
  if (status === "Copied") {
    return "Share link copied."
  }

  if (status === "SharingStopped") {
    return "Sharing stopped. Existing shared links no longer work."
  }

  if (status.startsWith("http")) {
    return `Share link created: ${status}`
  }

  return status
}

function getShareStatusClassName(status: string) {
  const baseClassName =
    "rounded-lg border px-3 py-2 text-sm break-words"

  if (status.startsWith("Unable")) {
    return `${baseClassName} border-red-100 bg-red-50 text-red-700`
  }

  if (status === "SharingStopped") {
    return `${baseClassName} border-green-100 bg-green-50 text-green-700`
  }

  if (status.startsWith("Select")) {
    return `${baseClassName} border-amber-100 bg-amber-50 text-amber-700`
  }

  if (status.startsWith("http")) {
    return `${baseClassName} break-all border-blue-100 bg-blue-50 text-blue-700`
  }

  return `${baseClassName} border-blue-100 bg-blue-50 text-blue-700`
}

async function copyTextToClipboard(text: string) {
  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return copyTextWithSelection(text)
    }
  }

  return copyTextWithSelection(text)
}

function copyTextWithSelection(text: string) {
  const textarea =
    document.createElement("textarea")

  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"

  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

function formatPeriodLabel(
  period: PeriodFilter
) {
  const labels: Record<PeriodFilter, string> = {
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

function formatMonthYear(value: string) {
  const date =
    new Date(`${value}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(
    undefined,
    {
      month: "short",
      year: "numeric",
    }
  )
}
