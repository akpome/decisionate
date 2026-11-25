"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { formatMetricLabel } from "@/features/dashboard/components/metric-selector"
import { dashboardChartPalette } from "@/features/dashboard/lib/chart-palette"
import { DatasetDimensionFilter, dimensionValueLabel } from "@/features/datasets/components/dimension-filter"
import {
  getDashboardGroupSeries, type DashboardGroupPreference, type DashboardGroupQuery, type DashboardGroupResult, type DimensionFilter,
} from "@/lib/api"

const input = "min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950"
const maxGroups = dashboardChartPalette.length

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

export function CompareGroupsEditor({ datasetId, userId, workspaceId, metrics, filter, metric, targets, onFilter, onMetric, onTarget }: {
  datasetId: number; userId: string; workspaceId?: string
  metrics: string[]; filter?: DimensionFilter; metric: string; targets: (number | null)[]
  onFilter: (filter: DimensionFilter | undefined) => void
  onMetric: (metric: string) => void
  onTarget: (index: number, target: number | null) => void
}) {
  const { t } = useDecisionateText()
  const id = useId()
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <DatasetDimensionFilter datasetId={datasetId} userId={userId} workspaceId={workspaceId}
        value={filter} onChange={onFilter} checkboxLimit={maxGroups} embedded />
      <div className="min-w-0 space-y-3">
        <label className="block space-y-1 text-xs font-medium text-gray-600">
          <span>{t("Metric to compare")}</span>
          <select className={input} value={metric} onChange={event => onMetric(event.target.value)} disabled={!metrics.length}>
            <option value="">{t(metrics.length ? "Choose a metric" : "No numeric metrics available")}</option>
            {metrics.map(column => <option key={column} value={column}>{formatMetricLabel(column)}</option>)}
          </select>
        </label>
        {metric && Boolean(filter?.values.length) && (
          <fieldset className="min-w-0 border-t pt-2">
            <legend className="pr-2 text-xs font-medium text-gray-600">{t("Group targets (optional)")}</legend>
            <div className="grid divide-y">
              {filter?.values.map((value, index) => (
                <label key={JSON.stringify(value)} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(6rem,9rem)] items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{t(dimensionValueLabel(value))}</span>
                  <input className={input} type="number" inputMode="decimal" min="0" step="any"
                    id={`${id}-target-${index}`} aria-label={`${t("Target")}: ${t(dimensionValueLabel(value))}`}
                    value={targets[index] ?? ""} placeholder={t("No target")}
                    onChange={event => {
                      const amount = event.target.valueAsNumber
                      onTarget(index, Number.isFinite(amount) && amount > 0 ? amount : null)
                    }} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
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

export function DashboardGroupChart({ comparison, state, print = false }: {
  comparison: DashboardGroupPreference
  state: ReturnType<typeof useDashboardGroupSeries>
  print?: boolean
}) {
  const { t } = useDecisionateText()
  const data = state.data
  const rows = useMemo(() => alignDashboardGroupPoints(data?.series ?? []), [data])
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
            <LineChart data={rows} margin={{ top: 12, right: 18, bottom: 6, left: 0 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" minTickGap={32} tick={{ fontSize: 11 }} tickMargin={8} tickFormatter={period => period.slice(2)} />
              <YAxis width={57} domain={["auto", "auto"]} tickFormatter={value => format.format(value)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={value => typeof value === "number" ? format.format(value) : value} />
              {data?.series.map((group, index) => {
                const color = dashboardChartPalette[index]
                const target = comparison.targets[comparison.filter.values.indexOf(group.value)]
                return target ? <ReferenceLine key={`target-${index}`} y={target} stroke={color}
                  strokeOpacity={0.8} strokeDasharray="5 4" ifOverflow="extendDomain" /> : null
              })}
              {data?.series.map((group, index) => (
                <Line key={JSON.stringify(group.value)} type="linear" dataKey={`group${index}`} name={t(dimensionValueLabel(group.value))}
                  stroke={dashboardChartPalette[index]} strokeWidth={2} dot={group.points.length < 90 ? { r: 2 } : false}
                  connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {data && (
        <ul className="grid grid-cols-1 gap-x-5 gap-y-2 border-y py-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {data.series.map((group, index) => {
            const color = dashboardChartPalette[index]
            const target = comparison.targets[comparison.filter.values.indexOf(group.value)]
            return <li key={JSON.stringify(group.value)} className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2 font-medium">
                <span className="w-5 shrink-0 border-t-2" style={{ borderColor: color }} aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(dimensionValueLabel(group.value))}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 pl-7 text-xs text-gray-600">
                {!group.points.length && <span>{t("No data")}</span>}
                {target && <span className="flex items-center gap-1.5">
                  <span className="w-3 border-t-2 border-dashed" style={{ borderColor: color }} aria-hidden="true" />
                  {t("Target")}: {format.format(target)}
                </span>}
              </div>
            </li>
          })}
        </ul>
      )}
    </section>
  )
}
