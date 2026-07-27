"use client"

import {
  useSearchParams,
} from "next/navigation"
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
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

import {
  getPublicSharedDashboard,
  type DashboardAggregation,
  type DecisionSummary,
} from "@/lib/api"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import {
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import {
  WorkspaceBrandMark,
} from "@/app/dashboard/workspace-brand-mark"
import {
  defaultWorkspaceBrand,
  getBrandColorWithAlpha,
  getBrandSurfaceTextColor,
  getReadableBrandTextColor,
  getWorkspaceBrandFromPayload,
  type WorkspaceBrand,
} from "@/lib/workspace-brand"
import {
  useWorkspaceBrowserBrand,
} from "@/lib/use-workspace-browser-brand"
import {
  dashboardRegistry,
  type DashboardChartTitles,
  type DashboardMetricMapping,
} from "@/features/dashboards/dashboard-registry"
import {
  dashboardUsesDatasetMetricMapping,
  defaultDashboardKey,
  getDashboardDefinition,
  isDashboardKey,
} from "@/features/dashboards/dashboard-definitions"

type ChartType = "line" | "bar" | "area"
type ScaleMode = "actual" | "indexed"
type MetricAggregation = DashboardAggregation
type DashboardTemplate =
  | "executive"
  | "performance"
  | "comparison"
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

type DashboardRow =
  Record<string, DashboardCellValue>

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
  row_count?: number
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  preview?: DashboardRow[]
  metrics: DashboardMetric[]
  chart?: {
    x_key?: string
    y_key?: string
    data?: DashboardRow[]
  }
}

type SharedDashboardConfig = {
  datasetId?: number
  dashboardTemplate?: DashboardTemplate
  selectedDashboard?: string
  token?: string
}

type SharedBrandStyle =
  CSSProperties & {
    "--decisionate-brand-primary": string
    "--decisionate-brand-primary-soft": string
    "--decisionate-brand-primary-ring": string
    "--decisionate-brand-primary-text": string
    "--decisionate-brand-primary-surface-text": string
    "--decisionate-brand-accent": string
    "--decisionate-brand-accent-soft": string
    "--decisionate-brand-accent-ring": string
    "--decisionate-brand-accent-text": string
  }

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
const maxDashboardKpiCards = 8
const maxDashboardTitleLength = 120
const maxDashboardSubtitleLength = 220

const defaultColorPalette = [
  "#2563eb",
  "#14b8a6",
  "#f97316",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#4f46e5",
]

const unavailableSharedDashboardMessage =
  "This shared dashboard link is no longer available."

export default function SharedDashboardPage() {
  return (
    <Suspense
      fallback={
        <SharedPageShell>
          <SharedCard
            role="status"
            aria-live="polite"
          >
            <p className="text-sm text-gray-500">
              Loading shared dashboard...
            </p>
          </SharedCard>
        </SharedPageShell>
      }
    >
      <SharedDashboardContent />
    </Suspense>
  )
}

function SharedDashboardContent() {
  const searchParams =
    useSearchParams()
  const searchParamString =
    searchParams.toString()
  const sharedConfig =
    useMemo(
      () =>
        getSharedDashboardConfig(
          searchParamString
        ),
      [searchParamString]
    )
  const [dataset, setDataset] =
    useState<DashboardDataset | null>(null)
  const [sharedBrand, setSharedBrand] =
    useState<WorkspaceBrand>(defaultWorkspaceBrand)
  const [selectedMetrics, setSelectedMetrics] =
    useState<string[]>([])
  const [chartType, setChartType] =
    useState<ChartType>("line")
  const [scaleMode, setScaleMode] =
    useState<ScaleMode>("actual")
  const [periodFilter, setPeriodFilter] =
    useState<PeriodFilter>("1y")
  const [aggregation, setAggregation] =
    useState<MetricAggregation>("monthly")
  const [dashboardTemplate, setDashboardTemplate] =
    useState<DashboardTemplate>("executive")
  const [dashboardTitle, setDashboardTitle] =
    useState("")
  const [
    dashboardSubtitle,
    setDashboardSubtitle,
  ] = useState("")
  const [
    dashboardMetricMapping,
    setDashboardMetricMapping,
  ] = useState<DashboardMetricMapping>({})
  const [dashboardChartTitles, setDashboardChartTitles] =
    useState<DashboardChartTitles>({})
  const [decisionSummary, setDecisionSummary] =
    useState<DecisionSummary | null>(null)
  const [startDate, setStartDate] =
    useState("")
  const [targets, setTargets] =
    useState<Record<string, number>>({})
  const [loading, setLoading] =
    useState(true)
  const [pageError, setPageError] =
    useState("")
  const [sharedLoadRetryKey, setSharedLoadRetryKey] =
    useState(0)
  const sharedDatasetId =
    sharedConfig.datasetId
  const sharedDashboardTemplate =
    sharedConfig.dashboardTemplate
  const sharedSelectedDashboard =
    sharedConfig.selectedDashboard ?? ""
  const sharedToken =
    sharedConfig.token ?? ""
  const sharedConfigKey =
    [
      sharedDatasetId ?? "",
      sharedSelectedDashboard,
      sharedDashboardTemplate ?? "",
      sharedToken,
    ].join("|")

  useEffect(() => {
    const [
      datasetIdValue,
      selectedDashboardValue,
      dashboardTemplateValue,
      tokenValue,
    ] = sharedConfigKey.split("|")
    const effectDatasetId =
      getQueryDatasetId(datasetIdValue)
    const effectDashboardTemplate =
      dashboardTemplateValue
        ? getSavedDashboardTemplate(
            dashboardTemplateValue as DashboardTemplate
          )
        : undefined
    const effectSelectedDashboard =
      selectedDashboardValue || undefined
    const effectToken =
      tokenValue || undefined
    let isCurrent = true
    const abortController =
      new AbortController()

    function setSharedPageError(message: string) {
      if (!isCurrent) {
        return
      }

      setPageError(message)
    }

    function clearSharedDashboardState() {
      if (!isCurrent) {
        return
      }

      setDataset(null)
      setSharedBrand(defaultWorkspaceBrand)
      setSelectedMetrics([])
      setTargets({})
      setDashboardMetricMapping({})
      setDashboardChartTitles({})
      setDecisionSummary(null)
      setDashboardTitle("")
      setDashboardSubtitle("")
      setStartDate("")
      setAggregation("monthly")
    }

    async function loadSharedDashboard() {
      try {
        setLoading(true)
        setPageError("")

        if (effectDashboardTemplate) {
          setDashboardTemplate(
            effectDashboardTemplate
          )
        }

        const datasetId =
          effectDatasetId

        if (!datasetId) {
          clearSharedDashboardState()
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        if (!effectToken) {
          clearSharedDashboardState()
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        const response =
          await getPublicSharedDashboard(
            datasetId,
            effectToken,
            effectSelectedDashboard,
            abortController.signal
          )

        if (!response) {
          clearSharedDashboardState()
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        const data =
          response.dataset
        const preference =
          response.preference

        const datasetKey =
          String(datasetId)
        const dashboardPreference =
          preference.dashboard_preferences?.[
            datasetKey
          ] ?? {}
        const sharedDashboardMetricMapping =
          getSavedDashboardMetricMapping(
            effectSelectedDashboard
              ? dashboardPreference.metricMappings?.[
                  effectSelectedDashboard
                ]
              : undefined
          )
        const sharedDashboardChartTitles =
          effectSelectedDashboard
            ? dashboardPreference.chartTitles?.[
                effectSelectedDashboard
              ] ?? {}
            : {}
        const availableMetrics =
          data.metrics?.map(
            (metric) => metric.column
          ) ?? []
        const safePeriodFilter =
          getSavedPeriodFilter(
            dashboardPreference.periodFilter
          )
        const safeAggregation =
          getSavedAggregation(
            dashboardPreference.aggregation
          )
        const savedChartRows =
          data.chart?.data?.length
            ? data.chart.data
            : data.preview ?? []

        if (!isCurrent) {
          return
        }

        setDataset(data)
        setDecisionSummary(
          response.decision_summary ?? null
        )
        setSharedBrand(
          getWorkspaceBrandFromPayload(
            response.branding
          )
        )
        setSelectedMetrics(
          getSavedSelectedMetrics(
            dashboardPreference.selectedMetrics,
            availableMetrics
          )
        )
        setChartType(
          getSavedChartType(
            dashboardPreference.chartType
          )
        )
        setScaleMode(
          getSavedScaleMode(
            dashboardPreference.scaleMode
          )
        )
        setPeriodFilter(safePeriodFilter)
        setAggregation(safeAggregation)
        setDashboardTemplate(
          getSavedDashboardTemplate(
            dashboardPreference.dashboardTemplate ??
              effectDashboardTemplate
          )
        )
        setDashboardTitle(
          getSavedDashboardText(
            dashboardPreference.title,
            "",
            maxDashboardTitleLength
          )
        )
        setDashboardSubtitle(
          getSavedDashboardText(
            dashboardPreference.subtitle,
            "",
            maxDashboardSubtitleLength
          )
        )
        setDashboardMetricMapping(
          sharedDashboardMetricMapping
        )
        setDashboardChartTitles(
          sharedDashboardChartTitles
        )
        setStartDate(
          getSafeStartDate(
            dashboardPreference.startDate,
            savedChartRows,
            data.chart?.x_key ?? "month",
            safePeriodFilter
          )
        )
        setTargets(
          getSavedMetricTargets(
            preference.metric_targets?.[
              datasetKey
            ],
            availableMetrics
          )
        )
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        clearSharedDashboardState()
        setSharedPageError(
          error instanceof Error &&
            error.message
            ? error.message
            : "Unable to load this shared dashboard."
        )
      } finally {
        if (isCurrent) {
          setLoading(false)
        }
      }
    }

    void loadSharedDashboard()

    return () => {
      isCurrent = false
      abortController.abort()
    }
  }, [
    sharedLoadRetryKey,
    sharedConfigKey,
  ])

  const effectiveDashboardTemplate =
    dashboardTemplate
  const selectedDashboardDefinition =
    getDashboardDefinition(
      sharedConfig.selectedDashboard
    )
  const sharedDashboardTitle =
    selectedDashboardDefinition.key !==
    defaultDashboardKey
      ? selectedDashboardDefinition.name
      : getSavedDashboardText(
          dashboardTitle,
          getSharedDashboardTitle(
            effectiveDashboardTemplate
          ),
          maxDashboardTitleLength
        )

  useWorkspaceBrowserBrand(
    `${sharedDashboardTitle} | ${sharedBrand.name}`,
    sharedBrand
  )

  const metrics =
    useMemo(
      () => dataset?.metrics ?? [],
      [dataset]
    )
  const dashboardColorPalette =
    useMemo(
      () => getDashboardColorPalette(
        sharedBrand.primaryColor,
        sharedBrand.accentColor
      ),
      [
        sharedBrand.accentColor,
        sharedBrand.primaryColor,
      ]
    )
  const sharedPrimaryTextColor =
    getReadableBrandTextColor(
      sharedBrand.primaryColor
    )
  const sharedAccentTextColor =
    getReadableBrandTextColor(
      sharedBrand.accentColor,
      defaultWorkspaceBrand.accentColor
    )
  const allRows =
    useMemo(
      () =>
        dataset?.chart?.data?.length
          ? dataset.chart.data
          : dataset?.preview ?? [],
      [dataset]
    )
  const xKey =
    dataset?.chart?.x_key ?? "month"
  const rows =
    filterRowsByPeriod(
      allRows,
      xKey,
      startDate,
      periodFilter
    )
  const aggregatedRows = useMemo(
    () =>
      aggregateRowsByDate(
        rows,
        xKey,
        aggregation,
        metrics.map(metric => metric.column)
      ),
    [
      aggregation,
      metrics,
      rows,
      xKey,
    ]
  )
  const primaryMetric =
    selectedMetrics[0] ??
    metrics[0]?.column ??
    ""
  const selectedTarget =
    targets[primaryMetric] ?? 0
  const latestValue =
    getLatestValue(
      aggregatedRows,
      primaryMetric
    )
  const targetProgress =
    getTargetProgress(
      latestValue,
      selectedTarget
    )
  const chartRows =
    scaleMode === "indexed" &&
    selectedMetrics.length > 1
      ? buildIndexedRows(
          aggregatedRows,
          selectedMetrics,
          xKey
        )
      : aggregatedRows

  if (loading) {
    return (
      <SharedPageShell brand={sharedBrand}>
        <SharedCard
          role="status"
          aria-live="polite"
        >
          <p className="text-sm text-gray-500">
            Loading {sharedDashboardTitle.toLowerCase()}...
          </p>
        </SharedCard>
      </SharedPageShell>
    )
  }

  if (pageError || !dataset) {
    return (
      <SharedPageShell brand={sharedBrand}>
        <SharedCard role="alert">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              {pageError || "Dashboard not found."}
            </p>

            <button
              type="button"
              onClick={() =>
                setSharedLoadRetryKey(
                  currentKey => currentKey + 1
                )
              }
              className="w-fit rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Try again
            </button>
          </div>
        </SharedCard>
      </SharedPageShell>
    )
  }

  const sourceDetails =
    dataset
      ? getDatasetSourceDetails(
          dataset.source_type,
          dataset.source_config,
          dataset.source_label
        )
      : null
  const sharedDatasetDescription =
    dataset
      ? getDashboardDatasetDescription(
          dataset,
          sourceDetails
        )
      : ""
  const sharedDashboardSubtitle =
    getSavedDashboardText(
      dashboardSubtitle,
      sharedDatasetDescription,
      maxDashboardSubtitleLength
    )

  if (
    selectedDashboardDefinition.key !==
    defaultDashboardKey
  ) {
    const SelectedDashboard =
      dashboardRegistry[
        selectedDashboardDefinition.componentKey
      ]
    return (
      <SharedPageShell brand={sharedBrand}>
        <SelectedDashboard
          name={selectedDashboardDefinition.name}
          description={selectedDashboardDefinition.description}
          highlights={selectedDashboardDefinition.highlights}
          dataset={{
            ...dataset,
            chart: {
              ...(dataset.chart ?? {}),
              data: rows,
            },
          }}
          datasetId={sharedDatasetId}
          aggregation={aggregation}
          manualMapping={
            dashboardUsesDatasetMetricMapping(
              selectedDashboardDefinition.componentKey
            )
              ? dashboardMetricMapping
              : undefined
          }
          chartTitles={dashboardChartTitles}
          decisionSummary={decisionSummary}
          brand={sharedBrand}
          showActions={false}
        />

        <SharedDashboardControls
          periodFilter={periodFilter}
          setPeriodFilter={setPeriodFilter}
          aggregation={aggregation}
          setAggregation={setAggregation}
          startDate={startDate}
          setStartDate={setStartDate}
        />
      </SharedPageShell>
    )
  }

  return (
    <SharedPageShell brand={sharedBrand}>
      <div className="space-y-5">
        <div
          className="rounded-2xl bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <WorkspaceBrandMark
                name={sharedBrand.name}
                logoUrl={sharedBrand.logoUrl}
                primaryColor={sharedBrand.primaryColor}
                className="h-14 w-14 rounded-2xl text-lg"
              />

              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Shared by
                </p>

                <p
                  className="break-words text-xl font-semibold"
                  style={{
                    color: sharedPrimaryTextColor,
                  }}
                >
                  {sharedBrand.name}
                </p>

                <p
                  className="text-sm"
                  style={{
                    color: sharedAccentTextColor,
                  }}
                >
                  Reporting workspace
                </p>
              </div>
            </div>

            <div className="min-w-0 sm:text-right">
              <h1 className="break-words text-3xl font-bold tracking-tight text-gray-950">
                {sharedDashboardTitle}
              </h1>

              <p className="mt-1 break-words text-sm text-gray-500">
                {sharedDashboardSubtitle}
              </p>

              {sharedDatasetDescription &&
                sharedDatasetDescription !==
                  sharedDashboardSubtitle && (
                  <p className="mt-1 break-words text-xs text-gray-400">
                    {sharedDatasetDescription}
                  </p>
                )}
            </div>
          </div>

        </div>

        {effectiveDashboardTemplate === "executive" && (
          <>
            <KpiGrid metrics={metrics} />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <MainChartCard
                chartType={chartType}
                chartRows={chartRows}
                xKey={xKey}
                selectedMetrics={selectedMetrics}
                metrics={metrics}
                primaryMetric={primaryMetric}
                selectedTarget={selectedTarget}
                scaleMode={scaleMode}
                colorPalette={dashboardColorPalette}
              />

              <TargetKpiCard
                primaryMetric={primaryMetric}
                latestValue={latestValue}
                selectedTarget={selectedTarget}
                targetProgress={targetProgress}
              />
            </div>
          </>
        )}

        {effectiveDashboardTemplate === "performance" && (
          <>
            <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <TargetKpiCard
                primaryMetric={primaryMetric}
                latestValue={latestValue}
                selectedTarget={selectedTarget}
                targetProgress={targetProgress}
              />

              <MainChartCard
                chartType={chartType}
                chartRows={chartRows}
                xKey={xKey}
                selectedMetrics={selectedMetrics}
                metrics={metrics}
                primaryMetric={primaryMetric}
                selectedTarget={selectedTarget}
                scaleMode={scaleMode}
                colorPalette={dashboardColorPalette}
              />
            </div>

            <KpiGrid metrics={metrics} />
          </>
        )}

        {effectiveDashboardTemplate === "comparison" && (
          <MainChartCard
            key={`shared-comparison-${chartType}-${scaleMode}-${selectedMetrics.join(
              "|"
            )}-${chartRows.length}`}
            chartType={chartType}
            chartRows={chartRows}
            xKey={xKey}
            selectedMetrics={selectedMetrics}
            metrics={metrics}
            primaryMetric={primaryMetric}
            selectedTarget={selectedTarget}
            scaleMode={scaleMode}
            colorPalette={dashboardColorPalette}
            className="w-full xl:h-[720px]"
            chartAreaClassName="mt-4 h-[520px] flex-none xl:h-auto xl:min-h-[560px] xl:flex-1"
          />
        )}

        <SharedDashboardControls
          chartType={chartType}
          setChartType={setChartType}
          scaleMode={scaleMode}
          setScaleMode={setScaleMode}
          periodFilter={periodFilter}
          setPeriodFilter={setPeriodFilter}
          aggregation={aggregation}
          setAggregation={setAggregation}
          startDate={startDate}
          setStartDate={setStartDate}
          showChartControls
        />
      </div>
    </SharedPageShell>
  )
}

function SharedDashboardControls({
  chartType,
  setChartType,
  scaleMode,
  setScaleMode,
  periodFilter,
  setPeriodFilter,
  aggregation,
  setAggregation,
  startDate,
  setStartDate,
  showChartControls = false,
}: {
  chartType?: ChartType
  setChartType?: (value: ChartType) => void
  scaleMode?: ScaleMode
  setScaleMode?: (value: ScaleMode) => void
  periodFilter: PeriodFilter
  setPeriodFilter: (value: PeriodFilter) => void
  aggregation: MetricAggregation
  setAggregation: (value: MetricAggregation) => void
  startDate: string
  setStartDate: (value: string) => void
  showChartControls?: boolean
}) {
  return (
    <div className="mt-4 grid min-w-0 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 sm:grid-cols-2 lg:grid-cols-5">
      {showChartControls && (
        <>
          <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
            <span className="block">Chart</span>
            <select
              value={chartType}
              onChange={event =>
                setChartType?.(
                  event.target.value as ChartType
                )
              }
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
            >
              <option value="line">Line</option>
              <option value="bar">Bar</option>
              <option value="area">Area</option>
            </select>
          </label>

          <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
            <span className="block">Scale</span>
            <select
              value={scaleMode}
              onChange={event =>
                setScaleMode?.(
                  event.target.value as ScaleMode
                )
              }
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
            >
              <option value="actual">Actual</option>
              <option value="indexed">Indexed</option>
            </select>
          </label>
        </>
      )}

      <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
        <span className="block">Start date</span>
        <input
          type="date"
          value={startDate}
          onChange={event =>
            setStartDate(event.target.value)
          }
          className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
        />
      </label>

      <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
        <span className="block">Duration</span>
        <select
          value={periodFilter}
          onChange={event =>
            setPeriodFilter(
              event.target.value as PeriodFilter
            )
          }
          className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
        <span className="block">Sum by</span>
        <select
          value={aggregation}
          onChange={event =>
            setAggregation(
              event.target.value as MetricAggregation
            )
          }
          className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
      </label>

      <p className="col-span-full truncate self-end text-xs text-gray-500 lg:col-span-1 lg:pb-2">
        Showing {formatPeriodLabel(periodFilter)} from {startDate
          ? formatMonthYear(startDate)
          : "first available period"}
      </p>
    </div>
  )
}

function KpiGrid({
  metrics,
}: {
  metrics: DashboardMetric[]
}) {
  const scrollRef =
    useRef<HTMLDivElement | null>(null)
  const canScroll =
    metrics.length > maxDashboardKpiCards

  if (metrics.length === 0) {
    return null
  }

  function scrollKpis(direction: -1 | 1) {
    const node = scrollRef.current

    if (!node) {
      return
    }

    node.scrollBy({
      left:
        direction *
        Math.max(node.clientWidth * 0.9, 320),
      behavior: "smooth",
    })
  }

  return (
    <section className="space-y-2">
      {canScroll && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => scrollKpis(-1)}
            aria-label="Show previous KPI cards"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-semibold text-gray-600 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={() => scrollKpis(1)}
            aria-label="Show more KPI cards"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-semibold text-gray-600 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
          >
            ›
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="dashboard-kpi-scroll flex gap-4 overflow-x-auto scroll-smooth pb-2"
      >
        {metrics.map((metric) => (
          <div
            key={metric.column}
            className="dashboard-kpi-strip-card"
          >
            <KpiCard
              label={formatMetricName(
                metric.column
              )}
              value={metric.total ?? 0}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function MainChartCard({
  chartType,
  chartRows,
  xKey,
  selectedMetrics,
  metrics,
  primaryMetric,
  selectedTarget,
  scaleMode,
  colorPalette,
  className = "xl:h-[640px]",
  chartAreaClassName = "mt-4 h-[360px] flex-none xl:h-auto xl:min-h-[360px] xl:flex-1",
}: {
  chartType: ChartType
  chartRows: DashboardRow[]
  xKey: string
  selectedMetrics: string[]
  metrics: DashboardMetric[]
  primaryMetric: string
  selectedTarget: number
  scaleMode: ScaleMode
  colorPalette: string[]
  className?: string
  chartAreaClassName?: string
}) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0
  const chartDescription =
    getSharedDashboardChartDescription({
      chartType,
      rows: chartRows,
      xKey,
      metrics: selectedMetrics,
      target: selectedTarget,
      showTarget: scaleMode === "actual",
    })

  return (
    <SharedCard className={`flex min-w-0 flex-col ${className}`}>
      <CardHeader
        title={
          selectedMetrics.length > 1
            ? selectedMetrics
                .map(formatMetricName)
                .join(" vs ")
            : `${formatMetricName(
                primaryMetric
              )} Performance`
        }
        description="Main chart"
      />

      {hasChartData ? (
        <div
          className={chartAreaClassName}
          role="img"
          aria-label={chartDescription}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
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
              colorPalette={colorPalette}
            />
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center ${chartAreaClassName}`}
        >
          <p className="max-w-sm text-sm text-gray-500">
            No chartable metrics are available for this shared dashboard.
          </p>
        </div>
      )}
    </SharedCard>
  )
}

function TargetKpiCard({
  primaryMetric,
  latestValue,
  selectedTarget,
  targetProgress,
  className = "xl:h-[640px]",
}: {
  primaryMetric: string
  latestValue: number
  selectedTarget: number
  targetProgress: number
  className?: string
}) {
  return (
    <SharedCard className={`flex min-w-0 flex-col ${className}`}>
      <CardHeader
        title="Target KPI"
        description={formatMetricName(
          primaryMetric
        )}
      />

      <div className="mt-6 flex justify-center">
        <TargetGauge
          value={targetProgress}
          actualValue={latestValue}
          targetValue={selectedTarget}
        />
      </div>

      <div className="mt-auto space-y-3 pt-6">
        <SnapshotRow
          label="Current Value"
          value={formatNumber(latestValue)}
        />

        <SnapshotRow
          label="Target"
          value={formatNumber(selectedTarget)}
        />

        <SnapshotRow
          label="Progress"
          value={`${targetProgress}%`}
        />
      </div>
    </SharedCard>
  )
}

function SharedPageShell({
  children,
  brand = defaultWorkspaceBrand,
}: {
  children: React.ReactNode
  brand?: WorkspaceBrand
}) {
  return (
    <main
      className="min-h-screen bg-[var(--decisionate-app-surface-muted)] p-4 sm:p-6 lg:p-8"
      style={getSharedBrandStyle(brand)}
    >
      <div className="mx-auto w-full max-w-none">
        {children}
      </div>
    </main>
  )
}

function getSharedBrandStyle(
  brand: WorkspaceBrand
): SharedBrandStyle {
  return {
    "--decisionate-brand-primary": brand.primaryColor,
    "--decisionate-brand-primary-soft":
      getBrandColorWithAlpha(
        brand.primaryColor,
        "12"
      ),
    "--decisionate-brand-primary-ring":
      getBrandColorWithAlpha(
        brand.primaryColor,
        "33"
      ),
    "--decisionate-brand-primary-text":
      getReadableBrandTextColor(
        brand.primaryColor
      ),
    "--decisionate-brand-primary-surface-text":
      getBrandSurfaceTextColor(
        brand.primaryColor
      ),
    "--decisionate-brand-accent": brand.accentColor,
    "--decisionate-brand-accent-soft":
      getBrandColorWithAlpha(
        brand.accentColor,
        "12"
      ),
    "--decisionate-brand-accent-ring":
      getBrandColorWithAlpha(
        brand.accentColor,
        "33"
      ),
    "--decisionate-brand-accent-text":
      getReadableBrandTextColor(
        brand.accentColor,
        defaultWorkspaceBrand.accentColor
      ),
  }
}

function SharedCard({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

function CardHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div>
      <h2 className="break-words text-xl font-semibold tracking-tight">
        {title}
      </h2>

      {description && (
        <p className="mt-1 break-words text-sm text-gray-500">
          {description}
        </p>
      )}
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
    <SharedCard className="min-w-0">
      <p className="truncate text-sm text-gray-500">
        {label}
      </p>

      <p className="mt-1 truncate text-2xl font-bold text-gray-950">
        {typeof value === "number"
          ? value.toLocaleString()
          : value}
      </p>
    </SharedCard>
  )
}

function MainChart({
  chartType,
  rows,
  xKey,
  metrics,
  allMetrics,
  target,
  showTarget,
  colorPalette,
}: {
  chartType: ChartType
  rows: DashboardRow[]
  xKey: string
  metrics: string[]
  allMetrics: DashboardMetric[]
  target: number
  showTarget: boolean
  colorPalette: string[]
}) {
  const margin = {
    top: 0,
    right: 32,
    left: 8,
    bottom: 42,
  }

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis
        dataKey={xKey}
        angle={-35}
        textAnchor="end"
        height={48}
        tickLine={false}
        tickMargin={8}
      />
      <YAxis
        width={70}
        tickLine={false}
        domain={["auto", "auto"]}
      />
      <Tooltip />
      <Legend
        verticalAlign="top"
        height={28}
      />

      {showTarget && target > 0 && (
        <ReferenceLine
          y={target}
          stroke="var(--decisionate-brand-primary)"
          strokeDasharray="4 4"
          label={{
            value: "Target",
            position: "insideTopRight",
            fill: "var(--decisionate-brand-primary)",
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

        {metrics.map((metric) => (
          <Bar
            key={metric}
            dataKey={metric}
            name={formatMetricName(metric)}
            fill={getMetricColor(
              getMetricIndex(allMetrics, metric),
              colorPalette
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
              getMetricIndex(allMetrics, metric),
              colorPalette
            )}
            fill={getMetricColor(
              getMetricIndex(allMetrics, metric),
              colorPalette
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
            getMetricIndex(allMetrics, metric),
            colorPalette
          )}
          strokeWidth={
            index === 0 ? 5 : 4
          }
          dot={false}
          activeDot={{ r: 7 }}
        />
      ))}
    </LineChart>
  )
}

function getSharedDashboardChartDescription({
  chartType,
  rows,
  xKey,
  metrics,
  target,
  showTarget,
}: {
  chartType: ChartType
  rows: DashboardRow[]
  xKey: string
  metrics: string[]
  target: number
  showTarget: boolean
}) {
  if (
    rows.length === 0 ||
    metrics.length === 0
  ) {
    return "No shared dashboard chart data is available."
  }

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const firstPeriod =
    formatSharedChartCellValue(firstRow[xKey])
  const lastPeriod =
    formatSharedChartCellValue(lastRow[xKey])
  const metricLabels =
    metrics.map(formatMetricName)
  const latestValues =
    metrics.slice(0, 3).map(metric =>
      `${formatMetricName(metric)} ${formatSharedChartCellValue(lastRow[metric])}`
    )
  const hiddenMetricCount =
    Math.max(metrics.length - latestValues.length, 0)
  const hiddenMetricSummary =
    hiddenMetricCount > 0
      ? `, plus ${hiddenMetricCount} more metric${
          hiddenMetricCount === 1 ? "" : "s"
        }`
      : ""
  const targetSummary =
    showTarget && target > 0
      ? ` Target is ${formatNumber(target)}.`
      : ""

  return `${formatMetricName(chartType)} chart showing ${metricLabels.join(
    ", "
  )} across ${rows.length} period${rows.length === 1 ? "" : "s"} from ${firstPeriod} to ${lastPeriod}. Latest values: ${latestValues.join(
    ", "
  )}${hiddenMetricSummary}.${targetSummary}`
}

function formatSharedChartCellValue(
  value: DashboardCellValue
) {
  if (value instanceof Date) {
    return value.toLocaleDateString()
  }

  const numericValue =
    toFiniteDashboardNumber(value)

  if (numericValue !== null) {
    return formatNumber(numericValue)
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
    <div
      role="img"
      aria-label={`Target progress ${value} percent. ${status.text}. Current value ${formatNumber(
        actualValue
      )}; target ${formatNumber(targetValue)}.`}
      className="mx-auto w-52"
    >
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
            "var(--decisionate-brand-accent)",
            "var(--decisionate-brand-accent-text)",
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
              fill="var(--decisionate-brand-primary)"
            />

            <circle
              cx="110"
              cy="112"
              r="10"
              fill="var(--decisionate-brand-primary)"
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

function SnapshotRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-gray-500">
        {label}
      </span>

      <span className="break-words font-semibold text-gray-900 sm:text-right">
        {value}
      </span>
    </div>
  )
}

function getSharedDashboardConfig(
  searchParamString: string
): SharedDashboardConfig {
  const params =
    new URLSearchParams(
      searchParamString
    )
  const datasetId =
    getQueryDatasetId(
      params.get("dataset")
    )
  const template =
    params.get("template")
  const selectedDashboard =
    params.get("dashboard")?.trim()
  const token =
    params.get("token")?.trim()

  return {
    datasetId,
    dashboardTemplate:
      template
        ? getSavedDashboardTemplate(
            template as DashboardTemplate
          )
        : undefined,
    selectedDashboard:
      isDashboardKey(selectedDashboard)
        ? selectedDashboard
        : undefined,
    token: token || undefined,
  }
}

function getSharedDashboardTitle(
  dashboardTemplate: DashboardTemplate
) {
  switch (dashboardTemplate) {
    case "executive":
      return "Executive Dashboard"
    case "comparison":
      return "Comparison Dashboard"
    case "performance":
    default:
      return "Performance Dashboard"
  }
}

function getDashboardDatasetDescription(
  dataset: DashboardDataset,
  sourceDetails: ReturnType<
    typeof getDatasetSourceDetails
  > | null
) {
  return sourceDetails
    ? `${dataset.file_name} • ${sourceDetails.label}`
    : dataset.file_name
}

function cleanDashboardText(
  value: string,
  maxLength: number
) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function getSavedDashboardText(
  value: unknown,
  fallback: string,
  maxLength: number
) {
  if (typeof value !== "string") {
    return fallback
  }

  const cleanValue = cleanDashboardText(
    value,
    maxLength
  )

  return cleanValue || fallback
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

function getSavedSelectedMetrics(
  savedMetrics: unknown,
  availableMetrics: string[]
) {
  if (!Array.isArray(savedMetrics)) {
    return availableMetrics.length > 0
      ? [availableMetrics[0]]
      : []
  }

  const validSavedMetrics =
    savedMetrics.filter(
      (metric): metric is string =>
        typeof metric === "string" &&
        availableMetrics.includes(metric)
    )

  if (validSavedMetrics.length > 0) {
    return validSavedMetrics
  }

  return availableMetrics.length > 0
    ? [availableMetrics[0]]
    : []
}

function getSavedDashboardMetricMapping(
  mapping: unknown
): DashboardMetricMapping {
  if (
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping)
  ) {
    return {}
  }

  return (
    [
      "primary",
      "category",
      "stage",
      "date",
    ] as const
  ).reduce<DashboardMetricMapping>(
    (result, key) => {
      const value = (
        mapping as Record<string, unknown>
      )[key]

      if (typeof value === "string" && value.trim()) {
        result[key] = value.trim().slice(0, 120)
      }

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

function getSavedAggregation(
  savedAggregation: unknown
): MetricAggregation {
  return isSavedAggregation(savedAggregation)
    ? savedAggregation
    : "monthly"
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

function isSavedAggregation(
  value: unknown
): value is MetricAggregation {
  return (
    value === "daily" ||
    value === "weekly" ||
    value === "quarterly" ||
    value === "monthly"
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

  const firstDate =
    startDate
      ? new Date(`${startDate}T00:00:00`)
      : normalizedRows[0].__periodDate

  if (
    Number.isNaN(firstDate.getTime())
  ) {
    return normalizedRows
  }

  const endDate =
    new Date(firstDate)
  endDate.setMonth(
    endDate.getMonth() + monthCount
  )

  return normalizedRows.filter((row) => {
    const rowDate =
      row.__periodDate

    return (
      rowDate >= firstDate &&
      rowDate < endDate
    )
  })
}

function aggregateRowsByDate(
  rows: DashboardRow[],
  xKey: string,
  aggregation: MetricAggregation,
  metricColumns: string[]
) {
  const buckets = new Map<
    string,
    {
      date: Date
      values: Record<string, number>
    }
  >()

  rows.forEach((row, index) => {
    const rowDate =
      row.__periodDate instanceof Date
        ? row.__periodDate
        : getRowPeriodStartDate(
            row,
            xKey,
            index
          )
    const bucketDate =
      getAggregationBucketDate(
        rowDate,
        aggregation
      )
    const bucketKey = formatDateKey(bucketDate)
    const bucket =
      buckets.get(bucketKey) ?? {
        date: bucketDate,
        values: {},
      }

    metricColumns.forEach(metric => {
      bucket.values[metric] =
        (bucket.values[metric] ?? 0) +
        (toFiniteDashboardNumber(row[metric]) ?? 0)
    })

    buckets.set(bucketKey, bucket)
  })

  return Array.from(buckets.values())
    .sort((first, second) =>
      first.date.getTime() - second.date.getTime()
    )
    .map(bucket => ({
      [xKey]: formatAggregationLabel(
        bucket.date,
        aggregation
      ),
      ...bucket.values,
    }))
}

function getAggregationBucketDate(
  value: Date,
  aggregation: MetricAggregation
) {
  const date = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  )

  if (aggregation === "monthly") {
    date.setDate(1)
    return date
  }

  if (aggregation === "quarterly") {
    date.setDate(1)
    date.setMonth(
      Math.floor(date.getMonth() / 3) * 3
    )
    return date
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

function formatDateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-")
}

function formatAggregationLabel(
  value: Date,
  aggregation: MetricAggregation
) {
  const dateKey = formatDateKey(value)

  return aggregation === "weekly"
    ? `Week of ${dateKey}`
    : aggregation === "quarterly"
      ? `${value.getFullYear()} Q${Math.floor(value.getMonth() / 3) + 1}`
    : aggregation === "monthly"
      ? dateKey.slice(0, 7)
      : dateKey
}

function getRowPeriodStartDate(
  row: DashboardRow,
  xKey: string,
  index: number
) {
  const rawValue =
    row[xKey]

  if (
    rawValue instanceof Date &&
    !Number.isNaN(rawValue.getTime())
  ) {
    return rawValue
  }

  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number"
  ) {
    const stringValue =
      String(rawValue)
    const directDate =
      new Date(stringValue)

    if (
      !Number.isNaN(directDate.getTime())
    ) {
      return directDate
    }

    const monthIndex =
      getMonthIndex(stringValue)

    if (monthIndex >= 0) {
      const yearMatch =
        stringValue.match(/\b(20\d{2}|19\d{2})\b/)

      return new Date(
        yearMatch ? Number(yearMatch[1]) : 2000,
        monthIndex,
        1
      )
    }
  }

  return new Date(2000, index, 1)
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

function getLatestValue(
  rows: DashboardRow[],
  metric: string
) {
  if (rows.length === 0) return 0

  const value =
    rows[rows.length - 1]?.[metric]

  return toFiniteDashboardNumber(value) ?? 0
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
  actualValue: number,
  targetValue: number
) {
  const cleanActual =
    toFiniteDashboardNumber(
      actualValue
    ) ?? 0
  const cleanTarget =
    toFiniteDashboardNumber(
      targetValue
    )

  if (
    cleanTarget === null ||
    cleanTarget <= 0
  ) {
    return {
      text: "No target set",
      className: "text-gray-500",
    }
  }

  if (cleanActual >= cleanTarget) {
    return {
      text: "Target met",
      className: "text-green-600",
    }
  }

  return {
    text: "Below target",
    className: "text-amber-600",
  }
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

function getMetricColor(
  index: number,
  colorPalette: string[]
) {
  return colorPalette[
    index % colorPalette.length
  ]
}

function getDashboardColorPalette(
  primaryColor: string,
  accentColor: string
) {
  return [
    primaryColor,
    accentColor,
    ...defaultColorPalette,
  ].reduce<string[]>((palette, color) => {
    const normalizedColor =
      color.trim().toLowerCase()

    if (
      normalizedColor &&
      !palette.some(
        (existingColor) =>
          existingColor.trim().toLowerCase() ===
          normalizedColor
      )
    ) {
      palette.push(color)
    }

    return palette
  }, [])
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  )
}

function formatMetricName(metric: string) {
  return formatMetricLabel(metric)
}

function formatPeriodLabel(period: PeriodFilter) {
  const labels: Record<PeriodFilter, string> = {
    "1m": "1 month",
    "1q": "1 quarter",
    "6m": "6 months",
    "1y": "1 year",
    "2y": "2 years",
    "3y": "3 years",
    "5y": "5 years",
    all: "All data",
  }

  return labels[period]
}

function formatMonthYear(value: string) {
  const date = new Date(`${value}T00:00:00`)

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })
}

function formatNumber(value: number) {
  return (
    toFiniteDashboardNumber(value) ?? 0
  ).toLocaleString()
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
