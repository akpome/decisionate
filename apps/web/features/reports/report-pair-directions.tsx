"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import type { CatalogDataset } from "@/features/relationships/types"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { reportPairKey, type PairDirection, type ReportMetricKey, type ReportPairDirection } from "./pair-directions"

export function ReportPairDirections({ pairs, datasets, onChange }: {
  pairs: ReportPairDirection[]; datasets: CatalogDataset[]; onChange: (pair: ReportPairDirection, mode: PairDirection) => void
}) {
  const { t } = useDecisionateText()
  const [search, setSearch] = useState("")
  function describe(metric: ReportMetricKey) {
    const dataset = datasets.find(item => item.dataset_id === metric.dataset_id)
    return { dataset: dataset?.dataset_label || `Dataset ${metric.dataset_id}`, metric: dataset?.metrics.find(item => item.metric_key === metric.metric_key)?.label || metric.metric_key.replace(/_/g, " ") }
  }
  const rows = pairs.map(pair => ({ pair, left: describe(pair.metric_a), right: describe(pair.metric_b) }))
  const visible = rows.filter(({ left, right }) => `${left.dataset} ${left.metric} ${right.dataset} ${right.metric}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section aria-label={t("Relationship directions")} className="min-w-0">
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h3 className="text-sm font-semibold">{t("Relationship directions")}</h3>
      {(pairs.length > 6 || search) && <div className="w-full max-w-sm"><label htmlFor="report-pair-search" className="text-xs text-gray-600">{t("Search metric pairs")}</label><div className="relative mt-1"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden="true" /><input id="report-pair-search" type="search" value={search} onChange={event => setSearch(event.target.value)} className="min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm" /></div></div>}
    </div>
    <div>
      {visible.map(({ pair, left, right }) => {
        const first = `${left.dataset} / ${left.metric}`, second = `${right.dataset} / ${right.metric}`
        const firstLabel = left.metric === right.metric ? first : left.metric
        const secondLabel = left.metric === right.metric ? second : right.metric
        const options = [
          { value: "same_period", label: t("Same-period comparison only") },
          { value: "a_leads_b", label: t("{metric} leads").replace("{metric}", firstLabel) },
          { value: "b_leads_a", label: t("{metric} leads").replace("{metric}", secondLabel) },
          { value: "both", label: t("Test both directions") },
        ]
        return <div key={reportPairKey(pair)} className="grid min-w-0 gap-2 border-t border-gray-100 py-3">
          <div className="min-w-0 space-y-1 text-sm"><p className="break-words"><span className="text-gray-500">{left.dataset}</span> / <span className="font-medium">{left.metric}</span></p><p className="break-words"><span className="text-gray-500">{right.dataset}</span> / <span className="font-medium">{right.metric}</span></p></div>
          <label className="block min-w-0 text-xs text-gray-600">{t("Timing comparison")}<select aria-label={`${t("Timing comparison")}: ${first} / ${second}`} title={options.find(option => option.value === pair.direction)?.label} value={pair.direction} onChange={event => onChange(pair, event.target.value as PairDirection)} className="mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      })}
    </div>
    {visible.length === 0 && <p role="status" className="py-4 text-sm text-gray-500">{t("No matching metric pairs.")}</p>}
  </section>
}
