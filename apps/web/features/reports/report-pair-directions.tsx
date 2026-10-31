"use client"

import { useState } from "react"
import { Search, Trash2, Undo2 } from "lucide-react"
import type { CatalogDataset } from "@/features/relationships/types"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { reportPairKey, unorderedReportPairKey, type PairDirection, type ReportMetricKey, type ReportMetricPair, type ReportPairDirection } from "./pair-directions"

export function ReportPairDirections({ pairs, excludedPairs, datasets, onChange, onRemove, onRestore }: {
  pairs: ReportPairDirection[]; excludedPairs: ReportMetricPair[]; datasets: CatalogDataset[]
  onChange: (pair: ReportPairDirection, mode: PairDirection) => void
  onRemove: (pair: ReportMetricPair) => void; onRestore: (pair: ReportMetricPair) => void
}) {
  const { t } = useDecisionateText()
  const [search, setSearch] = useState("")
  function describe(metric: ReportMetricKey) {
    const dataset = datasets.find(item => item.dataset_id === metric.dataset_id)
    return { dataset: dataset?.dataset_label || `Dataset ${metric.dataset_id}`, metric: dataset?.metrics.find(item => item.metric_key === metric.metric_key)?.label || metric.metric_key.replace(/_/g, " ") }
  }
  const rows = pairs.map(pair => ({ pair, left: describe(pair.metric_a), right: describe(pair.metric_b) }))
  const visible = rows.filter(({ left, right }) => `${left.dataset} ${left.metric} ${right.dataset} ${right.metric}`.toLowerCase().includes(search.trim().toLowerCase()))
  const excluded = new Set(excludedPairs.map(unorderedReportPairKey))
  const active = visible.filter(({ pair }) => !excluded.has(unorderedReportPairKey(pair)))
  const removed = visible.filter(({ pair }) => excluded.has(unorderedReportPairKey(pair)))
  return <section aria-label={t("Metric pairs")} className="min-w-0">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h3 className="text-sm font-semibold">{t("Metric pairs")}</h3>
      {(pairs.length > 6 || search) && <div className="w-full max-w-sm"><label htmlFor="report-pair-search" className="text-xs text-gray-600">{t("Search metric pairs")}</label><div className="relative mt-1"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden="true" /><input id="report-pair-search" type="search" value={search} onChange={event => setSearch(event.target.value)} className="min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm" /></div></div>}
    </div>
    <div>
      {active.map(({ pair, left, right }) => {
        const first = `${left.dataset} / ${left.metric}`, second = `${right.dataset} / ${right.metric}`
        const firstLabel = left.metric === right.metric ? first : left.metric
        const secondLabel = left.metric === right.metric ? second : right.metric
        const options = [
          { value: "same_period", label: t("Same period only") },
          { value: "a_leads_b", label: t("Check whether {metric} comes first").replace("{metric}", firstLabel) },
          { value: "b_leads_a", label: t("Check whether {metric} comes first").replace("{metric}", secondLabel) },
        ]
        return <div key={reportPairKey(pair)} className="grid min-w-0 gap-2 border-t border-gray-100 py-3">
          <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1 space-y-1 text-sm"><p className="break-words"><span className="text-gray-500">{left.dataset}</span> / <span className="font-medium">{left.metric}</span></p><p className="break-words"><span className="text-gray-500">{right.dataset}</span> / <span className="font-medium">{right.metric}</span></p></div><button type="button" title={t("Remove relationship pair")} aria-label={`${t("Remove relationship pair")}: ${first} / ${second}`} onClick={() => onRemove(pair)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-red-700 hover:bg-red-50"><Trash2 size={16} aria-hidden="true" /></button></div>
          <label className="block min-w-0 text-xs text-gray-600">{t("Timing to test")}<select aria-label={`${t("Timing to test")}: ${first} / ${second}`} title={options.find(option => option.value === pair.direction)?.label} value={pair.direction} onChange={event => onChange(pair, event.target.value as PairDirection)} className="mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      })}
    </div>
    {removed.length > 0 && <details className="border-t border-gray-200 py-3"><summary className="cursor-pointer text-sm font-medium">{t("Removed pairs")} ({removed.length})</summary><div className="mt-2">{removed.map(({ pair, left, right }) => <div key={reportPairKey(pair)} className="flex min-w-0 items-start gap-2 border-t border-gray-100 py-3"><div className="min-w-0 flex-1 space-y-1 text-sm text-gray-500"><p className="break-words">{left.dataset} / {left.metric}</p><p className="break-words">{right.dataset} / {right.metric}</p></div><button type="button" title={t("Restore relationship pair")} aria-label={`${t("Restore relationship pair")}: ${left.dataset} / ${left.metric} / ${right.dataset} / ${right.metric}`} onClick={() => onRestore(pair)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 hover:bg-gray-50"><Undo2 size={16} aria-hidden="true" /></button></div>)}</div></details>}
    {active.length === 0 && <p role="status" className="py-4 text-sm text-gray-500">{t(search ? "No matching metric pairs." : "No relationship pairs selected.")}</p>}
  </section>
}
