"use client"

import { useEffect, useState } from "react"
import { ChevronDown, RefreshCw } from "lucide-react"
import { SearchableSelect } from "@/components/searchable-select"
import { DatasetDimensionFilter } from "@/features/datasets/components/dimension-filter"
import type { CatalogDataset } from "@/features/relationships/types"
import { correlationRequest, getDatasetDimensions } from "@/lib/api"
import { blankAmount, type AmountSelection } from "./types"

export const field = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 disabled:opacity-50"
const buttonBase = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
export const command = `${buttonBase} border-gray-300 bg-white`
export const primary = `${buttonBase} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`
export type SourceContext = { userId: string; workspaceId?: string }
type Catalog = { datasets: CatalogDataset[]; next_offset: number | null }

export function WrappingSelect({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void
}) {
  return <label className="block min-w-0 text-xs font-medium text-gray-600">{label}
    <span className="relative mt-1 block rounded-md focus-within:ring-2 focus-within:ring-blue-100">
      <select aria-label={label} className={`${field} peer block mt-0! opacity-0!`} value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-0.5 text-sm font-normal leading-4 text-gray-950 peer-focus:border-blue-600 peer-disabled:opacity-50">
        <span className="min-w-0 flex-1 break-words">{options.find(option => option.value === value)?.label}</span><ChevronDown size={16} className="shrink-0" />
      </span>
    </span>
  </label>
}

export function useAmountDataset(datasetId: number, { userId, workspaceId }: SourceContext) {
  const [dataset, setDataset] = useState<CatalogDataset | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!datasetId) return
    const controller = new AbortController()
    void correlationRequest<Catalog>(userId, `/business-reports/catalog?dataset_id=${datasetId}`, { signal: controller.signal }, workspaceId)
      .then(data => {
        if (controller.signal.aborted) return
        if (!data.datasets[0] || data.datasets[0].error_code) throw new Error("Dataset details could not be loaded.")
        setDataset(data.datasets[0]); setError("")
      }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [datasetId, userId, workspaceId, revision])
  return { dataset: dataset?.dataset_id === datasetId ? dataset : null, error, retry: () => setRevision(value => value + 1) }
}

export function DatasetChoice({ label, value, selectedLabel, onChange, userId, workspaceId }: SourceContext & {
  label: string; value: number; selectedLabel?: string; onChange: (id: number) => void
}) {
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Catalog>({ datasets: [], next_offset: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      void correlationRequest<Catalog>(userId, `/business-reports/catalog?metadata_only=true&offset=${offset}&search=${encodeURIComponent(search)}`, { signal: controller.signal }, workspaceId)
        .then(data => { if (!controller.signal.aborted) { setPage(previous => ({ ...data, datasets: offset ? [...previous.datasets, ...data.datasets] : data.datasets })); setError("") } })
        .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, search ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [userId, workspaceId, search, offset, revision])
  return <SearchableSelect label={label} value={value ? String(value) : null} selectedLabel={selectedLabel}
    options={page.datasets.map(item => ({ value: String(item.dataset_id), label: item.dataset_label }))} loading={loading}
    placeholder="Choose or search datasets" onSearchChange={text => { setSearch(text); setOffset(0) }} onChange={id => onChange(Number(id))}
    footer={error ? <div role="alert" className="text-sm text-red-700">{error}<button type="button" title="Retry datasets" aria-label="Retry datasets" className={command} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button></div>
      : page.next_offset !== null ? <button type="button" className={command} disabled={loading} onClick={() => setOffset(page.next_offset!)}>Load more datasets</button> : null} />
}

export function AmountChoice({ label, value, dataset, onChange }: {
  label: string; value: string; dataset: CatalogDataset | null; onChange: (key: string) => void
}) {
  const metrics = dataset?.metrics.filter(metric => ["currency", "number"].includes(metric.unit) && ["sum", "policy"].includes(metric.aggregation)) || []
  return <label className="block min-w-0 text-xs font-medium text-gray-600">{label}<select aria-label={label} required className={field} value={value} disabled={!dataset} onChange={event => onChange(event.target.value)}>
    <option value="">{dataset && !metrics.length ? "No approved money amounts" : "Choose an amount"}</option>
    {metrics.map(metric => <option key={metric.metric_key} value={metric.metric_key}>{metric.label}</option>)}
  </select></label>
}

export function SourceDetails({ value, dataset, onChange, context }: {
  value: AmountSelection; dataset: CatalogDataset | null; onChange: (value: AmountSelection) => void; context: SourceContext
}) {
  const dateColumn = value.date_column || dataset?.date_columns[0] || ""
  return <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="text-xs font-medium text-gray-600">Date column<select aria-label="Date column" className={field} value={dateColumn} onChange={event => onChange({ ...value, date_column: event.target.value })}>
        {!dateColumn && <option value="">Choose a date column</option>}{dataset?.date_columns.map(column => <option key={column}>{column}</option>)}
      </select></label>
      <label className="text-xs font-medium text-gray-600">Records contain<select aria-label="Records contain" className={field} value={value.records} onChange={event => onChange({ ...value, date_column: dateColumn, records: event.target.value as AmountSelection["records"] })}>
        <option value="daily">Daily totals</option><option value="monthly">Monthly totals</option><option value="transactions">Individual transactions</option>
      </select></label>
    </div>
    <DatasetDimensionFilter embedded singleValue datasetId={value.dataset_id} {...context} value={value.dimension_filter} onChange={dimension_filter => onChange({ ...value, date_column: dateColumn, dimension_filter })} />
  </div>
}

export function AmountSource({ label, value, onChange, context }: {
  label: string; value: AmountSelection; onChange: (value: AmountSelection) => void; context: SourceContext
}) {
  const { dataset, error, retry } = useAmountDataset(value.dataset_id, context)
  return <div className="min-w-0 space-y-3">
    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><DatasetChoice {...context} label={`${label} dataset`} value={value.dataset_id} selectedLabel={dataset?.dataset_label} onChange={dataset_id => onChange({ ...blankAmount(), dataset_id })} />
      <AmountChoice label={`${label} amount`} dataset={dataset} value={value.metric_key} onChange={metric_key => onChange({ ...value, metric_key, date_column: value.date_column || dataset?.date_columns[0] || "" })} /></div>
    {value.dataset_id > 0 && <details className="text-sm"><summary className="min-h-10 cursor-pointer content-center text-gray-600">Dates and filters{value.dimension_filter ? ` / ${value.dimension_filter.values.join(", ")}` : ""}</summary>
      <SourceDetails context={context} value={value} dataset={dataset} onChange={onChange} /></details>}
    {error && <div role="alert" className="text-sm text-red-700">{error} <button type="button" className={command} onClick={retry}><RefreshCw size={16} />Retry</button></div>}
  </div>
}

export function GroupChoice({ datasetId, value, onChange, context, label = "Compare by", totalLabel = "Business total" }: {
  datasetId: number; value: string | null; onChange: (value: string | null) => void; context: SourceContext
  label?: string; totalLabel?: string
}) {
  const [state, setState] = useState<{ id: number; columns: { column: string; label: string }[] }>({ id: 0, columns: [] })
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!datasetId) return
    const controller = new AbortController()
    void getDatasetDimensions(datasetId, context.userId, context.workspaceId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setState({ id: datasetId, columns: data.columns }); setError("") } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [datasetId, context.userId, context.workspaceId, revision])
  return <div><label className="block text-xs font-medium text-gray-600">{label}<select aria-label={label} className={field} value={value || ""} disabled={!datasetId} onChange={event => onChange(event.target.value || null)}>
    <option value="">{totalLabel}</option>{state.id === datasetId && state.columns.map(column => <option key={column.column} value={column.column}>{column.label}</option>)}
  </select></label>{error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" className={command} onClick={() => setRevision(value => value + 1)}>Retry</button></p>}</div>
}
