"use client"

import { useDeferredValue, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { LoaderCircle, RefreshCw, Search, X } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { metricIdentity, type CatalogDataset, type CatalogMetricIssue, type MetricRef } from "@/features/relationships/types"
import { DatasetDimensionFilter } from "@/features/datasets/components/dimension-filter"
import type { DatasetDimensionFilter as DimensionSelection, DimensionFilter } from "@/lib/api"

const issueLabels: Record<string, string> = {
  selection_not_saved: "Metric selection not saved.",
  no_eligible_defaults: "No supported metric defaults match this dataset.",
  no_metrics_selected: "No metrics selected for this dataset.",
  transaction_policy_required: "Transaction totals are not configured for analysis.",
  column_unavailable: "Saved column no longer available.",
  identifier_field: "Identifier, not a business measure.",
  formula_required: "Calculation components not configured.",
  summary_policy_required: "Stored summaries have no supported aggregation rule.",
  aggregation_unconfirmed: "Aggregation rule not confirmed.",
  currency_unresolved: "Mixed, missing or invalid currency codes.",
  insufficient_values: "Fewer than two valid numeric values.",
  date_field_missing: "No date field detected.",
  date_values_unavailable: "No usable date values.",
}

export function reportDateColumn(dataset: CatalogDataset, metrics: MetricRef[], overrides: Record<number, string>) {
  return metrics.find(metric => metric.dataset_id === dataset.dataset_id)?.date_column || overrides[dataset.dataset_id] || dataset.date_columns.find(column => dataset.availability[column]) || dataset.date_columns[0] || ""
}

export function filterReportDatasets(datasets: CatalogDataset[], search: string) {
  const query = search.trim().toLowerCase()
  return datasets.flatMap(dataset => {
    if (!query || `${dataset.dataset_label} ${dataset.connector}`.toLowerCase().includes(query)) return [dataset]
    const metrics = dataset.metrics.filter(metric => `${metric.label} ${metric.metric_key}`.toLowerCase().includes(query))
    return metrics.length ? [{ ...dataset, metrics }] : []
  })
}

export function ReportMetricPicker({ datasets, metrics, dateColumns, onToggleMetric, onDateColumnChange, loading = false, error = false, onRetry, onRetryDataset, retryingDataset = null, footer, singleDataset = false, userId, workspaceId, dimensionFilters = [], onDimensionFilterChange, lockedMetric }: {
  datasets: CatalogDataset[]
  metrics: MetricRef[]
  dateColumns: Record<number, string>
  onToggleMetric: (dataset: CatalogDataset, key: string) => void
  onDateColumnChange: (dataset: CatalogDataset, column: string) => void
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onRetryDataset?: (dataset: CatalogDataset) => void
  retryingDataset?: number | null
  footer?: ReactNode
  singleDataset?: boolean
  userId?: string
  workspaceId?: string
  dimensionFilters?: DimensionSelection[]
  onDimensionFilterChange?: (datasetId: number, filter: DimensionFilter | undefined) => void
  lockedMetric?: { dataset_id: number; metric_key: string } | null
}) {
  const { t } = useDecisionateText()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const visible = useMemo(() => filterReportDatasets(datasets, deferredSearch), [datasets, deferredSearch])
  const selected = useMemo(() => new Set(metrics.map(metricIdentity)), [metrics])
  const counts = useMemo(() => {
    const result = new Map<number, number>()
    for (const metric of metrics) result.set(metric.dataset_id, (result.get(metric.dataset_id) || 0) + 1)
    return result
  }, [metrics])
  const issueText = (issue: CatalogMetricIssue) => t(issueLabels[issue.code] || "Metric unavailable for this analysis.")

  return <section aria-label={t("Datasets and metrics")} className="report-builder-section">
    <div className="mb-4 shrink-0 space-y-4">
      <h2 className="text-base font-semibold">{t("Datasets and metrics")}</h2>
      <div className="w-full max-w-sm">
        <label className="block text-xs font-medium text-gray-600" htmlFor="report-metric-search">{t("Search datasets and metrics")}</label>
        <div className="relative mt-1 flex items-center">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 text-gray-400" />
          <input id="report-metric-search" className="min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white py-2 pl-9 pr-11 text-sm text-gray-950 [&::-webkit-search-cancel-button]:appearance-none" type="search" placeholder={t("Dataset or metric name")} value={search} onChange={event => setSearch(event.target.value)} />
          {search && <button type="button" className="absolute right-0 inline-flex h-10 w-10 items-center justify-center text-gray-500 hover:text-gray-950" aria-label={t("Clear search")} title={t("Clear search")} onClick={() => setSearch("")}><X size={16} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
    {error && <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 border-l-2 border-amber-500 pl-3 text-sm text-amber-900"><p role="alert">{t("Dataset list could not be loaded. Your selections are unchanged.")}</p>{onRetry && <button type="button" disabled={loading} onClick={onRetry} className="inline-flex min-h-10 items-center gap-2 font-medium text-blue-700 underline disabled:opacity-50"><RefreshCw size={16} aria-hidden="true" />{t("Retry")}</button>}</div>}
    {loading && <p role="status" className="mb-3 flex shrink-0 items-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} aria-hidden="true" className="animate-spin" />{t(datasets.length ? "Loading metrics..." : "Loading datasets...")}</p>}
    <div role="group" aria-label={t("Datasets and metrics")} aria-busy={search !== deferredSearch} tabIndex={0} className="report-builder-scroll space-y-1 pr-2 focus-visible:outline-2 focus-visible:outline-blue-600">
      {visible.map(dataset => {
        const count = counts.get(dataset.dataset_id) || 0
        const dateColumn = reportDateColumn(dataset, metrics, dateColumns)
        const usableDate = Boolean(dataset.availability[dateColumn])
        const datasetIssues = (dataset.metric_issues || []).filter(issue => !issue.metric_key)
        const metricIssues = (dataset.metric_issues || []).filter(issue => issue.metric_key)
        const dates = dataset.date_columns.filter(column => dataset.availability[column])
        const showDate = dataset.metrics.length > 0 && dates.length > 0
        const showDimension = dataset.metrics.length > 0 && Boolean(userId && onDimensionFilterChange)
        const unavailable = Boolean(dataset.error_code)
        const pending = dataset.catalog_status === "pending" || retryingDataset === dataset.dataset_id
        return <fieldset key={dataset.dataset_id} className="min-w-0 border-b border-gray-200 py-4">
          <legend className="max-w-full break-words text-sm font-semibold">{dataset.dataset_label}<span className="ml-2 text-xs font-normal text-gray-500">{dataset.connector}</span></legend>
          {pending ? <p role={retryingDataset === dataset.dataset_id ? "status" : undefined} className="mt-2 flex items-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />{t("Loading metrics...")}</p> : unavailable ? <div className="mt-2 flex flex-wrap items-center gap-3 text-sm"><p className="text-amber-800">{t("Dataset temporarily unavailable.")}</p>{(onRetryDataset || onRetry) && <button type="button" disabled={loading || retryingDataset !== null} onClick={() => onRetryDataset ? onRetryDataset(dataset) : onRetry?.()} aria-label={`${t("Retry")}: ${dataset.dataset_label}`} className="inline-flex min-h-10 items-center gap-2 font-medium text-blue-700 underline disabled:opacity-50"><RefreshCw size={16} aria-hidden="true" />{t("Retry")}</button>}</div> : <>
            {(showDate || showDimension) && <div className="@container mt-3 min-w-0">
              <div className={`grid min-w-0 items-start gap-3 ${showDate && showDimension ? "@min-[28rem]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]" : ""}`}>
                {showDate && <div className="min-w-0 max-w-sm">
                  <label htmlFor={`report-date-column-${dataset.dataset_id}`} className="block text-xs font-medium text-gray-600">{t("Date column")}</label>
                  <select id={`report-date-column-${dataset.dataset_id}`} className="mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950" value={dateColumn} onChange={event => onDateColumnChange(dataset, event.target.value)}>
                    {!usableDate && <option value={dateColumn} disabled>{t("Selected date field unavailable.")}</option>}
                    {dates.map(column => <option key={column} value={column}>{column}</option>)}
                  </select>
                  {dataset.availability[dateColumn] && <p className="mt-1 text-xs text-gray-500">{dataset.availability[dateColumn].start} / {dataset.availability[dateColumn].end}</p>}
                </div>}
                {showDimension && userId && onDimensionFilterChange && <DatasetDimensionFilter key={`${userId}:${workspaceId}:${dataset.dataset_id}`} datasetId={dataset.dataset_id} userId={userId} workspaceId={workspaceId} deferLoad embedded value={dimensionFilters.find(item => item.dataset_id === dataset.dataset_id)} onChange={value => onDimensionFilterChange(dataset.dataset_id, value)} />}
              </div>
            </div>}
            {dataset.metrics.length > 0 ? <div className="mt-2 grid min-w-0 gap-x-4 gap-y-1 sm:grid-cols-2">
              {dataset.metrics.map(metric => {
                const checked = selected.has(metricIdentity(metric))
                return <label key={metric.metric_key} className="flex min-h-11 min-w-0 items-start gap-3 py-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" title={lockedMetric && metricIdentity(lockedMetric) === metricIdentity(metric) ? "Outcome metric from the decision" : undefined} disabled={Boolean(lockedMetric && metricIdentity(lockedMetric) === metricIdentity(metric)) || !checked && (!usableDate || (singleDataset ? count : metrics.length) >= 25)} checked={checked} onChange={() => onToggleMetric(dataset, metric.metric_key)} />
                  <span className="min-w-0 break-words">{metric.label}<span className="block text-xs text-gray-500">{metric.currency || metric.unit} / {metric.aggregation}</span></span>
                </label>
              })}
            </div> : <p className="mt-2 text-sm font-medium text-gray-700">{t("No report-ready metrics.")}</p>}
            {datasetIssues.map(issue => <p key={issue.code} className="mt-2 text-sm text-amber-800">{issueText(issue)}</p>)}
            {!usableDate && !datasetIssues.some(issue => ["date_field_missing", "date_values_unavailable"].includes(issue.code)) && <p className="mt-2 text-sm text-amber-800">{t(dates.length ? "Selected date field unavailable." : "No usable date values.")}</p>}
            {metricIssues.length > 0 && <details className="mt-2 text-sm"><summary className="min-h-10 cursor-pointer py-2 font-medium text-gray-600">{t("Unavailable metrics")} ({metricIssues.length})</summary><ul className="space-y-2 border-l-2 border-amber-200 pl-3 text-gray-600">{metricIssues.map(issue => <li key={`${issue.metric_key}:${issue.code}`} className="break-words"><span className="font-medium">{issue.metric_key}</span>: {issueText(issue)}</li>)}</ul></details>}
            {count > 0 && <p className="mt-3 border-t border-gray-100 pt-3 text-xs font-medium text-blue-800">{t("Selected metrics")}: {count}</p>}
          </>}
          {!pending && (unavailable || !dataset.metrics.length || !usableDate || metricIssues.length > 0) && <Link href={`/dashboard/datasets/${dataset.dataset_id}`} className="mt-2 inline-flex min-h-10 items-center text-sm font-medium text-blue-700 underline">{t("Review dataset")}</Link>}
        </fieldset>
      })}
      {visible.length === 0 && (datasets.length > 0 || !loading && !error) && <div className="border-y border-gray-200 py-8 text-sm text-gray-600"><p role="status">{t(datasets.length ? "No matching datasets or metrics." : "No datasets available.")}</p>{datasets.length === 0 && <Link href="/dashboard/datasets" className="mt-2 inline-flex min-h-10 items-center font-medium text-blue-700 underline">{t("Open datasets")}</Link>}</div>}
    </div>
    {footer && <div className="mt-3 shrink-0">{footer}</div>}
  </section>
}
