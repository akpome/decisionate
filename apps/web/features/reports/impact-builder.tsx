"use client"

import type { ReactNode } from "react"
import { CheckCircle2, CircleHelp, RefreshCw, X } from "lucide-react"
import type { CatalogDataset } from "@/features/relationships/types"
import { DatasetDimensionFilter } from "@/features/datasets/components/dimension-filter"
import type { ReportDefinition } from "./types"
import type { ImpactStudy } from "./impact-types"
import { ImpactChange, ImpactSetup } from "./impact-setup"
import { changeImpactComparison, impactSetupIssue } from "./impact-builder-state"
import { reportDateColumn } from "./report-metric-picker"
import type { WeeklySettings } from "./weekly-settings"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"

export function ImpactBuilder({ definition, datasets, userId, workspaceId, weekly, weeklySettings, decisionPicker, reportDetails, actions,
  loading, catalogError, retryingDataset, footer, onChange, onStudyChange, onRetry, onRetryDataset }: {
  definition: ReportDefinition; datasets: CatalogDataset[]; userId: string; workspaceId?: string
  weekly: boolean; weeklySettings: WeeklySettings | null; decisionPicker: ReactNode; reportDetails: ReactNode; actions: ReactNode
  loading: boolean; catalogError: boolean; retryingDataset?: number | null; footer: ReactNode
  onChange: (patch: Partial<ReportDefinition>) => void; onStudyChange: (patch: Partial<ImpactStudy>) => void
  onRetry: () => void; onRetryDataset: (dataset: CatalogDataset) => void
}) {
  const study = definition.impact
  if (!study) return null
  const issue = impactSetupIssue(definition, datasets)
  const roles = [study.outcome, study.comparison].filter(item => item !== null)
  const extras = definition.metrics.filter(metric => !roles.some(role => role?.dataset_id === metric.dataset_id && role.metric_key === metric.metric_key))
  const selectedDatasets = [...new Set(definition.metrics.map(metric => metric.dataset_id))]
  return <section aria-label="Check a decision" className="min-w-0 space-y-6">
    <section aria-labelledby="impact-decision-heading" className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
      <h2 id="impact-decision-heading" className="text-base font-semibold">1. Which decision are you checking?</h2>
      {decisionPicker}
      {study.decision_id && <ImpactChange study={study} datasets={datasets} onChange={onStudyChange} />}
    </section>
    {study.decision_id && study.outcome && <section aria-labelledby="impact-comparison-heading" className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
      <h2 id="impact-comparison-heading" className="text-base font-semibold">2. What can we fairly compare it with?</h2>
      {catalogError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-900"><p>Some datasets could not be loaded. Your choices are unchanged.</p><button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-2 text-blue-700 underline"><RefreshCw size={16} />Retry datasets</button></div>}
      <ImpactSetup study={study} datasets={datasets} metrics={definition.metrics} onChange={onStudyChange}
        onComparisonChange={metric => onChange(changeImpactComparison(definition, metric))} onRetryDataset={onRetryDataset}
        onExplore={() => onChange({ impact: null })} loading={loading} retryingDataset={retryingDataset} />
      {footer}
    </section>}
    {study.decision_id && study.comparison && <section aria-labelledby="impact-history-heading" className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
      <h2 id="impact-history-heading" className="text-base font-semibold">3. Which dates should we check?</h2>
      {weekly ? <div className="space-y-2 text-sm"><p>Report week: {weeklySettings?.window.start} to {weeklySettings?.window.end}</p><p className="text-gray-600">Impact history: {weeklySettings?.history_window.start} to {weeklySettings?.window.end}, compared week by week.</p></div> : <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-medium">History starts<input className={input} required type="date" max={study.change_date || definition.date_range.end || undefined} value={definition.date_range.start} onChange={event => onChange({ date_range: { ...definition.date_range, start: event.target.value } })} /></label>
        <label className="min-w-0 text-sm font-medium">History ends<input className={input} required type="date" min={study.change_date || definition.date_range.start || undefined} value={definition.date_range.end} onChange={event => onChange({ date_range: { ...definition.date_range, end: event.target.value } })} /></label>
        <label className="min-w-0 text-sm font-medium">Compare results by<select className={input} value={definition.grain} onChange={event => onChange({ grain: event.target.value })}><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></label>
      </div>}
      <p className="text-sm leading-6 text-gray-600">Minimum history: {definition.grain === "daily" ? "90 days before the change and 28 days after." : definition.grain === "weekly" ? "52 full weeks before the change and 8 weeks after." : "24 full months before the change and 6 months after."} Both results need matching records.</p>
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={definition.seasonal_business} onChange={event => onChange({ seasonal_business: event.target.checked })} /><span>This business has busy and quiet seasons.</span></label>
      {definition.seasonal_business && <p className="text-sm leading-6 text-gray-600">Seasonal businesses need about two years of records before the change.</p>}
      <details className="min-w-0 border-t border-gray-100 pt-3"><summary className="cursor-pointer text-sm font-medium">Date columns and filters{definition.dimension_filters?.some(filter => selectedDatasets.includes(filter.dataset_id)) ? " (filters applied)" : ""}</summary>
        <div className="mt-4 space-y-5">{selectedDatasets.map(identity => {
          const source = datasets.find(dataset => dataset.dataset_id === identity)
          if (!source) return <p key={identity} className="text-sm text-amber-900">Dataset {identity} is not available yet.</p>
          const column = reportDateColumn(source, definition.metrics, {})
          return <fieldset key={identity} className="@container min-w-0 space-y-3 border-b border-gray-100 pb-4">
            <legend className="max-w-full break-words text-sm font-medium">{source.dataset_label}</legend>
            <div className="grid min-w-0 gap-4 @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
              <label className="min-w-0 text-xs font-medium text-gray-600">Date column<select className={input} required value={column} onChange={event => onChange({ metrics: definition.metrics.map(metric => metric.dataset_id === identity ? { ...metric, date_column: event.target.value } : metric) })}>
                {!source.date_columns.includes(column) && <option value={column} disabled>Selected date unavailable</option>}
                {source.date_columns.map(date => <option key={date} value={date}>{date}</option>)}
              </select>{source.availability[column] && <span className="mt-1 block text-xs font-normal text-gray-500">{source.availability[column].start} to {source.availability[column].end}</span>}</label>
              <DatasetDimensionFilter key={`${userId}:${workspaceId}:${identity}`} datasetId={identity} userId={userId} workspaceId={workspaceId} embedded deferLoad value={definition.dimension_filters?.find(filter => filter.dataset_id === identity)} onChange={filter => onChange({ dimension_filters: [
                ...(definition.dimension_filters || []).filter(item => item.dataset_id !== identity), ...(filter ? [{ dataset_id: identity, ...filter }] : []),
              ] })} />
            </div>
          </fieldset>
        })}</div>
      </details>
      <details className="min-w-0 border-t border-gray-100 pt-3"><summary className="cursor-pointer text-sm font-medium">Business target (optional){study.worthwhile_change != null ? " (set)" : ""}</summary><label className="mt-3 block max-w-md text-sm font-medium">Smallest improvement worth the cost<input className={input} type="number" min={0} max={1e15} step="any" value={study.worthwhile_change ?? ""} onChange={event => onStudyChange({ worthwhile_change: event.target.value === "" ? null : Number(event.target.value) })} /><span className="mt-1 block text-xs font-normal leading-5 text-gray-600">In the result&apos;s units, not a percentage. Total improvement for orders or revenue; improvement per period for an average or rate. Costs are not deducted.</span></label></details>
    </section>}
    {extras.length > 0 && <details className="min-w-0 border-t border-gray-200 pt-4"><summary className="cursor-pointer text-sm font-medium">Other selected results ({extras.length})</summary><ul className="mt-3 divide-y divide-gray-100">{extras.map(metric => {
      const dataset = datasets.find(dataset => dataset.dataset_id === metric.dataset_id)
      return <li key={`${metric.dataset_id}:${metric.metric_key}`} className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words">{dataset?.dataset_label || `Dataset ${metric.dataset_id}`} / {dataset?.metrics.find(item => item.metric_key === metric.metric_key)?.label || metric.metric_key}</span><button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300" title="Remove extra result" aria-label={`Remove extra result: ${metric.metric_key}`} onClick={() => onChange({ metrics: definition.metrics.filter(item => item !== metric) })}><X size={16} /></button></li>
    })}</ul></details>}
    <details className="min-w-0 border-t border-gray-200 pt-4"><summary className="cursor-pointer text-sm font-medium">Report details</summary><div className="mt-4">{reportDetails}</div></details>
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-4">
      <p role="status" className="flex min-w-0 items-start gap-2 text-sm text-gray-600">{issue ? <CircleHelp size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-700" />}<span className="min-w-0 break-words">{issue || "Ready to check the decision. The data will still need to pass the comparison checks."}</span></p>
      <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">{actions}</div>
    </div>
  </section>
}
