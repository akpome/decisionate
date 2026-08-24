"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  useAuth,
  useUser,
} from "@clerk/nextjs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { DatasetJoinPanel } from "@/features/dashboard/components/dataset-join-panel"
import {
  formatMetricLabel,
  MetricSelector,
} from "@/features/dashboard/components/metric-selector"

import {
  createDecision,
  getDatasetJoinCache,
  joinDatasets,
  type AIAnalysis,
  type DatasetAnomaliesResponse,
  type DatasetJoinResult,
  type DatasetSummary,
  type DashboardPreferencePayload,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
  getDatasetAIAnalysis,
  getDatasetAnomalies,
  getDatasetDetails,
  getDatasetShareLink,
  getDatasetShareStatus,
  getDatasets,
  getDatasetPreference,
  getDashboardPreference,
  getMyOrganization,
  getOrganizationWorkspaces,
  stopDatasetSharing,
  updateDatasetPreference,
} from "@/lib/api"
import {
  buildAIRecommendationDecisionPayload,
} from "@/features/decisions/lib/ai-decision-handoff"
import {
  AnalysisStatus,
} from "@/features/ai/components/analysis-status"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  useDashboardSessionUserId,
} from "@/lib/dashboard-session-context"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import {
  WorkspaceBrandMark,
} from "@/app/dashboard/workspace-brand-mark"
import {
  WorkspaceAccessNotice,
} from "@/features/dashboard/components/workspace-access-notice"
import {
  getWorkspaceBrand,
  type WorkspaceBrand,
} from "@/lib/workspace-brand"
import {
  dashboardRegistry,
  getDashboardAutoMetricMapping,
  getDashboardChartTitleFields,
  getDashboardMappingChartTitles,
  DashboardActionButton,
  type DashboardChartTitleField,
  type DashboardChartTitleKey,
  type DashboardChartTitles,
  type DashboardAggregation,
  type DashboardValueAggregation,
  type DashboardMetricMapping,
} from "@/features/dashboards/dashboard-registry"
import {
  dashboardUsesDatasetMetricMapping,
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
  isInternalSummaryColumn,
  mergeSummaryAggregationState,
  type SummaryAggregationState,
} from "@/features/dashboard/lib/summary-aggregation"

import {
  Database,
  FileDown,
  Gauge,
  GitMerge,
  LineChart as LineChartIcon,
  Maximize2,
  Plus,
  Settings2,
  Share2,
  Unlink,
  X,
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

type MetricAggregation = DashboardAggregation
type ValueAggregation = DashboardValueAggregation

type DashboardCellValue =
  | string
  | number
  | Date
  | null
  | undefined

type DashboardRow = Record<string, DashboardCellValue>

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
  preview: DashboardRow[]
  metrics: DashboardMetric[]
  ai_analysis?: AIAnalysis | null
  chart?: {
    x_key?: string
    y_key?: string
    data?: DashboardRow[]
  }
}

type ReportSectionProps = {
  dashboardTitle: string
  dashboardSubtitle: string
  dataset: DashboardDataset
  metrics: DashboardMetric[]
  rows: DashboardRow[]
  chartRows: DashboardRow[]
  xKey: string
  selectedMetrics: string[]
  chartType: ChartType
  scaleMode: ScaleMode
  periodFilter: PeriodFilter
  aggregation: MetricAggregation
  aggregationType: ValueAggregation
  startDate: string
  primaryMetric: string
  selectedTarget: number
  latestValue: number
  targetProgress: number
  targetMet: boolean
  setChartType: (value: ChartType) => void
  setScaleMode: (value: ScaleMode) => void
  setPeriodFilter: (value: PeriodFilter) => void
  setAggregation: (value: MetricAggregation) => void
  setAggregationType: (value: ValueAggregation) => void
  setStartDate: (value: string) => void
  onResetView: () => void
  anomalies: DatasetAnomaliesResponse | null
  anomalyLoading: boolean
  anomalyError: boolean
  aiAnalysis?: AIAnalysis | null
  analysisLoading: boolean
  onCreateDecision?: () => void
  creatingDecision: boolean
}

type DashboardViewPreference = DashboardPreferencePayload

type SharedDashboardConfig = {
  datasetId?: number
  dashboardTemplate?: DashboardTemplate
}

/* =========================
   Constants
========================= */

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
const defaultDashboardTitle = "Dashboard"
const defaultDashboardSubtitle =
  "Monitor performance, compare metrics, and track targets."
const maxDashboardTitleLength = 120
const maxDashboardSubtitleLength = 220

const emptyDashboardDataset: DashboardDataset = {
  file_name: "",
  preview: [],
  metrics: [],
}

const joinedDatasetStoragePrefix =
  "decisionate:joined-dataset:"
const selectedMetricsStoragePrefix =
  "decisionate:selected-metrics:"
const joinedDatasetResultVersion = 6

function isCurrentJoinedDatasetResult(
  result: DatasetJoinResult | null | undefined
): result is DatasetJoinResult {
  return result?.join_version === joinedDatasetResultVersion
}

function findPersistedJoinedDatasetResult(
  dashboardPreferences:
    Record<string, DashboardViewPreference> | undefined,
  dashboardViews:
    Record<string, Record<string, DashboardViewPreference>> | undefined,
  selectedDashboard: string,
  datasetId: number
): DatasetJoinResult | null {
  const candidates: DatasetJoinResult[] = []

  if (selectedDashboard === defaultDashboardKey) {
    Object.keys(dashboardPreferences ?? {})
      .sort()
      .forEach(datasetKey => {
        const result = dashboardPreferences?.[datasetKey]
          ?.joinedDatasetResult

        if (
          isCurrentJoinedDatasetResult(result) &&
          result.dataset_ids.includes(datasetId)
        ) {
          candidates.push(result)
        }
      })
  }

  Object.keys(dashboardViews ?? {})
    .sort()
    .forEach(datasetKey => {
      const result = dashboardViews?.[datasetKey]?.[
        selectedDashboard
      ]?.joinedDatasetResult

      if (
        isCurrentJoinedDatasetResult(result) &&
        result.dataset_ids.includes(datasetId)
      ) {
        candidates.push(result)
      }
    })

  return candidates[0] ?? null
}

function getJoinedDatasetStorageKey(
  workspaceId: string | undefined,
  userId: string,
  datasetId: number | undefined,
  dashboardKey: string
) {
  if (!datasetId) {
    return null
  }

  return `${joinedDatasetStoragePrefix}${workspaceId ?? userId}:${dashboardKey}:${datasetId}`
}

function readPersistedJoinedDataset(
  storageKey: string | null
): DatasetJoinResult | null {
  if (
    !storageKey ||
    typeof window === "undefined"
  ) {
    return null
  }

  try {
    const stored = window.localStorage.getItem(
      storageKey
    )
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored) as DatasetJoinResult
    if (
      !parsed ||
      parsed.join_version !== joinedDatasetResultVersion ||
      !Array.isArray(parsed.dataset_ids) ||
      !Array.isArray(parsed.datasets) ||
      !Array.isArray(parsed.rows)
    ) {
      window.localStorage.removeItem(storageKey)
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function persistJoinedDataset(
  storageKey: string | null,
  result: DatasetJoinResult | null
) {
  if (!storageKey || typeof window === "undefined") {
    return
  }

  try {
    if (result) {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(result)
      )
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // The dashboard remains usable if browser storage is unavailable.
  }
}

function getSelectedMetricsStorageKey(
  workspaceId: string | undefined,
  userId: string,
  datasetId: number | undefined,
  dashboardKey: string
) {
  if (!datasetId) {
    return null
  }

  return `${selectedMetricsStoragePrefix}${workspaceId ?? userId}:${dashboardKey}:${datasetId}`
}

function readPersistedSelectedMetrics(
  storageKey: string | null,
  availableMetrics: string[]
): string[] | null {
  if (!storageKey || typeof window === "undefined") {
    return null
  }

  try {
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored)
    const validMetrics = getValidSelectedMetrics(
      parsed,
      availableMetrics
    )
    return validMetrics.length > 0 ? validMetrics : null
  } catch {
    return null
  }
}

function persistSelectedMetrics(
  storageKey: string | null,
  selectedMetrics: string[]
) {
  if (!storageKey || typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(selectedMetrics)
    )
  } catch {
    // The dashboard remains usable if browser storage is unavailable.
  }
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
    isLoaded: authLoaded,
    userId: clerkUserId,
  } = useAuth()
  const router = useRouter()
  const serverUserId =
    useDashboardSessionUserId()
  const userId =
    clerkUserId ??
    user?.id ??
    serverUserId ??
    ""
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(userId || undefined)
  const {
    canConfigureWorkspace,
    canManageWorkspaceData,
    canCreateDecisions,
    loadingWorkspaceAccess,
  } =
    useWorkspaceAccess(userId || undefined)

  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()
  const [dashboardDatasetIds, setDashboardDatasetIds] =
    useState<Record<string, number>>({})
  const [dashboardViewsByDataset, setDashboardViewsByDataset] =
    useState<Record<string, Record<string, DashboardViewPreference>>>({})
  const [dashboardDatasetPreferencesLoaded, setDashboardDatasetPreferencesLoaded] =
    useState(false)
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])

  const [dataset, setDataset] =
    useState<DashboardDataset | null>(null)
  const [joinedDatasetResult, setJoinedDatasetResult] =
    useState<DatasetJoinResult | null>(null)

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

  const [dashboardEditMode, setDashboardEditMode] =
    useState(false)
  const [showJoinPanel, setShowJoinPanel] =
    useState(false)
  const [showDatasetPanel, setShowDatasetPanel] =
    useState(false)
  const [showAnalysisPanel, setShowAnalysisPanel] =
    useState(false)
  const [showGeneralDecisionatePanel, setShowGeneralDecisionatePanel] =
    useState(false)

  const [dashboardTitle, setDashboardTitle] =
    useState(defaultDashboardTitle)

  const [
    dashboardSubtitle,
    setDashboardSubtitle,
  ] = useState(defaultDashboardSubtitle)

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
  const [metricAnalysisLoading, setMetricAnalysisLoading] =
    useState(false)
  const [metricAnalysisError, setMetricAnalysisError] =
    useState(false)
  const [metricAnalysisRetryKey, setMetricAnalysisRetryKey] =
    useState(0)
  const [dashboardAnomalies, setDashboardAnomalies] =
    useState<DatasetAnomaliesResponse | null>(null)
  const [dashboardAnomalyLoading, setDashboardAnomalyLoading] =
    useState(false)
  const [dashboardAnomalyError, setDashboardAnomalyError] =
    useState(false)
  const [
    datasetsLoading,
    setDatasetsLoading,
  ] = useState(true)
  const [dashboardError, setDashboardError] =
    useState("")
  const [datasetPreferenceError, setDatasetPreferenceError] =
    useState("")
  const [dashboardErrorRetryMode, setDashboardErrorRetryMode] =
    useState<"dataset" | "default" | null>(null)
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [defaultDatasetRetryKey, setDefaultDatasetRetryKey] =
    useState(0)
  const [pdfExporting, setPdfExporting] =
    useState(false)
  const [creatingDashboardRecommendation, setCreatingDashboardRecommendation] =
    useState(false)
  const [organization, setOrganization] =
    useState<OrganizationRecord | null>(null)
  const [workspaces, setWorkspaces] =
    useState<OrganizationWorkspaceRecord[]>([])
  const [selectedDashboard, setSelectedDashboard] =
    useState(defaultDashboardKey)
  const selectedDashboardRef =
    useRef(defaultDashboardKey)
  selectedDashboardRef.current = selectedDashboard
  const [dashboardPreferenceLoadedKey, setDashboardPreferenceLoadedKey] =
    useState("")
  const dashboardPreferenceContextKey =
    `${userId}:${activeWorkspaceId}:${workspaceVersion}`
  const dashboardPreferenceLoaded =
    Boolean(userId) &&
    dashboardPreferenceLoadedKey ===
      dashboardPreferenceContextKey
  const [dashboardPreferenceError, setDashboardPreferenceError] =
    useState("")
  const [dashboardPreferenceRetryKey, setDashboardPreferenceRetryKey] =
    useState(0)
  const [
    dashboardMetricMappings,
    setDashboardMetricMappings,
  ] = useState<Record<string, DashboardMetricMapping>>({})
  const [
    dashboardChartTitlesByKey,
    setDashboardChartTitlesByKey,
  ] = useState<Record<string, DashboardChartTitles>>({})
  const dashboardPreferenceSaveQueueRef =
    useRef<Promise<void>>(Promise.resolve())
  const dashboardPreferenceSaveVersionRef =
    useRef(0)
  const dashboardPreferenceContextRef =
    useRef("")
  const dashboardDatasetHydrationRef =
    useRef("")
  const datasetDetailWorkspaceRef =
    useRef("")
  const datasetReadinessRef = useRef({
    datasets,
    datasetsLoading,
    dashboardDatasetPreferencesLoaded,
  })

  useEffect(() => {
    datasetReadinessRef.current = {
      datasets,
      datasetsLoading,
      dashboardDatasetPreferencesLoaded,
    }
  }, [
    dashboardDatasetPreferencesLoaded,
    datasets,
    datasetsLoading,
  ])

  useEffect(() => {
    dashboardDatasetHydrationRef.current = ""
    dashboardPreferenceContextRef.current =
      `${activeWorkspaceId}:${selectedDatasetId ?? "none"}:${selectedDashboard}`
  }, [
    activeWorkspaceId,
    selectedDashboard,
    selectedDatasetId,
  ])

  useEffect(() => {
    if (!userId) return

    const cleanUserId = userId

    let cancelled = false

    async function loadDashboardPreference() {
      try {
        const preference =
          await getDashboardPreference(
            cleanUserId,
            activeWorkspaceId
          )

        if (!cancelled) {
          setSelectedDashboard(
            isDashboardKey(
              preference.selected_dashboard
            )
              ? preference.selected_dashboard
              : defaultDashboardKey
          )
          setDashboardPreferenceError("")
          setDashboardPreferenceLoadedKey(
            dashboardPreferenceContextKey
          )
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedDashboard(defaultDashboardKey)
          setDashboardPreferenceError(
            getErrorMessage(
              error,
              "Dashboard preference service is unavailable."
            )
          )
          setDashboardPreferenceLoadedKey(
            dashboardPreferenceContextKey
          )
        }
      }
    }

    void loadDashboardPreference()

    return () => {
      cancelled = true
    }
  }, [
    activeWorkspaceId,
    dashboardPreferenceRetryKey,
    dashboardPreferenceContextKey,
    userId,
    workspaceVersion,
  ])

  useEffect(() => {
    return () => {
      if (shareStatusTimeoutRef.current) {
        window.clearTimeout(
          shareStatusTimeoutRef.current
        )
      }
    }
  }, [])

  useEffect(() => {
    if (!userId) return

    let ignoreResult = false

    async function loadDashboardBrand(
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

    void loadDashboardBrand(userId)

    function handleOrganizationUpdated(
      event: Event
    ) {
      const organization =
        (event as CustomEvent<OrganizationRecord>).detail

      if (organization) {
        setOrganization(organization)
      }
    }

    window.addEventListener(
      "decisionate:organization-updated",
      handleOrganizationUpdated
    )

    return () => {
      ignoreResult = true
      window.removeEventListener(
        "decisionate:organization-updated",
        handleOrganizationUpdated
      )
    }
  }, [
    activeWorkspaceId,
    userId,
  ])

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

  useEffect(() => {
    function handleWorkspaceSharingStopped(
      event: Event
    ) {
      if (
        !(event instanceof CustomEvent) ||
        event.detail?.scope !== "workspace" ||
        event.detail?.action !== "stop-all"
      ) {
        return
      }

      setShareEnabled(false)
      clearShareStatus()
    }

    window.addEventListener(
      "decisionate:dashboard-sharing-changed",
      handleWorkspaceSharingStopped
    )

    return () => {
      window.removeEventListener(
        "decisionate:dashboard-sharing-changed",
        handleWorkspaceSharingStopped
      )
    }
  }, [clearShareStatus])

  const joinedDatasetStorageKey =
    getJoinedDatasetStorageKey(
      activeWorkspaceId,
      userId,
      selectedDatasetId,
      selectedDashboard
    )

  const handleJoinedDatasetResult = useCallback(
    (result: DatasetJoinResult | null) => {
      setJoinedDatasetResult(result)
      if (result) {
        setShowJoinPanel(true)
      }
      if (result?.start_date) {
        setStartDate(result.start_date)
      }
      const persistedDatasetIds = Array.from(
        new Set(
          (
            result?.dataset_ids ??
            joinedDatasetResult?.dataset_ids ??
            (selectedDatasetId
              ? [selectedDatasetId]
              : [])
          ).filter(
            datasetId =>
              Number.isInteger(datasetId) &&
              datasetId > 0
          )
        )
      )
      persistedDatasetIds.forEach(datasetId => {
        persistJoinedDataset(
          getJoinedDatasetStorageKey(
            activeWorkspaceId,
            userId,
            datasetId,
            selectedDashboard
          ),
          result
        )
      })

      const availableColumns = result
        ? result.datasets
          .filter(
            column => column.column_type === "numeric"
          )
          .map(column => column.label)
        : dataset?.metrics.map(
          metric => metric.column
        ) ?? []
      const availableColumnSet = new Set(
        availableColumns
      )

      setSelectedMetrics(current => {
        const retained = current.filter(metric =>
          availableColumnSet.has(metric)
        )
        return retained.length > 0
          ? retained
          : availableColumns.slice(0, 1)
      })
    },
    [
      activeWorkspaceId,
      dataset,
      joinedDatasetResult,
      selectedDatasetId,
      selectedDashboard,
      userId,
    ]
  )

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      if (!selectedDatasetId || !userId) {
        setJoinedDatasetResult(null)
        return
      }

      const stored = readPersistedJoinedDataset(
        joinedDatasetStorageKey
      )
      if (
        !stored ||
        !stored.dataset_ids.includes(selectedDatasetId)
      ) {
        return
      }

      setJoinedDatasetResult(current =>
        isCurrentJoinedDatasetResult(current) &&
        current.dataset_ids.includes(selectedDatasetId)
          ? current
          : stored
      )
      const availableColumns = stored.datasets
        .filter(
          column => column.column_type === "numeric"
        )
        .map(column => column.label)
      const availableColumnSet = new Set(
        availableColumns
      )
      setSelectedMetrics(current => {
        const retained = current.filter(metric =>
          availableColumnSet.has(metric)
        )
        const next = retained.length > 0
          ? retained
          : availableColumns.slice(0, 1)
        return current.length === next.length &&
          current.every(
            (metric, index) => metric === next[index]
          )
          ? current
          : next
      })

    })

    return () => {
      cancelled = true
    }
  }, [
    dataset,
    joinedDatasetStorageKey,
    selectedDatasetId,
    selectedDashboard,
    userId,
  ])

  useEffect(() => {
    if (
      !joinedDatasetResult ||
      isCurrentJoinedDatasetResult(joinedDatasetResult)
    ) {
      return
    }

    queueMicrotask(() => {
      setJoinedDatasetResult(null)
    })
  }, [joinedDatasetResult])

  const clearSelectedDashboard =
    useCallback(() => {
      setDataset(null)
      setSelectedMetrics([])
      dashboardDatasetHydrationRef.current = ""
      setTargets({})
      setDashboardTitle(defaultDashboardTitle)
      setDashboardSubtitle(
        defaultDashboardSubtitle
      )
      setDashboardError("")
      setDashboardErrorRetryMode(null)
      setShareEnabled(false)
      setLoading(false)
      clearShareStatus()
    }, [
      clearShareStatus,
    ])

  async function handleDatasetSelectionChange(
    datasetId: number | undefined
  ) {
    const previousDatasetId = selectedDatasetId
    const previousDashboardDatasetIds =
      dashboardDatasetIds
    const nextDashboardDatasetIds = {
      ...dashboardDatasetIds,
    }

    if (datasetId) {
      nextDashboardDatasetIds[selectedDashboard] =
        datasetId
    } else {
      delete nextDashboardDatasetIds[selectedDashboard]
    }

    clearSelectedDashboard()
    setJoinedDatasetResult(null)
    setSelectedDatasetId(datasetId)
    setDashboardDatasetIds(nextDashboardDatasetIds)

    if (!datasetId || !userId) {
      return
    }

    try {
      await updateDatasetPreference(
        datasetId,
        userId,
        "",
        undefined,
        undefined,
        activeWorkspaceId,
        nextDashboardDatasetIds
      )
      setDatasetPreferenceError("")
    } catch (error) {
      setSelectedDatasetId(previousDatasetId)
      setDashboardDatasetIds(
        previousDashboardDatasetIds
      )
      setDashboardError(
        getErrorMessage(
          error,
          "Unable to save your selected dataset."
        )
      )
      setDashboardErrorRetryMode(null)
    }
  }

  /* =========================
     Load Selected Dataset
  ========================= */

  useEffect(() => {
    const datasetWorkspaceKey =
      `${activeWorkspaceId}:${workspaceVersion}`
    if (
      datasetDetailWorkspaceRef.current !==
      datasetWorkspaceKey
    ) {
      datasetDetailWorkspaceRef.current =
        datasetWorkspaceKey
      return
    }

    const {
      datasets: currentDatasets,
      datasetsLoading: currentDatasetsLoading,
      dashboardDatasetPreferencesLoaded:
        currentDashboardDatasetPreferencesLoaded,
    } = datasetReadinessRef.current

    if (
      !selectedDatasetId ||
      !userId ||
      currentDatasetsLoading ||
      !currentDashboardDatasetPreferencesLoaded ||
      !currentDatasets.some(
        datasetSummary =>
          datasetSummary.id === selectedDatasetId
      )
    ) {
      return
    }

    const datasetId = selectedDatasetId
    let isCurrent = true

    async function loadDataset() {
      try {
        setLoading(true)

        const [
          datasetResult,
          preferenceResult,
          joinCacheResult,
          shareResult,
        ] = await Promise.allSettled([
          getDatasetDetails(
            datasetId,
            userId,
            activeWorkspaceId,
            {
              includeAllRows: true,
              includeAIAnalysis: false,
            }
          ),
          getDatasetPreference(
            userId,
            activeWorkspaceId
          ),
          getDatasetJoinCache(
            datasetId,
            selectedDashboard,
            userId,
            activeWorkspaceId
          ),
          canConfigureWorkspace
            ? getDatasetShareStatus(
                datasetId,
                userId,
                activeWorkspaceId,
                selectedDashboard
              )
            : Promise.resolve({
                share_enabled: false,
              }),
        ])

        if (!isCurrent) {
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
        const cachedJoinedDatasetResult =
          joinCacheResult.status === "fulfilled"
            ? joinCacheResult.value
            : null
        const locallyPersistedJoinedDatasetResult =
          readPersistedJoinedDataset(
            getJoinedDatasetStorageKey(
              activeWorkspaceId,
              userId,
              datasetId,
              selectedDashboard
            )
          )
        const shareState =
          shareResult.status === "fulfilled"
            ? shareResult.value
            : { share_enabled: false }

        const savedTargets =
          preference?.metric_targets ?? {}

        const savedDashboardDatasetIds =
          preference?.dashboard_dataset_ids ?? {}

        const savedDashboardPreferences =
          preference?.dashboard_preferences ?? {}
        const savedDashboardViews =
          preference?.dashboard_views ?? {}

        const datasetKey =
          String(datasetId)

        const legacyDashboardPreference =
          savedDashboardPreferences[datasetKey] ?? {}
        const savedDashboardPreference = {
          ...(selectedDashboard === defaultDashboardKey
            ? legacyDashboardPreference
            : {
              metricMappings:
                legacyDashboardPreference.metricMappings,
              chartTitles:
                legacyDashboardPreference.chartTitles,
            }),
          ...(savedDashboardViews[datasetKey]?.[
            selectedDashboard
          ] ?? {}),
        }
        const savedJoinedDatasetResult =
          cachedJoinedDatasetResult ??
          (isCurrentJoinedDatasetResult(
            savedDashboardPreference.joinedDatasetResult
          ) &&
          savedDashboardPreference.joinedDatasetResult.dataset_ids.includes(
            datasetId
          )
            ? savedDashboardPreference.joinedDatasetResult
            : findPersistedJoinedDatasetResult(
                savedDashboardPreferences,
                savedDashboardViews,
                selectedDashboard,
                datasetId
              )) ??
          (isCurrentJoinedDatasetResult(
            locallyPersistedJoinedDatasetResult
          ) &&
          locallyPersistedJoinedDatasetResult.dataset_ids.includes(
            datasetId
          )
            ? locallyPersistedJoinedDatasetResult
            : null)
        const dashboardSupportsMetricMapping =
          dashboardUsesDatasetMetricMapping(
            getDashboardDefinition(
              selectedDashboard
            ).componentKey
          )
        const savedMetricMapping =
          dashboardSupportsMetricMapping
            ? getSavedDashboardMetricMapping(
                getSavedDashboardMetricMappings(
                  savedDashboardPreference.metricMappings
                )[selectedDashboard]
              )
            : {}
        const savedDashboardChartTitles =
          getSavedDashboardChartTitles(
            savedDashboardPreference.chartTitles
          )

        const availableMetrics =
          savedJoinedDatasetResult
            ? savedJoinedDatasetResult.datasets
              .filter(
                column => column.column_type === "numeric"
              )
              .map(column => column.label)
            : data?.metrics?.map(
              (metric: DashboardMetric) => metric.column
            ) ?? []
        const savedSelectedMetrics =
          getValidSelectedMetrics(
            savedDashboardPreference.selectedMetrics,
            availableMetrics
          )
        const localSelectedMetrics =
          readPersistedSelectedMetrics(
            getSelectedMetricsStorageKey(
              activeWorkspaceId,
              userId,
              datasetId,
              selectedDashboard
            ),
            availableMetrics
          )
        const restoredSelectedMetrics =
          savedSelectedMetrics.length > 0
            ? savedSelectedMetrics
            : localSelectedMetrics ??
              (availableMetrics.length > 0
                ? [availableMetrics[0]]
                : [])
        const sharedSelectedMetric =
          selectedDashboard === defaultDashboardKey &&
          typeof preference?.selected_metric === "string" &&
          availableMetrics.includes(
            preference.selected_metric
          )
            ? preference.selected_metric
            : undefined
        const resolvedSelectedMetrics =
          sharedSelectedMetric
            ? [
              sharedSelectedMetric,
              ...restoredSelectedMetrics.filter(
                metric => metric !== sharedSelectedMetric
              ),
            ]
            : restoredSelectedMetrics
        const datasetTargets =
          getSavedMetricTargets(
            savedTargets[datasetKey],
            availableMetrics
          )

        const safePeriodFilter =
          getSavedPeriodFilter(
            savedDashboardPreference.periodFilter
          )
        const safeAggregation =
          getSavedAggregation(
            savedDashboardPreference.aggregation
          )
        const safeAggregationType =
          getSavedAggregationType(
            savedDashboardPreference.aggregationType
          )
        const savedChartRows =
          savedJoinedDatasetResult?.rows.length
            ? savedJoinedDatasetResult.rows
            : data?.chart?.data?.length
            ? data.chart.data
            : data?.preview ?? []

        const safeStartDate =
          getSafeStartDate(
            savedDashboardPreference.startDate,
            savedChartRows,
            savedJoinedDatasetResult
              ? "period"
              : data?.chart?.x_key ?? "month",
            safePeriodFilter
          )

        setDataset(data)
        setJoinedDatasetResult(
          savedJoinedDatasetResult
        )
        setShareEnabled(
          shareState.share_enabled
        )
        setMetricTargetsByDataset(savedTargets)
        setDashboardDatasetIds(
          savedDashboardDatasetIds
        )
        setDashboardPreferencesByDataset(
          savedDashboardPreferences
        )
        setDashboardViewsByDataset(
          savedDashboardViews
        )
        setDashboardMetricMappings(current => ({
          ...current,
          [`${selectedDashboard}:${datasetId}`]:
            savedMetricMapping,
        }))
        setDashboardChartTitlesByKey(current => ({
          ...current,
          [`${selectedDashboard}:${datasetId}`]:
            savedDashboardChartTitles[selectedDashboard] ?? {},
        }))

        setSelectedMetrics(
          resolvedSelectedMetrics
        )
        persistSelectedMetrics(
          getSelectedMetricsStorageKey(
            activeWorkspaceId,
            userId,
            datasetId,
            selectedDashboard
          ),
          resolvedSelectedMetrics
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

        setAggregation(safeAggregation)

        setAggregationType(safeAggregationType)

        setDashboardTemplate(
          getSavedDashboardTemplate(
            savedDashboardPreference.dashboardTemplate ??
              sharedConfig?.dashboardTemplate
          )
        )

        setDashboardTitle(
          getSavedDashboardText(
            savedDashboardPreference.title,
            defaultDashboardTitle,
            maxDashboardTitleLength
          )
        )

        setDashboardSubtitle(
          getSavedDashboardText(
            savedDashboardPreference.subtitle,
            defaultDashboardSubtitle,
            maxDashboardSubtitleLength
          )
        )

        setStartDate(
          savedJoinedDatasetResult?.start_date ??
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
        dashboardDatasetHydrationRef.current =
          `${activeWorkspaceId}:${datasetId}:${selectedDashboard}`
        setDashboardError("")
        setDashboardErrorRetryMode(null)
      } catch (error) {
        if (isCurrent) {
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to load dashboard."
            )
          )
          setDashboardErrorRetryMode("dataset")
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
    canConfigureWorkspace,
    datasetLoadRetryKey,
    selectedDashboard,
    sharedConfig,
    userId,
    workspaceVersion,
  ])

  /* =========================
     Load Default Dataset
  ========================= */

  const datasetDefaultsLoadKey =
    `${userId}:${activeWorkspaceId ?? ""}:${workspaceVersion}:${defaultDatasetRetryKey}`

  useEffect(() => {
    if (!userId || !dashboardPreferenceLoaded) return

    let isCurrent = true

    async function loadDefaultDataset() {
      try {
        clearSelectedDashboard()
        setSelectedDatasetId(undefined)
        setDashboardDatasetPreferencesLoaded(false)
        setDatasets([])
        setDatasetPreferenceError("")
        setDatasetsLoading(true)

        const [datasetsResult, preferenceResult] =
          await Promise.allSettled([
            getDatasets(
              userId,
              activeWorkspaceId
            ),
            getDatasetPreference(
              userId,
              activeWorkspaceId
            ),
          ])

        if (!isCurrent) {
          return
        }

        if (datasetsResult.status === "rejected") {
          throw datasetsResult.reason
        }

        const datasetSummaries =
          datasetsResult.value

        setDatasets(datasetSummaries)

        const preference =
          preferenceResult.status === "fulfilled"
            ? preferenceResult.value
            : undefined

        const savedDashboardDatasetIds = {
          ...(preference?.dashboard_dataset_ids ?? {}),
        }
        const legacyDatasetId =
          preference?.selected_dataset_id
        if (
          !savedDashboardDatasetIds[defaultDashboardKey] &&
          legacyDatasetId &&
          datasetSummaries.some(
            datasetSummary =>
              datasetSummary.id === legacyDatasetId
          )
        ) {
          savedDashboardDatasetIds[defaultDashboardKey] =
            legacyDatasetId
        }

        setDashboardDatasetIds(
          savedDashboardDatasetIds
        )
        const sharedDatasetId =
          sharedConfig?.datasetId &&
          datasetSummaries.some(
            (datasetSummary) =>
              datasetSummary.id ===
              sharedConfig.datasetId
          )
            ? sharedConfig.datasetId
            : undefined
        const savedSelectedDatasetId =
          savedDashboardDatasetIds[
            selectedDashboardRef.current
          ]
        const nextDatasetId =
          sharedDatasetId ??
          (
            savedSelectedDatasetId &&
            datasetSummaries.some(
              datasetSummary =>
                datasetSummary.id ===
                savedSelectedDatasetId
            )
              ? savedSelectedDatasetId
              : datasetSummaries[0]?.id
          )

        setSelectedDatasetId(nextDatasetId)
        setDashboardDatasetPreferencesLoaded(true)

        if (preferenceResult.status === "rejected") {
          setDatasetPreferenceError(
            `${getErrorMessage(
              preferenceResult.reason,
              "Dataset preference service is unavailable."
            )} Using the first available dataset.`
          )
        } else {
          setDatasetPreferenceError("")
        }

        setMetricTargetsByDataset(
          preference?.metric_targets ?? {}
        )

        setDashboardPreferencesByDataset(
          preference?.dashboard_preferences ?? {}
        )
        setDashboardViewsByDataset(
          preference?.dashboard_views ?? {}
        )

      } catch (error) {
        if (isCurrent) {
          setDatasets([])
          setDashboardDatasetPreferencesLoaded(true)
          setDatasetPreferenceError("")
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to load dashboard defaults."
            )
          )
          setDashboardErrorRetryMode("default")
        }
      } finally {
        if (isCurrent) {
          setDatasetsLoading(false)
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
    defaultDatasetRetryKey,
    dashboardPreferenceLoaded,
    datasetDefaultsLoadKey,
    userId,
    workspaceVersion,
  ])

  useEffect(() => {
    if (
      datasetsLoading ||
      !dashboardDatasetPreferencesLoaded ||
      !datasets.length ||
      !selectedDashboard
    ) {
      return
    }

    const savedDatasetId =
      dashboardDatasetIds[selectedDashboard]
    const sharedDatasetId =
      sharedConfig?.datasetId &&
      datasets.some(
        datasetSummary =>
          datasetSummary.id === sharedConfig.datasetId
      )
        ? sharedConfig.datasetId
        : undefined
    const nextDatasetId =
      sharedDatasetId ?? (
        savedDatasetId &&
          datasets.some(
            datasetSummary =>
              datasetSummary.id === savedDatasetId
          )
            ? savedDatasetId
            : datasets[0].id
      )

    if (nextDatasetId === selectedDatasetId) {
      return
    }

    queueMicrotask(() => {
      clearSelectedDashboard()
      setSelectedDatasetId(nextDatasetId)
    })
  }, [
    clearSelectedDashboard,
    dashboardDatasetIds,
    dashboardDatasetPreferencesLoaded,
    datasets,
    datasetsLoading,
    sharedConfig,
    selectedDashboard,
    selectedDatasetId,
  ])

  /* =========================
     Persist Metric Targets
  ========================= */

  useEffect(() => {
    if (
      !userId ||
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
            userId,
            undefined,
            nextMetricTargets,
            undefined,
            activeWorkspaceId
          )

          setMetricTargetsByDataset(
            nextMetricTargets
          )
          setDashboardError("")
          setDashboardErrorRetryMode(null)
        } catch (error) {
          setTargets(savedDatasetTargets)
          setDashboardError(
            getErrorMessage(
              error,
              "Unable to save metric targets."
            )
          )
          setDashboardErrorRetryMode(null)
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
    userId,
  ])

  /* =========================
     Derived Dashboard Data
  ========================= */

  const allRows = useMemo(
    () =>
      joinedDatasetResult?.rows.length
        ? joinedDatasetResult.rows
        : dataset?.chart?.data?.length
        ? dataset.chart.data
        : dataset?.preview ?? [],
    [dataset, joinedDatasetResult]
  )
  const joinedNumericMetrics = useMemo(
    () =>
      joinedDatasetResult?.datasets
        .filter(
          column => column.column_type === "numeric"
        )
        .map(column => ({
          column: column.label,
        })) ?? [],
    [joinedDatasetResult]
  )
  const metrics = useMemo(
    () =>
      joinedDatasetResult
        ? joinedNumericMetrics
        : dataset?.metrics ?? [],
    [dataset, joinedDatasetResult, joinedNumericMetrics]
  )
  const joinedMappingColumns = useMemo(
    () =>
      joinedDatasetResult?.datasets.map(
        column => column.label
      ) ?? [],
    [joinedDatasetResult]
  )
  const joinedNumericMappingColumns = useMemo(
    () =>
      joinedDatasetResult?.datasets
        .filter(
          column => column.column_type === "numeric"
        )
        .map(column => column.label) ?? [],
    [joinedDatasetResult]
  )
  const joinedDimensionMappingColumns = useMemo(
    () =>
      joinedDatasetResult?.datasets
        .filter(
          column => column.column_type !== "numeric"
        )
        .map(column => column.label) ?? [],
    [joinedDatasetResult]
  )
  const dashboardMappingColumns = useMemo(
    () =>
      joinedDatasetResult
        ? joinedMappingColumns
        : getDashboardMappingColumns(dataset),
    [dataset, joinedDatasetResult, joinedMappingColumns]
  )
  const dashboardNumericMappingColumns = useMemo(
    () =>
      joinedDatasetResult
        ? joinedNumericMappingColumns
        : getDashboardNumericMappingColumns(dataset),
    [dataset, joinedDatasetResult, joinedNumericMappingColumns]
  )
  const dashboardDimensionMappingColumns = useMemo(
    () =>
      joinedDatasetResult
        ? joinedDimensionMappingColumns
        : getDashboardDimensionMappingColumns(dataset),
    [dataset, joinedDatasetResult, joinedDimensionMappingColumns]
  )
  const dashboardMappingKey = useMemo(
    () =>
      `${selectedDashboard}:${selectedDatasetId ?? "none"}`,
    [
      selectedDashboard,
      selectedDatasetId,
    ]
  )
  const dashboardChartTitleKey = dashboardMappingKey
  const currentDashboardChartTitles = useMemo(
    () =>
      cleanDashboardChartTitles(
        dashboardChartTitlesByKey[
          dashboardChartTitleKey
        ] ?? {}
      ),
    [
      dashboardChartTitleKey,
      dashboardChartTitlesByKey,
    ]
  )
  const currentSavedDashboardPreference =
    useMemo<DashboardViewPreference>(() => {
      const datasetKey =
        String(selectedDatasetId ?? "")
      const legacyPreference =
        dashboardPreferencesByDataset[datasetKey] ?? {}
      const dashboardPreference =
        dashboardViewsByDataset[datasetKey]?.[
          selectedDashboard
        ] ?? {}

      return {
        ...(selectedDashboard === defaultDashboardKey
          ? legacyPreference
          : {
            metricMappings:
              legacyPreference.metricMappings,
            chartTitles:
              legacyPreference.chartTitles,
          }),
        ...dashboardPreference,
      }
    }, [
      dashboardPreferencesByDataset,
      dashboardViewsByDataset,
      selectedDashboard,
      selectedDatasetId,
    ])
  const currentMetricMapping = useMemo(
    () => {
      const savedMapping =
        dashboardMetricMappings[dashboardMappingKey] ?? {}
      const availableColumns = new Set(
        dashboardMappingColumns
      )
      const numericColumns = new Set(
        dashboardNumericMappingColumns
      )

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
          const value = savedMapping[key]

          if (
            value &&
            availableColumns.has(value) &&
            (!["primary", "secondary", "operationsValue"].includes(key) ||
              numericColumns.has(value))
          ) {
            result[key] = value
          }

          return result
        },
        {}
      )
    },
    [
      dashboardMetricMappings,
      dashboardMappingKey,
      dashboardMappingColumns,
      dashboardNumericMappingColumns,
    ]
  )
  const cleanCurrentMetricMapping =
    useMemo(
      () =>
        cleanDashboardMetricMapping(
          currentMetricMapping
        ),
      [currentMetricMapping]
    )
  const xKey =
    joinedDatasetResult
      ? "period"
      : currentMetricMapping.date ||
        dataset?.chart?.x_key ||
        "month"

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
  const dashboardMetrics = useMemo(
    () =>
      getDashboardPeriodMetrics(
        metrics,
        rows,
        startDate,
        periodFilter,
        aggregationType
      ),
    [
      aggregationType,
      metrics,
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
        metrics.map(metric => metric.column),
        aggregationType
      ),
    [
      aggregation,
      aggregationType,
      metrics,
      rows,
      xKey,
    ]
  )
  const selectedDashboardDataset = useMemo(() => {
    if (
      !dataset ||
      getDashboardDefinition(selectedDashboard).dataBasis !==
        "dataset"
    ) {
      return dataset
    }

    return {
      ...dataset,
      metrics: dashboardMetrics,
      chart: {
        ...(dataset.chart ?? {}),
        data: rows,
      },
    }
  }, [
    dataset,
    dashboardMetrics,
    rows,
    selectedDashboard,
  ])
  const primaryMetric =
    selectedMetrics[0] ??
    metrics[0]?.column ??
    ""
  const dashboardComponentKeyForSync =
    getDashboardDefinition(
      selectedDashboard
    ).componentKey
  const selectedDashboardUsesMetricMapping =
    dashboardUsesDatasetMetricMapping(
      dashboardComponentKeyForSync
    )
  const selectedDashboardAutoMetric =
    getDashboardAutoMetricMapping(
      dashboardComponentKeyForSync,
      selectedDashboardDataset
    ).primary
  const dashboardAnalysisMetric =
    joinedDatasetResult
      ? undefined
      : selectedDashboardUsesMetricMapping
        ? currentMetricMapping.primary ||
          selectedDashboardAutoMetric ||
          primaryMetric
        : primaryMetric
  const selectedDashboardSharedMetric =
    selectedDashboard === defaultDashboardKey
      ? primaryMetric
      : selectedDashboardUsesMetricMapping
        ? currentMetricMapping.primary ||
          selectedDashboardAutoMetric
        : undefined

  useEffect(() => {
    const selectedComponentKey =
      getDashboardDefinition(
        selectedDashboard
      ).componentKey

    if (
      !userId ||
      !selectedDatasetId ||
      !dashboardAnalysisMetric ||
      selectedComponentKey === "decisionPerformance"
    ) {
      queueMicrotask(() => {
        setMetricAnalysisLoading(false)
        setMetricAnalysisError(false)
      })
      return
    }

    const safeDatasetId = selectedDatasetId
    const metric = dashboardAnalysisMetric
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
    dashboardAnalysisMetric,
    metricAnalysisRetryKey,
    selectedDashboard,
    selectedDatasetId,
    userId,
  ])

  useEffect(() => {
    if (
      selectedDashboard !== defaultDashboardKey ||
      !userId ||
      !selectedDatasetId ||
      !dataset ||
      loading ||
      joinedDatasetResult
    ) {
      queueMicrotask(() => {
        setDashboardAnomalies(null)
        setDashboardAnomalyLoading(false)
        setDashboardAnomalyError(false)
      })
      return
    }

    const cleanDatasetId = selectedDatasetId
    const cleanUserId = userId
    let ignoreResult = false

    queueMicrotask(() => {
      setDashboardAnomalyLoading(true)
      setDashboardAnomalyError(false)
    })

    async function loadDashboardAnomalies() {
      try {
        const result = await getDatasetAnomalies(
          cleanDatasetId,
          cleanUserId,
          activeWorkspaceId,
          {
            dateColumn: xKey === "month" ? undefined : xKey,
            startDate: startDate || undefined,
            periodFilter,
            aggregation,
            aggregationType,
            sensitivity: "medium",
          }
        )

        if (!ignoreResult) {
          setDashboardAnomalies(result)
        }
      } catch {
        if (!ignoreResult) {
          setDashboardAnomalies(null)
          setDashboardAnomalyError(true)
        }
      } finally {
        if (!ignoreResult) {
          setDashboardAnomalyLoading(false)
        }
      }
    }

    void loadDashboardAnomalies()

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    aggregation,
    aggregationType,
    dataset,
    joinedDatasetResult,
    loading,
    periodFilter,
    selectedDashboard,
    selectedDatasetId,
    startDate,
    userId,
    xKey,
  ])

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

  const targetMet =
    selectedTarget > 0 &&
    targetProgress >= 100
  const availableMetricColumns =
    useMemo(
      () =>
        metrics.map(
          (metric) => metric.column
        ),
      [metrics]
    )

  async function handleCreateMainDashboardRecommendation() {
    const analysis = dataset?.ai_analysis

    if (
      !userId ||
      !selectedDatasetId ||
      !primaryMetric ||
      !analysis ||
      !analysis.recommendations.length ||
      !canCreateDecisions ||
      creatingDashboardRecommendation
    ) {
      return
    }

    const decisionPayload =
      buildAIRecommendationDecisionPayload(
        selectedDatasetId,
        primaryMetric,
        analysis,
        dataset.file_name
      )

    if (!decisionPayload) {
      return
    }

    try {
      setCreatingDashboardRecommendation(true)
      setDashboardError("")

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
      setDashboardError(
        getErrorMessage(
          error,
          "Unable to create a decision from the dashboard analysis."
        )
      )
    } finally {
      setCreatingDashboardRecommendation(false)
    }
  }

  const chartRows =
    scaleMode === "indexed" &&
    selectedMetrics.length > 1
      ? buildIndexedRows(
          aggregatedRows,
          selectedMetrics,
          xKey
        )
      : aggregatedRows
  const activeBrand = useMemo(
    () =>
      getWorkspaceBrand(
        activeWorkspaceId,
        userId,
        organization,
        workspaces,
        user?.fullName
      ),
    [
      activeWorkspaceId,
      organization,
      user?.fullName,
      userId,
      workspaces,
    ]
  )
  const effectiveDashboardTitle =
    getSavedDashboardText(
      dashboardTitle,
      defaultDashboardTitle,
      maxDashboardTitleLength
    )
  const effectiveDashboardSubtitle =
    getSavedDashboardText(
      dashboardSubtitle,
      defaultDashboardSubtitle,
      maxDashboardSubtitleLength
    )
  const selectedDashboardDefinition =
    getDashboardDefinition(selectedDashboard)
  const selectedDashboardNeedsDataset =
    selectedDashboardDefinition.dataBasis ===
    "dataset"
  const selectedDashboardComponentKey =
    selectedDashboardDefinition.componentKey
  const selectedDashboardUsesDatasetMetricMapping =
    dashboardUsesDatasetMetricMapping(
      selectedDashboardComponentKey
    )
  const dashboardAutoMetricMappingForWarning =
    getDashboardAutoMetricMapping(
      selectedDashboardComponentKey,
      selectedDashboardDataset
    )
  const historicalDataWarning =
    getHistoricalDimensionWarning(
      rows,
      [
        currentMetricMapping.category ||
          dashboardAutoMetricMappingForWarning.category,
        currentMetricMapping.stage ||
          dashboardAutoMetricMappingForWarning.stage,
      ]
    )
  const savedDashboardMetricMappings =
    useMemo(
      () =>
        getNextDashboardMetricMappings(
          currentSavedDashboardPreference.metricMappings ?? {},
          selectedDashboard,
          cleanCurrentMetricMapping,
          dashboardUsesDatasetMetricMapping(
            getDashboardDefinition(
              selectedDashboard
            ).componentKey
          )
        ),
      [
        cleanCurrentMetricMapping,
        currentSavedDashboardPreference,
        selectedDashboard,
      ]
    )
  const savedDashboardChartTitles =
    useMemo(
      () =>
        getNextDashboardChartTitles(
          currentSavedDashboardPreference.chartTitles ?? {},
          selectedDashboard,
          currentDashboardChartTitles,
          selectedDashboard !== defaultDashboardKey
        ),
      [
        currentDashboardChartTitles,
        currentSavedDashboardPreference,
        selectedDashboard,
      ]
    )
  const currentDashboardPreference =
    useMemo<DashboardViewPreference>(
      () => ({
        title: cleanDashboardText(
          dashboardTitle,
          maxDashboardTitleLength
        ),
        subtitle: cleanDashboardText(
          dashboardSubtitle,
          maxDashboardSubtitleLength
        ),
        selectedMetrics:
          getValidSelectedMetrics(
            selectedMetrics,
            availableMetricColumns
          ),
        aggregation,
        aggregationType,
        chartType,
        scaleMode,
        periodFilter,
        dashboardTemplate,
        startDate,
        ...(Object.keys(
          savedDashboardMetricMappings
        ).length > 0
          ? {
            metricMappings:
              savedDashboardMetricMappings,
          }
          : {}),
        ...(Object.keys(
          savedDashboardChartTitles
        ).length > 0
          ? {
            chartTitles:
              savedDashboardChartTitles,
          }
          : {}),
        ...(joinedDatasetResult
          ? {
            joinedDatasetResult,
          }
          : {}),
      }),
      [
        availableMetricColumns,
        aggregation,
        aggregationType,
        chartType,
        dashboardSubtitle,
        dashboardTemplate,
        dashboardTitle,
        periodFilter,
        scaleMode,
        savedDashboardChartTitles,
        joinedDatasetResult,
        selectedMetrics,
        startDate,
        savedDashboardMetricMappings,
      ]
    )

  const saveDashboardViewPreference =
    useCallback(async (
      selectedMetricsOverride?: string[]
    ) => {
      const dashboardDatasetContextKey =
        `${activeWorkspaceId}:${selectedDatasetId ?? "none"}:${selectedDashboard}`

      if (
        !userId ||
        !selectedDatasetId ||
        !dataset ||
        loading ||
        dashboardDatasetHydrationRef.current !==
          dashboardDatasetContextKey
      ) {
        return
      }

      const savedDashboardPreference =
        currentSavedDashboardPreference
      const preferenceToSave =
        selectedMetricsOverride
          ? {
            ...currentDashboardPreference,
            selectedMetrics: getValidSelectedMetrics(
              selectedMetricsOverride,
              availableMetricColumns
            ),
          }
          : currentDashboardPreference

      if (
        JSON.stringify(savedDashboardPreference) ===
        JSON.stringify(preferenceToSave)
      ) {
        return
      }

      const savedJoinResult =
        currentSavedDashboardPreference.joinedDatasetResult ??
        findPersistedJoinedDatasetResult(
          dashboardPreferencesByDataset,
          dashboardViewsByDataset,
          selectedDashboard,
          selectedDatasetId
        )
      const activeJoinResult =
        joinedDatasetResult ??
        savedJoinResult
      const joinedDatasetIds =
        activeJoinResult &&
        Array.isArray(activeJoinResult.dataset_ids)
          ? Array.from(
              new Set(
                activeJoinResult.dataset_ids.filter(
                  datasetId =>
                    Number.isInteger(datasetId) &&
                    datasetId > 0
                )
              )
            )
          : [selectedDatasetId]
      const nextDashboardPreferences = {
        ...dashboardPreferencesByDataset,
      }
      const nextDashboardViews = {
        ...dashboardViewsByDataset,
      }

      joinedDatasetIds.forEach(joinedDatasetId => {
        const joinedDatasetKey = String(joinedDatasetId)
        const existingPreference = {
          ...(nextDashboardPreferences[joinedDatasetKey] ?? {}),
        }
        delete existingPreference.joinedDatasetResult
        nextDashboardPreferences[joinedDatasetKey] = {
          ...existingPreference,
          ...preferenceToSave,
        }
        nextDashboardViews[joinedDatasetKey] = {
          ...(nextDashboardViews[joinedDatasetKey] ?? {}),
          [selectedDashboard]: preferenceToSave,
        }
      })

      const saveVersion =
        ++dashboardPreferenceSaveVersionRef.current
      const saveContextKey =
        dashboardPreferenceContextRef.current
      const saveRequest =
        dashboardPreferenceSaveQueueRef.current.then(
          async () => {
            try {
              await updateDatasetPreference(
                selectedDatasetId,
                userId,
                selectedMetricsOverride?.[0] ??
                  selectedDashboardSharedMetric,
                undefined,
                nextDashboardPreferences,
                activeWorkspaceId,
                dashboardDatasetIds,
                nextDashboardViews
              )

              if (
                saveVersion !==
                  dashboardPreferenceSaveVersionRef.current ||
                saveContextKey !==
                  dashboardPreferenceContextRef.current
              ) {
                return
              }

              setDashboardPreferencesByDataset(
                nextDashboardPreferences
              )
              setDashboardViewsByDataset(
                nextDashboardViews
              )
              setDashboardError("")
              setDashboardErrorRetryMode(null)
            } catch (error) {
              if (
                saveVersion !==
                  dashboardPreferenceSaveVersionRef.current ||
                saveContextKey !==
                  dashboardPreferenceContextRef.current
              ) {
                return
              }

              const savedMetricMappings =
                getSavedDashboardMetricMappings(
                  savedDashboardPreference.metricMappings
                )
              const savedChartTitles =
                getSavedDashboardChartTitles(
                  savedDashboardPreference.chartTitles
                )
              setDashboardMetricMappings(current => ({
                ...current,
                [dashboardMappingKey]:
                  getSavedDashboardMetricMapping(
                    savedMetricMappings[selectedDashboard]
                  ),
              }))
              setDashboardChartTitlesByKey(current => ({
                ...current,
                [dashboardChartTitleKey]:
                  savedChartTitles[selectedDashboard] ?? {},
              }))
              setDashboardError(
                getErrorMessage(
                  error,
                  "Unable to save dashboard view."
                )
              )
              setDashboardErrorRetryMode(null)
              console.error(error)
              throw error
            }
          }
        )

      dashboardPreferenceSaveQueueRef.current =
        saveRequest.then(
          () => undefined,
          () => undefined
        )

      await saveRequest
    }, [
      activeWorkspaceId,
      currentDashboardPreference,
      availableMetricColumns,
      dashboardMappingKey,
      dashboardChartTitleKey,
      dashboardDatasetIds,
      dashboardPreferencesByDataset,
      dashboardViewsByDataset,
      dataset,
      joinedDatasetResult,
      loading,
      currentSavedDashboardPreference,
      selectedDashboardSharedMetric,
      selectedDatasetId,
      selectedDashboard,
      userId,
    ])

  /* =========================
     Persist Dashboard View
  ========================= */

  useEffect(() => {
    const dashboardDatasetContextKey =
      `${activeWorkspaceId}:${selectedDatasetId ?? "none"}:${selectedDashboard}`

    if (
      !userId ||
      !selectedDatasetId ||
      !dataset ||
      loading ||
      dashboardDatasetHydrationRef.current !==
        dashboardDatasetContextKey
    ) {
      return
    }

    const saveViewTimeout =
      window.setTimeout(() => {
        void saveDashboardViewPreference().catch(
          () => undefined
        )
      }, 500)

    return () => {
      window.clearTimeout(saveViewTimeout)
    }
  }, [
    aggregation,
    aggregationType,
    activeWorkspaceId,
    chartType,
    dashboardTemplate,
    dataset,
    loading,
    periodFilter,
    scaleMode,
    selectedDatasetId,
    selectedMetrics,
    joinedDatasetResult,
    saveDashboardViewPreference,
    startDate,
    selectedDashboard,
    userId,
  ])

  const templateProps: ReportSectionProps = {
    dashboardTitle: effectiveDashboardTitle,
    dashboardSubtitle: effectiveDashboardSubtitle,
    dataset: dataset ?? emptyDashboardDataset,
    metrics: dashboardMetrics,
    rows,
    chartRows,
    xKey,
    selectedMetrics,
    chartType,
    scaleMode,
    periodFilter,
    aggregation,
    aggregationType,
    startDate,
    primaryMetric,
    selectedTarget,
    latestValue,
    targetProgress,
    targetMet,
    setChartType,
    setScaleMode,
    setPeriodFilter,
    setAggregation,
    setAggregationType,
    setStartDate,
    onResetView: handleResetView,
    anomalies: dashboardAnomalies,
    anomalyLoading: dashboardAnomalyLoading,
    anomalyError: dashboardAnomalyError,
    aiAnalysis: dataset?.ai_analysis,
    analysisLoading: metricAnalysisLoading,
    onCreateDecision:
      canCreateDecisions &&
      dashboardAnalysisMetric &&
      dataset?.ai_analysis?.recommendations.length
        ? () => {
          void handleCreateMainDashboardRecommendation()
        }
        : undefined,
    creatingDecision: creatingDashboardRecommendation,
  }

  /* =========================
     Event Handlers
  ========================= */

  function handleMetricToggle(metric: string) {
    if (
      selectedMetrics.includes(metric) &&
      selectedMetrics.length === 1
    ) {
      return
    }

    const nextMetrics = selectedMetrics.includes(metric)
      ? selectedMetrics.filter(
        item => item !== metric
      )
      : [...selectedMetrics, metric]

    setSelectedMetrics(nextMetrics)
    persistSelectedMetrics(
      getSelectedMetricsStorageKey(
        activeWorkspaceId,
        userId,
        selectedDatasetId,
        selectedDashboard
      ),
      nextMetrics
    )
    void saveDashboardViewPreference(
      nextMetrics
    ).catch(() => undefined)
  }

  function handlePrimaryMetricChange(
    metric: string | undefined
  ) {
    if (
      !metric ||
      selectedMetrics[0] === metric
    ) {
      return
    }

    const nextMetrics = [
      metric,
      ...selectedMetrics.filter(
        item => item !== metric
      ),
    ]
    setSelectedMetrics(nextMetrics)
    persistSelectedMetrics(
      getSelectedMetricsStorageKey(
        activeWorkspaceId,
        userId,
        selectedDatasetId,
        selectedDashboard
      ),
      nextMetrics
    )
    void saveDashboardViewPreference(
      nextMetrics
    ).catch(() => undefined)
  }

  function handleResetView() {
    setPeriodFilter("1m")
    setAggregation("monthly")
    setAggregationType("sum")
    setStartDate("")
    setScaleMode("actual")
    setChartType("line")
  }

  async function handleDownloadDashboardPdf() {
    if (
      selectedDashboardNeedsDataset &&
      (!selectedDatasetId || !dataset)
    ) {
      setTemporaryShareStatus(
        "Select a dataset before downloading a PDF."
      )
      return
    }

    try {
      setPdfExporting(true)
      setTemporaryShareStatus(
        "Use Save as PDF in the print dialog.",
        5000
      )
      await waitForNextFrame()
      window.print()
    } finally {
      window.setTimeout(() => {
        setPdfExporting(false)
      }, 1000)
    }
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
    if (
      shareAction ||
      !canConfigureWorkspace
    ) {
      return
    }

    if (!selectedDatasetId || !userId) {
      setTemporaryShareStatus(
        "Select a dataset before sharing."
      )
      return
    }

    let shareUrl = ""

    try {
      setShareAction("share")

      if (
        joinedDatasetResult &&
        joinedDatasetResult.dataset_ids.length > 1
      ) {
        const cachedJoin =
          await getDatasetJoinCache(
            selectedDatasetId,
            selectedDashboard,
            userId,
            activeWorkspaceId
          )

        if (!cachedJoin) {
          const selections = Array.from(
            new Map(
              joinedDatasetResult.datasets.map(detail => [
                detail.dataset_id,
                {
                  dataset_id: detail.dataset_id,
                  date_column: detail.date_column,
                  metric_column: detail.metric_column,
                },
              ])
            ).values()
          )

          await joinDatasets(
            {
              selections,
              start_date:
                joinedDatasetResult.start_date ??
                (startDate || undefined),
              period_filter:
                joinedDatasetResult.period_filter,
              aggregation: "monthly",
              aggregation_type:
                joinedDatasetResult.aggregation_type,
              dashboard_key: selectedDashboard,
            },
            userId,
            activeWorkspaceId
          )
        }
      }

      await saveDashboardViewPreference()

      const shareLink =
        await getDatasetShareLink(
          selectedDatasetId,
          userId,
          activeWorkspaceId,
          selectedDashboard
        )
      shareUrl =
        buildDashboardShareUrl(
          selectedDatasetId,
          dashboardTemplate,
          selectedDashboard,
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
      window.dispatchEvent(
        new Event(
          "decisionate:dashboard-sharing-changed"
        )
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
    if (
      shareAction ||
      !canConfigureWorkspace
    ) {
      return
    }

    if (!selectedDatasetId || !userId) {
      setTemporaryShareStatus(
        "Select a dataset before stopping sharing."
      )
      return
    }

    const confirmed =
      window.confirm(
        `Stopping sharing will make all existing ${dashboardShareTitle.toLowerCase()} links stop working. Continue?`
      )

    if (!confirmed) {
      return
    }

    try {
      setShareAction("stop")

      const shareState =
        await stopDatasetSharing(
          selectedDatasetId,
          userId,
          activeWorkspaceId,
          selectedDashboard
        )

      setTemporaryShareStatus(
        "SharingStopped",
        3500
      )
      setShareEnabled(
        shareState.share_enabled
      )
      window.dispatchEvent(
        new Event(
          "decisionate:dashboard-sharing-changed"
        )
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
    !userId ||
    shareAction !== null ||
    !canConfigureWorkspace
  const stopSharingDisabled =
    shareControlsDisabled ||
    !shareEnabled
  const isCustomSelectedDashboard =
    selectedDashboardDefinition.key !==
    defaultDashboardKey
  const showIndustryManagementToggles =
    isCustomSelectedDashboard &&
    selectedDashboardDefinition.componentKey !==
      "decisionPerformance"
  const dashboardShareTitle =
    isCustomSelectedDashboard
      ? selectedDashboardDefinition.name
      : effectiveDashboardTitle
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
      ? `Copy the current ${dashboardShareTitle.toLowerCase()} link.`
      : `Create and copy a ${dashboardShareTitle.toLowerCase()} link.`
  const shareButtonAriaLabel =
    shareEnabled
      ? `Copy ${dashboardShareTitle.toLowerCase()} share link`
      : `Create ${dashboardShareTitle.toLowerCase()} share link`

  const dashboardIsInitializing =
    !authLoaded ||
    !userId ||
    !dashboardPreferenceLoaded ||
    datasetsLoading ||
    !dashboardDatasetPreferencesLoaded ||
    (
      Boolean(selectedDatasetId) &&
      !dataset &&
      !dashboardError
    )

  if (dashboardIsInitializing) {
    return (
      <div
        className="screen-page space-y-4"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-8 w-64 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-11 w-full animate-pulse rounded-xl bg-gray-100" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
        </div>
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    )
  }

  const canCompareDashboardData =
    selectedDashboardNeedsDataset &&
    Boolean(selectedDatasetId) &&
    datasets.length > 1

  function handleOpenDashboardDecision() {
    if (!selectedDatasetId || !canCreateDecisions) {
      return
    }

    const autoMetricMapping =
      getDashboardAutoMetricMapping(
        selectedDashboardDefinition.componentKey,
        selectedDashboardDataset
      )
    const dashboardMetric =
      currentMetricMapping.primary &&
      availableMetricColumns.includes(
        currentMetricMapping.primary
      )
        ? currentMetricMapping.primary
        : autoMetricMapping.primary
    const params = new URLSearchParams({
      dataset: String(selectedDatasetId),
      returnTo: "/dashboard",
    })

    if (dashboardMetric) {
      params.set("metric", dashboardMetric)
    }

    router.push(
      `/dashboard/decisions/new?${params.toString()}`
    )
  }

  const dashboardManagementActions = (
    <div
      className={
        showIndustryManagementToggles
          ? "flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-2"
          : !isCustomSelectedDashboard
            ? "flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-2"
            : "flex flex-wrap items-center justify-end gap-2"
      }
    >
      {showIndustryManagementToggles &&
        canCreateDecisions &&
        selectedDatasetId && (
        <button
          type="button"
          onClick={handleOpenDashboardDecision}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-3 text-xs font-semibold text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
          title="Create a decision from this dashboard's selected dataset and metric."
        >
          <Plus size={14} />
          Create decision
        </button>
      )}

      {!isCustomSelectedDashboard &&
        canCreateDecisions &&
        selectedDatasetId && (
        <button
          type="button"
          onClick={handleOpenDashboardDecision}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-3 text-xs font-semibold text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
          title="Create a decision from this dashboard's selected dataset and metric."
        >
          <Plus size={14} />
          Create decision
        </button>
      )}

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {canConfigureWorkspace && shareEnabled && (
        <DashboardActionButton
          icon={<Unlink size={14} />}
          label={
            shareAction === "stop"
              ? "Stopping..."
              : "Stop sharing"
          }
          onClick={handleStopSharing}
          disabled={stopSharingDisabled}
          title={`Turn off public access for this ${dashboardShareTitle.toLowerCase()}.`}
          ariaLabel={`Stop sharing ${dashboardShareTitle.toLowerCase()}`}
          tone="danger"
          className="h-9 rounded-lg px-3 text-xs shadow-none"
        />
        )}

      {canConfigureWorkspace && (
        <button
          type="button"
          onClick={() => setDashboardEditMode(current => !current)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
          aria-pressed={dashboardEditMode}
        >
          <Settings2 size={14} />
          {dashboardEditMode ? "Done editing" : "Edit dashboard"}
        </button>
      )}

      {!isCustomSelectedDashboard && (
        <button
          type="button"
          onClick={() => setShowGeneralDecisionatePanel(current => !current)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
          aria-expanded={showGeneralDecisionatePanel}
          aria-controls="general-dashboard-decisionate-panel"
          title="Show the Decisionate analysis and intelligence for this dashboard."
        >
          <LineChartIcon size={14} />
          {showGeneralDecisionatePanel
            ? "Hide Decisionate Analysis & Intelligence"
            : "Decisionate Analysis & Intelligence"}
        </button>
      )}

      {showIndustryManagementToggles && (
        <button
          type="button"
          onClick={() => setShowDatasetPanel(current => !current)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
          aria-expanded={showDatasetPanel}
          aria-controls="industry-dashboard-dataset-panel"
          title="Choose the dataset and analysis period for this dashboard."
        >
          <Database size={14} />
          {showDatasetPanel ? "Hide dataset" : "Dataset"}
        </button>
      )}

      {showIndustryManagementToggles && (
        <button
          type="button"
          onClick={() => setShowAnalysisPanel(current => !current)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
          aria-expanded={showAnalysisPanel}
          aria-controls="industry-dashboard-analysis-panel"
          title="Show the Decisionate analysis and recommendation for this dashboard."
        >
          <LineChartIcon size={14} />
          {showAnalysisPanel ? "Hide analysis" : "Decisionate Analysis"}
        </button>
      )}

      {canManageWorkspaceData && (
        <button
          type="button"
          onClick={() => setShowJoinPanel(current => !current)}
          disabled={!canCompareDashboardData}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 text-xs font-semibold text-[var(--decisionate-brand-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-expanded={showJoinPanel}
          title={
            canCompareDashboardData
              ? "Compare this dashboard's datasets"
              : "Compare data is available on dataset-based dashboards with at least two datasets."
          }
        >
          <GitMerge size={14} />
          {showJoinPanel
            ? "Hide compare data"
            : joinedDatasetResult
              ? "Review joined data"
              : "Compare data"}
        </button>
      )}

      </div>
    </div>
  )

  const generalDashboardManagementPanels = (
    <>
      {dataset &&
        !loading &&
        showGeneralDecisionatePanel && (
        <section
          id="general-dashboard-decisionate-panel"
          className="min-w-0 rounded-2xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3 shadow-sm print:hidden"
        >
          <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-2">
            <div className="min-w-0">
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
                (!dashboardAnalysisMetric ||
                  dataset.ai_analysis.metric === dashboardAnalysisMetric) && (
                <AIAnalysisPanel
                  analysis={dataset.ai_analysis}
                  title="Decisionate Analysis"
                  metric={dashboardAnalysisMetric}
                  className="h-full !rounded-none !border-0 !bg-transparent !p-0"
                  compact
                  creatingDecision={
                    creatingDashboardRecommendation
                  }
                />
              )}

              {!metricAnalysisLoading &&
                !metricAnalysisError &&
                !dataset.ai_analysis && (
                <p className="text-sm text-gray-600">
                  Analysis will appear after the selected metric has been evaluated.
                </p>
              )}
            </div>

            <div className="min-w-0 border-t border-[var(--decisionate-brand-primary-ring)]/70 pt-3 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
              <DashboardIntelligenceCard
                anomalies={dashboardAnomalies}
                primaryMetric={primaryMetric}
                latestValue={latestValue}
                selectedTarget={selectedTarget}
                chartRows={chartRows}
                selectedMetrics={selectedMetrics}
                anomalyLoading={dashboardAnomalyLoading}
                anomalyError={dashboardAnomalyError}
                analysisLoading={metricAnalysisLoading}
                aiAnalysis={dataset?.ai_analysis}
                embedded
              />
            </div>
          </div>
        </section>
      )}

      {dashboardEditMode && (
        <DashboardCard>
          <CardHeader
            title="Metrics & Targets"
            description="Choose which metrics appear in the chart and set optional targets."
            icon={
              <IconBadge
                className="bg-[var(--decisionate-brand-accent-soft)] text-[var(--decisionate-brand-accent-text)]"
                icon={<Gauge size={22} />}
              />
            }
          />

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {metrics.map((metric) => (
              <MetricSelectionRow
                key={metric.column}
                metric={metric}
                color={getMetricColor(
                  getMetricIndex(
                    metrics,
                    metric.column
                  )
                )}
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
        </DashboardCard>
      )}

      {showJoinPanel && (
        <DatasetJoinPanel
          key={`dataset-join-${selectedDatasetId ?? "none"}`}
          datasets={datasets}
          selectedDatasetId={selectedDatasetId}
          dashboardKey={selectedDashboard}
          userId={userId}
          workspaceId={activeWorkspaceId}
          startDate={startDate}
          periodFilter={periodFilter}
          aggregation={aggregation}
          aggregationType={aggregationType}
          canManageWorkspaceData={canManageWorkspaceData}
          onJoinResult={handleJoinedDatasetResult}
          persistedResult={joinedDatasetResult}
        />
      )}
    </>
  )

  if (isCustomSelectedDashboard) {
    const SelectedDashboard =
      dashboardRegistry[
        selectedDashboardDefinition.componentKey
      ]
    const usesDatasetMetricMapping =
      selectedDashboardUsesDatasetMetricMapping
    const usesDatasetSelection =
      selectedDashboardDefinition.dataBasis ===
      "dataset"
    const customDashboardMappingColumns =
      usesDatasetMetricMapping
        ? dashboardMappingColumns
        : []
    const customDashboardNumericMappingColumns =
      usesDatasetMetricMapping
        ? dashboardNumericMappingColumns
        : []
    const customDashboardDimensionMappingColumns =
      usesDatasetMetricMapping
        ? dashboardDimensionMappingColumns
        : []
    const defaultDashboardMappingChartTitles =
      getDashboardMappingChartTitles(
        selectedDashboardDefinition.componentKey
      )
    const dashboardMappingChartTitles = {
      trend:
        currentDashboardChartTitles.trend ??
        defaultDashboardMappingChartTitles.trend,
      mix:
        currentDashboardChartTitles.mix ??
        defaultDashboardMappingChartTitles.mix,
      operations:
        currentDashboardChartTitles.operations ??
        defaultDashboardMappingChartTitles.operations,
    }
    const dashboardChartTitleFields =
      getDashboardChartTitleFields(
        selectedDashboardDefinition.componentKey
      )
    const dashboardAutoMetricMapping =
      getDashboardAutoMetricMapping(
        selectedDashboardDefinition.componentKey,
        selectedDashboardDataset
      )
    const customDashboardMetricValue =
      currentMetricMapping.primary &&
      availableMetricColumns.includes(
        currentMetricMapping.primary
      )
        ? currentMetricMapping.primary
        : undefined
    const dashboardRecommendationMetric =
      customDashboardMetricValue ||
      dashboardAutoMetricMapping.primary

    async function handleCreateDashboardRecommendation() {
      const analysis = dataset?.ai_analysis

      if (
        !userId ||
        !selectedDatasetId ||
        !dashboardRecommendationMetric ||
        !analysis ||
        !analysis.recommendations.length ||
        !canCreateDecisions ||
        creatingDashboardRecommendation
      ) {
        return
      }

      const decisionPayload =
        buildAIRecommendationDecisionPayload(
          selectedDatasetId,
          dashboardRecommendationMetric,
          analysis,
          dataset.file_name
        )

      if (!decisionPayload) {
        return
      }

      try {
        setCreatingDashboardRecommendation(true)
        setDashboardError("")

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
        setDashboardError(
          getErrorMessage(
            error,
            "Unable to create a decision from the dashboard analysis."
          )
        )
      } finally {
        setCreatingDashboardRecommendation(false)
      }
    }
    const dashboardControls = usesDatasetSelection ? (
      <div className="grid w-full min-w-0 grid-cols-1 gap-3">
        <div className="min-w-0 space-y-1">
            {joinedDatasetResult && (
              <div
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-xs text-[var(--decisionate-brand-primary-text)]"
                role="status"
                aria-label="Joined dataset is active"
              >
                <GitMerge size={14} className="shrink-0" />
                <span className="font-semibold">Joined dataset</span>
                <span className="truncate text-[var(--decisionate-brand-primary-text)]/80">
                  {joinedDatasetResult.dataset_ids.length} datasets · {joinedDatasetResult.matched_period_count} shared periods
                </span>
              </div>
            )}
            {!joinedDatasetResult && (
              <>
                <DatasetSelector
                  ariaLabel="Select dashboard dataset"
                  datasets={datasets}
                  emptyMessage={
                    canConfigureWorkspace
                      ? undefined
                      : "Ask the workspace team to share a dataset to populate this dashboard."
                  }
                  loading={
                    !authLoaded ||
                    !userId ||
                    datasetsLoading
                  }
                  loadError={
                    Boolean(dashboardError) &&
                    datasets.length === 0
                  }
                  value={selectedDatasetId}
                  onChange={(id) => {
                    void handleDatasetSelectionChange(id)
                  }}
                />

                {selectedDatasetId && (
                  <Link
                    href={`/dashboard/datasets/${selectedDatasetId}`}
                    className="block truncate text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
                  >
                    Open dataset details
                  </Link>
                )}
              </>
            )}
          </div>
        <div className="col-span-full grid min-w-0 gap-2 rounded-lg border border-gray-200 bg-gray-50 px-0 py-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
          <label className="min-w-0 space-y-1 text-xs font-medium text-gray-500">
            <span className="block">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={event =>
                setStartDate(event.target.value)
              }
              className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
              className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
              className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
              className="h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
            onClick={handleResetView}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
          >
            Reset range
          </button>

          <p className="col-span-full truncate text-xs text-gray-500">
            Showing {formatPeriodLabel(periodFilter)} from {startDate
              ? formatMonthYear(startDate)
              : "first available period"}
          </p>
        </div>
      </div>
    ) : dashboardManagementActions

    const dashboardManagementPanels = (
      <>
        {showDatasetPanel && usesDatasetSelection && (
          <section
            id="industry-dashboard-dataset-panel"
            className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-sm print:hidden"
          >
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Dataset selection
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Choose the dataset, period, grouping, and aggregation used by this dashboard.
              </p>
            </div>
            {dashboardControls}
          </section>
        )}

        {dashboardEditMode && (
          <DashboardChartTitlePanel
            fields={dashboardChartTitleFields}
            titles={currentDashboardChartTitles}
            onChange={(key, value) => {
              setDashboardChartTitlesByKey(current => ({
                ...current,
                [dashboardChartTitleKey]:
                  getNextDashboardChartTitle(
                    current[dashboardChartTitleKey] ?? {},
                    key,
                    value
                  ),
              }))
              setTemporaryShareStatus(
                value
                  ? "Chart name updated."
                  : "Chart name reset to default."
              )
            }}
          />
        )}

        {dashboardEditMode &&
          usesDatasetMetricMapping &&
          dataset &&
          customDashboardMappingColumns.length > 0 && (
          <DashboardMetricMappingPanel
            chartTitles={dashboardMappingChartTitles}
            includeSecondary={
              selectedDashboardDefinition.componentKey ===
              "salesPerformance"
            }
            columns={customDashboardMappingColumns}
            numericColumns={customDashboardNumericMappingColumns}
            dimensionColumns={customDashboardDimensionMappingColumns}
            mapping={currentMetricMapping}
            autoMapping={dashboardAutoMetricMapping}
            onChange={(role, value) => {
              setDashboardMetricMappings(current => ({
                ...current,
                [dashboardMappingKey]:
                  getNextDashboardMetricMapping(
                    current[dashboardMappingKey] ?? {},
                    role,
                    value
                  ),
              }))
              setTemporaryShareStatus(
                value
                  ? "Metric mapping updated."
                  : "Metric mapping reset to auto."
              )
            }}
          />
        )}

        {showJoinPanel && selectedDashboardNeedsDataset && (
          <DatasetJoinPanel
            key={`dataset-join-${selectedDatasetId ?? "none"}`}
            datasets={datasets}
            selectedDatasetId={selectedDatasetId}
            dashboardKey={selectedDashboard}
            userId={userId}
            workspaceId={activeWorkspaceId}
            startDate={startDate}
            periodFilter={periodFilter}
            aggregation={aggregation}
            aggregationType={aggregationType}
            canManageWorkspaceData={canManageWorkspaceData}
            onJoinResult={handleJoinedDatasetResult}
            persistedResult={joinedDatasetResult}
          />
        )}
      </>
    )

    return (
      <div className="screen-page space-y-3">
        {pdfExporting && (
          <div
            aria-hidden="true"
            className="dashboard-print-page"
          >
            <SelectedDashboard
              key={`print-${selectedDashboard}-${selectedDatasetId ?? "none"}`}
              name={selectedDashboardDefinition.name}
              description={selectedDashboardDefinition.description}
              highlights={selectedDashboardDefinition.highlights}
              dataset={selectedDashboardDataset}
              datasetName={dataset?.file_name}
              datasetId={selectedDatasetId}
              aggregation={aggregation}
              aggregationType={aggregationType}
              canManageWorkspaceData={canManageWorkspaceData}
              analysisMetric={dashboardAnalysisMetric}
              analysisLoading={metricAnalysisLoading}
              analysisError={metricAnalysisError}
              onRetryAnalysis={() =>
                setMetricAnalysisRetryKey(
                  currentKey => currentKey + 1
                )
              }
              manualMapping={
                usesDatasetMetricMapping
                  ? currentMetricMapping
                  : undefined
              }
              chartTitles={currentDashboardChartTitles}
              brand={activeBrand}
              showActions={false}
              exportMode
            />
          </div>
        )}

        <WorkspaceAccessNotice
          loading={loadingWorkspaceAccess}
          canManageWorkspaceData={canConfigureWorkspace}
          message="Analysis and metric selection are available in this shared workspace. The business owner handles data changes and dashboard sharing."
          className="rounded-lg print:hidden"
        />

        <SelectedDashboard
          key={`screen-${selectedDashboard}-${selectedDatasetId ?? "none"}`}
          name={selectedDashboardDefinition.name}
          description={selectedDashboardDefinition.description}
          highlights={selectedDashboardDefinition.highlights}
          dataset={selectedDashboardDataset}
          datasetName={dataset?.file_name}
          datasetId={selectedDatasetId}
          aggregation={aggregation}
          aggregationType={aggregationType}
          canManageWorkspaceData={canManageWorkspaceData}
          canCreateDecisions={canCreateDecisions}
          analysisMetric={dashboardAnalysisMetric}
          analysisLoading={metricAnalysisLoading}
          analysisError={metricAnalysisError}
          onRetryAnalysis={() =>
            setMetricAnalysisRetryKey(
              currentKey => currentKey + 1
            )
          }
          manualMapping={
            usesDatasetMetricMapping
              ? currentMetricMapping
              : undefined
          }
          chartTitles={currentDashboardChartTitles}
          brand={activeBrand}
          controls={
            selectedDashboardDefinition.componentKey ===
            "decisionPerformance"
              ? dashboardControls
              : undefined
          }
          managementActions={dashboardManagementActions}
          managementPanels={dashboardManagementPanels}
          showAnalysisPanel={showAnalysisPanel}
          onCreateDecision={
            canCreateDecisions && selectedDatasetId
              ? handleOpenDashboardDecision
              : undefined
          }
          onCreateRecommendation={
            usesDatasetMetricMapping &&
            canCreateDecisions &&
            Boolean(
              dashboardRecommendationMetric &&
              dataset?.ai_analysis?.recommendations.length
            )
              ? () => {
                void handleCreateDashboardRecommendation()
              }
              : undefined
          }
          creatingRecommendation={
            creatingDashboardRecommendation
          }
          status={
            canConfigureWorkspace && shareStatus ? (
              <div
                className={getShareStatusClassName(shareStatus)}
                role="status"
                aria-live="polite"
              >
                {getShareStatusMessage(
                  shareStatus,
                  dashboardShareTitle
                )}
              </div>
            ) : null
          }
          onDownloadPdf={handleDownloadDashboardPdf}
          onShare={handleShareDashboard}
          onStopSharing={
            canConfigureWorkspace
              ? handleStopSharing
              : undefined
          }
          pdfDisabled={
            (selectedDashboardNeedsDataset && (
              !selectedDatasetId ||
              !dataset ||
              loading
            )) ||
            pdfExporting
          }
          shareDisabled={shareControlsDisabled}
          stopSharingDisabled={stopSharingDisabled}
          pdfLabel={
            pdfExporting
              ? "Opening..."
              : "Save PDF"
          }
          shareLabel={shareButtonLabel}
          stopSharingLabel={
            shareAction === "stop"
              ? "Stopping..."
              : "Stop sharing"
          }
          shareTitle={shareButtonTitle}
          shareAriaLabel={shareButtonAriaLabel}
          stopSharingTitle={`Turn off public access for this ${dashboardShareTitle.toLowerCase()}.`}
          stopSharingAriaLabel={`Stop sharing ${dashboardShareTitle.toLowerCase()}`}
          shareEnabled={shareEnabled}
        />

        {!datasetsLoading &&
          userId &&
          !dashboardError &&
          datasets.length === 0 && (
            <div className="print:hidden rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {canConfigureWorkspace ? (
                <>
                  No datasets available.{" "}
                  <Link
                    href="/dashboard/datasets"
                    className="font-medium underline"
                  >
                    Add a dataset
                  </Link>
                  {" "}to connect real data to dashboards.
                </>
              ) : (
                "No shared datasets are available for this workspace yet."
              )}
            </div>
          )}
      </div>
    )
  }

  return (
    <div className="screen-page space-y-4">
      {dataset && !loading && pdfExporting && (
        <div
          aria-hidden="true"
          className="dashboard-print-page"
        >
          <DashboardPrintPage
            brand={activeBrand}
            dashboardTemplate={dashboardTemplate}
            props={templateProps}
          />
        </div>
      )}

      {/* =========================
          Page Header
      ========================= */}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 lg:shrink-0">
          <label
            htmlFor="dashboard-title"
            className="sr-only"
          >
            Dashboard title
          </label>

          <input
            id="dashboard-title"
            value={dashboardTitle}
            maxLength={maxDashboardTitleLength}
            disabled={
              !dashboardEditMode ||
              !selectedDatasetId ||
              !dataset ||
              loading
            }
            onChange={(event) =>
              setDashboardTitle(
                event.target.value
              )
            }
            placeholder={defaultDashboardTitle}
            className="block w-full min-w-0 rounded-lg bg-transparent px-0 py-0 text-3xl font-bold text-gray-950 outline-none transition placeholder:text-gray-400 focus:bg-white focus:px-3 focus:py-2 focus:shadow-sm disabled:cursor-not-allowed disabled:text-gray-400"
          />

          <label
            htmlFor="dashboard-subtitle"
            className="sr-only"
          >
            Dashboard subtitle
          </label>

          <input
            id="dashboard-subtitle"
            value={dashboardSubtitle}
            maxLength={maxDashboardSubtitleLength}
            disabled={
              !dashboardEditMode ||
              !selectedDatasetId ||
              !dataset ||
              loading
            }
            onChange={(event) =>
              setDashboardSubtitle(
                event.target.value
              )
            }
            placeholder={
              defaultDashboardSubtitle
            }
            className="mt-1 block w-full min-w-0 rounded-lg bg-transparent px-0 py-0 text-sm text-gray-500 outline-none transition placeholder:text-gray-400 focus:bg-white focus:px-3 focus:py-2 focus:shadow-sm disabled:cursor-not-allowed disabled:text-gray-400"
          />

          <p className="mt-1 text-xs text-gray-400">
            {selectedDatasetId
              ? "Title and subtitle auto-save for this dataset."
              : "Select a dataset to customize this dashboard title."}
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-start gap-3 lg:flex-1 lg:justify-end">
          <div
            data-dashboard-export-control
            className="flex w-full items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 sm:w-auto"
            role="group"
            aria-label="Share and export dashboard"
          >
            <DashboardActionButton
              icon={<FileDown size={15} />}
              label={
                pdfExporting
                  ? "Opening..."
                  : "Save PDF"
              }
              onClick={handleDownloadDashboardPdf}
              disabled={
                !selectedDatasetId ||
                !dataset ||
                loading ||
                pdfExporting
              }
              className="h-9 flex-1 rounded-lg px-2.5 text-xs shadow-none sm:flex-none"
            />

            {canConfigureWorkspace && (
              <>
              <DashboardActionButton
                icon={<Share2 size={15} />}
                label={shareButtonLabel}
                onClick={handleShareDashboard}
                disabled={shareControlsDisabled}
                title={shareButtonTitle}
                ariaLabel={shareButtonAriaLabel}
                className="h-9 flex-1 rounded-lg px-2.5 text-xs shadow-none sm:flex-none"
              />

              </>
            )}
          </div>

          <div
            className="grid h-11 w-full shrink-0 grid-cols-3 rounded-xl border border-gray-200 bg-white p-1 sm:w-auto sm:flex sm:items-center"
            role="group"
            aria-label="Dashboard template"
          >
            {([
              ["executive", "Executive"],
              ["performance", "Performance"],
              ["comparison", "Comparison"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={dashboardTemplate === value}
                onClick={() =>
                  setDashboardTemplate(value)
                }
                className={`h-full rounded-lg px-2 text-sm font-medium transition sm:px-3 ${
                  dashboardTemplate === value
                    ? "bg-[var(--decisionate-brand-primary)] text-[var(--decisionate-brand-primary-surface-text)]"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid w-full min-w-0 max-w-full gap-2 sm:w-96 sm:flex-none sm:grid-cols-2 lg:w-[26rem] xl:w-[28rem]">
            {joinedDatasetResult && (
              <div
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-xs text-[var(--decisionate-brand-primary-text)]"
                role="status"
                aria-label="Joined dataset is active"
              >
                <GitMerge size={14} className="shrink-0" />
                <span className="font-semibold">Joined dataset</span>
                <span className="truncate text-[var(--decisionate-brand-primary-text)]/80">
                  {joinedDatasetResult.dataset_ids.length} datasets · {joinedDatasetResult.matched_period_count} shared periods
                </span>
              </div>
            )}
            {!joinedDatasetResult && (
              <div className="min-w-0">
                <DatasetSelector
                  ariaLabel="Select dashboard dataset"
                  datasets={datasets}
                  emptyMessage={
                    canConfigureWorkspace
                      ? undefined
                      : "Ask the workspace team to share a dataset to populate this dashboard."
                  }
                  loading={
                    !authLoaded ||
                    !userId ||
                    datasetsLoading
                  }
                  loadError={
                    Boolean(dashboardError) &&
                    datasets.length === 0
                  }
                  value={selectedDatasetId}
                  onChange={(id) => {
                    void handleDatasetSelectionChange(id)
                  }}
                />

                {selectedDatasetId && (
                  <Link
                    href={`/dashboard/datasets/${selectedDatasetId}`}
                    className="mt-1 block truncate text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
                  >
                    Open dataset details
                  </Link>
                )}
              </div>
            )}

            {dataset && availableMetricColumns.length > 0 && (
              <div className="min-w-0 space-y-1">
                <MetricSelector
                  ariaLabel="Select target metric"
                  metrics={availableMetricColumns}
                  value={primaryMetric}
                  onChange={handlePrimaryMetricChange}
                  disabled={loading}
                />
                <p className="truncate text-xs text-gray-500">
                  Target metric
                </p>
              </div>
            )}
          </div>

        </div>
      </div>

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canConfigureWorkspace}
        message="Analysis and metric selection are available in this shared workspace. The business owner handles data changes and dashboard sharing."
        className="rounded-lg print:hidden"
      />

      {historicalDataWarning && (
        <div
          className="print:hidden rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          role="status"
          aria-live="polite"
        >
          {historicalDataWarning}
        </div>
      )}

      {canConfigureWorkspace && shareStatus && (
        <div
          className={getShareStatusClassName(shareStatus)}
          role="status"
          aria-live="polite"
        >
          {getShareStatusMessage(
            shareStatus,
            dashboardShareTitle
          )}
        </div>
      )}

      {dashboardPreferenceError && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <span>
            {dashboardPreferenceError} The default dashboard is shown for now.
          </span>

          <button
            type="button"
            onClick={() => {
              setDashboardPreferenceRetryKey(
                currentKey => currentKey + 1
              )
            }}
            className="w-fit rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
          >
            Retry preference
          </button>
        </div>
      )}

      {datasetPreferenceError && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <span>{datasetPreferenceError}</span>

          <button
            type="button"
            onClick={() => {
              setDefaultDatasetRetryKey(
                currentKey => currentKey + 1
              )
            }}
            className="w-fit rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
          >
            Retry dataset preference
          </button>
        </div>
      )}

      {dashboardError && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>{dashboardError}</span>

          {dashboardErrorRetryMode && (
            <button
              type="button"
              onClick={() => {
                if (
                  dashboardErrorRetryMode ===
                  "dataset"
                ) {
                  setDatasetLoadRetryKey(
                    currentKey => currentKey + 1
                  )
                  return
                }

                setDefaultDatasetRetryKey(
                  currentKey => currentKey + 1
                )
              }}
              className="w-fit rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50"
            >
              Retry dashboard load
        </button>
      )}

      {showIndustryManagementToggles &&
        canCreateDecisions &&
        selectedDatasetId && (
        <button
          type="button"
          onClick={handleOpenDashboardDecision}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-3 text-xs font-semibold text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
          title="Create a decision from this dashboard's selected dataset and metric."
        >
          <Plus size={14} />
          Create decision
        </button>
      )}
    </div>
      )}

      {/* =========================
          Empty State
      ========================= */}

      {authLoaded &&
        Boolean(userId) &&
        !datasetsLoading &&
        !dashboardError &&
        datasets.length === 0 && (
        <DashboardCard>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database
              size={36}
              className="text-gray-400"
            />

            <h2 className="mt-4 text-lg font-semibold">
              No datasets available
            </h2>

            <p className="mt-2 max-w-md text-sm text-gray-500">
              {canConfigureWorkspace
                ? "Upload or connect a dataset to populate the General Business dashboard."
                : "Ask the workspace team to share a dataset to populate this dashboard."}
            </p>

            {canConfigureWorkspace && (
              <Link
                href="/dashboard/datasets"
                className="mt-4 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
              >
                Go to Datasets
              </Link>
            )}
          </div>
        </DashboardCard>
      )}

      {!selectedDatasetId &&
        datasets.length > 0 && (
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
          <div className="dashboard-management-toolbar print:hidden">
            {dashboardManagementActions}
          </div>

          {generalDashboardManagementPanels}

          <div
            className="dashboard-report space-y-4"
          >
            {dashboardTemplate === "executive" && (
              <ExecutiveTemplate
                {...templateProps}
              />
            )}

            {dashboardTemplate === "performance" && (
              <PerformanceTemplate
                {...templateProps}
              />
            )}

            {dashboardTemplate === "comparison" && (
              <ComparisonTemplate
                {...templateProps}
              />
            )}

          </div>

        </>
      )}
    </div>
  )
}

/* =========================
   Print/PDF One Page Replica
========================= */

function DashboardPrintPage({
  brand,
  dashboardTemplate,
  props,
}: {
  brand: WorkspaceBrand
  dashboardTemplate: DashboardTemplate
  props: ReportSectionProps
}) {
  const hasChartData =
    props.chartRows.length > 0 &&
    props.selectedMetrics.length > 0
  const chartDescription =
    getDashboardChartDescription({
      chartType: props.chartType,
      rows: props.chartRows,
      xKey: props.xKey,
      metrics: props.selectedMetrics,
      target: props.selectedTarget,
      showTarget:
        props.scaleMode === "actual",
    })
  const topMetrics =
    props.metrics.slice(0, maxDashboardKpiCards)
  const isComparisonDashboard =
    dashboardTemplate === "comparison"

  return (
    <div className="dashboard-print-one-page">
      <div
        className="dashboard-print-header rounded-2xl bg-white p-4 shadow-sm"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <WorkspaceBrandMark
              name={brand.name}
              logoUrl={brand.logoUrl}
              primaryColor={brand.primaryColor}
              className="h-12 w-12 rounded-2xl text-base"
            />

            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Shared by
              </p>

              <p
                className="truncate text-lg font-semibold"
                style={{
                  color:
                    "var(--decisionate-brand-primary-text)",
                }}
              >
                {brand.name}
              </p>

              <p
                className="text-xs"
                style={{
                  color:
                    "var(--decisionate-brand-accent-text)",
                }}
              >
                Reporting workspace
              </p>
            </div>
          </div>

          <div className="min-w-0 text-right">
            <h2 className="truncate text-xl font-bold text-gray-950">
              {props.dashboardTitle}
            </h2>

            <p className="mt-1 truncate text-xs font-medium text-gray-600">
              {props.dashboardSubtitle}
            </p>

            <p className="mt-1 truncate text-[10px] text-gray-400">
              {getDashboardDatasetDescription(props.dataset)}
            </p>
          </div>
        </div>
      </div>

      {!isComparisonDashboard && (
        <div className="dashboard-print-inline-kpis">
          {topMetrics.map((metric) => (
            <section
              key={metric.column}
              className="dashboard-print-inline-kpi-card rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">
                {formatMetricName(
                  metric.column
                )}
              </p>

              <p className="mt-1 truncate text-base font-bold text-gray-950">
                {formatNumber(
                  metric.total ?? 0
                )}
              </p>
            </section>
          ))}
        </div>
      )}

      <div
        className={`dashboard-print-main-grid ${
          isComparisonDashboard
            ? "dashboard-print-main-grid-comparison"
            : ""
        }`}
      >
        <section
          className={`dashboard-print-main-chart rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${
            isComparisonDashboard
              ? "dashboard-print-main-chart-full"
              : ""
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-gray-950">
                {props.selectedMetrics.length > 1
                  ? props.selectedMetrics
                      .slice(0, 3)
                      .map(formatMetricName)
                      .join(" vs ")
                  : `${formatMetricName(
                      props.primaryMetric
                    )} Performance`}
              </h3>

              <p className="mt-1 text-xs text-gray-500">
                {formatPeriodLabel(
                  props.periodFilter
                )}{" "}
                view
                {props.scaleMode === "indexed"
                  ? " · indexed scale"
                  : ""}
              </p>
            </div>
          </div>

          {hasChartData ? (
            <div
              className={`dashboard-print-main-chart-area ${
                isComparisonDashboard
                  ? "dashboard-print-main-chart-area-comparison"
                  : ""
              }`}
              role="img"
              aria-label={chartDescription}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
              >
                <MainChart
                  chartType={props.chartType}
                  rows={props.chartRows}
                  xKey={props.xKey}
                  metrics={props.selectedMetrics}
                  allMetrics={props.metrics}
                  chartMargin={{
                    top: 12,
                    right: 10,
                    left: 0,
                    bottom: 32,
                  }}
                  yAxisWidth={52}
                  target={props.selectedTarget}
                  showTarget={
                    props.scaleMode === "actual"
                  }
                  exportMode
                />
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartEmptyState
              className={`dashboard-print-main-chart-area ${
                isComparisonDashboard
                  ? "dashboard-print-main-chart-area-comparison"
                  : ""
              }`}
            />
          )}
        </section>

        {!isComparisonDashboard && (
          <aside className="dashboard-print-kpi-column">
            <section className="dashboard-print-target-card rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Target Snapshot
                </p>

                <p className="mt-1 truncate text-sm font-semibold text-gray-950">
                  {formatMetricName(
                    props.primaryMetric
                  )}
                </p>
              </div>

              <div className="dashboard-print-target-gauge mt-2">
                <TargetGauge
                  value={props.targetProgress}
                  actualValue={props.latestValue}
                  targetValue={props.selectedTarget}
                />
              </div>

              <div className="dashboard-print-target-details space-y-2 text-xs">
                <PrintMetricLine
                  label="Current"
                  value={formatNumber(
                    props.latestValue
                  )}
                />
                <PrintMetricLine
                  label="Target"
                  value={formatNumber(
                    props.selectedTarget
                  )}
                />
              </div>
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}

function PrintMetricLine({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-2 py-1.5">
      <span className="text-gray-500">
        {label}
      </span>

      <span className="truncate font-semibold text-gray-900">
        {value}
      </span>
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
  const chartDescription =
    getDashboardChartDescription({
      chartType: props.chartType,
      rows: props.chartRows,
      xKey: props.xKey,
      metrics: props.selectedMetrics,
      target: props.selectedTarget,
      showTarget: props.scaleMode === "actual",
    })

  return (
    <>
      <div className="dashboard-print-target-grid dashboard-print-target-grid-left grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <DashboardCard className="dashboard-print-target-card flex min-w-0 flex-col xl:h-[660px]">
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

          <div className="mt-auto space-y-4 pt-5">
            <div className="space-y-3">
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
              className={`rounded-xl border p-4 text-sm ${
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
          </div>
        </DashboardCard>

        <DashboardCard className="dashboard-print-chart-card flex min-w-0 flex-col xl:h-[660px]">
          <CardHeader
            title={`${formatMetricName(
              props.primaryMetric
            )} Trend`}
            icon={
              <IconBadge
                className="bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
                icon={<LineChartIcon size={22} />}
              />
            }
          />

          <DashboardControls
            chartType={props.chartType}
            scaleMode={props.scaleMode}
            periodFilter={props.periodFilter}
            aggregation={props.aggregation}
            aggregationType={props.aggregationType}
            startDate={props.startDate}
            selectedMetrics={props.selectedMetrics}
            setChartType={props.setChartType}
            setScaleMode={props.setScaleMode}
            setPeriodFilter={props.setPeriodFilter}
            setAggregation={props.setAggregation}
            setAggregationType={props.setAggregationType}
            setStartDate={props.setStartDate}
            onResetView={props.onResetView}
          />

          {hasChartData ? (
            <FullscreenChartArea
              title={`${formatMetricName(props.primaryMetric)} Trend`}
              ariaLabel={chartDescription}
              className="dashboard-print-chart-area mt-4 h-[320px] flex-none xl:h-auto xl:min-h-[320px] xl:flex-1"
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
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
            </FullscreenChartArea>
          ) : (
            <ChartEmptyState className="dashboard-print-chart-area mt-4 h-[320px] flex-none xl:h-auto xl:min-h-[320px] xl:flex-1" />
          )}
        </DashboardCard>
      </div>

      <KpiCarousel
        metrics={props.metrics}
        anomalies={props.anomalies}
        anomalyLoading={props.anomalyLoading}
        anomalyError={props.anomalyError}
      />

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
  aggregation,
  aggregationType,
  startDate,
  primaryMetric,
  selectedTarget,
  setChartType,
  setScaleMode,
  setPeriodFilter,
  setAggregation,
  setAggregationType,
  setStartDate,
  onResetView,
  anomalies,
  anomalyLoading,
  anomalyError,
}: ReportSectionProps) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0
  const chartDescription =
    getDashboardChartDescription({
      chartType,
      rows: chartRows,
      xKey,
      metrics: selectedMetrics,
      target: selectedTarget,
      showTarget: scaleMode === "actual",
    })

  return (
    <>
      <KpiCarousel
        metrics={metrics}
        anomalies={anomalies}
        anomalyLoading={anomalyLoading}
        anomalyError={anomalyError}
      />

      <DashboardCard className="flex min-w-0 flex-col xl:h-[720px]">
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
              className="bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
              icon={<LineChartIcon size={22} />}
            />
          }
        />

        <DashboardControls
          chartType={chartType}
          scaleMode={scaleMode}
          periodFilter={periodFilter}
          aggregation={aggregation}
          aggregationType={aggregationType}
          startDate={startDate}
          selectedMetrics={selectedMetrics}
          setChartType={setChartType}
          setScaleMode={setScaleMode}
          setPeriodFilter={setPeriodFilter}
          setAggregation={setAggregation}
          setAggregationType={setAggregationType}
          setStartDate={setStartDate}
          onResetView={onResetView}
        />

        {hasChartData ? (
          <FullscreenChartArea
            title={
              selectedMetrics.length > 1
                ? selectedMetrics
                    .map(formatMetricName)
                    .join(" vs ")
                : `${formatMetricName(primaryMetric)} Performance`
            }
            ariaLabel={chartDescription}
            className="mt-4 h-[360px] flex-none xl:h-auto xl:min-h-[360px] xl:flex-1"
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
              />
            </ResponsiveContainer>
          </FullscreenChartArea>
        ) : (
          <ChartEmptyState className="mt-4 h-[360px] flex-none xl:h-auto xl:min-h-[360px] xl:flex-1" />
        )}
      </DashboardCard>
    </>
  )
}

function DashboardIntelligenceCard({
  anomalies,
  primaryMetric,
  latestValue,
  selectedTarget,
  chartRows,
  selectedMetrics,
  anomalyLoading,
  anomalyError,
  analysisLoading,
  aiAnalysis,
  embedded = false,
}: {
  anomalies: DatasetAnomaliesResponse | null
  primaryMetric: string
  latestValue: number
  selectedTarget: number
  chartRows: DashboardRow[]
  selectedMetrics: string[]
  anomalyLoading: boolean
  anomalyError: boolean
  analysisLoading: boolean
  aiAnalysis?: AIAnalysis | null
  embedded?: boolean
}) {
  return (
    <section
      data-dashboard-export-control
      className={
        embedded
          ? "flex h-full flex-col px-0 py-0 text-[var(--decisionate-brand-primary-text)]"
          : "flex h-full flex-col rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-[var(--decisionate-brand-primary-text)] sm:px-3"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold">
            Decisionate intelligence
          </span>
        </div>

        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {getDashboardIntelligenceImportance(
            anomalies,
            primaryMetric,
            latestValue,
            selectedTarget
          )}
        </span>
      </div>

      <div className="mt-2 grid gap-2 border-t border-[var(--decisionate-brand-primary-ring)]/70 pt-2 text-xs sm:grid-cols-3">
          <DashboardIntelligenceItem
            label="What happened"
            value={getDashboardIntelligenceEvent(
              anomalies,
              chartRows,
              selectedMetrics,
              primaryMetric,
              anomalyLoading,
              anomalyError
            )}
          />
          <DashboardIntelligenceItem
            label="Why it matters"
            value={getDashboardIntelligenceMeaning(
              anomalies,
              primaryMetric,
              latestValue,
              selectedTarget
            )}
          />
          <DashboardIntelligenceItem
            label="Recommended action"
            value={
              analysisLoading
                ? "Updating the recommendation for this metric..."
                : aiAnalysis?.recommendations[0] ??
                  getDashboardDefaultRecommendation(
                    primaryMetric,
                    anomalies
                  )
            }
          />
      </div>
    </section>
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
  aggregation,
  aggregationType,
  startDate,
  primaryMetric,
  selectedTarget,
  latestValue,
  targetProgress,
  targetMet,
  setChartType,
  setScaleMode,
  setPeriodFilter,
  setAggregation,
  setAggregationType,
  setStartDate,
  onResetView,
  anomalies,
  anomalyLoading,
  anomalyError,
}: ReportSectionProps) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0
  const chartDescription =
    getDashboardChartDescription({
      chartType,
      rows: chartRows,
      xKey,
      metrics: selectedMetrics,
      target: selectedTarget,
      showTarget: scaleMode === "actual",
    })

  return (
    <>
      {/* KPI Row */}
      <KpiCarousel
        metrics={metrics}
        anomalies={anomalies}
        anomalyLoading={anomalyLoading}
        anomalyError={anomalyError}
      />

      {/* Main Executive Grid */}
      <div className="dashboard-print-target-grid dashboard-print-target-grid-right grid items-stretch gap-5 lg:h-[660px] lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Executive Chart Card */}
        <DashboardCard
          id="dashboard-evidence"
          className="dashboard-print-chart-card flex min-h-[460px] min-w-0 flex-col sm:min-h-[560px] xl:h-full xl:min-h-0"
        >
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
                className="bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
                icon={<LineChartIcon size={22} />}
              />
            }
          />

          <DashboardControls
            chartType={chartType}
            scaleMode={scaleMode}
            periodFilter={periodFilter}
            aggregation={aggregation}
            aggregationType={aggregationType}
            startDate={startDate}
            selectedMetrics={selectedMetrics}
            setChartType={setChartType}
            setScaleMode={setScaleMode}
            setPeriodFilter={setPeriodFilter}
            setAggregation={setAggregation}
            setAggregationType={setAggregationType}
            setStartDate={setStartDate}
            onResetView={onResetView}
          />

          {hasChartData ? (
            <FullscreenChartArea
              title={
                selectedMetrics.length > 1
                  ? selectedMetrics
                      .map(formatMetricName)
                      .join(" vs ")
                  : `${formatMetricName(primaryMetric)} Performance`
              }
              ariaLabel={chartDescription}
              className="dashboard-print-chart-area mt-4 h-[320px] flex-none xl:h-auto xl:min-h-[320px] xl:flex-1"
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
                />
              </ResponsiveContainer>
            </FullscreenChartArea>
          ) : (
            <ChartEmptyState className="dashboard-print-chart-area mt-4 h-[320px] flex-none xl:h-auto xl:min-h-[320px] xl:flex-1" />
          )}
        </DashboardCard>

        {/* Executive Target Card */}
        <DashboardCard className="dashboard-print-target-card flex min-w-0 flex-col xl:h-full">
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
          </div>

          <div className="mt-auto space-y-4 pt-4">
            <div className="space-y-3">
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
  aggregation,
  aggregationType,
  startDate,
  selectedMetrics,
  setChartType,
  setScaleMode,
  setPeriodFilter,
  setAggregation,
  setAggregationType,
  setStartDate,
  onResetView,
}: {
  chartType: ChartType
  scaleMode: ScaleMode
  periodFilter: PeriodFilter
  aggregation: MetricAggregation
  aggregationType: ValueAggregation
  startDate: string
  selectedMetrics: string[]
  setChartType: (value: ChartType) => void
  setScaleMode: (value: ScaleMode) => void
  setPeriodFilter: (value: PeriodFilter) => void
  setAggregation: (value: MetricAggregation) => void
  setAggregationType: (value: ValueAggregation) => void
  setStartDate: (value: string) => void
  onResetView: () => void
}) {
  return (
    <div
      data-dashboard-export-control
      className="mt-3 grid gap-2 sm:flex sm:flex-wrap sm:items-center"
    >
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

      <CompactSelect
        label="Group by"
        value={aggregation}
        onChange={value =>
          setAggregation(value as MetricAggregation)
        }
        options={[
          ["daily", "Daily"],
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
          ["quarterly", "Quarterly"],
        ]}
      />

      <CompactSelect
        label="Aggregate"
        value={aggregationType}
        onChange={value =>
          setAggregationType(value as ValueAggregation)
        }
        options={[
          ["sum", "Sum"],
          ["count", "Count"],
          ["avg", "Average"],
          ["min", "Minimum"],
          ["max", "Maximum"],
        ]}
      />

      <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs sm:h-9 sm:w-auto sm:px-2">
        <span className="whitespace-nowrap font-medium text-gray-500">
          Start
        </span>

        <input
          type="date"
          value={startDate}
          onChange={(event) =>
            setStartDate(event.target.value)
          }
          className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none sm:flex-none"
        />
      </label>

      <div className="flex min-h-10 w-full flex-wrap items-center rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-xs text-[var(--decisionate-brand-primary-text)] sm:min-h-9 sm:w-auto sm:py-0">
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
        className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 sm:h-9 sm:w-auto"
      >
        Reset view
      </button>

      <div className="flex h-10 w-full items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs text-gray-600 sm:h-9 sm:w-auto">
        Metrics:&nbsp;
        <span className="font-semibold text-gray-800">
          {selectedMetrics.length}
        </span>
      </div>

      {selectedMetrics.length > 5 && (
        <div className="flex min-h-10 w-full items-center rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 sm:min-h-9 sm:w-auto sm:py-0">
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
  chartMargin,
  yAxisWidth = 70,
  target,
  showTarget,
  exportMode = false,
}: {
  chartType: ChartType
  rows: DashboardRow[]
  xKey: string
  metrics: string[]
  allMetrics: DashboardMetric[]
  chartMargin?: {
    top: number
    right: number
    left: number
    bottom: number
  }
  yAxisWidth?: number
  target: number
  showTarget: boolean
  exportMode?: boolean
}) {
  const margin = chartMargin ?? {
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
        width={yAxisWidth}
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

        {metrics.map(metric => (
          <Bar
            key={metric}
            dataKey={metric}
            name={formatMetricName(metric)}
            fill={getMetricColor(
              getMetricIndex(allMetrics, metric)
            )}
            radius={[8, 8, 0, 0]}
            isAnimationActive={!exportMode}
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
            isAnimationActive={!exportMode}
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
          dot={false}
          activeDot={{ r: 7 }}
          isAnimationActive={!exportMode}
        />
      ))}
    </LineChart>
  )
}

function getDashboardChartDescription({
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
    return "No dashboard chart data is available."
  }

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const firstPeriod =
    formatChartCellValue(firstRow[xKey])
  const lastPeriod =
    formatChartCellValue(lastRow[xKey])
  const metricLabels =
    metrics.map(formatMetricName)
  const latestValues =
    metrics.slice(0, 3).map(metric =>
      `${formatMetricName(metric)} ${formatChartCellValue(lastRow[metric])}`
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

function formatChartCellValue(
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

/* =========================
   Shared: Metric Selection Rows
========================= */

function MetricSelectionRow({
  metric,
  color,
  selected,
  target,
  onToggle,
  onTargetChange,
}: {
  metric: DashboardMetric
  color: string
  selected: boolean
  target: number
  onToggle: () => void
  onTargetChange: (value: number) => void
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-3 transition sm:flex-row sm:items-center sm:justify-between ${
        selected
          ? ""
          : "border-gray-100 bg-gray-50"
      }`}
      style={
        selected
          ? {
            borderColor: getColorWithAlpha(
              color,
              "66"
            ),
            backgroundColor: getColorWithAlpha(
              color,
              "12"
            ),
          }
          : undefined
      }
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? "Hide" : "Show"} ${formatMetricName(
          metric.column
        )} in dashboard chart`}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
            selected
              ? "bg-white"
              : "border-gray-200 bg-white text-gray-400"
          }`}
          style={
            selected
              ? {
                borderColor: getColorWithAlpha(
                  color,
                  "66"
                ),
                color,
              }
              : undefined
          }
          aria-hidden="true"
        >
          {selected ? "✓" : ""}
        </span>

        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: color,
              }}
              aria-hidden="true"
            />

            <span className="truncate text-sm font-semibold text-gray-900">
              {formatMetricName(metric.column)}
            </span>
          </span>

          <span className="block text-xs text-gray-500">
            {selected
              ? "Included in chart"
              : "Hidden from chart"}
          </span>
        </span>
      </button>

      <label
        className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-500 sm:w-52"
        style={
          selected
            ? {
              borderColor: getColorWithAlpha(
                color,
                "44"
              ),
            }
            : undefined
        }
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <span className="shrink-0 font-medium">
          Target
        </span>

        <input
          type="number"
          aria-label={`Target for ${formatMetricName(metric.column)}`}
          min={0}
          value={
            target > 0
              ? target
              : ""
          }
          placeholder="Optional"
          onChange={(event) => {
            const nextValue =
              event.target.value

            onTargetChange(
              nextValue === ""
                ? 0
                : Number(nextValue)
            )
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none"
        />
      </label>
    </div>
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
    <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs sm:h-9 sm:w-auto sm:px-2">
      <span className="shrink-0 font-medium text-gray-500">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="h-7 min-w-0 flex-1 bg-transparent text-xs font-medium text-gray-800 outline-none sm:flex-none"
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
  id,
}: {
  children: React.ReactNode
  className?: string
  id?: string
}) {
  return (
    <div
      id={id}
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

function FullscreenChartArea({
  title,
  ariaLabel,
  className,
  children,
}: {
  title: string
  ariaLabel: string
  className: string
  children: React.ReactNode
}) {
  const [isFullscreen, setIsFullscreen] =
    useState(false)

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

  return (
    <>
      <div
        className={`relative ${className}`}
        role="img"
        aria-label={ariaLabel}
      >
        {!isFullscreen && (
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            title={`View ${title} full screen`}
            aria-label={`View ${title} full screen`}
            className="dashboard-print-hidden absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-500 shadow-sm transition hover:bg-white hover:text-gray-900"
          >
            <Maximize2 size={15} />
          </button>
        )}

        {!isFullscreen && children}
      </div>

      {isFullscreen && (
        <div
          className="dashboard-print-hidden fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} full screen chart`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setIsFullscreen(false)
            }
          }}
        >
          <div className="flex h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
              <h2 className="truncate text-base font-semibold text-gray-950 sm:text-lg">
                {title}
              </h2>

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
                {children}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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

function KpiCarousel({
  metrics,
  anomalies,
  anomalyLoading,
  anomalyError,
}: {
  metrics: DashboardMetric[]
  anomalies?: DatasetAnomaliesResponse | null
  anomalyLoading?: boolean
  anomalyError?: boolean
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
        <div
          data-dashboard-export-control
          className="flex justify-end gap-2"
        >
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
              signal={getDashboardKpiSignal(
                metric.column,
                anomalies,
                anomalyLoading,
                anomalyError
              )}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function KpiCard({
  label,
  value,
  signal,
}: {
  label: string
  value: string | number
  signal?: DashboardKpiSignal
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="truncate text-sm text-gray-500">
        {label}
      </p>

      <p className="mt-1 truncate text-2xl font-bold">
        {typeof value === "number"
          ? value.toLocaleString()
          : value}
      </p>

      {signal && (
        <p className={`mt-2 truncate text-[11px] font-medium ${signal.className}`}>
          <span
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle"
            aria-hidden="true"
          />
          {signal.text}
        </p>
      )}
    </div>
  )
}

type DashboardKpiSignal = {
  text: string
  className: string
}

function getDashboardKpiSignal(
  metric: string,
  anomalies?: DatasetAnomaliesResponse | null,
  anomalyLoading = false,
  anomalyError = false
): DashboardKpiSignal {
  if (anomalyLoading) {
    return {
      text: "Checking pattern",
      className: "text-gray-400",
    }
  }

  if (anomalyError) {
    return {
      text: "Monitoring unavailable",
      className: "text-gray-400",
    }
  }

  const metricResult = anomalies?.metrics.find(
    item => item.metric === metric
  )

  if (!metricResult) {
    return {
      text: "No baseline yet",
      className: "text-gray-400",
    }
  }

  if (metricResult.status !== "ready") {
    return {
      text: "Not enough history",
      className: "text-gray-400",
    }
  }

  const latestAnomaly =
    metricResult.anomalies[metricResult.anomalies.length - 1]

  if (latestAnomaly) {
    return {
      text:
        latestAnomaly.direction === "high"
          ? "Unusual increase"
          : "Unusual decrease",
      className:
        latestAnomaly.direction === "high"
          ? "text-red-600"
          : "text-blue-600",
    }
  }

  return {
    text: "Within expected range",
    className: "text-green-600",
  }
}

function DashboardIntelligenceItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]/70">
        {label}
      </p>
      <p className="mt-1 leading-5 text-gray-700">
        {value}
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

const dashboardChartTitleKeys: DashboardChartTitleKey[] = [
  "trend",
  "mix",
  "operations",
  "outcome",
]

function getSavedDashboardChartTitles(
  titles: unknown
): Record<string, DashboardChartTitles> {
  if (
    !titles ||
    typeof titles !== "object" ||
    Array.isArray(titles)
  ) {
    return {}
  }

  return Object.entries(
    titles as Record<string, unknown>
  ).reduce<Record<string, DashboardChartTitles>>(
    (result, [dashboardKey, chartTitles]) => {
      if (
        !isDashboardKey(dashboardKey) ||
        dashboardKey === defaultDashboardKey
      ) {
        return result
      }

      const cleanTitles =
        cleanDashboardChartTitles(chartTitles)

      if (Object.keys(cleanTitles).length > 0) {
        result[dashboardKey] = cleanTitles
      }

      return result
    },
    {}
  )
}

function cleanDashboardChartTitles(
  titles: unknown
): DashboardChartTitles {
  if (
    !titles ||
    typeof titles !== "object" ||
    Array.isArray(titles)
  ) {
    return {}
  }

  return dashboardChartTitleKeys.reduce<DashboardChartTitles>(
    (result, key) => {
      const value = (titles as Record<string, unknown>)[key]

      if (typeof value === "string") {
        const cleanValue = value
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80)

        if (cleanValue) {
          result[key] = cleanValue
        }
      }

      return result
    },
    {}
  )
}

function getNextDashboardChartTitle(
  titles: DashboardChartTitles,
  key: DashboardChartTitleKey,
  value: string
): DashboardChartTitles {
  const nextTitles = {
    ...cleanDashboardChartTitles(titles),
  }
  const cleanValue = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)

  if (cleanValue) {
    nextTitles[key] = cleanValue
  } else {
    delete nextTitles[key]
  }

  return nextTitles
}

function getNextDashboardChartTitles(
  titles: unknown,
  dashboardKey: string,
  currentTitles: DashboardChartTitles,
  shouldSave: boolean
): Record<string, DashboardChartTitles> {
  const nextTitles = getSavedDashboardChartTitles(titles)

  if (!shouldSave || dashboardKey === defaultDashboardKey) {
    return nextTitles
  }

  const cleanTitles =
    cleanDashboardChartTitles(currentTitles)

  if (Object.keys(cleanTitles).length > 0) {
    nextTitles[dashboardKey] = cleanTitles
  } else {
    delete nextTitles[dashboardKey]
  }

  return nextTitles
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

  return cleanDashboardMetricMapping(
    mapping as DashboardMetricMapping
  ) ?? {}
}

function getSavedDashboardMetricMappings(
  mappings: unknown
): Record<string, DashboardMetricMapping> {
  if (
    !mappings ||
    typeof mappings !== "object" ||
    Array.isArray(mappings)
  ) {
    return {}
  }

  return Object.entries(
    mappings as Record<string, unknown>
  ).reduce<Record<string, DashboardMetricMapping>>(
    (result, [dashboardKey, mapping]) => {
      if (typeof dashboardKey !== "string") {
        return result
      }

      const cleanMapping =
        getSavedDashboardMetricMapping(mapping)

      if (Object.keys(cleanMapping).length > 0) {
        result[dashboardKey] = cleanMapping
      }

      return result
    },
    {}
  )
}

function cleanDashboardMetricMapping(
  mapping: DashboardMetricMapping
): DashboardMetricMapping | undefined {
  const cleanMapping =
    (
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
        const value = mapping[key]

        if (typeof value === "string" && value.trim()) {
          result[key] = value.trim()
        }

        return result
      },
      {}
    )

  return Object.keys(cleanMapping).length > 0
    ? cleanMapping
    : undefined
}

function getNextDashboardMetricMapping(
  mapping: DashboardMetricMapping,
  role: keyof DashboardMetricMapping,
  value: string
): DashboardMetricMapping {
  const nextMapping = {
    ...mapping,
  }
  const cleanValue = value.trim()

  if (cleanValue) {
    nextMapping[role] = cleanValue
  } else {
    delete nextMapping[role]
  }

  return nextMapping
}

function getNextDashboardMetricMappings(
  mappings: Record<string, DashboardMetricMapping>,
  dashboardKey: string,
  mapping: DashboardMetricMapping | undefined,
  shouldSaveMapping: boolean
): Record<string, DashboardMetricMapping> {
  const nextMappings = Object.entries(
    mappings
  ).reduce<Record<string, DashboardMetricMapping>>(
    (result, [key, value]) => {
      if (
        isDashboardKey(key) &&
        dashboardUsesDatasetMetricMapping(
          getDashboardDefinition(key).componentKey
        )
      ) {
        result[key] = value
      }

      return result
    },
    {}
  )

  if (
    shouldSaveMapping &&
    mapping &&
    Object.keys(mapping).length > 0
  ) {
    nextMappings[dashboardKey] = mapping
  } else {
    delete nextMappings[dashboardKey]
  }

  return nextMappings
}

function getValidSelectedMetrics(
  selectedMetrics: unknown,
  availableMetrics: string[]
) {
  if (!Array.isArray(selectedMetrics)) {
    return []
  }

  return Array.from(
    new Set(
      selectedMetrics.filter(
        (metric): metric is string =>
          typeof metric === "string" &&
          availableMetrics.includes(metric)
      )
    )
  )
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
    return periodFilter === "1m"
      ? getFirstDatasetStartDate(rows, xKey)
      : ""
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

function getFirstDatasetStartDate(
  rows: DashboardRow[],
  xKey: string
) {
  let firstDate: Date | undefined

  rows.forEach((row, index) => {
    const date = getRowPeriodStartDate(
      row,
      xKey,
      index
    )

    if (
      !firstDate ||
      date.getTime() < firstDate.getTime()
    ) {
      firstDate = date
    }
  })

  if (!firstDate) {
    return ""
  }

  const year = firstDate.getFullYear()
  const month = String(
    firstDate.getMonth() + 1
  ).padStart(2, "0")
  const day = String(
    firstDate.getDate()
  ).padStart(2, "0")

  return `${year}-${month}-${day}`
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
  selectedDashboard: string,
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
    "dashboard",
    isDashboardKey(selectedDashboard)
      ? selectedDashboard
      : defaultDashboardKey
  )
  url.searchParams.set(
    "token",
    token
  )

  return url.toString()
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  })
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

  const firstDate = startDate
    ? new Date(`${startDate}T00:00:00`)
    : normalizedRows.reduce(
        (earliest, row) =>
          row.__periodDate < earliest
            ? row.__periodDate
            : earliest,
        normalizedRows[0].__periodDate
      )

  if (Number.isNaN(firstDate.getTime())) {
    return normalizedRows
  }

  const periodEnd = new Date(firstDate)
  periodEnd.setMonth(
    periodEnd.getMonth() + monthCount
  )

  return normalizedRows.filter((row) => {
    return (
      row.__periodDate >= firstDate &&
      row.__periodDate < periodEnd
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
        parsed.getDate()
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

function getDashboardPeriodMetrics(
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
    const total = state
      ? finalizeSummaryAggregation(
        state,
        aggregationType
      )
      : typeof datasetValue === "number" &&
        Number.isFinite(datasetValue)
        ? datasetValue
        : 0
    const average = state && state.count > 0
      ? state.sum / state.count
      : 0
    const minimum = state?.min ?? 0
    const maximum = state?.max ?? 0

    return {
      ...metric,
      total,
      average,
      min: minimum,
      max: maximum,
      minimum,
      maximum,
      count: state?.count ?? 0,
    }
  })
}

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
    className: "text-[var(--decisionate-brand-primary-text)]",
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

function getDashboardAnomalyMetric(
  anomalies: DatasetAnomaliesResponse | null,
  metric: string
) {
  return anomalies?.metrics.find(
    item => item.metric === metric
  )
}

function getDashboardIntelligenceImportance(
  anomalies: DatasetAnomaliesResponse | null,
  metric: string,
  value: number,
  target: number
) {
  const anomaly = getDashboardAnomalyMetric(
    anomalies,
    metric
  )

  if (anomaly?.anomaly_count) {
    return "High importance"
  }

  if (target > 0 && getTargetProgress(value, target) < 100) {
    return "Review target"
  }

  return "Monitoring"
}

function getDashboardIntelligenceEvent(
  anomalies: DatasetAnomaliesResponse | null,
  rows: DashboardRow[],
  selectedMetrics: string[],
  primaryMetric: string,
  anomalyLoading: boolean,
  anomalyError: boolean
) {
  if (anomalyLoading) {
    return "Checking the selected metric against its recent pattern."
  }

  if (anomalyError) {
    return getExecutiveNarrative(
      rows,
      selectedMetrics,
      primaryMetric
    )
  }

  const anomaly = getDashboardAnomalyMetric(
    anomalies,
    primaryMetric
  )
  const latestAnomaly =
    anomaly?.anomalies[anomaly.anomalies.length - 1]

  if (latestAnomaly) {
    return `${formatMetricName(primaryMetric)} shows an unusual ${latestAnomaly.direction === "high" ? "increase" : "decrease"} versus its recent baseline.`
  }

  return getExecutiveNarrative(
    rows,
    selectedMetrics,
    primaryMetric
  )
}

function getDashboardIntelligenceMeaning(
  anomalies: DatasetAnomaliesResponse | null,
  metric: string,
  value: number,
  target: number
) {
  const anomaly = getDashboardAnomalyMetric(
    anomalies,
    metric
  )

  if (anomaly?.anomaly_count) {
    return "The result is outside the expected pattern and deserves business-context review."
  }

  if (target > 0) {
    const progress = getTargetProgress(value, target)
    return progress >= 100
      ? `${formatMetricName(metric)} is at or above its current target.`
      : `${formatMetricName(metric)} is below its current target and may need attention.`
  }

  return "Use the trend and target snapshot to decide whether this movement is material."
}

function getDashboardDefaultRecommendation(
  metric: string,
  anomalies: DatasetAnomaliesResponse | null
) {
  const anomaly = getDashboardAnomalyMetric(
    anomalies,
    metric
  )

  if (anomaly?.anomaly_count) {
    return `Review the ${formatMetricName(metric)} drivers and confirm whether the unusual movement is a real business signal.`
  }

  return `Review the ${formatMetricName(metric)} trend, set a target and record a decision if action is justified.`
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
  return dashboardChartPalette[
    index % dashboardChartPalette.length
  ]
}

function getColorWithAlpha(
  color: string,
  alpha: string
) {
  if (
    !/^[0-9a-fA-F]{2}$/.test(alpha)
  ) {
    return color
  }

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alpha}`
  }

  if (color.startsWith("var(")) {
    const alphaPercent =
      Math.round(
        (parseInt(alpha, 16) / 255) * 100
      )

    return `color-mix(in srgb, ${color} ${alphaPercent}%, transparent)`
  }

  return `${color}${alpha}`
}

function formatMetricName(metric: string) {
  return formatMetricLabel(metric)
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

function getShareStatusMessage(
  status: string,
  dashboardShareTitle: string
) {
  const dashboardLabel =
    dashboardShareTitle.toLowerCase()

  if (status === "Copied") {
    return `${dashboardShareTitle} link copied.`
  }

  if (status === "SharingStopped") {
    return `Sharing stopped. Existing ${dashboardLabel} links no longer work.`
  }

  if (status.startsWith("http")) {
    return `${dashboardShareTitle} link created: ${status}`
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
    return `${baseClassName} break-all border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]`
  }

  return `${baseClassName} border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]`
}

function DashboardChartTitlePanel({
  fields,
  titles,
  onChange,
}: {
  fields: DashboardChartTitleField[]
  titles: DashboardChartTitles
  onChange: (
    key: DashboardChartTitleKey,
    value: string
  ) => void
}) {
  return (
    <section className="print:hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-gray-950">
          Chart Names
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Rename the charts in this dashboard. Changes save automatically.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(field => (
          <label
            key={field.key}
            className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm"
          >
            <span className="block truncate text-xs font-semibold uppercase text-gray-500">
              {field.label}
            </span>
            <input
              type="text"
              value={titles[field.key] ?? ""}
              placeholder={field.defaultValue}
              maxLength={80}
              onChange={event =>
                onChange(field.key, event.target.value)
              }
              className="mt-2 h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm placeholder:text-gray-400"
            />
          </label>
        ))}
      </div>
    </section>
  )
}

function DashboardMetricMappingPanel({
  chartTitles,
  includeSecondary = false,
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
  includeSecondary?: boolean
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
      description: string
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
          description: "Numeric column plotted on the trend chart's Y-axis.",
          key: "primary",
          label: "Y-axis value column",
          numericOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.trend,
      fields: [
        {
          description: "Date or period column shown along this chart's horizontal axis.",
          key: "date",
          label: "Horizontal axis column",
          dimensionOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.mix,
      fields: [
        {
          description: "Grouping column for category, source, segment, or mix charts.",
          key: "category",
          label: "Category / channel column",
          dimensionOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.operations,
      fields: [
        {
          description: "Numeric column aggregated for each stage or status.",
          key: "operationsValue",
          label: "Y-axis value column",
          numericOnly: true,
        },
      ],
    },
    {
      chart: chartTitles.operations,
      fields: [
        {
          description: "Stage, funnel, pipeline, or status labels shown along the chart's horizontal axis.",
          key: "stage",
          label: "Horizontal axis column",
          dimensionOnly: true,
        },
      ],
    },
  ]

  if (includeSecondary) {
    chartMappings.splice(1, 0, {
      chart: chartTitles.trend,
      fields: [
        {
          description: "Optional numeric pipeline, forecast, or supporting value shown alongside the primary trend.",
          key: "secondary",
          label: "Secondary trend value",
          numericOnly: true,
        },
      ],
    })
  }

  return (
    <section className="print:hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-950">
            Metric Mapping
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Map dataset columns to the dashboard charts when automatic detection needs help.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Auto uses the detected column. Choose a column only when a chart is using the wrong field.
          </p>
        </div>
      </div>

      <div className={`mt-4 grid items-stretch gap-3 lg:auto-rows-fr ${includeSecondary ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        {chartMappings.map((mappingCard, index) => (
          <div
            key={`${mappingCard.chart}-${index}`}
            className="flex h-full min-w-0 flex-col rounded-xl border border-gray-100 bg-gray-50 p-3"
          >
            <p className="truncate text-xs font-semibold uppercase text-gray-500">
              {mappingCard.chart}
            </p>

            {mappingCard.fields.map((field, index) => (
              <div
                key={field.key}
                className={index > 0 ? "mt-3 border-t border-gray-200 pt-3" : "mt-2"}
              >
                <DashboardMappingSelect
                  label={field.label}
                  description={field.description}
                  value={mapping[field.key] ?? ""}
                  autoValue={autoMapping[field.key]}
                  options={
                    field.numericOnly
                      ? numericColumns
                      : field.dimensionOnly
                        ? dimensionColumns
                        : columns
                  }
                  emptyLabel="Auto"
                  onChange={value =>
                    onChange(field.key, value)
                  }
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function DashboardMappingSelect({
  label,
  description,
  value,
  autoValue,
  options,
  emptyLabel,
  onChange,
}: {
  label: string
  description?: string
  value: string
  autoValue?: string
  options: string[]
  emptyLabel: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-h-0 min-w-0 flex-1 flex-col text-sm">
      <span className="font-medium text-gray-700">
        {label}
      </span>
      {description && (
        <span className="mt-0.5 block text-xs leading-4 text-gray-500">
          {description}
        </span>
      )}
      {!value && autoValue && (
        <span className="mt-1 block truncate text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
          Auto: {autoValue}
        </span>
      )}
      {!value && !autoValue && (
        <span className="mt-1 block text-xs font-medium text-amber-600">
          Auto: not detected
        </span>
      )}
      <select
        value={value}
        onChange={event =>
          onChange(event.target.value)
        }
        className="mt-auto h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm"
      >
        <option value="">
          {emptyLabel}
        </option>
        {options.map(option => (
          <option
            key={option}
            value={option}
          >
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function getDashboardMappingColumns(
  dataset: DashboardDataset | null
) {
  const columns = new Set<string>()

  dataset?.metrics.forEach(metric => {
    columns.add(metric.column)
  })

  ;[
    ...(dataset?.chart?.data ?? []),
    ...(dataset?.preview ?? []),
  ]
    .slice(0, 50)
    .forEach(row => {
      Object.keys(row).forEach(column => {
        if (!isInternalSummaryColumn(column)) {
          columns.add(column)
        }
      })
    })

  return Array.from(columns)
}

function getDashboardDimensionMappingColumns(
  dataset: DashboardDataset | null
) {
  const numericColumns = new Set(
    getDashboardNumericMappingColumns(dataset)
  )

  return getDashboardMappingColumns(dataset).filter(
    column => !numericColumns.has(column)
  )
}

function getDashboardNumericMappingColumns(
  dataset: DashboardDataset | null
) {
  const metricColumns = new Set(
    dataset?.metrics.map(metric => metric.column) ?? []
  )

  if (metricColumns.size > 0) {
    return Array.from(metricColumns)
  }

  const rows = dataset?.chart?.data?.length
    ? dataset.chart.data
    : dataset?.preview ?? []
  const columns = getDashboardMappingColumns(dataset)

  return columns.filter(column =>
    rows.some(row =>
      toFiniteDashboardNumber(row[column]) !== null
    )
  )
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

  const parent = document.body

  if (!parent) {
    return false
  }

  parent.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.parentNode?.removeChild(textarea)
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
