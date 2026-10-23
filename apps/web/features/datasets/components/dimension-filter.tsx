"use client"

import { useEffect, useId, useRef, useState } from "react"
import { LoaderCircle, RefreshCw, Search, X } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { getDatasetDimensions, type DimensionFilter, type DimensionOptions } from "@/lib/api"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
export const dimensionValueLabel = (value: string | null) => value === null ? "Missing" : value === "" ? "Empty string" : value
export const dimensionFilterLabel = (value: DimensionFilter) => `${value.column}: ${value.values.map(dimensionValueLabel).join(", ")}`

export function DatasetDimensionFilter({ datasetId, userId, workspaceId, value, onChange, disabled = false, deferLoad = false }: {
  datasetId: number; userId: string; workspaceId?: string; value?: DimensionFilter
  onChange: (value: DimensionFilter | undefined) => void; disabled?: boolean; deferLoad?: boolean
}) {
  const { t } = useDecisionateText()
  const id = useId()
  const fieldset = useRef<HTMLFieldSetElement>(null)
  const [options, setOptions] = useState<DimensionOptions & { scope?: string; datasetScope?: string }>({ columns: [], values: [], next_offset: null })
  const [activated, setActivated] = useState(!deferLoad || Boolean(value))
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(!deferLoad || Boolean(value))
  const [error, setError] = useState("")
  const column = value?.column
  const datasetScope = JSON.stringify([datasetId, userId, workspaceId])
  const scope = JSON.stringify([datasetScope, column, search])
  const currentOptions = options.scope === scope
  const columns = options.datasetScope === datasetScope ? options.columns : []

  useEffect(() => {
    if (!deferLoad || activated || !fieldset.current || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setActivated(true)
    }, { rootMargin: "100px" })
    observer.observe(fieldset.current)
    return () => observer.disconnect()
  }, [deferLoad, activated])

  useEffect(() => {
    if (!activated && !column) return
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError("")
      try {
        const result = await getDatasetDimensions(datasetId, userId, workspaceId, { column, search, offset, signal: controller.signal })
        if (!controller.signal.aborted) {
          setOptions(current => ({ ...result, scope, datasetScope,
            values: offset && current.scope === scope ? [...new Set([...current.values, ...result.values])] : result.values }))
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Dimension values could not be loaded.")
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    const timer = setTimeout(() => void load(), search ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [datasetId, userId, workspaceId, column, search, offset, version, activated, scope, datasetScope])

  const selectedValues = value?.values || []
  const visible = [...new Set([...selectedValues, ...(currentOptions ? options.values : [])])]
  return <fieldset ref={fieldset} disabled={disabled} aria-label={t("Filter by column values")} onFocusCapture={() => setActivated(true)} onMouseEnter={() => setActivated(true)} className="@container mt-4 min-w-0 space-y-3 border-t border-gray-100 pt-3">
    <div className={`grid min-w-0 items-end gap-3 ${column ? "grid-cols-[minmax(0,1fr)_auto] @min-[28rem]:grid-cols-[repeat(3,minmax(0,1fr))_auto]" : "grid-cols-1"}`}>
      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-column`}>{t("Dimension column")}</label>
        <select id={`${id}-column`} className={input} value={column || ""} onChange={event => {
          setSearch(""); setOffset(0); setOptions(current => ({ ...current, values: [], next_offset: null }))
          onChange(event.target.value ? { column: event.target.value, values: [] } : undefined)
        }}>
          <option value="">{t("All rows")}</option>
          {loading && !columns.length && <option disabled>{t("Loading columns...")}</option>}
          {column && !columns.some(item => item.column === column) && <option value={column}>{column}</option>}
          {columns.map(item => <option key={item.column} value={item.column}>{item.label}</option>)}
        </select>
      </div>
      {column && <>
        <div className="col-span-full min-w-0 @min-[28rem]:col-span-1">
          <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-values`}>{t("Unique values")}</label>
          <select id={`${id}-values`} className={input} value="" disabled={selectedValues.length >= 50} onChange={event => {
            if (!event.target.value || selectedValues.length >= 50) return
            const selected = JSON.parse(event.target.value) as string | null
            if (!selectedValues.includes(selected)) onChange({ column, values: [...selectedValues, selected] })
          }}>
            <option value="">{t("Select values")}</option>
            {visible.map(item => <option key={JSON.stringify(item)} value={JSON.stringify(item)} disabled={selectedValues.includes(item)}>{dimensionValueLabel(item)}</option>)}
          </select>
        </div>
        <div className="col-span-full min-w-0 @min-[28rem]:col-span-1">
          <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-search`}>{t("Search values")}</label>
          <div className="relative"><Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-gray-400" /><input id={`${id}-search`} aria-label={t("Search unique values")} type="search" className={`${input} pl-9`} placeholder={t("Search values")} value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /></div>
        </div>
      </>}
      {value && <button type="button" className="col-start-2 row-start-1 inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 @min-[28rem]:col-start-4" title={t("Clear dimension filter")} aria-label={t("Clear dimension filter")} onClick={() => { onChange(undefined); setSearch(""); setOffset(0) }}><X size={16} /></button>}
    </div>
    {column && <div className="min-w-0 space-y-2">
      {selectedValues.length > 0 && <div role="group" aria-label={`${column} ${t("selected values")}`} className="flex max-h-40 min-w-0 flex-wrap gap-2 overflow-y-auto">
        {selectedValues.map(item => <span key={JSON.stringify(item)} className="inline-flex min-h-10 max-w-full min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 pl-3 text-sm">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{dimensionValueLabel(item)}</span>
          <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100" title={`${t("Remove value")}: ${dimensionValueLabel(item)}`} aria-label={`${t("Remove value")}: ${dimensionValueLabel(item)}`} onClick={() => onChange({ column, values: selectedValues.filter(selected => selected !== item) })}><X size={14} /></button>
        </span>)}
      </div>}
      {!loading && !error && currentOptions && options.values.length === 0 && <p role="status" className="text-xs text-gray-500">{t("No matching values.")}</p>}
      {selectedValues.length === 0 && <p className="text-xs text-amber-800">{t("No dimension values selected.")}</p>}
      {selectedValues.length > 0 && <p className="text-xs text-gray-600">{t("Selected values")}: {selectedValues.length} / 50</p>}
      {currentOptions && options.next_offset !== null && <button type="button" className="min-h-10 text-sm font-medium text-blue-700 underline disabled:opacity-50" disabled={loading} onClick={() => setOffset(options.next_offset!)}>{t("Load more values")}</button>}
    </div>}
    {loading && <p role="status" className="flex items-center gap-2 text-xs text-gray-500"><LoaderCircle size={14} className="animate-spin" />{t("Loading dimensions...")}</p>}
    {error && <div className="flex min-w-0 items-start gap-2 text-xs text-red-700"><p role="alert" className="min-w-0 flex-1 break-words">{error}</p><button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300" title={t("Retry dimension values")} aria-label={t("Retry dimension values")} onClick={() => setVersion(current => current + 1)}><RefreshCw size={15} /></button></div>}
    {!loading && !error && options.datasetScope === datasetScope && !columns.length && <p className="text-xs text-gray-500">{t("No filterable columns available.")}</p>}
  </fieldset>
}
