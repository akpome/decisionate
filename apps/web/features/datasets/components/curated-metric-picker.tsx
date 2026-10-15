"use client"

import { Eraser, ListChecks, RotateCcw, Save } from "lucide-react"
import type { DatasetMetricRecommendations, MetricRecommendation } from "@/lib/api"
import { formatMetricLabel } from "@/features/dashboard/components/metric-selector"

type Props = {
  recommendations: DatasetMetricRecommendations
  selected: string[]
  dimensions: string[]
  disabled: boolean
  saving: boolean
  onChange: (columns: string[]) => void
  onSave: () => void
  onRestore: () => void
}

const metricNames: Record<string, string> = {
  ctr: "CTR",
  cpc: "CPC",
  cpa: "CPA",
  roas: "ROAS",
  record_count: "Record count",
}
const aggregationNames: Record<string, string> = {
  SUM: "Sum",
  AVG: "Average",
  LAST: "Latest value",
  AVG_WEIGHTED: "Weighted average",
  COUNT_DISTINCT: "Distinct count",
}

export function getRecommendedMetricKeys(recommendations: DatasetMetricRecommendations) {
  return [
    ...recommendations.recommended.map(metric => metric.columnKey),
    ...recommendations.derived.filter(metric => metric.defaultSelected).map(metric => metric.columnKey),
  ]
}

export function CuratedMetricPicker({ recommendations, selected, dimensions, disabled, saving, onChange, onSave, onRestore }: Props) {
  const recommended = [...recommendations.recommended, ...recommendations.derived.filter(metric => metric.defaultSelected)]
  const optional = [...recommendations.optional, ...recommendations.derived.filter(metric => !metric.defaultSelected)]
  const eligible = new Set([...recommended, ...optional].map(metric => metric.columnKey))
  const unavailable = selected.filter(column => !eligible.has(column))
  const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"

  function renderMetric(metric: MetricRecommendation) {
    const name = metricNames[metric.semanticKey] ?? formatMetricLabel(metric.columnKey)
    return <label key={metric.columnKey} className="flex min-w-0 items-start gap-3 border-b border-gray-100 py-3 last:border-0">
      <input type="checkbox" checked={selected.includes(metric.columnKey)} disabled={disabled || saving}
        onChange={event => onChange(event.target.checked ? [...selected, metric.columnKey] : selected.filter(column => column !== metric.columnKey))}
        aria-label={`Use ${name} as a metric`} className="mt-1 h-4 w-4 shrink-0 accent-blue-600" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-gray-950">{name}</span>
        <span className="block break-words text-xs leading-5 text-gray-500">{metric.reason}</span>
        {metric.formula && <span className="block break-words font-mono text-xs leading-5 text-gray-500">{metric.formula}</span>}
      </span>
      <span className="w-28 shrink-0 break-words text-right text-xs leading-5 text-gray-500">
        {aggregationNames[metric.aggregation] ?? metric.aggregation.replaceAll("_", " ")}<br />{metric.currency ?? metric.unit}
        {["AVG", "LAST", "AVG_WEIGHTED"].includes(metric.aggregation) && <span className="block text-amber-800">Non-additive</span>}
      </span>
    </label>
  }

  return <section aria-label="Metric recommendations" className="mb-5 min-w-0 border-y border-gray-200 py-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-base font-semibold">Recommended metrics</h3>
        <p className="mt-1 text-xs text-gray-500">{selected.length} selected</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={disabled || saving} onClick={() => onChange(getRecommendedMetricKeys(recommendations))}><ListChecks size={16} aria-hidden="true" />Select recommended</button>
        <button type="button" className={buttonClass} disabled={disabled || saving} onClick={() => onChange([])}><Eraser size={16} aria-hidden="true" />Clear all</button>
        <button type="button" className={buttonClass} disabled={disabled || saving} onClick={onRestore}><RotateCcw size={16} aria-hidden="true" />Restore recommended</button>
        <button type="button" className={`${buttonClass} border-blue-600 bg-blue-600 text-white`} disabled={disabled || saving || unavailable.length > 0} onClick={onSave}><Save size={16} aria-hidden="true" />{saving ? "Saving..." : "Save metrics"}</button>
      </div>
    </div>
    <fieldset disabled={disabled || saving} className="mt-3 min-w-0">
      <legend className="sr-only">Recommended metrics</legend>
      {recommended.length ? recommended.map(renderMetric) : <p className="py-3 text-sm text-gray-500">No verified recommendations for this schema.</p>}
    </fieldset>
    {recommendations.savedPolicyUnavailable && <p role="status" className="border-t border-amber-200 py-3 text-sm text-amber-900">The saved metric policy is unavailable.</p>}
    {unavailable.length > 0 && <div role="status" className="border-t border-amber-200 py-3 text-sm text-amber-900">
      <p className="font-medium">Previously selected metrics unavailable</p>
      {unavailable.map(column => <label key={column} className="mt-2 flex items-start gap-3 break-all"><input type="checkbox" checked disabled={disabled || saving} onChange={() => onChange(selected.filter(value => value !== column))} className="mt-1 h-4 w-4 shrink-0" />{column}</label>)}
    </div>}
    {optional.length > 0 && <details className="border-t border-gray-200 py-3">
      <summary className="cursor-pointer text-sm font-medium">More metrics ({optional.length})</summary>
      <fieldset disabled={disabled || saving} className="min-w-0"><legend className="sr-only">Optional metrics</legend>{optional.map(renderMetric)}</fieldset>
    </details>}
    {dimensions.length > 0 && <details className="border-t border-gray-200 pt-3">
      <summary className="cursor-pointer text-sm font-medium">Dimensions ({dimensions.length})</summary>
      <ul className="mt-3 grid min-w-0 gap-2 text-sm text-gray-600 sm:grid-cols-2">{dimensions.map(column => <li key={column} className="break-words">{formatMetricLabel(column)}</li>)}</ul>
    </details>}
  </section>
}
