"use client"

import Link from "next/link"
import {
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
  LockKeyhole,
  Maximize2,
  X,
} from "lucide-react"

import {
  getPublicDemoDashboard,
  getPublicSharedDashboard,
  type DashboardAggregation,
  type DashboardValueAggregation,
  type DecisionSummary,
  type DatasetJoinResult,
  type PublicDemoDashboardResponse,
  type PublicDemoDatasetOption,
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
  getDashboardAutoMetricMapping,
  getDashboardMappingChartTitles,
  type DashboardChartTitles,
  type DashboardMetricMapping,
} from "@/features/dashboards/dashboard-registry"
import {
  dashboardUsesDatasetMetricMapping,
  dashboardDefinitions,
  defaultDashboardKey,
  getDashboardDefinition,
  isDashboardKey,
} from "@/features/dashboards/dashboard-definitions"
import {
  dashboardChartPalette,
} from "@/features/dashboard/lib/chart-palette"
import {
  finalizeSummaryAggregation,
  getHistoricalDimensionWarning,
  getSummaryAggregationState,
  mergeSummaryAggregationState,
  type SummaryAggregationState,
} from "@/features/dashboard/lib/summary-aggregation"

type ChartType = "line" | "bar" | "area"
type ScaleMode = "actual" | "indexed"
type MetricAggregation = DashboardAggregation
type ValueAggregation = DashboardValueAggregation
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
  count?: number
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
  demo?: boolean
  demoDataset?: string
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
const sharedBrandStoragePrefix =
  "decisionate:shared-dashboard-brand:"
const joinedDatasetResultVersion = 6

function isCurrentJoinedDatasetResult(
  result: DatasetJoinResult | null | undefined
): result is DatasetJoinResult {
  return result?.join_version === joinedDatasetResultVersion
}

function getSharedBrandStorageKey(
  config: SharedDashboardConfig
) {
  if (!config.datasetId) {
    return ""
  }

  return `${sharedBrandStoragePrefix}${config.datasetId}`
}

function readCachedSharedBrand(
  storageKey: string
) {
  if (
    !storageKey ||
    typeof window === "undefined"
  ) {
    return null
  }

  try {
    const cachedValue = window.localStorage.getItem(
      storageKey
    )

    if (!cachedValue) {
      return null
    }

    const parsedValue = JSON.parse(cachedValue)

    if (
      !parsedValue ||
      typeof parsedValue !== "object" ||
      typeof parsedValue.name !== "string" ||
      typeof parsedValue.logoUrl !== "string" ||
      typeof parsedValue.primaryColor !== "string" ||
      typeof parsedValue.accentColor !== "string"
    ) {
      return null
    }

    return parsedValue as WorkspaceBrand
  } catch {
    return null
  }
}

function cacheSharedBrand(
  storageKey: string,
  brand: WorkspaceBrand
) {
  if (
    !storageKey ||
    typeof window === "undefined"
  ) {
    return
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(brand)
    )
  } catch {
    // Branding cache is best-effort and must not block the shared page.
  }
}

const unavailableSharedDashboardMessage =
  "This shared dashboard link is no longer available."

export default function SharedDashboardPage({
  demo = false,
}: {
  demo?: boolean
}) {
  return <SharedDashboardContent demoMode={demo} />
}

function SharedDashboardContent({
  demoMode = false,
}: {
  demoMode?: boolean
}) {
  const [searchParamString, setSearchParamString] =
    useState<string | null>(null)

  useEffect(() => {
    const updateSearchParams = () => {
      setSearchParamString(
        window.location.search.replace(/^\?/, "")
      )
    }

    updateSearchParams()
    window.addEventListener(
      "popstate",
      updateSearchParams
    )

    return () => {
      window.removeEventListener(
        "popstate",
        updateSearchParams
      )
    }
  }, [])

  const sharedConfig =
    useMemo(
      () =>
        getSharedDashboardConfig(
          searchParamString ?? "",
          demoMode
        ),
      [demoMode, searchParamString]
    )
  const sharedBrandStorageKey =
    getSharedBrandStorageKey(
      sharedConfig
    )
  const [dataset, setDataset] =
    useState<DashboardDataset | null>(null)
  const [joinedDatasetResult, setJoinedDatasetResult] =
    useState<DatasetJoinResult | null>(null)
  const [sharedBrand, setSharedBrand] =
    useState<WorkspaceBrand>(
      () =>
        readCachedSharedBrand(
          sharedBrandStorageKey
        ) ?? defaultWorkspaceBrand
    )
  const [selectedMetrics, setSelectedMetrics] =
    useState<string[]>([])
  const [chartType, setChartType] =
    useState<ChartType>("line")
  const [scaleMode, setScaleMode] =
    useState<ScaleMode>("actual")
  const [periodFilter, setPeriodFilter] =
    useState<PeriodFilter>("1m")
  const [aggregation, setAggregation] =
    useState<MetricAggregation>("monthly")
  const [aggregationType, setAggregationType] =
    useState<ValueAggregation>("sum")
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
  const [demoDatasets, setDemoDatasets] =
    useState<PublicDemoDatasetOption[]>([])
  const [demoJoinDataset, setDemoJoinDataset] =
    useState("")
  const [demoNotice, setDemoNotice] =
    useState("")
  const sharedDatasetId =
    sharedConfig.datasetId
  const sharedDemo = Boolean(sharedConfig.demo)
  const sharedDemoDataset =
    sharedConfig.demoDataset ?? "google-analytics"
  const sharedDashboardTemplate =
    sharedConfig.dashboardTemplate
  const sharedSelectedDashboard =
    sharedConfig.selectedDashboard ?? ""
  const sharedToken =
    sharedConfig.token ?? ""
  const sharedConfigKey =
    [
      sharedDemo ? "demo" : sharedDatasetId ?? "",
      sharedDemoDataset,
      sharedSelectedDashboard,
      sharedDashboardTemplate ?? "",
      sharedToken,
    ].join("|")

  useEffect(() => {
    if (searchParamString === null) {
      return
    }

    const [
      datasetModeValue,
      demoDatasetValue,
      selectedDashboardValue,
      dashboardTemplateValue,
      tokenValue,
    ] = sharedConfigKey.split("|")
    const effectDemo = datasetModeValue === "demo"
    const effectDatasetId =
      effectDemo
        ? undefined
        : getQueryDatasetId(datasetModeValue)
    const effectDemoDataset =
      effectDemo
        ? demoDatasetValue || "google-analytics"
        : undefined
    const effectDemoJoinDataset =
      effectDemo &&
      demoJoinDataset &&
      demoJoinDataset !== effectDemoDataset
        ? demoJoinDataset
        : undefined
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
    const effectBrandStorageKey =
      getSharedBrandStorageKey({
        datasetId: effectDatasetId,
        selectedDashboard: effectSelectedDashboard,
      })
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
      setJoinedDatasetResult(null)
      setDemoDatasets([])
      setSharedBrand(
        readCachedSharedBrand(
          effectBrandStorageKey
        ) ?? defaultWorkspaceBrand
      )
      setSelectedMetrics([])
      setTargets({})
      setDashboardMetricMapping({})
      setDashboardChartTitles({})
      setDecisionSummary(null)
      setDashboardTitle("")
      setDashboardSubtitle("")
      setStartDate("")
      setPeriodFilter("1m")
      setAggregation("monthly")
      setAggregationType("sum")
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

        if (!effectDemo && !effectDatasetId) {
          clearSharedDashboardState()
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        if (!effectDemo && !effectToken) {
          clearSharedDashboardState()
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        const response = effectDemo
          ? await getPublicDemoDashboard(
              effectDemoDataset ?? "google-analytics",
              effectSelectedDashboard,
              abortController.signal
            )
          : await getPublicSharedDashboard(
              effectDatasetId as number,
              effectToken as string,
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
        const joinedResponse =
          effectDemoJoinDataset
            ? await getPublicDemoDashboard(
                effectDemoJoinDataset,
                effectSelectedDashboard,
                abortController.signal
              )
            : null

        const datasetKey = effectDemo
          ? effectDemoDataset ?? "google-analytics"
          : String(effectDatasetId)
        const resolvedDashboardKey =
          effectSelectedDashboard ??
          defaultDashboardKey
        const legacyDashboardPreference =
          preference.dashboard_preferences?.[
            datasetKey
          ] ?? {}
        const dashboardPreference = {
          ...(resolvedDashboardKey === defaultDashboardKey
            ? legacyDashboardPreference
            : {
              metricMappings:
                legacyDashboardPreference.metricMappings,
              chartTitles:
                legacyDashboardPreference.chartTitles,
            }),
          ...(preference.dashboard_views?.[
            datasetKey
          ]?.[resolvedDashboardKey] ?? {}),
        }
        const sharedDashboardMetricMapping =
          getSavedDashboardMetricMapping(
            dashboardPreference.metricMappings?.[
              resolvedDashboardKey
            ]
          )
        const sharedDashboardChartTitles =
          dashboardPreference.chartTitles?.[
            resolvedDashboardKey
          ] ?? {}
        const nextJoinedDatasetResult =
          effectDemo
            ? effectDemoJoinDataset && joinedResponse
              ? buildDemoJoinedDatasetResult(
                  effectDemoDataset ?? "google-analytics",
                  data,
                  effectDemoJoinDataset,
                  joinedResponse.dataset
                )
              : null
            : preference.joined_dataset_result ??
              (isCurrentJoinedDatasetResult(
                dashboardPreference.joinedDatasetResult
              )
                ? dashboardPreference.joinedDatasetResult
                : null)
        const availableMetrics =
          nextJoinedDatasetResult
            ? nextJoinedDatasetResult.datasets
              .filter(
                column => column.column_type === "numeric"
              )
              .map(column => column.label)
            : data.metrics?.map(
              (metric) => metric.column
            ) ?? []
        const savedDashboardMetrics =
          getValidSavedSelectedMetrics(
            dashboardPreference.selectedMetrics,
            availableMetrics
          )
        const savedLegacyMetrics =
          getValidSavedSelectedMetrics(
            legacyDashboardPreference.selectedMetrics,
            availableMetrics
          )
        const restoredSelectedMetrics =
          savedDashboardMetrics.length > 0
            ? savedDashboardMetrics
            : savedLegacyMetrics.length > 0
              ? savedLegacyMetrics
              : getSavedSelectedMetrics(
                undefined,
                availableMetrics,
                preference.selected_metric
              )
        const safePeriodFilter =
          effectDemo
            ? "1y"
            : getSavedPeriodFilter(
                dashboardPreference.periodFilter
              )
        const safeAggregation =
          getSavedAggregation(
            dashboardPreference.aggregation
          )
        const safeAggregationType =
          getSavedAggregationType(
            dashboardPreference.aggregationType
          )
        const savedChartRows =
          nextJoinedDatasetResult?.rows.length
            ? nextJoinedDatasetResult.rows
            : data.chart?.data?.length
            ? data.chart.data
            : data.preview ?? []
        const nextSharedBrand =
          getWorkspaceBrandFromPayload(
            response.branding
          )

        if (!isCurrent) {
          return
        }

        setDataset(data)
        if (effectDemo && "demo_datasets" in response) {
          setDemoDatasets(
            (response as PublicDemoDashboardResponse).demo_datasets
          )
        }
        setJoinedDatasetResult(
          nextJoinedDatasetResult
        )
        setDecisionSummary(
          response.decision_summary ?? null
        )
        setSharedBrand(nextSharedBrand)
        cacheSharedBrand(
          effectBrandStorageKey,
          nextSharedBrand
        )
        setSelectedMetrics(
          restoredSelectedMetrics
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
        setAggregationType(safeAggregationType)
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
        const savedStartDate =
          nextJoinedDatasetResult?.start_date ??
          (effectDemo
            ? getDatasetStartDate(
                savedChartRows,
                nextJoinedDatasetResult
                  ? "period"
                  : data.chart?.x_key ?? "month"
              )
            : getSafeStartDate(
                dashboardPreference.startDate,
                savedChartRows,
                nextJoinedDatasetResult
                  ? "period"
                  : data.chart?.x_key ?? "month",
                safePeriodFilter
              ))
        setStartDate(savedStartDate)
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
    searchParamString,
    demoJoinDataset,
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
  const isGeneralBusinessOverview =
    selectedDashboardDefinition.key ===
    defaultDashboardKey

  useWorkspaceBrowserBrand(
    sharedBrand.name,
    sharedBrand,
    {
      keepFaviconStable: true,
      workspaceKey:
        sharedBrandStorageKey || sharedConfigKey,
      brandReady:
        !loading && Boolean(sharedConfigKey),
    }
  )

  const datasetMetrics =
    useMemo(
      () =>
        joinedDatasetResult
          ? joinedDatasetResult.datasets
            .filter(
              column => column.column_type === "numeric"
            )
            .map(column => ({
              column: column.label,
            }))
          : dataset?.metrics ?? [],
      [dataset, joinedDatasetResult]
    )
  const dashboardColorPalette = dashboardChartPalette
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
        joinedDatasetResult?.rows.length
          ? joinedDatasetResult.rows
          : dataset?.chart?.data?.length
          ? dataset.chart.data
          : dataset?.preview ?? [],
      [dataset, joinedDatasetResult]
    )
  const xKey =
    joinedDatasetResult
      ? "period"
      : dataset?.chart?.x_key ?? "month"
  const rows = useMemo(
    () =>
      filterRowsByPeriod(
        allRows,
        xKey,
        startDate,
        periodFilter
      ),
    [
      allRows,
      periodFilter,
      startDate,
      xKey,
    ]
  )
  const historicalDataWarning =
    (() => {
      const autoMapping =
        getDashboardAutoMetricMapping(
          selectedDashboardDefinition.componentKey,
          dataset
        )

      return getHistoricalDimensionWarning(
        rows,
        [
          dashboardMetricMapping.category ||
            autoMapping.category,
          dashboardMetricMapping.stage ||
            autoMapping.stage,
        ]
      )
    })()
  const metrics = useMemo(
    () => getSharedDashboardMetrics(
      datasetMetrics,
      rows,
      startDate,
      periodFilter,
      aggregationType
    ),
    [
      aggregationType,
      datasetMetrics,
      periodFilter,
      rows,
      startDate,
    ]
  )
  const aggregatedRows = useMemo(
    () =>
      aggregateRowsByDate(
        rows,
        xKey,
        aggregation,
        datasetMetrics.map(metric => metric.column),
        aggregationType
      ),
    [
      aggregation,
      aggregationType,
      datasetMetrics,
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

  const dashboardMappingDataset = dataset
    ? {
        ...dataset,
        metrics: datasetMetrics,
        chart: {
          ...(dataset.chart ?? {}),
          x_key: xKey,
          data: allRows,
        },
      }
    : null
  const dashboardMappingColumns =
    getDashboardMappingColumns(
      dashboardMappingDataset,
      allRows,
      xKey
    )
  const dashboardAutoMetricMapping =
    getDashboardAutoMetricMapping(
      selectedDashboardDefinition.componentKey,
      dashboardMappingDataset
    )
  const showDemoMetricMapping =
    sharedDemo &&
    !isGeneralBusinessOverview &&
    dashboardUsesDatasetMetricMapping(
      selectedDashboardDefinition.componentKey
    )

  function updateDemoQuery(
    key: "dataset" | "dashboard",
    value: string
  ) {
    if (!sharedDemo || typeof window === "undefined") {
      return
    }

    const url = new URL(window.location.href)
    url.searchParams.set(key, value)
    window.history.replaceState(null, "", url.toString())
    setSearchParamString(url.search.slice(1))
    setDemoNotice("")
  }

  const handleDemoDatasetChange = (value: string) => {
    setDemoJoinDataset("")
    updateDemoQuery("dataset", value)
  }
  const handleDemoJoinChange = (value: string) => {
    setDemoJoinDataset(value)
    setDemoNotice("")
  }
  const handleDemoResetJoin = () => {
    setDemoJoinDataset("")
    setDemoNotice("")
  }
  const handleDemoCreateDecision = () => {
    setDemoNotice(
      "This is a live demo. Decisions cannot be created here. Sign up for a free trial to create and track decisions."
    )
  }
  const demoPrimaryControls = sharedDemo ? (
    <DemoPrimaryControls
      datasets={demoDatasets}
      selectedDataset={sharedDemoDataset}
      joinDataset={demoJoinDataset}
      selectedDashboard={
        sharedSelectedDashboard || defaultDashboardKey
      }
      onDatasetChange={handleDemoDatasetChange}
      onJoinChange={handleDemoJoinChange}
      onResetJoin={handleDemoResetJoin}
      onDashboardChange={value => updateDemoQuery("dashboard", value)}
      onCreateDecision={handleDemoCreateDecision}
    />
  ) : null
  const demoBanner = sharedDemo ? (
    <DemoModeBanner
      showMetricSelection={isGeneralBusinessOverview}
      showMetricMapping={showDemoMetricMapping}
      mappingChartTitles={getDashboardMappingChartTitles(
        selectedDashboardDefinition.componentKey
      )}
      mappingColumns={dashboardMappingColumns.columns}
      numericMappingColumns={
        dashboardMappingColumns.numericColumns
      }
      dimensionMappingColumns={
        dashboardMappingColumns.dimensionColumns
      }
      metricMapping={dashboardMetricMapping}
      autoMetricMapping={dashboardAutoMetricMapping}
      metricOptions={datasetMetrics.map(
        metric => metric.column
      )}
      selectedMetrics={selectedMetrics}
      metricTargets={targets}
      notice={demoNotice}
      onMetricsChange={values => {
        setSelectedMetrics(
          values.length > 0
            ? values
            : datasetMetrics[0]
              ? [datasetMetrics[0].column]
              : []
        )
        setDemoNotice("")
      }}
      onTargetChange={(metric, value) => {
        setTargets(current => ({
          ...current,
          [metric]: value,
        }))
        setDemoNotice("")
      }}
      onMappingChange={(role, value) => {
        setDashboardMetricMapping(current => ({
          ...current,
          [role]: value || undefined,
        }))
        setDemoNotice("")
      }}
    />
  ) : null

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
  const effectiveDashboardMetricMapping =
    sharedDemo &&
    isGeneralBusinessOverview &&
    selectedMetrics[0]
      ? {
          ...dashboardMetricMapping,
          primary: selectedMetrics[0],
          operationsValue: selectedMetrics[0],
        }
      : dashboardMetricMapping

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
        {historicalDataWarning && (
          <div
            className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            role="status"
            aria-live="polite"
          >
            {historicalDataWarning}
          </div>
        )}
        <SelectedDashboard
          name={selectedDashboardDefinition.name}
          description={selectedDashboardDefinition.description}
          highlights={selectedDashboardDefinition.highlights}
          dataset={{
            ...dataset,
            metrics: datasetMetrics,
            chart: {
              ...(dataset.chart ?? {}),
              x_key: xKey,
              data: rows,
            },
          }}
          datasetId={sharedDatasetId}
          aggregation={aggregation}
          aggregationType={aggregationType}
          manualMapping={
            dashboardUsesDatasetMetricMapping(
              selectedDashboardDefinition.componentKey
            )
              ? effectiveDashboardMetricMapping
              : undefined
          }
          chartTitles={dashboardChartTitles}
          decisionSummary={decisionSummary}
          brand={sharedBrand}
          demoMode={sharedDemo}
          headerControls={demoPrimaryControls}
          showActions={false}
        />

        <SharedDashboardControls
          periodFilter={periodFilter}
          setPeriodFilter={setPeriodFilter}
          aggregation={aggregation}
          setAggregation={setAggregation}
          aggregationType={aggregationType}
          setAggregationType={setAggregationType}
          startDate={startDate}
          setStartDate={setStartDate}
        />
        {demoBanner}
      </SharedPageShell>
    )
  }

  return (
    <SharedPageShell brand={sharedBrand}>
      <div className="space-y-5">
        {historicalDataWarning && (
          <div
            className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            role="status"
            aria-live="polite"
          >
            {historicalDataWarning}
          </div>
        )}
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

                {sharedDemo && (
                  <p className="mt-1 text-[11px] font-semibold text-blue-700">
                    Live demo · Read-only sample data · Decisions disabled
                  </p>
                )}
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
                headerControls={demoPrimaryControls}
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
                headerControls={demoPrimaryControls}
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
            headerControls={demoPrimaryControls}
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
          aggregationType={aggregationType}
          setAggregationType={setAggregationType}
          startDate={startDate}
          setStartDate={setStartDate}
          showChartControls
        />
        {demoBanner}
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
  aggregationType,
  setAggregationType,
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
  aggregationType: ValueAggregation
  setAggregationType: (value: ValueAggregation) => void
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
        <span className="block">Period</span>
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
        <span className="block">Group by</span>
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

      <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
        <span className="block">Aggregate</span>
        <select
          value={aggregationType}
          onChange={event =>
            setAggregationType(
              event.target.value as ValueAggregation
            )
          }
          className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
        >
          <option value="sum">Sum</option>
          <option value="count">Count</option>
          <option value="avg">Average</option>
          <option value="min">Minimum</option>
          <option value="max">Maximum</option>
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
  headerControls,
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
  headerControls?: React.ReactNode
  className?: string
  chartAreaClassName?: string
}) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0
  const [isFullscreen, setIsFullscreen] =
    useState(false)
  const chartTitle =
    selectedMetrics.length > 1
      ? selectedMetrics
          .map(formatMetricName)
          .join(" vs ")
      : `${formatMetricName(
          primaryMetric
        )} Performance`
  const chartDescription =
    getSharedDashboardChartDescription({
      chartType,
      rows: chartRows,
      xKey,
      metrics: selectedMetrics,
      target: selectedTarget,
      showTarget: scaleMode === "actual",
    })

  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const previousOverflow =
      document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFullscreen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isFullscreen])

  const chartContent = hasChartData ? (
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
  ) : (
    <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
      <p className="max-w-sm text-sm text-gray-500">
        No chartable metrics are available for this shared dashboard.
      </p>
    </div>
  )

  return (
    <>
      <SharedCard className={`flex min-w-0 flex-col ${className}`}>
        {headerControls && (
          <div className="mb-3 flex min-w-0 flex-wrap items-center justify-start border-b border-gray-100 pb-3">
            {headerControls}
          </div>
        )}

        <CardHeader
          title={chartTitle}
          description="Main chart"
          action={
            hasChartData ? (
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  title={`View ${chartTitle} full screen`}
                  aria-label={`View ${chartTitle} full screen`}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
                >
                  <Maximize2 size={15} />
                </button>
              </div>
            ) : undefined
          }
        />

        {hasChartData ? (
          <div
            className={chartAreaClassName}
            role="img"
            aria-label={chartDescription}
          >
            {!isFullscreen && chartContent}
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

      {isFullscreen && hasChartData && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${chartTitle} full screen chart`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setIsFullscreen(false)
            }
          }}
        >
          <div className="flex h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-950 sm:text-lg">
                  {chartTitle}
                </h2>
                <p className="mt-1 truncate text-xs text-gray-500 sm:text-sm">
                  Main chart
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                title="Close full screen chart"
                aria-label="Close full screen chart"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 p-4 sm:p-8">
              <div className="h-full min-h-0 w-full">
                {chartContent}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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

function DemoPrimaryControls({
  datasets,
  selectedDataset,
  joinDataset,
  selectedDashboard,
  onDatasetChange,
  onJoinChange,
  onResetJoin,
  onDashboardChange,
  onCreateDecision,
}: {
  datasets: PublicDemoDatasetOption[]
  selectedDataset: string
  joinDataset: string
  selectedDashboard: string
  onDatasetChange: (value: string) => void
  onJoinChange: (value: string) => void
  onResetJoin: () => void
  onDashboardChange: (value: string) => void
  onCreateDecision: () => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end justify-end gap-2">
      <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        <span className="shrink-0">Dataset</span>
        <select
          aria-label="Sample dataset"
          value={selectedDataset}
          onChange={event => onDatasetChange(event.target.value)}
          className="h-8 max-w-[13rem] rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        >
          {datasets.map(dataset => (
            <option key={dataset.key} value={dataset.key}>
              {dataset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        <span className="shrink-0">Dashboard</span>
        <select
          aria-label="Dashboard"
          value={selectedDashboard}
          onChange={event => onDashboardChange(event.target.value)}
          className="h-8 max-w-[12rem] rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        >
          {dashboardDefinitions.map(dashboard => (
            <option key={dashboard.key} value={dashboard.key}>
              {dashboard.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-gray-500">
        <span className="shrink-0">Join with</span>
        <select
          aria-label="Join with"
          value={joinDataset}
          onChange={event => onJoinChange(event.target.value)}
          className="h-8 max-w-[11rem] rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        >
          <option value="">Join with...</option>
          {datasets
            .filter(dataset => dataset.key !== selectedDataset)
            .map(dataset => (
              <option key={dataset.key} value={dataset.key}>
                {dataset.label}
              </option>
            ))}
        </select>
      </label>

      {joinDataset && (
        <button
          type="button"
          onClick={onResetJoin}
          title="Reset joined demo data"
          aria-label="Reset joined demo data"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-amber-900 transition hover:bg-amber-100"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={onCreateDecision}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-blue-300 bg-white px-2.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-100"
      >
        <LockKeyhole size={13} aria-hidden="true" />
        Create decision
      </button>

      <Link
        href="/sign-up"
        className="inline-flex h-8 items-center justify-center rounded-md bg-blue-700 px-2.5 text-xs font-semibold text-white transition hover:bg-blue-800"
      >
        Start free trial
      </Link>
    </div>
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

function DemoModeBanner({
  showMetricSelection,
  showMetricMapping,
  mappingChartTitles,
  mappingColumns,
  numericMappingColumns,
  dimensionMappingColumns,
  metricMapping,
  autoMetricMapping,
  metricOptions,
  selectedMetrics,
  metricTargets,
  notice,
  onMetricsChange,
  onTargetChange,
  onMappingChange,
}: {
  showMetricSelection: boolean
  showMetricMapping: boolean
  mappingChartTitles: {
    trend: string
    mix: string
    operations: string
  }
  mappingColumns: string[]
  numericMappingColumns: string[]
  dimensionMappingColumns: string[]
  metricMapping: DashboardMetricMapping
  autoMetricMapping: DashboardMetricMapping
  metricOptions: string[]
  selectedMetrics: string[]
  metricTargets: Record<string, number>
  notice: string
  onMetricsChange: (values: string[]) => void
  onTargetChange: (metric: string, value: number) => void
  onMappingChange: (
    role: keyof DashboardMetricMapping,
    value: string
  ) => void
}) {
  return (
    <section
      className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"
      aria-labelledby="live-demo-settings-heading"
    >
      <div>
        <h2
          id="live-demo-settings-heading"
          className="text-sm font-bold tracking-tight text-blue-950"
        >
          Demo controls
        </h2>
        <p className="mt-1 text-xs leading-5 text-blue-800">
          Select KPIs and map industry chart fields. Changes apply only to this demo session.
        </p>
      </div>

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {showMetricSelection && (
            <fieldset className="min-w-0 text-xs font-semibold text-blue-900 sm:col-span-2 xl:col-span-4">
              <legend className="mb-1">Metrics &amp; targets</legend>
              <div className="grid max-h-32 grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-blue-200 bg-white px-3 py-2 sm:grid-cols-2 xl:grid-cols-4">
                {metricOptions.length > 0 ? (
                  metricOptions.map(metric => (
                    <div
                      key={metric}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem] items-center gap-2"
                    >
                      <label className="flex min-w-0 items-center gap-2 font-normal text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedMetrics.includes(metric)}
                          onChange={event => {
                            const nextMetrics = event.target.checked
                              ? [...selectedMetrics, metric]
                              : selectedMetrics.filter(
                                  selectedMetric => selectedMetric !== metric
                                )
                            onMetricsChange(nextMetrics)
                          }}
                          className="h-3.5 w-3.5 shrink-0 accent-blue-700"
                        />
                        <span
                          className="truncate"
                          title={formatMetricName(metric)}
                        >
                          {formatMetricName(metric)}
                        </span>
                      </label>
                      <label className="flex min-w-0 items-center gap-1 font-normal text-gray-500">
                        <span className="sr-only">
                          {formatMetricName(metric)} target
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={metricTargets[metric] ?? 0}
                          onChange={event => {
                            const nextValue = Number(event.target.value)
                            onTargetChange(
                              metric,
                              Number.isFinite(nextValue)
                                ? Math.max(nextValue, 0)
                                : 0
                            )
                          }}
                          className="h-8 w-full min-w-0 rounded-md border border-blue-200 bg-white px-2 text-right text-xs text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                    </div>
                  ))
                ) : (
                  <span className="col-span-full font-normal text-blue-700">
                    Loading metrics...
                  </span>
                )}
              </div>
              <p className="mt-1 font-normal text-blue-700">
                Select KPIs for the General Business Overview and set optional targets.
              </p>
            </fieldset>
          )}

          {showMetricMapping && (
            <DemoMetricMappingPanel
              chartTitles={mappingChartTitles}
              columns={mappingColumns}
              numericColumns={numericMappingColumns}
              dimensionColumns={dimensionMappingColumns}
              mapping={metricMapping}
              autoMapping={autoMetricMapping}
              onChange={onMappingChange}
            />
          )}
      </div>

      {notice && (
        <p
          className="mt-3 text-sm font-semibold text-blue-900"
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
      )}
    </section>
  )
}

function DemoMetricMappingPanel({
  chartTitles,
  columns,
  numericColumns,
  dimensionColumns,
  mapping,
  autoMapping,
  onChange,
}: {
  chartTitles: {
    trend: string
    mix: string
    operations: string
  }
  columns: string[]
  numericColumns: string[]
  dimensionColumns: string[]
  mapping: DashboardMetricMapping
  autoMapping: DashboardMetricMapping
  onChange: (
    role: keyof DashboardMetricMapping,
    value: string
  ) => void
}) {
  const chartMappings: Array<{
    chart: string
    fields: Array<{
      key: keyof DashboardMetricMapping
      label: string
      numericOnly?: boolean
      dimensionOnly?: boolean
    }>
  }> = [
    {
      chart: chartTitles.trend,
      fields: [
        {
          key: "primary",
          label: "Y-axis value",
          numericOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.trend,
      fields: [
        {
          key: "date",
          label: "Horizontal axis",
          dimensionOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.mix,
      fields: [
        {
          key: "category",
          label: "Category / channel",
          dimensionOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.operations,
      fields: [
        {
          key: "operationsValue",
          label: "Y-axis value",
          numericOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.operations,
      fields: [
        {
          key: "stage",
          label: "Horizontal axis",
          dimensionOnly: true,
        },
      ],
    },
  ]

  return (
    <section className="min-w-0 rounded-xl border border-blue-200 bg-blue-100/50 p-3 sm:col-span-2 xl:col-span-4">
      <div>
        <h2 className="text-sm font-semibold text-blue-950">
          Metric mapping
        </h2>
        <p className="mt-1 text-xs font-normal text-blue-800">
          Choose the dataset columns used by each industry chart. Changes apply only to this demo session.
        </p>
      </div>

      <div className="mt-3 grid items-stretch gap-2 lg:grid-cols-5">
        {chartMappings.map((mappingCard, index) => (
          <div
            key={`${mappingCard.chart}-${index}`}
            className="flex min-w-0 flex-col rounded-lg border border-blue-200 bg-white p-2"
          >
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-blue-800">
              {mappingCard.chart}
            </p>

            {mappingCard.fields.map(field => {
              const options = field.numericOnly
                ? numericColumns
                : field.dimensionOnly
                  ? dimensionColumns
                  : columns
              const selectedValue = mapping[field.key] ?? ""
              const autoValue = autoMapping[field.key]

              return (
                <label
                  key={field.key}
                  className="mt-2 flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-gray-600"
                >
                  <span>{field.label}</span>
                  <select
                    value={selectedValue}
                    onChange={event =>
                      onChange(field.key, event.target.value)
                    }
                    className="h-8 w-full min-w-0 rounded-md border border-blue-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="">Auto</option>
                    {options.map(option => (
                      <option key={option} value={option}>
                        {formatMetricName(option)}
                      </option>
                    ))}
                  </select>
                  <span className="truncate text-[11px] font-normal text-gray-400">
                    Auto: {autoValue ? formatMetricName(autoValue) : "Not detected"}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

const demoDatasetNumericIds: Record<string, number> = {
  "google-analytics": 900001,
  stripe: 900002,
  shopify: 900003,
  quickbooks: 900004,
  freshbooks: 900005,
  sage: 900006,
  xero: 900007,
  hubspot: 900008,
  "meta-ads": 900009,
}

function getDemoDatasetRows(dataset: DashboardDataset) {
  return dataset.chart?.data?.length
    ? dataset.chart.data
    : dataset.preview ?? []
}

function getDemoDateKey(
  row: DashboardRow,
  dateColumn: string
) {
  const rawValue = row[dateColumn]

  if (
    typeof rawValue !== "string" &&
    typeof rawValue !== "number" &&
    !(rawValue instanceof Date)
  ) {
    return null
  }

  const textValue = String(rawValue)
  const isoDate = textValue.match(
    /^(\d{4}-\d{2}-\d{2})/
  )?.[1]

  if (isoDate) {
    return isoDate
  }

  const parsedDate = new Date(textValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return formatDateKey(parsedDate)
}

function getDemoDatasetId(datasetKey: string) {
  return (
    demoDatasetNumericIds[datasetKey] ??
    900000 +
      Array.from(datasetKey).reduce(
        (total, character) =>
          total + character.charCodeAt(0),
        0
      )
  )
}

function buildDemoJoinedDatasetResult(
  primaryKey: string,
  primaryDataset: DashboardDataset,
  secondaryKey: string,
  secondaryDataset: DashboardDataset
): DatasetJoinResult {
  const sourceDatasets = [
    {
      key: primaryKey,
      dataset: primaryDataset,
    },
    {
      key: secondaryKey,
      dataset: secondaryDataset,
    },
  ]
  const rowMaps = sourceDatasets.map(({ dataset }) => {
    const rows = getDemoDatasetRows(dataset)
    const dateColumn = dataset.chart?.x_key ?? "date"
    const rowsByDate = new Map<string, DashboardRow>()

    rows.forEach(row => {
      const dateKey = getDemoDateKey(row, dateColumn)

      if (dateKey) {
        rowsByDate.set(dateKey, row)
      }
    })

    return {
      rows,
      dateColumn,
      rowsByDate,
    }
  })
  const matchedDates = Array.from(
    rowMaps[0].rowsByDate.keys()
  )
    .filter(dateKey => rowMaps[1].rowsByDate.has(dateKey))
    .sort()
  const columnDefinitions = sourceDatasets.flatMap(
    ({ key, dataset }, sourceIndex) => {
      const rows = rowMaps[sourceIndex].rows
      const dateColumn = rowMaps[sourceIndex].dateColumn
      const metricColumns = new Set(
        (dataset.metrics ?? []).map(metric => metric.column)
      )
      const columns = Array.from(
        new Set(rows.flatMap(row => Object.keys(row)))
      ).filter(column => column !== dateColumn)
      const sourceLabel =
        dataset.source_label?.trim() ||
        key.replace(/[-_]+/g, " ")

      return columns.map(column => ({
        datasetId: getDemoDatasetId(key),
        fileName: dataset.file_name,
        dateColumn,
        metricColumn: column,
        label: `${sourceLabel} · ${formatMetricName(column)}`,
        columnType: metricColumns.has(column) ||
          rows.some(row => typeof row[column] === "number")
          ? "numeric" as const
          : "categorical" as const,
        sourceRows: rows.length,
      }))
    }
  )
  const joinedRows = matchedDates.map(dateKey => {
    const row: DatasetJoinResult["rows"][number] = {
      period: dateKey,
    }

    sourceDatasets.forEach(({ key }, sourceIndex) => {
      const sourceRow = rowMaps[sourceIndex].rowsByDate.get(dateKey)
      const datasetId = getDemoDatasetId(key)

      columnDefinitions
        .filter(column => column.datasetId === datasetId)
        .forEach(column => {
          const value =
            sourceRow?.[column.metricColumn]
          row[column.label] =
            value instanceof Date
              ? formatDateKey(value)
              : typeof value === "string" ||
                  typeof value === "number"
                ? value
                : null
        })
    })

    return row
  })
  const datasetIds = sourceDatasets.map(({ key }) =>
    getDemoDatasetId(key)
  )

  return {
    join_version: joinedDatasetResultVersion,
    primary_dataset_id: datasetIds[0],
    dataset_ids: datasetIds,
    join_key: "date",
    join_type: "inner",
    period: "daily",
    aggregation_type: "sum",
    start_date: matchedDates[0] ?? null,
    period_filter: "all",
    matched_period_count: matchedDates.length,
    available_period_count: Math.max(
      rowMaps[0].rowsByDate.size,
      rowMaps[1].rowsByDate.size
    ),
    coverage_percent:
      rowMaps[0].rowsByDate.size > 0
        ? (matchedDates.length / rowMaps[0].rowsByDate.size) * 100
        : 0,
    datasets: columnDefinitions.map(column => ({
      dataset_id: column.datasetId,
      file_name: column.fileName,
      date_column: column.dateColumn,
      metric_column: column.metricColumn,
      label: column.label,
      column_type: column.columnType,
      source_rows: column.sourceRows,
      usable_rows: matchedDates.length,
      period_count: matchedDates.length,
    })),
    rows: joinedRows,
    decision_context:
      "Live demo join: sample datasets are joined in the browser by normalized date. This result is not saved.",
  }
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
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="break-words text-xl font-semibold tracking-tight">
          {title}
        </h2>

        {description && (
          <p className="mt-1 break-words text-sm text-gray-500">
            {description}
          </p>
        )}
      </div>

      {action}
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
  searchParamString: string,
  demoMode = false
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
    demo: demoMode,
    demoDataset:
      demoMode
        ? params.get("dataset")?.trim() || "google-analytics"
        : undefined,
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

function getValidSavedSelectedMetrics(
  savedMetrics: unknown,
  availableMetrics: string[]
) {
  if (!Array.isArray(savedMetrics)) {
    return []
  }

  const availableMetricSet = new Set(
    availableMetrics
  )
  const validSavedMetrics = savedMetrics.filter(
    (metric): metric is string =>
      typeof metric === "string" &&
      availableMetricSet.has(metric.trim())
  ).map(metric => metric.trim()).filter(
    (metric, index, metrics) =>
      metrics.indexOf(metric) === index
  )

  return validSavedMetrics
}

function getSavedSelectedMetrics(
  savedMetrics: unknown,
  availableMetrics: string[],
  fallbackMetric?: unknown
) {
  const validSavedMetrics =
    getValidSavedSelectedMetrics(
      savedMetrics,
      availableMetrics
    )

  if (validSavedMetrics.length > 0) {
    return validSavedMetrics
  }

  if (
    typeof fallbackMetric === "string" &&
    availableMetrics.includes(fallbackMetric.trim())
  ) {
    return [fallbackMetric.trim()]
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
      "secondary",
      "operationsValue",
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
    : "1m"
}

function getSavedAggregation(
  savedAggregation: unknown
): MetricAggregation {
  return isSavedAggregation(savedAggregation)
    ? savedAggregation
    : "monthly"
}

function getSavedAggregationType(
  savedAggregationType: unknown
): ValueAggregation {
  return isSavedAggregationType(savedAggregationType)
    ? savedAggregationType
    : "sum"
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

function isSavedAggregationType(
  value: unknown
): value is ValueAggregation {
  return (
    value === "sum" ||
    value === "avg" ||
    value === "min" ||
    value === "max" ||
    value === "count"
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

function getDashboardMappingColumns(
  dataset: DashboardDataset | null,
  rows: DashboardRow[],
  xKey: string
) {
  const columns = Array.from(
    new Set([
      ...rows.flatMap(row => Object.keys(row)),
      ...(dataset?.metrics ?? []).map(metric => metric.column),
      xKey,
    ])
  )
  const numericColumnSet = new Set(
    (dataset?.metrics ?? []).map(metric => metric.column)
  )
  const numericColumns = columns.filter(column =>
    numericColumnSet.has(column) ||
    rows.some(row => typeof row[column] === "number")
  )

  return {
    columns,
    numericColumns,
    dimensionColumns: columns.filter(
      column => !numericColumns.includes(column)
    ),
  }
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

function getDatasetStartDate(
  rows: DashboardRow[],
  xKey: string
) {
  const dates = rows
    .map((row, index) =>
      getRowPeriodStartDate(row, xKey, index)
    )
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((first, second) =>
      first.getTime() - second.getTime()
    )

  return dates[0]
    ? formatDateKey(dates[0])
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

  const firstDate = startDate
    ? new Date(`${startDate}T00:00:00`)
    : normalizedRows.reduce(
        (earliest, row) =>
          row.__periodDate < earliest
            ? row.__periodDate
            : earliest,
        normalizedRows[0].__periodDate
      )

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
  metricColumns: string[],
  aggregationType: ValueAggregation
) {
  const buckets = new Map<
    string,
    {
      date: Date
      values: Record<string, SummaryAggregationState>
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
      const state = getSummaryAggregationState(
        row,
        metric
      )

      if (state) {
        bucket.values[metric] =
          mergeSummaryAggregationState(
            bucket.values[metric],
            state
          )
      }
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
      ...Object.fromEntries(
        metricColumns.map(metric => [
          metric,
          finalizeSummaryAggregation(
            bucket.values[metric],
            aggregationType
          ),
        ])
      ),
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

function getSharedDashboardMetrics(
  metrics: DashboardMetric[],
  rows: DashboardRow[],
  startDate: string,
  periodFilter: PeriodFilter,
  aggregationType: ValueAggregation
) {
  return metrics.map(metric => {
    let state: SummaryAggregationState | undefined
    rows.forEach(row => {
      const next = getSummaryAggregationState(
        row,
        metric.column
      )

      if (next) {
        state = mergeSummaryAggregationState(
          state,
          next
        )
      }
    })
    const datasetValue =
      periodFilter === "all" && !startDate
        ? aggregationType === "sum"
          ? metric.total
          : aggregationType === "avg"
            ? metric.average
            : aggregationType === "min"
              ? metric.min ?? metric.minimum
              : aggregationType === "max"
                ? metric.max ?? metric.maximum
                : metric.count
        : undefined
    const value = state
      ? finalizeSummaryAggregation(
        state,
        aggregationType
      )
      : typeof datasetValue === "number" &&
        Number.isFinite(datasetValue)
        ? datasetValue
        : 0

    return {
      ...metric,
      total: value,
    }
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
