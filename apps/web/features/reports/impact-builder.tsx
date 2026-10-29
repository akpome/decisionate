"use client"

import type { ReactNode } from "react"
import { CheckCircle2, CircleHelp, RefreshCw, X } from "lucide-react"
import type { CatalogDataset } from "@/features/relationships/types"
import { DatasetDimensionFilter, dimensionFilterLabel } from "@/features/datasets/components/dimension-filter"
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
  const selectedDatasets = [...new Set(roles.map(role => role!.dataset_id))]
  const outcomeFilter = definition.dimension_filters?.find(filter => filter.dataset_id === study.outcome?.dataset_id)
  const comparisonSource = datasets.find(dataset => dataset.dataset_id === study.comparison?.dataset_id)
  const comparisonColumn = comparisonSource ? reportDateColumn(comparisonSource, definition.metrics, {}) : ""
  return <section aria-label="Check a decision" className="min-w-0 space-y-6">
    <section aria-labelledby="impact-decision-heading" className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
      <h2 id="impact-decision-heading" className="text-base font-semibold">1. Which decision are you checking?</h2>
      {decisionPicker}
      {study.decision_id && !weekly && <p aria-label="Decision data period" className="text-sm text-gray-600">Analysis period: {definition.date_range.start && definition.date_range.end ? `${definition.date_range.start} to ${definition.date_range.end}` : "Not available"}.</p>}
      {study.decision_id && <ImpactChange study={study} datasets={datasets} onChange={onStudyChange} />}
      {study.decision_id && outcomeFilter && <div className="flex min-w-0 items-center gap-2 text-sm text-gray-600"><p className="min-w-0 break-words">Outcome segment: {dimensionFilterLabel(outcomeFilter)}</p><button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300" title="Clear outcome filter" aria-label="Clear outcome filter" onClick={() => onChange({ dimension_filters: definition.dimension_filters?.filter(filter => filter !== outcomeFilter) })}><X size={16} /></button></div>}
    </section>
    {study.decision_id && study.outcome && <section aria-labelledby="impact-comparison-heading" className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
      <h2 id="impact-comparison-heading" className="text-base font-semibold">2. What can we fairly compare it with?</h2>
      {catalogError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-900"><p>Some datasets could not be loaded. Your choices are unchanged.</p><button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-2 text-blue-700 underline"><RefreshCw size={16} />Retry datasets</button></div>}
      <ImpactSetup study={study} datasets={datasets} metrics={definition.metrics} onChange={onStudyChange}
        onComparisonChange={metric => onChange(changeImpactComparison(definition, metric))} onRetryDataset={onRetryDataset}
        comparisonDate={comparisonSource && <label className="min-w-0 text-xs font-medium text-gray-600">Date column<select className={input} required value={comparisonColumn} onChange={event => onChange({ metrics: definition.metrics.map(metric => metric.dataset_id === comparisonSource.dataset_id ? { ...metric, date_column: event.target.value } : metric) })}>
          {!comparisonSource.date_columns.includes(comparisonColumn) && <option value={comparisonColumn} disabled>Selected date unavailable</option>}
          {comparisonSource.date_columns.map(date => <option key={date} value={date}>{date}</option>)}
        </select></label>}
        comparisonFilter={study.comparison && <DatasetDimensionFilter key={`${userId}:${workspaceId}:${study.comparison.dataset_id}`} datasetId={study.comparison.dataset_id} userId={userId} workspaceId={workspaceId} embedded singleValue value={definition.dimension_filters?.find(filter => filter.dataset_id === study.comparison?.dataset_id)} onChange={filter => onChange({ dimension_filters: [
          ...(definition.dimension_filters || []).filter(item => item.dataset_id !== study.comparison?.dataset_id), ...(filter ? [{ dataset_id: study.comparison!.dataset_id, ...filter }] : []),
        ] })} />}
        onExplore={() => onChange({ impact: null })} loading={loading} retryingDataset={retryingDataset} />
      {footer}
    </section>}
    {study.decision_id && study.comparison && <section aria-labelledby="impact-history-heading" className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
      <h2 id="impact-history-heading" className="text-base font-semibold">3. Check the analysis</h2>
      {weekly ? <div className="space-y-2 text-sm"><p>Report week: {weeklySettings?.window.start} to {weeklySettings?.window.end}</p><p className="text-gray-600">Impact history: {weeklySettings?.history_window.start} to {weeklySettings?.window.end}, compared week by week.</p></div> : <p className="text-sm text-gray-600">Compared {definition.grain === "daily" ? "day by day" : definition.grain === "weekly" ? "week by week" : "month by month"}.</p>}
      <p className="text-sm text-gray-600">Baseline: the comparison&apos;s usual movement, checked against earlier records.</p>
      <details className="min-w-0 border-t border-gray-100 pt-3"><summary className="cursor-pointer text-sm font-medium">Analysis settings</summary>
        <div className="mt-4 space-y-4">
          {!weekly && <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <label className="min-w-0 text-sm font-medium">History starts<input className={input} required type="date" max={study.change_date || definition.date_range.end || undefined} value={definition.date_range.start} onChange={event => onChange({ date_range: { ...definition.date_range, start: event.target.value } })} /></label>
            <label className="min-w-0 text-sm font-medium">History ends<input className={input} required type="date" min={study.change_date || definition.date_range.start || undefined} value={definition.date_range.end} onChange={event => onChange({ date_range: { ...definition.date_range, end: event.target.value } })} /></label>
            <label className="min-w-0 text-sm font-medium">Compare results by<select className={input} value={definition.grain} onChange={event => onChange({ grain: event.target.value })}><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></label>
          </div>}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">{selectedDatasets.filter(identity => identity === study.outcome?.dataset_id).map(identity => {
            const source = datasets.find(dataset => dataset.dataset_id === identity)
            if (!source) return <p key={identity} className="text-sm text-amber-900">Dataset {identity} is not available yet.</p>
            const column = reportDateColumn(source, definition.metrics, {})
            return <label key={identity} className="min-w-0 break-words text-xs font-medium text-gray-600">{source.dataset_label} / Date column<select className={input} required value={column} onChange={event => {
              const metrics = definition.metrics.map(metric => metric.dataset_id === identity ? { ...metric, date_column: event.target.value } : metric)
              onChange({ metrics })
            }}>
              {!source.date_columns.includes(column) && <option value={column} disabled>Selected date unavailable</option>}
              {source.date_columns.map(date => <option key={date} value={date}>{date}</option>)}
            </select></label>
          })}</div>
          <p className="text-sm leading-6 text-gray-600">Minimum history: {definition.grain === "daily" ? "90 days before the change and 28 days after." : definition.grain === "weekly" ? "52 full weeks before the change and 8 weeks after." : "24 full months before the change and 6 months after."} Both results need matching records.</p>
        </div>
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
