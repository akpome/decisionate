"use client"

import { useState } from "react"
import { coefficientText, heatmapColor, type CorrelationMatrix } from "./types"

export function RelationshipMatrix({ matrix, onSelect }: { matrix: CorrelationMatrix; onSelect: (identity: string) => void }) {
  const [scrollTop, setScrollTop] = useState(0)
  const [focused, setFocused] = useState("")
  const [sort, setSort] = useState("source")
  const [search, setSearch] = useState("")
  const metrics = matrix.metrics.filter(metric => `${metric.label} ${metric.dataset_label}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "metric" ? a.label.localeCompare(b.label) || a.id.localeCompare(b.id) : a.dataset_label.localeCompare(b.dataset_label) || a.id.localeCompare(b.id))
  const cells = new Map(matrix.cells.flatMap(cell => [[`${cell.a}|${cell.b}`, cell], [`${cell.b}|${cell.a}`, cell]]))
  const virtual = metrics.length > 25
  const first = virtual ? Math.max(0, Math.floor(scrollTop / 56) - 3) : 0
  const last = virtual ? Math.min(metrics.length, first + 16) : metrics.length
  const columns = `144px repeat(${metrics.length}, 48px)`
  return <section aria-label="Relationship matrix" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-end gap-3"><label className="block max-w-full text-xs text-gray-500">Filter matrix<input type="search" value={search} onChange={event => { setSearch(event.target.value); setScrollTop(0) }} className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" /></label><label className="block text-xs text-gray-500">Order<select value={sort} onChange={event => setSort(event.target.value)} className="mt-1 block h-10 rounded-md border bg-white px-3 text-sm"><option value="source">Source</option><option value="metric">Metric</option></select></label></div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600" aria-label="Coefficient legend">
      {[["-1 to -0.70", -.8], ["-0.70 to -0.40", -.5], ["-0.40 to -0.05", -.1], ["-0.05 to 0.05", 0], ["0.05 to 0.40", .1], ["0.40 to 0.70", .5], ["0.70 to 1", .8], ["Insufficient", null]].map(([label, value]) => <span key={String(label)} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 border border-gray-300" style={{ backgroundColor: heatmapColor(value as number | null) }} />{label}</span>)}
    </div>
    <div className="max-h-[650px] overflow-auto border-y border-gray-200" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div role="grid" aria-label="Pairwise correlation coefficients" aria-rowcount={metrics.length + 1} aria-colcount={metrics.length + 1} style={{ minWidth: 144 + 48 * metrics.length }}>
        <div role="row" className="sticky top-0 z-20 grid bg-white" style={{ gridTemplateColumns: columns }}>
          <div role="columnheader" className="sticky left-0 z-10 flex h-14 items-center bg-white px-2 text-xs font-medium">Metric / Source</div>
          {metrics.map((metric, index) => <div role="columnheader" key={metric.id} title={`${metric.label} / ${metric.dataset_label}`} className="flex h-14 items-center justify-center border-b px-1 text-xs font-semibold">{index + 1}</div>)}
        </div>
        {first > 0 && <div aria-hidden="true" style={{ height: first * 56 }} />}
        {metrics.slice(first, last).map((metric, rowIndex) => <div role="row" aria-rowindex={first + rowIndex + 2} key={metric.id} className="grid" style={{ gridTemplateColumns: columns }}>
          <div role="rowheader" className="sticky left-0 z-10 flex h-14 min-w-0 flex-col justify-center border-b bg-white px-2 text-xs" title={`${metric.label} / ${metric.dataset_label}`}><span className="truncate font-medium">{first + rowIndex + 1}. {metric.label}</span><span className="truncate text-gray-500">{metric.dataset_label}</span></div>
          {metrics.map(other => {
            const cell = cells.get(`${metric.id}|${other.id}`)
            if (metric.id === other.id) return <div role="gridcell" key={other.id} className="flex h-14 items-center justify-center border border-white bg-gray-100 text-gray-400">-</div>
            const description = `${metric.label} (${metric.dataset_label}) / ${other.label} (${other.dataset_label}): ${coefficientText(cell?.coefficient ?? null)}, lag ${cell?.lag ?? 0} shared periods, n=${cell?.n ?? 0}, ${cell?.reliability ?? "insufficient"}`
            return <button role="gridcell" type="button" key={other.id} title={description} aria-label={description} onFocus={() => setFocused(description)} onMouseEnter={() => setFocused(description)} onClick={() => cell && onSelect(cell.result_id)} className="h-14 border border-white text-xs font-medium focus:z-10 focus:outline-2 focus:outline-blue-700" style={{ backgroundColor: heatmapColor(cell?.coefficient ?? null), color: cell?.coefficient !== null && Math.abs(cell?.coefficient ?? 0) >= .7 ? "white" : "#111827" }}>{cell?.coefficient === null || !cell ? "-" : cell.coefficient.toFixed(2)}</button>
          })}
        </div>)}
        {last < metrics.length && <div aria-hidden="true" style={{ height: (metrics.length - last) * 56 }} />}
      </div>
    </div>
    <p role="status" className="min-h-10 break-words text-xs leading-5 text-gray-600">{focused || `${matrix.method} / ${matrix.grain} / ${matrix.window.start} to ${matrix.window.end}`}</p>
  </section>
}
