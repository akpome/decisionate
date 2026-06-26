"use client"

import { useEffect, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { useUser } from "@clerk/nextjs"
import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"

import {
  getDatasetDetails,
  getDatasets,
  getDatasetPreference,
} from "@/lib/api"

import {
  Database,
  Download,
  Gauge,
  LineChart as LineChartIcon,
  Printer,
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

type PeriodFilter =
  | "1m"
  | "1q"
  | "6m"
  | "1y"
  | "2y"
  | "3y"
  | "5y"
  | "all"

type ReportSectionProps = {
  dataset: any
  metrics: any[]
  rows: any[]
  chartRows: any[]
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

/* =========================
   Page Component
========================= */

export default function DashboardPage() {
  const { user } = useUser()

  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()

  const [dataset, setDataset] =
    useState<any>(null)

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

  const [showNarrative, setShowNarrative] =
    useState(true)

  const [loading, setLoading] =
    useState(false)

  /* =========================
     Load Selected Dataset
  ========================= */

  useEffect(() => {
    if (!selectedDatasetId || !user?.id) {
      setDataset(null)
      return
    }

    async function loadDataset() {
      try {
        setLoading(true)

        const data =
          await getDatasetDetails(
            selectedDatasetId!,
            user!.id
          )

        const availableMetrics =
          data?.metrics?.map(
            (metric: any) => metric.column
          ) ?? []

        setDataset(data)

        setSelectedMetrics(
          availableMetrics.length > 0
            ? [availableMetrics[0]]
            : []
        )

        setTargets(
          buildDefaultTargets(
            data?.metrics ?? []
          )
        )
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    loadDataset()
  }, [selectedDatasetId, user?.id])

  /* =========================
     Load Default Dataset
  ========================= */

  useEffect(() => {
    if (!user?.id) return

    const userId = user.id

    async function loadDefaultDataset() {
      try {
        const preference =
          await getDatasetPreference(userId)

        if (preference.selected_dataset_id) {
          setSelectedDatasetId(
            preference.selected_dataset_id
          )
          return
        }

        const datasets =
          await getDatasets(userId)

        if (datasets.length > 0) {
          setSelectedDatasetId(
            datasets[0].id
          )
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadDefaultDataset()
  }, [user?.id])

  /* =========================
     Derived Dashboard Data
  ========================= */

  const allRows = dataset?.preview ?? []
  const metrics = dataset?.metrics ?? []
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

  const templateProps: ReportSectionProps = {
    dataset,
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

  return (
    <div className="screen-page space-y-4">
      {/* =========================
          Page Header
      ========================= */}

      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold">
            Dashboard
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Monitor performance, compare metrics, and track targets.
          </p>
        </div>

        <div className="flex items-center gap-3">
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

          <div className="w-80">
            <DatasetSelector
              value={selectedDatasetId}
              onChange={(id) => {
                setDataset(null)
                setSelectedMetrics([])
                setTargets({})
                setSelectedDatasetId(id)
              }}
            />
          </div>
        </div>
      </div>

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
            {metrics.map((metric: any, index: number) => (
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
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <DashboardCard className="flex h-[660px] flex-col">
          <CardHeader
            title="Performance Target"
            description={props.dataset.file_name}
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

        <DashboardCard className="flex h-[660px] flex-col">
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

          <div className="mt-4 flex-1 min-h-0">
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
        </DashboardCard>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {props.metrics.slice(0, 4).map((metric: any) => (
          <KpiCard
            key={metric.column}
            label={formatMetricName(metric.column)}
            value={metric.total}
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
  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        {metrics.slice(0, 4).map((metric: any) => (
          <KpiCard
            key={metric.column}
            label={formatMetricName(metric.column)}
            value={metric.total}
          />
        ))}
      </div>

      <DashboardCard className="flex h-[720px] flex-col">
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

        <div className="mt-4 flex-1 min-h-0">
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
  return (
    <>
      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-4">
        {metrics.slice(0, 4).map((metric: any) => (
          <KpiCard
            key={metric.column}
            label={formatMetricName(metric.column)}
            value={metric.total}
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
      <div className="grid h-[660px] items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Executive Chart Card */}
        <DashboardCard className="flex h-full flex-col">
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

          <div className="mt-4 flex-1 min-h-0">
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
        </DashboardCard>

        {/* Executive Target Card */}
        <DashboardCard className="flex h-full flex-col justify-between">
          <div>
            <CardHeader
              title="Target Snapshot"
              description={dataset.file_name}
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
  rows: any[]
  xKey: string
  metrics: string[]
  allMetrics: any[]
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
  onToggle,
}: {
  metric: any
  index: number
  rows: any[]
  xKey: string
  chartType: ChartType
  selected: boolean
  onToggle: () => void
}) {
  const latestValue =
    getLatestValue(rows, metric.column)

  return (
    <button
      type="button"
      onClick={onToggle}
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

        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            selected
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {selected ? "Selected" : "Select"}
        </span>
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
    </button>
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
  rows: any[]
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
  const [inputValue, setInputValue] =
    useState(value > 0 ? String(value) : "")

  useEffect(() => {
    setInputValue(
      value > 0 ? String(value) : ""
    )
  }, [value])

  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-500">
        {label}
      </span>

      <input
        type="number"
        value={inputValue}
        min={0}
        placeholder="Set target"
        onChange={(event) => {
          const nextValue =
            event.target.value

          setInputValue(nextValue)

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

function buildDefaultTargets(metrics: any[]) {
  return metrics.reduce(
    (
      result: Record<string, number>,
      metric: any
    ) => {
      result[metric.column] = 0
      return result
    },
    {}
  )
}

function buildIndexedRows(
  rows: any[],
  metrics: string[],
  xKey: string
) {
  return rows.map((row) => {
    const next: Record<string, any> = {
      [xKey]: row[xKey],
    }

    metrics.forEach((metric) => {
      const first =
        Number(rows[0]?.[metric] || 1)

      next[metric] =
        Math.round(
          (Number(row[metric] || 0) /
            first) *
            100
        )
    })

    return next
  })
}

function filterRowsByPeriod(
  rows: any[],
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
  row: any,
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
  rows: any[],
  metric: string
) {
  if (rows.length === 0) return 0

  return Number(
    rows[rows.length - 1]?.[metric] ?? 0
  )
}

function getTargetProgress(
  value: number,
  target: number
) {
  if (!target || target <= 0) return 0

  return Math.round(
    (value / target) * 100
  )
}

function getTargetStatus(
  value: number,
  target: number
) {
  if (!target || target <= 0) {
    return {
      text: "No target set",
      className: "text-gray-500",
    }
  }

  const progress =
    Math.round((value / target) * 100)

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
  rows: any[],
  metric: string
) {
  if (rows.length < 2) return 0

  const first =
    Number(rows[0]?.[metric] || 0)

  const last =
    Number(
      rows[rows.length - 1]?.[metric] ||
        0
    )

  if (first === 0) return 0

  return Math.round(
    ((last - first) / first) * 100
  )
}

function getExecutiveNarrative(
  rows: any[],
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
  if (!target || target <= 0) {
    return `Set a target for ${formatMetricName(metric)} to monitor performance.`
  }

  if (value >= target) {
    return `${formatMetricName(metric)} has reached ${getTargetProgress(value, target)}% of target.`
  }

  return `${formatMetricName(metric)} is ${formatNumber(target - value)} below target.`
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
  metrics: any[],
  metric: string
) {
  const index =
    metrics.findIndex(
      (item: any) =>
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

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString(
    undefined,
    {
      maximumFractionDigits: 2,
    }
  )
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