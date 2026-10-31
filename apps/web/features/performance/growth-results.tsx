"use client"

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { money } from "./performance-results"
import type { GrowthResult, ValueFormat } from "./types"

export function GrowthResults({ result }: { result: GrowthResult }) {
  const currency = result.definition.kind === "cashflow" ? result.definition.currency : "CAD"
  function format(value: unknown, style: ValueFormat) {
    if (value == null) return "Not yet available"
    if (typeof value !== "number") return String(value)
    if (style === "money") return money(value, currency)
    if (style === "percent") return `${value.toFixed(1)}%`
    return value.toLocaleString("en")
  }
  const chart = result.chart, points = chart?.points || [], shown = points.slice(0, 12)
  const max = Math.max(1, ...points.map(point => point.value))
  const isCash = result.definition.kind === "cashflow"
  return <div className="min-w-0 space-y-6" aria-label="Comparison results">
    <section className="border-b border-gray-200 pb-5">
      <p className="mb-2 text-sm text-gray-600">{result.period.start} to {result.period.end}{isCash ? ` / ${currency}` : ""}</p>
      <h2 className="break-words text-xl font-semibold">{result.headline}</h2>
      <p className="mt-3 text-sm text-gray-700">{result.next_action}</p>
    </section>
    {!!result.highlights.length && <dl className="grid gap-5 border-b border-gray-200 pb-5 sm:grid-cols-2 lg:grid-cols-4">{result.highlights.map(item => <div className="min-w-0" key={item.label}>
      <dt className="text-sm text-gray-600">{item.label}</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{format(item.value, item.format)}</dd>
    </div>)}</dl>}
    {chart && points.length > 0 && <figure className="min-w-0 space-y-4" aria-label={chart.label}>
      <figcaption className="text-sm font-semibold">{chart.label}{!isCash && points.length > shown.length ? " / first 12 groups" : ""}</figcaption>
      {result.definition.kind === "cashflow" ? <div className="h-72 min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} minTickGap={40} tickFormatter={value => String(value).slice(5)} />
          <YAxis width={64} tick={{ fontSize: 11 }} tickFormatter={value => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value))} />
          <Tooltip formatter={value => money(Number(value), currency)} /><Legend />
          <ReferenceLine y={result.definition.reserve} stroke="#b45309" strokeDasharray="4 4" />
          <Line name="Planned cash" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line name="Without adjustments" dataKey="baseline" stroke="#059669" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>
        <p className="text-xs text-amber-900">Minimum cash: {money(result.definition.reserve, currency)}</p>
      </div> : <div className="max-w-4xl space-y-4">{shown.map((point, index) => <div key={`${point.name}:${index}`} className="space-y-1.5">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"><span className="min-w-0 break-words">{point.name}</span><span className="font-semibold tabular-nums">{format(point.value, chart.format)}</span></div>
        <div className="h-3 w-full overflow-hidden rounded-sm bg-gray-100" aria-hidden="true"><div className="h-full bg-emerald-600" style={{ width: `${100 * point.value / (chart.format === "percent" ? 100 : max)}%` }} /></div>
      </div>)}</div>}
    </figure>}
    {result.rows.length > 0 && <div className="overflow-x-auto border-y border-gray-200" tabIndex={0} role="region" aria-label="Detailed results">
      <table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">{result.name}</caption>
        <thead className="bg-gray-50"><tr>{result.columns.map(column => <th key={column.key} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{column.label}</th>)}<th scope="col" className="px-3 py-3 font-medium">Record checks</th></tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={`${row.name}:${index}`} className="border-t border-gray-100 align-top">
          {result.columns.map((column, at) => at === 0 ? <th key={column.key} scope="row" className="min-w-40 max-w-60 break-words px-3 py-4 font-medium">{format(row[column.key], column.format)}</th>
            : <td key={column.key} className={`whitespace-nowrap px-3 py-4 tabular-nums ${typeof row[column.key] === "number" && Number(row[column.key]) < 0 ? "text-rose-700" : ""}`}>{format(row[column.key], column.format)}</td>)}
          <td className="min-w-48 max-w-96 px-3 py-4 text-xs leading-5">{row.issues.length ? <ul className="space-y-2 text-amber-900">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : row.ready ? "Complete for the selected records" : "More follow-up is needed"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <details className="border-b border-gray-200 pb-4 text-sm"><summary className="cursor-pointer py-2 font-medium">What is included</summary>
      <ul className="list-disc space-y-2 py-3 pl-5 text-gray-600">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      <p className="text-xs text-gray-500">Calculated {result.generated_at.slice(0, 10)}. {result.analysis_id ? "Saved comparison; source updates do not change it." : "Unsaved preview."}</p>
    </details>
  </div>
}
