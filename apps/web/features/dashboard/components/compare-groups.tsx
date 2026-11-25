"use client"

import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { DashboardSelectionRow } from "@/features/dashboard/components/dashboard-selection-row"
import { DashboardMetricTargetFields, formatMetricLabel } from "@/features/dashboard/components/metric-selector"
import { dashboardChartPalette } from "@/features/dashboard/lib/chart-palette"
import { DatasetDimensionFilter, dimensionValueLabel } from "@/features/datasets/components/dimension-filter"
import {
  getDashboardGroupSeries, type DashboardGroupPreference, type DashboardGroupQuery, type DashboardGroupResult, type DashboardPreferencePayload, type DimensionFilter,
} from "@/lib/api"

const maxGroups = dashboardChartPalette.length
const metricTargetColor = "#475569"

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

export function DashboardGroupChart({ comparison, state, chartType = "line", metricTarget = 0, print = false }: {
  comparison: DashboardGroupPreference
  state: ReturnType<typeof useDashboardGroupSeries>
  chartType?: DashboardPreferencePayload["chartType"]
  metricTarget?: number
  print?: boolean
}) {
  const { t } = useDecisionateText()
  const data = state.data
  const rows = useMemo(() => alignDashboardGroupPoints(data?.series ?? []), [data])
  const showMetricTarget = rows.length > 0 && Number.isFinite(metricTarget) && metricTarget > 0
  const colors = groupColors(comparison.filter.values)
  const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
  return (
    <section className="min-w-0 space-y-3 border-t pt-4" aria-label={t("Group comparison")}>
      <h2 className="break-words text-lg font-semibold">{formatMetricLabel(comparison.metric)} / {comparison.filter.column}</h2>
      {state.pending && <p role="status" className="text-sm text-gray-600">{t("Loading group comparison...")}</p>}
      {state.error && <div className="flex items-start gap-2 text-sm text-red-700">
        <p role="alert" className="min-w-0 flex-1 break-words">{state.error}</p>
        <button type="button" title={t("Retry group comparison")} aria-label={t("Retry group comparison")} onClick={state.retry}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"><RefreshCw size={16} aria-hidden="true" /></button>
      </div>}
      {data?.has_summarized_data && <p role="status" className="text-xs text-amber-800">{t("Older monthly totals are included only for complete months when grouped by month or quarter.")}</p>}
      {data && !rows.length && <p role="status" className="text-sm text-gray-600">{t("No group data matches these dates.")}</p>}
      {rows.length > 0 && (
        <div className={print ? "h-[270px] w-full min-w-0" : "h-[320px] w-full min-w-0 sm:h-[400px]"}>
          <ResponsiveContainer minWidth={0} initialDimension={{ width: print ? 900 : 1, height: print ? 270 : 1 }}>
            <ComposedChart data={rows} margin={{ top: 12, right: 18, bottom: 6, left: 0 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" minTickGap={32} tick={{ fontSize: 11 }} tickMargin={8} tickFormatter={period => period.slice(2)} />
              <YAxis width={57}
                domain={chartType === "bar" ? [min => Math.min(0, min), max => Math.max(0, max)] : ["auto", "auto"]}
                tickFormatter={value => format.format(value)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={value => typeof value === "number" ? format.format(value) : value} />
              {showMetricTarget && <ReferenceLine y={metricTarget} stroke={metricTargetColor} strokeDasharray="5 4" ifOverflow="extendDomain" />}
              {data?.series.map((group, index) => {
                const key = JSON.stringify(group.value)
                const color = groupColor(group.value, colors)
                const series = { dataKey: `group${index}`, name: t(dimensionValueLabel(group.value)), isAnimationActive: false }
                if (chartType === "bar") return <Bar key={key} {...series} fill={color} />
                const curve = {
                  ...series, type: "monotone" as const, stroke: color, strokeWidth: 2,
                  dot: group.points.length < 90 ? { r: 2 } : false, connectNulls: false,
                }
                return chartType === "area"
                  ? <Area key={key} {...curve} fill={color} fillOpacity={0.15} />
                  : <Line key={key} {...curve} />
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {data && (
        <ul className="grid grid-cols-1 gap-x-5 gap-y-2 border-y py-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {showMetricTarget && <li className="flex items-center gap-2 font-medium">
            <span className="w-5 shrink-0 border-t-2 border-dashed" style={{ borderColor: metricTargetColor }} aria-hidden="true" />
            {t("Metric target")}: {format.format(metricTarget)}
          </li>}
          {data.series.map(group => {
            const color = groupColor(group.value, colors)
            return <li key={JSON.stringify(group.value)} className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2 font-medium">
                <span className="w-5 shrink-0 border-t-2" style={{ borderColor: color }} aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(dimensionValueLabel(group.value))}</span>
              </div>
              {!group.points.length && <div className="pl-7 text-xs text-gray-600">{t("No data")}</div>}
            </li>
          })}
        </ul>
      )}
    </section>
  )
}
