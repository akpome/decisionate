"use client"

import { useMemo, useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { formatReportValue, type BusinessReport } from "./types"
import { indexedMetricTrends, type IndexedTrendRow, type IndexedTrendSeries } from "./indexed-trends"
import { ChartScaleControl, type ChartScale } from "./chart-scale-control"

const indexFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 })
const axisFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const scientificFormat = new Intl.NumberFormat("en", { notation: "scientific", maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
const periodLabel = (period: string) => {
  const date = new Date(`${period}T00:00:00Z`)
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : period
}

function originalTrendValue(value: number | null, currency?: string | null) {
  if (value !== null && Number.isFinite(value) && value !== 0 && Math.abs(value) < .01) {
    return new Intl.NumberFormat("en", { notation: "scientific", maximumFractionDigits: 4,
      ...(currency && /^[A-Z]{3}$/.test(currency) ? { style: "currency", currency } : {}),
    }).format(value)
  }
  return formatReportValue(value, currency)
}

function SeriesSwatch({ series }: { series: IndexedTrendSeries }) {
  return <span aria-hidden="true" className="mt-2 inline-block w-6 shrink-0 border-t-[3px]" style={{ borderColor: series.color, borderTopStyle: series.dash === "2 3" ? "dotted" : series.dash ? "dashed" : "solid" }} />
}

export function IndexedTrendTooltip({ active, row, series, scale = "indexed" }: { active: boolean; row?: IndexedTrendRow; series: IndexedTrendSeries[]; scale?: ChartScale }) {
  const { t } = useDecisionateText()
  if (!active || !row) return null
  return <div tabIndex={0} role="group" aria-label={t(scale === "indexed" ? "Indexed values" : "Actual values")} onMouseMove={event => event.stopPropagation()} className="max-h-64 w-72 max-w-[65vw] space-y-3 overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-white p-3 text-xs shadow-md print:hidden">
    <p className="font-semibold">{row.period} / {t(scale === "indexed" ? "Index (base 100)" : "Actual values")}</p>
    {series.map(item => {
      const value = row.indexed[item.key]
      return <div key={item.key} className="flex min-w-0 items-start gap-2">
        <SeriesSwatch series={item} />
        <div className="min-w-0"><p className="break-words font-medium">{item.label}</p>{scale === "indexed" && <p className="mt-1 text-gray-600">{t("Index")}: {value === null ? t("Unavailable") : indexFormat.format(value)}</p>}<p className="mt-1 text-gray-600">{t("Original value")}: {originalTrendValue(row.raw[item.key], item.metric.currency)} / {item.metric.currency || item.metric.unit}</p></div>
      </div>
    })}
  </div>
}

export function MetricTrends({ report }: { report: BusinessReport }) {
  const { t } = useDecisionateText()
  const [scale, setScale] = useState<ChartScale>("indexed")
  const data = useMemo(() => indexedMetricTrends(report.metrics), [report.metrics])
  const rows = useMemo(() => new Map(data.rows.map(row => [row.period, row])), [data.rows])
  const plotted = scale === "indexed" ? data.plotted : data.actual
  const title = t(scale === "indexed" ? "Indexed metric comparison" : "Actual metric comparison")
  return <section className="min-w-0 space-y-5" aria-label={t("Metric comparisons")}>
    <div className={`grid min-w-0 gap-4 md:grid-cols-2 ${report.metrics.length >= 3 ? "xl:grid-cols-3" : ""}`}>
      {data.series.map(item => {
        const metric = item.metric
        return <article key={metric.id} className="min-w-0 rounded-md border border-gray-200 bg-white p-4">
          <h3 className="flex min-w-0 items-start gap-2 text-sm font-semibold"><SeriesSwatch series={item} /><span className="min-w-0 break-words">{metric.label}</span></h3>
          <p className="mt-1 break-words text-xs text-gray-500">{metric.dataset_label} / {metric.currency || metric.unit} / {metric.aggregation}</p>
          <p className="mt-3 break-words text-2xl font-semibold tabular-nums">{formatReportValue(metric.value, metric.currency)}</p>
          <p className="mt-1 text-sm text-gray-600">{metric.change_percent === null ? t("Percentage change unavailable") : `${metric.change_percent >= 0 ? "+" : ""}${metric.change_percent.toFixed(1)}% ${t("versus previous period")}`}</p>
          <p className="mt-1 text-xs text-gray-500">{t("Previous")}: {formatReportValue(metric.previous_value, metric.currency)} / {t("Coverage")}: {metric.observations}/{metric.expected_periods}</p>
          {metric.warnings.length > 0 && <details className="mt-2 text-xs text-amber-800"><summary className="cursor-pointer">{t("Coverage notes")}</summary><ul className="mt-2 list-disc space-y-1 pl-4">{metric.warnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}</ul></details>}
        </article>
      })}
    </div>
    <figure className="min-w-0 space-y-4 border-t border-gray-200 pt-5" aria-label={title}>
      <figcaption className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold">{title}</h3><ChartScaleControl value={scale} onChange={setScale} /></div>
        {scale === "indexed" ? data.baselinePeriod && <p className="text-sm text-gray-600">{t("Indexed scale: {date} = 100 for every plotted metric. Values are indexed, not original units.").replace("{date}", data.baselinePeriod)}</p> : <p className="text-sm text-gray-600">{t("Actual scale: original values, not indexed. Each line's units are shown in the legend; different units are not directly comparable.")}</p>}
      </figcaption>
      {plotted.length > 0 ? <>
        <div className="h-80 min-w-0 sm:h-96" role="group" aria-label={`${title}: ${plotted.map(item => item.label).join("; ")}.${scale === "indexed" ? ` ${data.baselinePeriod} = 100.` : ""}`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={data.rows} margin={{ top: 12, right: 16, bottom: 4, left: 10 }} accessibilityLayer>
              <CartesianGrid stroke="var(--color-gray-200)" vertical={false} />
              <XAxis dataKey="period" tickFormatter={periodLabel} stroke="var(--color-gray-400)" tick={{ fontSize: 11, fill: "var(--color-gray-600)" }} minTickGap={35} tickMargin={8} />
              <YAxis width={60} domain={["auto", "auto"]} stroke="var(--color-gray-400)" tickFormatter={value => (Math.abs(Number(value)) >= 1e12 ? scientificFormat : axisFormat).format(Number(value))} tick={{ fontSize: 11, fill: "var(--color-gray-600)" }} label={{ value: t(scale === "indexed" ? "Index" : "Actual value"), angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--color-gray-600)" } }} />
              {scale === "indexed" && <ReferenceLine y={100} stroke="var(--color-gray-500)" strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: "100", position: "insideTopRight", style: { fontSize: 11, fill: "var(--color-gray-600)" } }} />}
              <Tooltip filterNull={false} isAnimationActive={false} wrapperStyle={{ pointerEvents: "auto", zIndex: 20 }} content={({ active, label }) => <IndexedTrendTooltip active={active} row={rows.get(String(label))} series={plotted} scale={scale} />} />
              {plotted.map(item => <Line key={item.key} type="linear" dataKey={(row: IndexedTrendRow) => row[scale === "indexed" ? "indexed" : "raw"][item.key]} name={item.label} stroke={item.color} strokeDasharray={item.dash} strokeWidth={2} dot={(scale === "indexed" ? item.points : item.rawPoints) <= 24 ? { r: 2 } : false} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ul aria-label={t("Chart legend")} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {plotted.map(item => <li key={item.key} className="flex min-w-0 items-start gap-2 text-xs"><SeriesSwatch series={item} /><div className="min-w-0"><p className="break-words font-medium">{item.label}</p><p className="mt-1 break-words text-gray-500">{scale === "indexed" ? t("100 = {value} on {date}").replace("{value}", originalTrendValue(item.baseline, item.metric.currency)).replace("{date}", data.baselinePeriod ?? "") : `${item.metric.currency || item.metric.unit} / ${item.metric.aggregation}`}</p>{scale === "indexed" && item.overflow > 0 && <p className="mt-1 text-amber-800">{t("Some values are outside the supported index range.")}</p>}</div></li>)}
        </ul>
      </> : <p role="status" className="border-l-2 border-amber-500 py-2 pl-3 text-sm text-amber-900">{t(scale === "indexed" ? "An indexed comparison is unavailable because the metrics have no shared positive baseline period. Original metric values remain above." : "No actual values are available in this reporting window.")}</p>}
      {scale === "indexed" && data.excluded.length > 0 && <ul aria-label={t("Metrics not indexed")} className="space-y-2 text-xs text-amber-900">{data.excluded.map(item => <li key={item.key} className="break-words"><span className="font-medium">{item.label}</span>: {t("Not indexed: no positive baseline value in this reporting window.")}</li>)}</ul>}
    </figure>
  </section>
}
