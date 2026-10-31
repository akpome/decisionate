"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { LoaderCircle, RefreshCw } from "lucide-react"
import type { CatalogDataset, MetricRef } from "@/features/relationships/types"
import type { ImpactStudy } from "./impact-types"
import { reportDateColumn } from "./report-metric-picker"
import { ImpactTiming } from "./impact-timing"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
export function ImpactChange({ study, datasets, onChange, outcomeDate }: {
  study: ImpactStudy; datasets: CatalogDataset[]; onChange: (patch: Partial<ImpactStudy>) => void; outcomeDate?: ReactNode
}) {
  const source = datasets.find(dataset => dataset.dataset_id === study.outcome?.dataset_id)
  const metric = source?.metrics.find(metric => metric.metric_key === study.outcome?.metric_key)
  return <div className="min-w-0 space-y-4">
    <div className="grid min-w-0 gap-4 bg-gray-50 px-4 py-3 sm:grid-cols-2">
      <dl className="min-w-0"><dt className="text-xs text-gray-600">Recorded action</dt><dd className="mt-1 break-words text-sm font-medium">{study.change || "No action recorded."}</dd></dl>
      <div className={`grid min-w-0 gap-4 ${outcomeDate ? "md:grid-cols-2" : ""}`}>
        <dl className="min-w-0"><dt className="text-xs text-gray-600">Outcome metric</dt><dd className="mt-1 break-words text-sm font-medium">{metric?.label || study.outcome?.metric_key || "No result chosen."}</dd>{source && <dd className="mt-1 break-words text-xs text-gray-500">{source.dataset_label}</dd>}</dl>
        {outcomeDate}
      </div>
    </div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">When did you implement the change?<input className={input} required type="date" value={study.change_date} onChange={event => onChange({ change_date: event.target.value })} /></label>
      <label className="min-w-0 text-sm font-medium">Desired improvement<select className={input} value={study.desired_direction} onChange={event => onChange({ desired_direction: event.target.value as ImpactStudy["desired_direction"] })}><option value="increase">Increase {metric?.label || study.outcome?.metric_key || "the outcome"}</option><option value="decrease">Decrease {metric?.label || study.outcome?.metric_key || "the outcome"}</option></select></label>
    </div>
    <ImpactTiming study={study} onChange={onChange} />
  </div>
}

export function ImpactSetup({ study, datasets, metrics, onChange, onComparisonChange, onRetryDataset, comparisonFilter, comparisonDate, loading = false, retryingDataset }: {
  study: ImpactStudy; datasets: CatalogDataset[]; metrics: MetricRef[]; onChange: (patch: Partial<ImpactStudy>) => void
  onComparisonChange: (metric: MetricRef | null) => void; onRetryDataset: (dataset: CatalogDataset) => void
  comparisonFilter?: ReactNode; comparisonDate?: ReactNode; loading?: boolean; retryingDataset?: number | null
}) {
  const [pending, setPending] = useState({ decision: study.decision_id, dataset: 0 })
  const datasetId = study.comparison?.dataset_id || (pending.decision === study.decision_id ? pending.dataset : 0)
  const source = datasets.find(dataset => dataset.dataset_id === datasetId)
  const dates = source && reportDateColumn(source, metrics, {})
  const pendingSource = source?.catalog_status === "pending" || Boolean(source && retryingDataset === source.dataset_id)
  return <div className="min-w-0 space-y-4">
    <p className="text-sm leading-6 text-gray-600">A comparable store, region or business line unaffected by your action, including indirect effects.</p>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">Comparison dataset<select className={input} required value={datasetId || ""} onChange={event => {
        setPending({ decision: study.decision_id, dataset: Number(event.target.value) }); onComparisonChange(null)
      }}><option value="">Choose a comparison dataset</option>{datasets.filter(dataset => dataset.dataset_id !== study.outcome?.dataset_id).map(dataset => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.dataset_label}</option>)}</select></label>
      <label className="min-w-0 text-sm font-medium">Comparison metric<select className={input} required disabled={!source || pendingSource || Boolean(source.error_code) || !dates || !source.availability[dates]} value={study.comparison?.metric_key || ""} onChange={event => {
        const metric = source?.metrics.find(metric => metric.metric_key === event.target.value)
        if (source && metric && dates) onComparisonChange({ dataset_id: source.dataset_id, metric_key: metric.metric_key, date_column: dates, aggregation: metric.aggregation })
      }}><option value="">{pendingSource ? "Loading metrics..." : "Choose a comparison metric"}</option>{source?.metrics.map(metric => <option key={metric.metric_key} value={metric.metric_key}>{metric.label}{metric.currency ? ` (${metric.currency})` : ""}</option>)}</select></label>
    </div>
    {study.comparison && <div className="@container min-w-0"><div className="grid min-w-0 gap-4 @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">{comparisonDate}{comparisonFilter}</div></div>}
    {(loading || pendingSource) && <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} className="animate-spin" />{pendingSource ? `Loading results for ${source?.dataset_label}...` : "Loading comparison datasets..."}</p>}
    {source && !pendingSource && (source.error_code || !source.metrics.length || !dates || !source.availability[dates]) && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-900"><p>No usable result and date are available for this dataset.</p><button type="button" className="inline-flex min-h-10 items-center gap-2 text-blue-700 underline" onClick={() => onRetryDataset(source)}><RefreshCw size={16} />Retry dataset</button><Link className="text-blue-700 underline" href={`/dashboard/datasets/${source.dataset_id}`}>Review dataset</Link></div>}
    {study.comparison && <div className="space-y-4 border-t border-gray-100 pt-4">
      <label className="block text-sm font-medium">Why was this comparison not affected?<textarea className={input} required minLength={10} maxLength={1000} rows={2} placeholder="For example: Store B kept the same hours and prices." value={study.comparison_reason} onChange={event => onChange({ comparison_reason: event.target.value, comparison_unaffected: false })} /></label>
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={study.comparison_unaffected} onChange={event => onChange({ comparison_unaffected: event.target.checked })} /><span>To my knowledge, this comparison was unaffected by my action, including indirectly.</span></label>
      <label className="block text-sm font-medium">Did anything else major change at the same time?<select className={input} value={study.other_changes} onChange={event => onChange({ other_changes: event.target.value as ImpactStudy["other_changes"] })}><option value="not_sure">I am not sure yet</option><option value="none_known">No other major change that I know of</option><option value="yes">Yes, another change could affect the result</option></select></label>
      {(!study.comparison_unaffected || study.other_changes !== "none_known") && <p role="status" className="border-l-2 border-amber-400 pl-3 text-sm leading-6 text-amber-900">An impact estimate is unavailable while the comparison is unconfirmed or other major changes are known or uncertain.</p>}
    </div>}
  </div>
}
