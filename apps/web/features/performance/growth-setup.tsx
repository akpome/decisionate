"use client"

import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react"
import { getDatasetJoinMetadata } from "@/lib/api"
import { DatasetDimensionFilter } from "@/features/datasets/components/dimension-filter"
import { AmountChoice, command, DatasetChoice, field, GroupChoice, type SourceContext, useAmountDataset } from "./amount-source"
import type { GrowthDefinition, RecordSource } from "./types"

export function GrowthSetup({ definition: value, onChange, context }: {
  definition: GrowthDefinition; onChange: (value: GrowthDefinition) => void; context: SourceContext
}) {
  const { dataset, error, retry } = useAmountDataset(value.kind === "retention" ? 0 : value.source.dataset_id, context)
  const [metadata, setMetadata] = useState<{ id: number; label: string; columns: string[]; dates: string[] } | null>(null)
  const [metadataError, setMetadataError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (value.kind !== "retention" || !value.source.dataset_id) return
    let cancelled = false
    void getDatasetJoinMetadata([value.source.dataset_id], context.userId, context.workspaceId).then(data => {
      if (!cancelled) {
        const result = data.datasets[0]
        if (!result) throw new Error("Purchase columns could not be loaded.")
        setMetadata({ id: result.dataset_id, label: result.file_name, columns: result.columns, dates: result.date_columns }); setMetadataError("")
      }
    }).catch(failure => { if (!cancelled) setMetadataError(failure.message) })
    return () => { cancelled = true }
  }, [value.kind, value.source.dataset_id, context.userId, context.workspaceId, revision])
  const columns = metadata?.id === value.source.dataset_id ? metadata.columns : []
  const dates = value.kind === "retention" && metadata?.id === value.source.dataset_id ? metadata.dates : dataset?.date_columns || []
  const dateColumn = value.source.date_column || dates[0] || ""
  const source = (change: Partial<RecordSource>) => ({ ...value.source, date_column: dateColumn, ...change })
  const change = (next: GrowthDefinition) => onChange(next)
  return <div className="min-w-0 space-y-5">
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <DatasetChoice {...context} label={value.kind === "retention" ? "Purchase dataset" : value.kind === "conversion" ? "Sales process dataset" : "Payment schedule dataset"} value={value.source.dataset_id} selectedLabel={dataset?.dataset_label || (metadata?.id === value.source.dataset_id ? metadata.label : undefined)} onChange={dataset_id => {
        const next = { ...value, source: { dataset_id, date_column: "" } }
        if (next.kind === "retention") change({ ...next, customer_column: "", order_column: "" })
        if (next.kind === "conversion") change({ ...next, group_column: null, steps: next.steps.map(step => ({ ...step, metric_key: "" })) })
        if (next.kind === "cashflow") change({ ...next, incoming_metric: "", outgoing_metric: "" })
      }} />
      {value.kind === "conversion" && <GroupChoice context={context} datasetId={value.source.dataset_id} value={value.group_column} onChange={group_column => change({ ...value, source: source({}), group_column })} />}
    </div>
    <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
      <label className="text-xs font-medium text-gray-600">{value.kind === "retention" ? "Purchase date column" : value.kind === "cashflow" ? "Expected payment date column" : "Date column"}<select aria-label="Date column" className={field} value={dateColumn} disabled={!dates.length} onChange={event => change({ ...value, source: source({ date_column: event.target.value }) })}>
        {!dateColumn && <option value="">Choose a date column</option>}{dates.map(column => <option key={column}>{column}</option>)}
      </select></label>
      {value.source.dataset_id > 0 && <DatasetDimensionFilter embedded singleValue datasetId={value.source.dataset_id} {...context} value={value.source.dimension_filter} onChange={dimension_filter => change({ ...value, source: source({ dimension_filter }) })} />}
    </div>
    {value.kind !== "cashflow" ? <div className="grid min-w-0 gap-4 md:grid-cols-3">
      <label className="text-xs font-medium text-gray-600">{value.kind === "retention" ? "First recorded purchases from" : "From"}<input className={field} type="date" required value={value.date_range.start} onChange={event => change({ ...value, date_range: { ...value.date_range, start: event.target.value } })} /></label>
      <label className="text-xs font-medium text-gray-600">{value.kind === "retention" ? "History through" : "To"}<input className={field} type="date" required min={value.date_range.start} value={value.date_range.end} onChange={event => change({ ...value, date_range: { ...value.date_range, end: event.target.value } })} /></label>
      {value.kind === "retention" ? <label className="text-xs font-medium text-gray-600">Time to buy again<select aria-label="Time to buy again" className={field} value={value.return_days} onChange={event => change({ ...value, return_days: Number(event.target.value) as 30 | 60 | 90 })}>
        {[30, 60, 90].map(days => <option key={days} value={days}>{days} days</option>)}
      </select></label> : <label className="text-xs font-medium text-gray-600">Records contain<select aria-label="Records contain" className={field} value={value.records} onChange={event => change({ ...value, records: event.target.value as typeof value.records })}>
        <option value="daily">Daily counts</option><option value="monthly">Monthly counts</option><option value="transactions">One count per group</option>
      </select></label>}
    </div> : <div className="grid min-w-0 gap-4 md:grid-cols-4">
      <label className="text-xs font-medium text-gray-600">Plan starts<input className={field} type="date" required value={value.start_date} onChange={event => change({ ...value, start_date: event.target.value })} /></label>
      <label className="text-xs font-medium text-gray-600">Plan length<select aria-label="Plan length" className={field} value={value.weeks} onChange={event => change({ ...value, weeks: Number(event.target.value) as typeof value.weeks })}>{[4, 8, 13, 26].map(weeks => <option key={weeks} value={weeks}>{weeks} weeks</option>)}</select></label>
      <label className="text-xs font-medium text-gray-600">Cash available at the start<input className={field} type="number" required step="0.01" min={-1e12} max={1e12} value={value.opening_balance} onChange={event => change({ ...value, opening_balance: Number(event.target.value) })} /></label>
      <label className="text-xs font-medium text-gray-600">Currency<select aria-label="Currency" className={field} value={value.currency} onChange={event => change({ ...value, currency: event.target.value })}>{["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "JPY", "INR", "NGN", "ZAR", "BRL", "MXN", "SGD", "CHF"].map(code => <option key={code}>{code}</option>)}</select></label>
    </div>}
    {value.kind === "retention" && <div className="grid min-w-0 gap-4 md:grid-cols-2">
      {(["customer_column", "order_column"] as const).map(key => <label key={key} className="text-xs font-medium text-gray-600">{key === "customer_column" ? "Customer ID column" : "Purchase ID column"}<select aria-label={key === "customer_column" ? "Customer ID column" : "Purchase ID column"} className={field} required value={value[key]} disabled={!columns.length} onChange={event => change({ ...value, source: source({}), [key]: event.target.value })}>
        <option value="">Choose a column</option>{columns.filter(column => column !== dateColumn).map(column => <option key={column}>{column}</option>)}
      </select></label>)}
    </div>}
    {value.kind === "conversion" && <section className="space-y-3 border-t border-gray-200 pt-4" aria-label="Sales steps">
      {value.steps.map((step, index) => <div key={index} className="grid min-w-0 items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-medium text-gray-600">Step {index + 1}<input className={field} required maxLength={80} value={step.name} onChange={event => change({ ...value, steps: value.steps.map((item, at) => at === index ? { ...item, name: event.target.value } : item) })} /></label>
        <label className="text-xs font-medium text-gray-600">Count column<select aria-label={`Count for step ${index + 1}`} className={field} required value={step.metric_key} disabled={!dataset} onChange={event => change({ ...value, source: source({}), steps: value.steps.map((item, at) => at === index ? { ...item, metric_key: event.target.value } : item) })}>
          <option value="">Choose a count</option>{dataset?.metrics.filter(metric => ["count", "number"].includes(metric.unit) && ["sum", "policy"].includes(metric.aggregation)).map(metric => <option key={metric.metric_key} value={metric.metric_key}>{metric.label}</option>)}
        </select></label>
        <div className="flex gap-2">{[-1, 1].map(direction => <button type="button" key={direction} className={command} title={direction < 0 ? "Move step up" : "Move step down"} aria-label={`${direction < 0 ? "Move up" : "Move down"} step ${index + 1}`} disabled={index + direction < 0 || index + direction >= value.steps.length} onClick={() => {
          const steps = [...value.steps]; [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]]; change({ ...value, steps })
        }}>{direction < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</button>)}
          <button type="button" className={command} disabled={value.steps.length <= 2} title="Remove step" aria-label={`Remove step ${index + 1}`} onClick={() => change({ ...value, steps: value.steps.filter((_, at) => index !== at) })}><Trash2 size={16} /></button>
        </div>
      </div>)}
      {value.steps.length < 5 && <button type="button" className={command} onClick={() => change({ ...value, steps: [...value.steps, { name: `Step ${value.steps.length + 1}`, metric_key: "" }] })}><Plus size={16} />Add step</button>}
    </section>}
    {value.kind === "cashflow" && <>
      <div className="grid min-w-0 gap-4 md:grid-cols-2"><AmountChoice label="Expected money in" value={value.incoming_metric} dataset={dataset} onChange={incoming_metric => change({ ...value, source: source({}), incoming_metric })} />
        <AmountChoice label="Expected money out" value={value.outgoing_metric} dataset={dataset} onChange={outgoing_metric => change({ ...value, source: source({}), outgoing_metric })} /></div>
      <details className="border-t border-gray-200 pt-3 text-sm"><summary className="cursor-pointer py-2 font-medium">Cash buffer and what-if changes</summary>
        <div className="grid gap-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-gray-600">Minimum cash to keep<input className={field} type="number" step="0.01" min={0} max={1e12} value={value.reserve} onChange={event => change({ ...value, reserve: Number(event.target.value) })} /></label>
          <label className="text-xs font-medium text-gray-600">Money in adjustment (%)<input className={field} type="number" step="0.1" min={-100} max={100} value={value.income_change_percent} onChange={event => change({ ...value, income_change_percent: Number(event.target.value) })} /></label>
          <label className="text-xs font-medium text-gray-600">Money out adjustment (%)<input className={field} type="number" step="0.1" min={-100} max={100} value={value.cost_change_percent} onChange={event => change({ ...value, cost_change_percent: Number(event.target.value) })} /></label>
          <label className="text-xs font-medium text-gray-600">Receipts arrive later (days)<input className={field} type="number" min={0} max={90} step={1} value={value.collection_delay_days} onChange={event => change({ ...value, collection_delay_days: Number(event.target.value) })} /></label>
        </div>
      </details>
    </>}
    {(metadataError || error) && <p role="alert" className="text-sm text-red-700">{metadataError || error} <button type="button" className={command} onClick={() => { retry(); setRevision(revision + 1) }}><RefreshCw size={16} />Retry dataset</button></p>}
  </div>
}

export function GrowthConfirmation({ definition }: { definition: GrowthDefinition }) {
  if (definition.kind === "retention") return <>These records contain completed purchases with stable customer and purchase IDs. Cancelled purchases and duplicate exports have been excluded.</>
  if (definition.kind === "conversion") return <>Each step counts the same group of people or opportunities, once per step, in the order shown. The records cover these dates and use the same follow-up window.</>
  return <>This is a complete schedule of expected cash receipts and payments for this period, in {definition.currency}. The starting cash excludes these future payments. Blank amounts have been replaced with explicit zeros where appropriate.</>
}
