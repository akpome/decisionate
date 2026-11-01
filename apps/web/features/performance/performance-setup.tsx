"use client"

import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { AmountChoice, AmountSource, command, DatasetChoice, field, GroupChoice, SourceDetails, type SourceContext, useAmountDataset } from "./amount-source"
import { blankAmount, blankItem, type AmountSelection, type PerformanceDefinition, type PerformanceItem } from "./types"

export function SingleDatasetSetup({ definition, onChange, context }: {
  definition: PerformanceDefinition; onChange: (value: PerformanceDefinition) => void; context: SourceContext
}) {
  const item = definition.items[0]
  const { dataset, error, retry } = useAmountDataset(item.revenue.dataset_id, context)
  function update(next: PerformanceItem) { onChange({ ...definition, items: [next] }) }
  function shared(source: AmountSelection) {
    update({ ...item, revenue: source, costs: item.costs.map(cost => ({ ...source, metric_key: cost.metric_key })) })
  }
  return <section className="space-y-5" aria-label="Comparison data">
    <div className="grid gap-4 md:grid-cols-2"><DatasetChoice {...context} label="Dataset" value={item.revenue.dataset_id} selectedLabel={dataset?.dataset_label} onChange={dataset_id => {
      const source = { ...blankAmount(), dataset_id }
      onChange({ ...definition, group_column: null, items: [{ ...blankItem("Business"), revenue: source, costs: [{ ...source }] }] })
    }} /><GroupChoice context={context} datasetId={item.revenue.dataset_id} value={definition.group_column} onChange={group_column => onChange({ ...definition, group_column })} /></div>
    <div className="grid items-start gap-4 md:grid-cols-2">
      <AmountChoice label="Revenue amount" value={item.revenue.metric_key} dataset={dataset} onChange={metric_key => {
        const date_column = item.revenue.date_column || dataset?.date_columns[0] || ""
        update({ ...item, revenue: { ...item.revenue, metric_key, date_column }, costs: item.costs.map(cost => ({ ...cost, date_column })) })
      }} />
      <div className="space-y-3">{item.costs.map((cost, index) => <div key={index} className="flex items-end gap-2">
        <div className="min-w-0 flex-1"><AmountChoice label={definition.kind === "return" ? "Spending amount" : `Cost amount${item.costs.length > 1 ? ` ${index + 1}` : ""}`} dataset={dataset} value={cost.metric_key}
          onChange={metric_key => { const date_column = item.revenue.date_column || dataset?.date_columns[0] || ""; update({ ...item, revenue: { ...item.revenue, date_column }, costs: item.costs.map((current, at) => ({ ...current, date_column, metric_key: at === index ? metric_key : current.metric_key })) }) }} /></div>
        {item.costs.length > 1 && <button type="button" className={command} title={`Remove cost ${index + 1}`} aria-label={`Remove cost ${index + 1}`} onClick={() => update({ ...item, costs: item.costs.filter((_, at) => at !== index) })}><Trash2 size={16} /></button>}
      </div>)}
        {definition.kind === "profit" && item.costs.length < 4 && <button type="button" className={command} onClick={() => update({ ...item, costs: [...item.costs, { ...item.revenue, metric_key: "" }] })}><Plus size={16} />Add another cost</button>}
      </div>
    </div>
    {item.revenue.dataset_id > 0 && <SourceDetails context={context} value={item.revenue} dataset={dataset} onChange={shared} />}
    {error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" className={command} onClick={retry}><RefreshCw size={16} />Retry dataset</button></p>}
  </section>
}

export function SeparateDatasetSetup({ definition, onChange, context }: {
  definition: PerformanceDefinition; onChange: (value: PerformanceDefinition) => void; context: SourceContext
}) {
  function update(index: number, value: PerformanceItem) {
    onChange({ ...definition, items: definition.items.map((item, at) => index === at ? value : item) })
  }
  return <section aria-label="Named comparisons" className="space-y-5">
    {definition.items.map((item, index) => <details key={index} open className="min-w-0 border-b border-gray-200 pb-5">
      <summary className="cursor-pointer py-2 text-base font-semibold">{item.name || `Comparison ${index + 1}`}</summary>
      <div className="space-y-5 pt-3"><div className="flex items-end gap-3"><label className="min-w-0 flex-1 text-xs font-medium text-gray-600">Comparison name<input required maxLength={100} className={field} value={item.name} onChange={event => update(index, { ...item, name: event.target.value })} /></label>
        {definition.items.length > 1 && <button type="button" className={command} aria-label={`Remove comparison ${index + 1}`} title={`Remove comparison ${index + 1}`} onClick={() => onChange({ ...definition, items: definition.items.filter((_, at) => index !== at) })}><Trash2 size={16} /></button>}
      </div>
      <AmountSource label="Revenue" context={context} value={item.revenue} onChange={revenue => update(index, { ...item, revenue })} />
      {item.costs.map((cost, costIndex) => <div key={costIndex} className="space-y-2">
        <AmountSource label={definition.kind === "return" ? "Spending" : `Cost ${costIndex + 1}`} context={context} value={cost} onChange={source => update(index, { ...item, costs: item.costs.map((current, at) => at === costIndex ? source : current) })} />
        {item.costs.length > 1 && <button type="button" className={command} onClick={() => update(index, { ...item, costs: item.costs.filter((_, at) => at !== costIndex) })}><Trash2 size={16} />Remove cost {costIndex + 1}</button>}
      </div>)}
      {definition.kind === "profit" && item.costs.length < 4 && <button type="button" className={command} onClick={() => update(index, { ...item, costs: [...item.costs, blankAmount()] })}><Plus size={16} />Add another cost</button>}
      </div>
    </details>)}
    <button type="button" className={command} disabled={definition.items.length >= 6} onClick={() => onChange({ ...definition, items: [...definition.items, blankItem(`Comparison ${definition.items.length + 1}`)] })}><Plus size={16} />Add comparison</button>
  </section>
}
