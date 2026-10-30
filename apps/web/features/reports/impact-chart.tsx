"use client"

import { useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useDecisionateText } from "@/app/use-decisionate-language"
import type { ImpactAnalysis } from "./impact-types"
import { formatReportValue } from "./types"
import { ChartScaleControl, type ChartScale } from "./chart-scale-control"
import { impactChartTrends } from "./impact-trends"

const indexFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 })

export function ImpactChart({ analysis }: { analysis: ImpactAnalysis }) {
  const { t } = useDecisionateText()
  const [period, setPeriod] = useState("after")
  const [scale, setScale] = useState<ChartScale>("actual")
  if (!analysis.estimate || !analysis.trend.length) return null
  const { rows, baseline, overflow } = impactChartTrends(analysis.trend, scale, period)
  const firstAfter = rows.find(item => item.after_change)?.period
  const indexed = scale === "indexed"
  return <figure className="min-w-0 space-y-4 border-b border-gray-200 pb-5" aria-label="Actual result and estimated result without the change">
    <figcaption className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Your result compared with no change</h3>
        <div className="flex max-w-full flex-wrap items-center gap-3">
          <div role="group" aria-label="Impact chart period" className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-gray-200 p-1 print:hidden">{[{ value: "after", label: "After the change" }, { value: "all", label: "Full history" }].map(item => <button type="button" key={item.value} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)} className={`min-h-10 rounded px-3 text-sm ${period === item.value ? "bg-blue-50 font-medium text-blue-800" : "text-gray-600"}`}>{item.label}</button>)}</div>
          <ChartScaleControl value={scale} onChange={setScale} />
        </div>
      </div>
      <p className="text-sm text-gray-600">{analysis.outcome?.label} per {analysis.grain === "daily" ? "day" : analysis.grain === "weekly" ? "week" : "month"}{analysis.outcome?.currency ? ` (${analysis.outcome.currency})` : ""}. The dashed line estimates the result without your change. {!indexed && "Values are in original units, not an indexed scale."}</p>
      {indexed && baseline && <p className="text-sm text-gray-600">{t("Indexed scale: {date} = 100 using the estimated result without the change for both lines.").replace("{date}", baseline.period)} {t("100 = {value} on {date}").replace("{value}", formatReportValue(baseline.without_change, analysis.outcome?.currency)).replace("{date}", baseline.period)}</p>}
    </figcaption>
    {!indexed || baseline ? <div className="h-80 min-w-0" role="img" aria-label={`Actual ${analysis.outcome?.label} and estimated result without the change. ${t(indexed ? "Index (base 100)" : "Actual values")}. ${analysis.summary}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={rows} margin={{ top: 16, right: 20, bottom: 8, left: 5 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#e5e7eb" /><XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={50} tickFormatter={value => String(value).slice(0, 10)} />
        <YAxis width={70} tick={{ fontSize: 11 }} tickFormatter={value => new Intl.NumberFormat("en", { notation: "compact" }).format(Number(value))} domain={["auto", "auto"]} label={indexed ? { value: t("Index"), angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
        <Tooltip formatter={(value, name, item) => [indexed ? `${t("Index")}: ${indexFormat.format(Number(value))} / ${t("Original value")}: ${formatReportValue(item.dataKey === "actual" ? item.payload.raw_actual : item.payload.raw_without_change, analysis.outcome?.currency)}` : formatReportValue(Number(value), analysis.outcome?.currency), name]} />
        {indexed && <ReferenceLine y={100} stroke="#6b7280" strokeDasharray="4 4" />}
        {firstAfter && period === "all" && <ReferenceLine x={firstAfter} stroke="#6b7280" strokeDasharray="3 3" label={{ value: "Measured period starts", position: "insideTopRight", fontSize: 11 }} />}
        {analysis.timing?.later_period_start && rows.some(row => row.period === analysis.timing?.later_period_start) && <ReferenceLine x={analysis.timing.later_period_start} stroke="#0f766e" strokeDasharray="3 3" />}
        <Line type="linear" dataKey="actual" name="Actual result" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        <Line type="linear" dataKey="without_change" name="Without the change (estimate)" stroke="#b45309" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer>
    </div> : <p role="status" className="border-l-2 border-amber-500 py-2 pl-3 text-sm text-amber-900">{t("An indexed comparison is unavailable because there is no positive estimated baseline after the change. Actual values remain available.")}</p>}
    {indexed && overflow && <p role="status" className="text-sm text-amber-800">{t("Some values are outside the supported index range.")}</p>}
    <ul aria-label="Impact chart legend" className="flex flex-wrap gap-x-6 gap-y-2 text-xs"><li className="flex items-center gap-2"><span className="w-6 shrink-0 border-t-2 border-blue-600" />Actual result</li><li className="flex items-center gap-2"><span className="w-6 shrink-0 border-t-2 border-dashed border-amber-700" />Without the change (estimate)</li>{analysis.timing?.later_period_start && <li className="flex items-center gap-2"><span className="w-6 shrink-0 border-t-2 border-dashed border-teal-700" />First full later period: {analysis.timing.later_period_start}</li>}</ul>
  </figure>
}
