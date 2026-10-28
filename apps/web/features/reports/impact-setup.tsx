"use client"

import Link from "next/link"
import type { CatalogDataset, MetricRef } from "@/features/relationships/types"
import type { ImpactStudy } from "./impact-types"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
const key = (value: { dataset_id: number; metric_key: string } | null) => value ? `${value.dataset_id}:${value.metric_key}` : ""

export function ImpactChange({ study, onChange }: { study: ImpactStudy; onChange: (patch: Partial<ImpactStudy>) => void }) {
  return <section aria-label="Your business change" className="grid min-w-0 gap-4 border-y border-gray-200 py-4 sm:grid-cols-[minmax(0,1fr)_200px]">
    <div className="min-w-0 space-y-2 text-sm"><h3 className="font-medium">Decision action</h3><p className="break-words leading-6">{study.decision_id ? study.change || "No action recorded." : "Choose a decision to review."}</p>{study.decision_id && <Link className="text-xs text-blue-700 underline" href={`/dashboard/decisions/${study.decision_id}#decision-title`}>Edit this action on the decision</Link>}</div>
    <label className="min-w-0 text-sm font-medium">When did the action actually start?<input className={input} required type="date" value={study.change_date} onChange={event => onChange({ change_date: event.target.value })} /></label>
  </section>
}

export function ImpactSetup({ study, datasets, metrics, onChange }: {
  study: ImpactStudy; datasets: CatalogDataset[]; metrics: MetricRef[]; onChange: (patch: Partial<ImpactStudy>) => void
}) {
  const selected = metrics.map(metric => {
    const dataset = datasets.find(item => item.dataset_id === metric.dataset_id)
    const descriptor = dataset?.metrics.find(item => item.metric_key === metric.metric_key)
    return { ...metric, label: `${dataset?.dataset_label || `Dataset ${metric.dataset_id}`} / ${descriptor?.label || metric.metric_key}` }
  })
  const choose = (value: string) => {
    const found = selected.find(item => key(item) === value)
    return found ? { dataset_id: found.dataset_id, metric_key: found.metric_key } : null
  }
  const comparisons = selected.filter(item => item.dataset_id !== study.outcome?.dataset_id)
  return <section aria-label="Measure the business change" className="min-w-0 space-y-4">
    <h3 className="text-sm font-semibold">Did the change help?</h3>
    <div className="space-y-2 text-sm"><p className="text-xs font-medium text-gray-700">Outcome from the decision</p><p className="break-words">{selected.find(item => key(item) === key(study.outcome))?.label || "Choose an outcome metric in Decision Details."}</p>{study.decision_id && <Link className="text-xs text-blue-700 underline" href={`/dashboard/decisions/${study.decision_id}#decision-title`}>Open Decision Details</Link>}</div>
    <label className="block text-xs font-medium text-gray-700">What would be better?<select className={input} value={study.desired_direction} onChange={event => onChange({ desired_direction: event.target.value as ImpactStudy["desired_direction"] })}><option value="increase">More of this result</option><option value="decrease">Less of this result</option></select></label>
    <label className="block min-w-0 text-xs font-medium text-gray-700">What can we compare it with?<select className={input} required value={key(study.comparison)} onChange={event => onChange({ comparison: choose(event.target.value), comparison_unaffected: false })}><option value="">Choose from another dataset</option>{comparisons.map(item => <option key={key(item)} value={key(item)}>{item.label}</option>)}</select></label>
    <p className="text-xs leading-5 text-gray-600">A similar store or region that did not make the change can be useful. Spending is not an unaffected comparison if your change increased that spending.</p>
    <label className="block text-xs font-medium text-gray-700">Why was the comparison unaffected?<textarea className={input} required minLength={10} maxLength={1000} rows={3} value={study.comparison_reason} onChange={event => onChange({ comparison_reason: event.target.value, comparison_unaffected: false })} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={study.comparison_unaffected} onChange={event => onChange({ comparison_unaffected: event.target.checked })} /><span>I have checked that the change did not affect this comparison, directly or indirectly.</span></label>
    <label className="block text-xs font-medium text-gray-700">Did anything else major change at the same time?<select className={input} value={study.other_changes} onChange={event => onChange({ other_changes: event.target.value as ImpactStudy["other_changes"] })}><option value="not_sure">I am not sure yet</option><option value="none_known">No other major change that I know of</option><option value="yes">Yes, another change could affect the result</option></select></label>
    <label className="block text-xs font-medium text-gray-700">Minimum worthwhile improvement (optional)<input className={input} type="number" min={0} max={1e15} step="any" value={study.worthwhile_change ?? ""} onChange={event => onChange({ worthwhile_change: event.target.value === "" ? null : Number(event.target.value) })} /><span className="mt-1 block font-normal leading-5 text-gray-500">In the result&apos;s own units: total extra orders or revenue, or improvement per period for an average or rate. Costs are not deducted automatically.</span></label>
  </section>
}
