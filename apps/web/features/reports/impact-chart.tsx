"use client"

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { ImpactAnalysis } from "./impact-types"
import { formatReportValue } from "./types"

export function ImpactChart({ analysis }: { analysis: ImpactAnalysis }) {
  if (!analysis.estimate || !analysis.trend.length) return null
  const rows = analysis.trend.map(item => ({ ...item, without_change: item.after_change ? item.without_change : null }))
  const firstAfter = rows.find(item => item.after_change)?.period
  return <figure className="min-w-0 space-y-4 border-b border-gray-200 pb-5" aria-label="Actual result and estimated result without the change">
    <figcaption className="space-y-2"><h3 className="text-base font-semibold">What happened compared with no change</h3><p className="text-sm text-gray-600">{analysis.outcome?.label} per {analysis.grain === "daily" ? "day" : analysis.grain === "weekly" ? "week" : "month"}{analysis.outcome?.currency ? ` (${analysis.outcome.currency})` : ""}. Original units, not an indexed scale. The dashed line is a model estimate, not another observed result.</p></figcaption>
    <div className="h-80 min-w-0" role="img" aria-label={`Actual ${analysis.outcome?.label} and estimated result without the change. ${analysis.summary}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={rows} margin={{ top: 16, right: 20, bottom: 8, left: 5 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#e5e7eb" /><XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={50} tickFormatter={value => String(value).slice(0, 10)} />
        <YAxis width={70} tick={{ fontSize: 11 }} tickFormatter={value => new Intl.NumberFormat("en", { notation: "compact" }).format(Number(value))} domain={["auto", "auto"]} />
        <Tooltip formatter={(value, name) => [formatReportValue(typeof value === "number" ? value : Number(value), analysis.outcome?.currency), name]} />
        {firstAfter && <ReferenceLine x={firstAfter} stroke="#6b7280" strokeDasharray="3 3" label={{ value: "Change", position: "insideTopRight", fontSize: 11 }} />}
        <Line type="linear" dataKey="actual" name="What actually happened" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="linear" dataKey="without_change" name="Estimated without the change" stroke="#b45309" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer>
    </div>
    <ul aria-label="Impact chart legend" className="flex flex-wrap gap-x-6 gap-y-2 text-xs"><li className="flex items-center gap-2"><span className="w-6 border-t-2 border-blue-600" />What actually happened</li><li className="flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-amber-700" />Estimated without the change</li></ul>
  </figure>
}
