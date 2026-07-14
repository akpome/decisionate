"use client"

import { useEffect, useMemo, useState } from "react"
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
} from "@/lib/api"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

type ChartType = "line" | "bar" | "area"
type ScaleMode = "actual" | "indexed"
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
  token?: string
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

const colorPalette = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#9333ea",
  "#dc2626",
  "#0891b2",
]

const unavailableSharedDashboardMessage =
  "This shared dashboard link is no longer available."

export default function SharedDashboardPage() {
  const [sharedConfig] =
    useState<SharedDashboardConfig>(
      () => getSharedDashboardConfig()
    )
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
  const [loading, setLoading] =
    useState(true)
  const [pageError, setPageError] =
    useState("")

  useEffect(() => {
    let isCurrent = true
    const abortController =
      new AbortController()

    function setSharedPageError(message: string) {
      if (!isCurrent) {
        return
      }

      setPageError(message)
    }

    async function loadSharedDashboard() {
      try {
        setLoading(true)
        setPageError("")

        const datasetId =
          sharedConfig.datasetId

        if (!datasetId) {
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        if (!sharedConfig.token) {
          setSharedPageError(
            unavailableSharedDashboardMessage
          )
          return
        }

        const response =
          await getPublicSharedDashboard(
            datasetId,
            sharedConfig.token,
            abortController.signal
          )

        if (!response) {
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
        const availableMetrics =
          data.metrics?.map(
            (metric) => metric.column
          ) ?? []
        const safePeriodFilter =
          getSavedPeriodFilter(
            dashboardPreference.periodFilter
          )
        const savedChartRows =
          data.chart?.data?.length
            ? data.chart.data
            : data.preview ?? []

        if (!isCurrent) {
          return
        }

        setDataset(data)
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
        setDashboardTemplate(
          getSavedDashboardTemplate(
            sharedConfig.dashboardTemplate ??
              dashboardPreference.dashboardTemplate
          )
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

        setSharedPageError(
          "Unable to load this shared dashboard."
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
    sharedConfig.datasetId,
    sharedConfig.dashboardTemplate,
    sharedConfig.token,
  ])

  const metrics =
    useMemo(
      () => dataset?.metrics ?? [],
      [dataset]
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
  const chartRows =
    scaleMode === "indexed" &&
    selectedMetrics.length > 1
      ? buildIndexedRows(
          rows,
          selectedMetrics,
          xKey
        )
      : rows

  if (loading) {
    return (
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
    )
  }

  if (pageError || !dataset) {
    return (
      <SharedPageShell>
        <SharedCard role="alert">
          <p className="text-sm text-gray-500">
            {pageError || "Dashboard not found."}
          </p>
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

  return (
    <SharedPageShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">
            Shared Dashboard
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            {dataset.file_name}
            {sourceDetails && (
              <>
                {" "}
                • {sourceDetails.label}
              </>
            )}
          </p>
        </div>

        {dashboardTemplate === "executive" && (
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

        {dashboardTemplate === "performance" && (
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
              />
            </div>

            <KpiGrid metrics={metrics} />
          </>
        )}

        {dashboardTemplate === "comparison" && (
          <>
            <KpiGrid metrics={metrics} />

            <MainChartCard
              chartType={chartType}
              chartRows={chartRows}
              xKey={xKey}
              selectedMetrics={selectedMetrics}
              metrics={metrics}
              primaryMetric={primaryMetric}
              selectedTarget={selectedTarget}
              scaleMode={scaleMode}
              className="h-[720px]"
            />
          </>
        )}
      </div>
    </SharedPageShell>
  )
}

function KpiGrid({
  metrics,
}: {
  metrics: DashboardMetric[]
}) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {metrics.slice(0, 4).map((metric) => (
        <KpiCard
          key={metric.column}
          label={formatMetricName(metric.column)}
          value={metric.total ?? 0}
        />
      ))}
    </div>
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
  className = "h-[640px]",
}: {
  chartType: ChartType
  chartRows: DashboardRow[]
  xKey: string
  selectedMetrics: string[]
  metrics: DashboardMetric[]
  primaryMetric: string
  selectedTarget: number
  scaleMode: ScaleMode
  className?: string
}) {
  const hasChartData =
    chartRows.length > 0 &&
    selectedMetrics.length > 0

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
        <div className="mt-4 flex min-h-[360px] flex-1 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
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
  className = "h-[640px]",
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
}: {
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl">
        {children}
      </div>
    </main>
  )
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
      <h2 className="text-xl font-semibold tracking-tight">
        {title}
      </h2>

      {description && (
        <p className="mt-1 text-sm text-gray-500">
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
    <SharedCard>
      <p className="text-sm text-gray-500">
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

        {metrics.map((metric) => (
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
    token: token || undefined,
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

function getMetricColor(index: number) {
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
