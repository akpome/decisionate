"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { LoaderCircle, RefreshCw, Search, X } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { ApiError, getDatasetDimensions, type DimensionFilter, type DimensionOptions } from "@/lib/api"
import { SearchableSelect } from "@/components/searchable-select"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
export const dimensionValueLabel = (value: string | null) => value === null ? "Missing" : value === "" ? "Empty string" : value
export const dimensionFilterLabel = (value: DimensionFilter) => `${value.column}: ${value.values.map(dimensionValueLabel).join(", ")}`

export function DatasetDimensionFilter({ datasetId, userId, workspaceId, value, onChange, disabled = false, deferLoad = false, embedded = false, singleValue = false, fixedColumn, groupPicker, groupMetric, emptyFallback }: {
  datasetId: number; userId: string; workspaceId?: string; value?: DimensionFilter
  onChange: (value: DimensionFilter | undefined) => void; disabled?: boolean; deferLoad?: boolean; embedded?: boolean; singleValue?: boolean
  fixedColumn?: string
  groupMetric?: string
  emptyFallback?: ReactNode
  groupPicker?: {
    limit: number
    renderValue: (value: string | null, checked: boolean, disabled: boolean, toggle: () => void) => ReactNode
  }
}) {
  const { t } = useDecisionateText()
  const id = useId()
  const fieldset = useRef<HTMLFieldSetElement>(null)
  const [options, setOptions] = useState<DimensionOptions & { scope?: string; datasetScope?: string; valueColumn?: string }>({ columns: [], values: [], next_offset: null })
  const [activated, setActivated] = useState(!deferLoad || Boolean(value))
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(!deferLoad || Boolean(value))
  const [error, setError] = useState("")
  const selectedColumn = fixedColumn ?? value?.column
  const datasetScope = JSON.stringify([datasetId, userId, workspaceId, groupMetric])
  const scope = JSON.stringify([datasetScope, selectedColumn, search])
  const currentOptions = options.scope === scope
  const hasCatalog = options.datasetScope === datasetScope
  const columns = hasCatalog ? options.columns : []
  const unavailableColumn = Boolean(selectedColumn && hasCatalog && !columns.some(item => item.column === selectedColumn))
  const column = unavailableColumn ? undefined : selectedColumn

  useEffect(() => {
    if (!deferLoad || activated || !fieldset.current || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setActivated(true)
    }, { rootMargin: "100px" })
    observer.observe(fieldset.current)
    return () => observer.disconnect()
  }, [deferLoad, activated])

  useEffect(() => {
    if (!activated && !selectedColumn) return
    const controller = new AbortController()
    const signal = controller.signal
    async function load() {
      setLoading(true); setError("")
      try {
        const result = await getDatasetDimensions(datasetId, userId, workspaceId, { column: selectedColumn, search, offset, signal, groupMetric })
          .catch(async failure => {
            if (!selectedColumn || signal.aborted || !(failure instanceof ApiError) || failure.status !== 422) throw failure
            // A saved filter may refer to a column that is now a metric.
            const catalog = await getDatasetDimensions(datasetId, userId, workspaceId, { signal, groupMetric })
            if (catalog.columns.some(item => item.column === selectedColumn)) throw failure
            return catalog
          })
        if (!signal.aborted) {
          setOptions(current => ({ ...result, scope, datasetScope, valueColumn: selectedColumn,
            values: offset && current.scope === scope ? [...new Set([...current.values, ...result.values])] : result.values }))
        }
      } catch (failure) {
        if (!signal.aborted) setError(failure instanceof Error ? failure.message : "Dimension values could not be loaded.")
      } finally { if (!signal.aborted) setLoading(false) }
    }
    const timer = setTimeout(() => void load(), search ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [datasetId, userId, workspaceId, selectedColumn, search, offset, version, activated, scope, datasetScope, groupMetric])

  const selectedValues = value?.column === column ? value?.values ?? [] : []
  const valuesAvailable = currentOptions || singleValue && options.datasetScope === datasetScope && options.valueColumn === column
  const loadedValues = valuesAvailable ? options.values : []
  const visible = [...new Set(groupPicker ? [...loadedValues, ...selectedValues] : [...selectedValues, ...loadedValues])]
  const savedMultiple = singleValue && selectedValues.length > 1
  const columnGrid = column && !groupPicker ? singleValue || fixedColumn
    ? "@min-[28rem]:grid-cols-[repeat(2,minmax(0,1fr))_auto]"
    : "@min-[28rem]:grid-cols-[repeat(3,minmax(0,1fr))_auto]" : ""
  const moreValues = currentOptions && options.next_offset !== null && <button type="button" className="min-h-10 text-sm font-medium text-blue-700 underline disabled:opacity-50" disabled={loading} onClick={() => setOffset(options.next_offset!)}>{t("Load more values")}</button>
  const errorFeedback = error && <div className="flex min-w-0 items-start gap-2 text-xs text-red-700"><p role="alert" className="min-w-0 flex-1 break-words">{error}</p><button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300" title={t("Retry dimension values")} aria-label={t("Retry dimension values")} onClick={() => setVersion(current => current + 1)}><RefreshCw size={15} /></button></div>
  if (emptyFallback && !value && hasCatalog && !columns.length && !loading && !error) {
    return emptyFallback
  }
  const searchField = column && !singleValue && <div className={groupPicker ? "min-w-0 max-w-sm" : "col-span-full min-w-0 @min-[28rem]:col-span-1"}>
    <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-search`}>{t("Search values")}</label>
    <div className="relative"><Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-gray-400" /><input id={`${id}-search`} aria-label={t("Search unique values")} type="search" className={`${input} pl-9`} placeholder={t("Search values")} value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /></div>
  </div>
  return <fieldset ref={fieldset} disabled={disabled} aria-label={t("Filter by column values")} onFocusCapture={() => setActivated(true)} onMouseEnter={() => setActivated(true)} className={`@container min-w-0 space-y-3 ${embedded ? "" : "mt-4 border-t border-gray-100 pt-3"}`}>
    <div className={`grid min-w-0 items-end gap-3 ${(column && !groupPicker) || value ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1"} ${columnGrid}`}>
      {!fixedColumn && <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-column`}>{t("Dimension column")}</label>
        <select id={`${id}-column`} className={input} value={selectedColumn || ""} onChange={event => {
          setSearch(""); setOffset(0); setOptions(current => ({ ...current, values: [], next_offset: null }))
          onChange(event.target.value ? { column: event.target.value, values: [] } : undefined)
        }}>
          <option value="">{t(groupPicker ? "Choose a dimension" : "All rows")}</option>
          {loading && !columns.length && <option disabled>{t("Loading columns...")}</option>}
          {unavailableColumn && <option value={selectedColumn} disabled>{t("Unavailable dimension")}</option>}
          {!hasCatalog && column && <option value={column}>{column}</option>}
          {columns.map(item => <option key={item.column} value={item.column}>{item.label}</option>)}
        </select>
      </div>}
      {column && !groupPicker && <>
        <div className={fixedColumn ? "min-w-0" : "col-span-full min-w-0 @min-[28rem]:col-span-1"}>
          {singleValue ? <SearchableSelect key={JSON.stringify([datasetScope, column])} id={`${id}-values`} label={t("Unique value")} placeholder={t("Choose or search values")}
            value={selectedValues.length === 1 ? JSON.stringify(selectedValues[0]) : null} selectedLabel={savedMultiple ? `${t("Saved values")}: ${selectedValues.length}` : ""}
            disabled={disabled} loading={loading} loadingLabel={t("Loading dimensions...")} emptyLabel={error ? "" : t("No matching values.")}
            options={visible.map(item => ({ value: JSON.stringify(item), label: dimensionValueLabel(item) }))}
            onChange={selected => onChange({ column, values: [JSON.parse(selected) as string | null] })}
            onSearchChange={nextSearch => {
              if (nextSearch === search && offset === 0) return
              setSearch(nextSearch); setOffset(0); setLoading(true); setError("")
            }} footer={errorFeedback || moreValues} /> : <>
          <label className="block text-xs font-medium text-gray-600" htmlFor={`${id}-values`}>{t(fixedColumn ? "Filter values (optional)" : "Unique values")}</label>
          <select id={`${id}-values`} className={input} value="" disabled={selectedValues.length >= 50} onChange={event => {
            if (!event.target.value || selectedValues.length >= 50) return
            const selected = JSON.parse(event.target.value) as string | null
            if (!selectedValues.includes(selected)) onChange({ column, values: [...selectedValues, selected] })
          }}>
            <option value="">{t(fixedColumn && !selectedValues.length ? "All values" : "Select values")}</option>
            {visible.map(item => <option key={JSON.stringify(item)} value={JSON.stringify(item)} disabled={selectedValues.includes(item)}>{dimensionValueLabel(item)}</option>)}
          </select></>}
        </div>
        {searchField}
      </>}
      {value && <button type="button" className={`col-start-2 row-start-1 inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 ${column && !groupPicker ? singleValue || fixedColumn ? "@min-[28rem]:col-start-3" : "@min-[28rem]:col-start-4" : ""}`} title={t("Clear dimension filter")} aria-label={t("Clear dimension filter")} onClick={() => { onChange(undefined); setSearch(""); setOffset(0) }}><X size={16} /></button>}
    </div>
    {column && <div className="min-w-0 space-y-2">
      {groupPicker && searchField}
      {groupPicker && visible.length > 0 && (
        <div role="group" aria-label={t("Groups to compare")} className={`grid min-w-0 grid-cols-1 gap-3 @min-[28rem]:grid-cols-2 @min-[46rem]:grid-cols-4 ${visible.length > groupPicker.limit ? "max-h-[28rem] overflow-y-auto overscroll-contain p-1" : ""}`}>
          {visible.map(item => {
            const checked = selectedValues.includes(item)
            return groupPicker.renderValue(item, checked, !checked && selectedValues.length >= groupPicker.limit,
              () => onChange({ column, values: checked ? selectedValues.filter(selected => selected !== item) : [...selectedValues, item] }))
          })}
        </div>
      )}
      {!groupPicker && !singleValue && selectedValues.length > 0 && <div role="group" aria-label={`${column} ${t("selected values")}`} className="flex max-h-40 min-w-0 flex-wrap gap-2 overflow-y-auto">
        {selectedValues.map(item => <span key={JSON.stringify(item)} className="inline-flex min-h-10 max-w-full min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 pl-3 text-sm">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{dimensionValueLabel(item)}</span>
          <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100" title={`${t("Remove value")}: ${dimensionValueLabel(item)}`} aria-label={`${t("Remove value")}: ${dimensionValueLabel(item)}`} onClick={() => {
            const remaining = selectedValues.filter(selected => selected !== item)
            onChange(fixedColumn && !remaining.length ? undefined : { column, values: remaining })
          }}><X size={14} /></button>
        </span>)}
      </div>}
      {!singleValue && !loading && !error && currentOptions && options.values.length === 0 && <p role="status" className="text-xs text-gray-500">{t("No matching values.")}</p>}
      {!fixedColumn && selectedValues.length === 0 && <p className="text-xs text-amber-800">{t("No dimension values selected.")}</p>}
      {!singleValue && selectedValues.length > 0 && <p className="text-xs text-gray-600">{t("Selected values")}: {selectedValues.length} / {groupPicker?.limit ?? 50}</p>}
      {savedMultiple && <p className="break-words text-xs text-amber-800">{t("Saved values")}: {selectedValues.map(dimensionValueLabel).join(", ")}</p>}
      {!singleValue && moreValues}
    </div>}
    {loading && (!singleValue || !column) && <p role="status" className="flex items-center gap-2 text-xs text-gray-500"><LoaderCircle size={14} className="animate-spin" />{t("Loading dimensions...")}</p>}
    {(!singleValue || !column) && errorFeedback}
    {unavailableColumn && <p role="status" className="text-xs text-amber-800">{t("This column is no longer available as a dimension.")}</p>}
    {!loading && !error && options.datasetScope === datasetScope && !columns.length && <p className="text-xs text-gray-500">{t("No filterable columns available.")}</p>}
  </fieldset>
}
