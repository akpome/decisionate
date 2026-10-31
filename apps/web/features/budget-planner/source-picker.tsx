"use client"

import { useEffect, useState } from "react"
import { SearchableSelect } from "@/components/searchable-select"
import { DatasetDimensionFilter } from "@/features/datasets/components/dimension-filter"
import type { CatalogDataset } from "@/features/relationships/types"
import { correlationRequest } from "@/lib/api"
import { blankSelection, type Selection } from "./types"

type Catalog = { datasets: CatalogDataset[]; next_offset: number | null }

export function SourcePicker({ label, value, onChange, userId, workspaceId, spending = false }: {
  label: string; value: Selection; onChange: (value: Selection) => void; userId: string; workspaceId?: string; spending?: boolean
}) {
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Catalog>({ datasets: [], next_offset: null })
  const [selected, setSelected] = useState<CatalogDataset | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      void correlationRequest<Catalog>(userId, `/business-reports/catalog?metadata_only=true&offset=${offset}&search=${encodeURIComponent(search)}`, { signal: controller.signal }, workspaceId)
        .then(data => { if (!controller.signal.aborted) setPage(previous => ({ ...data, datasets: offset ? [...previous.datasets, ...data.datasets] : data.datasets })) })
        .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, search ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [userId, workspaceId, search, offset, revision])
  useEffect(() => {
    if (!value.dataset_id) return
    const controller = new AbortController()
    void correlationRequest<Catalog>(userId, `/business-reports/catalog?dataset_id=${value.dataset_id}`, { signal: controller.signal }, workspaceId)
      .then(data => {
        if (controller.signal.aborted) return
        const dataset = data.datasets[0]
        if (!dataset || dataset.error_code) throw new Error("Dataset details are unavailable. Retry or choose another dataset.")
        setSelected(dataset)
      })
      .catch(failure => { if (!controller.signal.aborted) { setSelected(null); setError(failure.message) } })
    return () => controller.abort()
  }, [userId, workspaceId, value.dataset_id, revision])
  const current = selected?.dataset_id === value.dataset_id ? selected : null
  const metrics = current?.metrics.filter(metric => (!spending || metric.unit === "currency") && ["sum", "policy"].includes(metric.aggregation)) || []
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      <SearchableSelect label={`${label} dataset`} options={page.datasets.map(item => ({ value: String(item.dataset_id), label: item.dataset_label }))}
        value={value.dataset_id ? String(value.dataset_id) : null} selectedLabel={current?.dataset_label} placeholder="Choose a dataset" loading={loading}
        onSearchChange={text => { setSearch(text); setOffset(0) }} onChange={id => { setError(""); onChange({ ...blankSelection(), dataset_id: Number(id) }) }}
        footer={page.next_offset !== null && <button type="button" disabled={loading} onClick={() => setOffset(page.next_offset!)}>Load more datasets</button>} />
      <label>{spending ? "Spending metric" : "Result metric"}<select value={value.metric_key} disabled={!current} onChange={event => onChange({ ...value, metric_key: event.target.value, date_column: value.date_column || current?.date_columns[0] || "" })}>
        <option value="">Choose a metric</option>{metrics.map(metric => <option key={metric.metric_key} value={metric.metric_key}>{metric.label}</option>)}
      </select></label>
    </div>
    {value.dataset_id > 0 && <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <label>Date column<select value={value.date_column} onChange={event => onChange({ ...value, date_column: event.target.value })}>
          <option value="">Choose a date column</option>{current?.date_columns.map(column => <option key={column}>{column}</option>)}
        </select></label>
        <label>Records contain<select value={value.data_grain} onChange={event => onChange({ ...value, data_grain: event.target.value as Selection["data_grain"] })}>
          <option value="daily">Daily totals</option><option value="weekly">Complete weekly totals (Monday dates)</option>
        </select></label>
      </div>
      <DatasetDimensionFilter embedded singleValue datasetId={value.dataset_id} userId={userId} workspaceId={workspaceId} value={value.dimension_filter} onChange={dimension_filter => onChange({ ...value, dimension_filter })} />
    </div>}
    {current && !metrics.length && <p role="status">No eligible {spending ? "spending" : "additive"} metrics in this dataset.</p>}
    {error && <p role="alert" className="text-red-700">{error} <button type="button" onClick={() => { setError(""); setRevision(value => value + 1) }}>Retry</button></p>}
  </div>
}
