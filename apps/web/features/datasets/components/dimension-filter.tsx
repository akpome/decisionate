"use client"

import { useEffect, useId, useState } from "react"
import { LoaderCircle, RefreshCw, Search, X } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { getDatasetDimensions, type DimensionFilter, type DimensionOptions } from "@/lib/api"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
export const dimensionValueLabel = (value: string | null) => value === null ? "Missing" : value === "" ? "Empty string" : value
export const dimensionFilterLabel = (value: DimensionFilter) => `${value.column}: ${value.values.map(dimensionValueLabel).join(", ")}`

export function DatasetDimensionFilter({ datasetId, userId, workspaceId, value, onChange, disabled = false }: {
  datasetId: number; userId: string; workspaceId?: string; value?: DimensionFilter
  onChange: (value: DimensionFilter | undefined) => void; disabled?: boolean
}) {
  const { t } = useDecisionateText()
  const id = useId()
  const [options, setOptions] = useState<DimensionOptions>({ columns: [], values: [], next_offset: null })
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [loadedColumn, setLoadedColumn] = useState<string>()
  const column = value?.column

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError("")
      try {
        const result = await getDatasetDimensions(datasetId, userId, workspaceId, { column, search, offset, signal: controller.signal })
        if (!controller.signal.aborted) {
          setLoadedColumn(column)
          setOptions(current => ({ ...result, values: offset ? [...new Set([...current.values, ...result.values])] : result.values }))
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Dimension values could not be loaded.")
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    const timer = setTimeout(() => void load(), search ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [datasetId, userId, workspaceId, column, search, offset, version])

  const selectedValues = value?.values || []
  const visible = [...new Set([...selectedValues, ...(loadedColumn === column ? options.values : [])])]
  return <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-3 border-t border-gray-100 pt-3">
    <div className="flex min-w-0 items-end gap-2">
      <div className="min-w-0 flex-1">
        <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-column`}>{t("Filter by dimension")}</label>
        <select id={`${id}-column`} className={input} value={column || ""} onChange={event => {
          setSearch(""); setOffset(0); setOptions(current => ({ ...current, values: [], next_offset: null }))
          onChange(event.target.value ? { column: event.target.value, values: [] } : undefined)
        }}>
          <option value="">{t("All rows")}</option>
          {column && !options.columns.some(item => item.column === column) && <option value={column}>{column}</option>}
          {options.columns.map(item => <option key={item.column} value={item.column}>{item.label}</option>)}
        </select>
      </div>
      {value && <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300" title={t("Clear dimension filter")} aria-label={t("Clear dimension filter")} onClick={() => { onChange(undefined); setSearch(""); setOffset(0) }}><X size={16} /></button>}
    </div>
    {column && <div className="min-w-0 space-y-2">
      <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-search`}>{t("Dimension values")}</label>
      <div className="relative"><Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-gray-400" /><input id={`${id}-search`} type="search" className={`${input} pl-9`} placeholder={t("Search values")} value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /></div>
      <div role="group" aria-label={`${column} ${t("values")}`} className="max-h-48 min-w-0 overflow-y-auto pr-2">
        {visible.map(item => {
          const checked = selectedValues.includes(item)
          return <label key={JSON.stringify(item)} className="flex min-h-10 min-w-0 items-start gap-2 py-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} disabled={!checked && selectedValues.length >= 50} onChange={() => onChange({ column, values: checked ? selectedValues.filter(selected => selected !== item) : [...selectedValues, item] })} /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{dimensionValueLabel(item)}</span></label>
        })}
      </div>
      {!loading && !error && options.values.length === 0 && <p role="status" className="text-xs text-gray-500">{t("No matching values.")}</p>}
      {selectedValues.length === 0 && <p className="text-xs text-amber-800">{t("No dimension values selected.")}</p>}
      {loadedColumn === column && options.next_offset !== null && <button type="button" className="min-h-10 text-sm font-medium text-blue-700 underline disabled:opacity-50" disabled={loading} onClick={() => setOffset(options.next_offset!)}>{t("Load more values")}</button>}
    </div>}
    {loading && <p role="status" className="flex items-center gap-2 text-xs text-gray-500"><LoaderCircle size={14} className="animate-spin" />{t("Loading dimensions...")}</p>}
    {error && <div className="flex min-w-0 items-start gap-2 text-xs text-red-700"><p role="alert" className="min-w-0 flex-1 break-words">{error}</p><button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300" title={t("Retry dimension values")} aria-label={t("Retry dimension values")} onClick={() => setVersion(current => current + 1)}><RefreshCw size={15} /></button></div>}
    {!loading && !error && !options.columns.length && <p className="text-xs text-gray-500">{t("No dimension columns available.")}</p>}
  </fieldset>
}
