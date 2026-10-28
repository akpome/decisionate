"use client"

import { useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { ImpactAnalysis } from "./impact-types"
import { formatReportValue } from "./types"

export function ImpactChart({ analysis }: { analysis: ImpactAnalysis }) {
  const [period, setPeriod] = useState("after")
  if (!analysis.estimate || !analysis.trend.length) return null
  const rows = analysis.trend.filter(item => period === "all" || item.after_change).map(item => ({ ...item, without_change: item.after_change ? item.without_change : null }))
  const firstAfter = rows.find(item => item.after_change)?.period
  return <figure className="min-w-0 space-y-4 border-b border-gray-200 pb-5" aria-label="Actual result and estimated result without the change">
    <figcaption className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold">Your result compared with no change</h3><div role="group" aria-label="Impact chart period" className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-gray-200 p-1 print:hidden">{[{ value: "after", label: "After the change" }, { value: "all", label: "Full history" }].map(item => <button type="button" key={item.value} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)} className={`min-h-10 rounded px-3 text-sm ${period === item.value ? "bg-blue-50 font-medium text-blue-800" : "text-gray-600"}`}>{item.label}</button>)}</div></div><p className="text-sm text-gray-600">{analysis.outcome?.label} per {analysis.grain === "daily" ? "day" : analysis.grain === "weekly" ? "week" : "month"}{analysis.outcome?.currency ? ` (${analysis.outcome.currency})` : ""}. The dashed line estimates the result without your change. Values are in original units, not an indexed scale.</p></figcaption>
    <div className="h-80 min-w-0" role="img" aria-label={`Actual ${analysis.outcome?.label} and estimated result without the change. ${analysis.summary}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={rows} margin={{ top: 16, right: 20, bottom: 8, left: 5 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#e5e7eb" /><XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={50} tickFormatter={value => String(value).slice(0, 10)} />
        <YAxis width={70} tick={{ fontSize: 11 }} tickFormatter={value => new Intl.NumberFormat("en", { notation: "compact" }).format(Number(value))} domain={["auto", "auto"]} />
        <Tooltip formatter={(value, name) => [formatReportValue(typeof value === "number" ? value : Number(value), analysis.outcome?.currency), name]} />
        {firstAfter && period === "all" && <ReferenceLine x={firstAfter} stroke="#6b7280" strokeDasharray="3 3" label={{ value: "Measured period starts", position: "insideTopRight", fontSize: 11 }} />}
        <Line type="linear" dataKey="actual" name="Actual result" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="linear" dataKey="without_change" name="Without the change (estimate)" stroke="#b45309" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer>
    </div>
    <ul aria-label="Impact chart legend" className="flex flex-wrap gap-x-6 gap-y-2 text-xs"><li className="flex items-center gap-2"><span className="w-6 border-t-2 border-blue-600" />Actual result</li><li className="flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-amber-700" />Without the change (estimate)</li></ul>
  </figure>
}
