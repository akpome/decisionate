"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { ResponsiveContainer } from "recharts"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { DashboardTrendChart, FullscreenChartArea, indexDashboardChartRows } from "@/features/dashboard/components/dashboard-chart"
import { DashboardSelectionRow } from "@/features/dashboard/components/dashboard-selection-row"
import { DashboardMetricTargetFields, formatMetricLabel } from "@/features/dashboard/components/metric-selector"
import { dashboardChartPalette } from "@/features/dashboard/lib/chart-palette"
import { DatasetDimensionFilter, dimensionValueLabel } from "@/features/datasets/components/dimension-filter"
import {
  getDashboardGroupSeries, type DashboardGroupPreference, type DashboardGroupQuery, type DashboardGroupResult, type DashboardPreferencePayload, type DimensionFilter,
} from "@/lib/api"

const maxGroups = dashboardChartPalette.length

function groupColor(value: string | null, colors: Map<string | null, string>) {
  const selected = colors.get(value)
  if (selected) return selected
  const hash = Array.from(JSON.stringify(value)).reduce((sum, character) =>
    (Math.imul(sum, 31) + character.codePointAt(0)!) >>> 0, 0)
  const start = hash % maxGroups
  const used = [...colors.values()]
  for (let offset = 0; offset < maxGroups; offset++) {
    const color = dashboardChartPalette[(start + offset) % maxGroups]
    if (!used.includes(color)) return color
  }
  return dashboardChartPalette[start]
}

function groupColors(values: (string | null)[]) {
  const colors = new Map<string | null, string>()
  for (const value of values) colors.set(value, groupColor(value, colors))
  return colors
}

export function useDashboardGroupSeries(datasetId: number | undefined, userId: string, workspaceId: string | undefined,
  query: DashboardGroupQuery | undefined, context: string) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; data?: DashboardGroupResult; error?: string }>()
  const key = JSON.stringify([workspaceId, userId, datasetId, context, query, retry])
  useEffect(() => {
    if (!datasetId || !userId || !query) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void getDashboardGroupSeries(datasetId, userId, workspaceId, query, controller.signal)
        .then(data => { if (!controller.signal.aborted) setResult({ key, data }) })
        .catch(error => {
          if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "The group comparison could not be loaded." })
        })
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [datasetId, userId, workspaceId, query, key])
  const current = query && result?.key === key ? result : undefined
  return { data: current?.data, pending: Boolean(query && !current), error: current?.error, retry: () => setRetry(value => value + 1) }
}

export function CompareGroupsEditor({ datasetId, userId, workspaceId, metrics, filter, metric, metricTarget, onFilter, onMetric, onTargetChange }: {
  datasetId: number; userId: string; workspaceId?: string
  metrics: string[]; filter?: DimensionFilter; metric: string; metricTarget: number
  onFilter: (filter: DimensionFilter | undefined) => void
  onMetric: (metric: string) => void
  onTargetChange: (metric: string, value: number | null) => void
}) {
  const { t } = useDecisionateText()
  const colors = groupColors(filter?.values ?? [])
  return (
    <div className="min-w-0 space-y-3">
      <DashboardMetricTargetFields metrics={metrics} metric={metric} metricLabel="Metric to compare"
        placeholder="Choose a metric" target={metricTarget} onMetricChange={value => onMetric(value ?? "")}
        onTargetChange={onTargetChange} />
      <DatasetDimensionFilter datasetId={datasetId} userId={userId} workspaceId={workspaceId}
        value={filter} onChange={onFilter} embedded groupPicker={{
          limit: maxGroups,
          renderValue(value, checked, disabled, toggle) {
            return <DashboardSelectionRow key={JSON.stringify(value)}
              label={t(dimensionValueLabel(value))} color={groupColor(value, colors)}
              checked={checked} disabled={disabled} onToggle={toggle} />
          },
        }} />
    </div>
  )
}

export function alignDashboardGroupPoints(series: DashboardGroupResult["series"]) {
  const periods = new Map<string, Record<string, number | string | null>>()
  series.forEach((group, index) => {
    for (const point of group.points) {
      const row = periods.get(point.period) ?? { period: point.period }
      row[`group${index}`] = point.amount
      periods.set(point.period, row)
    }
  })
  return [...periods.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => ({
    ...Object.fromEntries(series.map((_, index) => [`group${index}`, null])),
    ...row,
  }))
}

export function DashboardGroupChart({ comparison, state, chartType = "line", scaleMode = "actual", metricTarget = 0, print = false, controls }: {
  comparison: Pick<DashboardGroupPreference, "metric" | "filter">
  state: { data?: DashboardGroupResult; pending?: boolean; error?: string; retry?: () => void }
  chartType?: DashboardPreferencePayload["chartType"]
  scaleMode?: DashboardPreferencePayload["scaleMode"]
  metricTarget?: number
  print?: boolean
  controls?: ReactNode
}) {
  const { t } = useDecisionateText()
  const data = state.data
  const rows = useMemo(() => alignDashboardGroupPoints(data?.series ?? []), [data])
  const colors = groupColors(comparison.filter.values)
  const title = `${formatMetricLabel(comparison.metric)} / ${comparison.filter.column}`
  const series = data?.series.map((group, index) => ({
    dataKey: `group${index}`, label: t(dimensionValueLabel(group.value)), color: groupColor(group.value, colors),
  })) ?? []
  const plottedRows = scaleMode === "indexed" ? indexDashboardChartRows(rows, series.map(group => group.dataKey), "period") : rows
  const chart = (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={1}
      initialDimension={{ width: print ? 900 : 1, height: print ? 270 : 1 }}>
      <DashboardTrendChart rows={plottedRows} series={series} chartType={chartType} xKey="period" xLabel={t("Period")}
        target={scaleMode === "actual" && Number.isFinite(metricTarget) ? metricTarget : 0} extendTargetDomain animate={!print} />
    </ResponsiveContainer>
  )
  const emptyGroups = data?.series.filter(group => !group.points.length).map(group => t(dimensionValueLabel(group.value))) ?? []
  return (
    <section className={print ? "min-w-0 space-y-3" : "flex h-full min-w-0 flex-col"} aria-label={t("Group comparison")}>
      <h2 className="break-words text-base font-semibold">{title}</h2>
      {controls}
      {state.pending && <p role="status" className="text-sm text-gray-600">{t("Loading group comparison...")}</p>}
      {state.error && <div className="flex items-start gap-2 text-sm text-red-700">
        <p role="alert" className="min-w-0 flex-1 break-words">{state.error}</p>
        {state.retry && <button type="button" title={t("Retry group comparison")} aria-label={t("Retry group comparison")} onClick={state.retry}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"><RefreshCw size={16} aria-hidden="true" /></button>}
      </div>}
      {data?.has_summarized_data && <p role="status" className="text-xs text-amber-800">{t("Older monthly totals are included only for complete months when grouped by month or quarter.")}</p>}
      {data && !rows.length && <p role="status" className="text-sm text-gray-600">{t("No group data matches these dates.")}</p>}
      {rows.length > 0 && (print
        ? <div className="h-[270px] w-full min-w-0">{chart}</div>
        : <FullscreenChartArea title={title} ariaLabel={`${title}: ${series.map(group => group.label).join(", ")}`}
            className="dashboard-print-chart-area mt-4 h-[320px] w-full min-w-0 flex-none xl:h-auto xl:min-h-[320px] xl:flex-1">{chart}</FullscreenChartArea>)}
      {rows.length > 0 && emptyGroups.length > 0 && <p className="break-words text-xs text-gray-600">{t("No data")}: {emptyGroups.join(", ")}</p>}
    </section>
  )
}
