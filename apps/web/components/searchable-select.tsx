"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"

export type SearchableOption = { value: string; label: string; searchText?: string; disabled?: boolean }

export function SearchableSelect({ id: suppliedId, label, options, value, selectedLabel, placeholder, onChange, onSearchChange,
  disabled = false, loading = false, loadingLabel = "Loading...", emptyLabel = "No matching options.", footer }: {
  id?: string; label: string; options: SearchableOption[]; value: string | null; selectedLabel?: string; placeholder: string
  onChange: (value: string) => void; onSearchChange?: (search: string) => void
  disabled?: boolean; loading?: boolean; loadingLabel?: string; emptyLabel?: string; footer?: ReactNode
}) {
  const generatedId = useId(), id = suppliedId || generatedId
  const input = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState<string | null>(null)
  const query = (search || "").toLowerCase()
  const filtered = options.filter(option => (option.searchText ?? option.label).toLowerCase().includes(query))
  const navigable = filtered.filter(option => !option.disabled)
  const expanded = open && !disabled
  const activeIndex = expanded ? filtered.findIndex(option => option.value === activeValue && !option.disabled) : -1
  const active = filtered[activeIndex]
  const display = options.find(option => option.value === value)?.label ?? selectedLabel ?? ""

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" })
  }, [id, activeIndex, active])

  function close() {
    setOpen(false); setActiveValue(null); setSearch(null)
    if (search !== null) onSearchChange?.("")
  }

  function choose(option: SearchableOption) {
    if (disabled || input.current?.matches(":disabled") || option.disabled) return
    input.current?.focus()
    close()
    if (option.value !== value) onChange(option.value)
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return
    if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); close() }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true)
      const index = navigable.findIndex(option => option.value === activeValue)
      const next = event.key === "ArrowDown" ? Math.min(index + 1, navigable.length - 1) : index <= 0 ? navigable.length - 1 : index - 1
      setActiveValue(navigable[next]?.value ?? null)
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault()
      if (active) choose(active)
    }
  }

  return <div className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}>
    <label htmlFor={id} className="block text-xs font-medium text-gray-600">{label}</label>
    <div className="relative mt-1">
      <input ref={input} id={id} type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
        aria-controls={expanded ? `${id}-choices` : undefined} aria-activedescendant={active ? `${id}-option-${activeIndex}` : undefined}
        autoComplete="off" maxLength={200} value={search ?? display} placeholder={placeholder} disabled={disabled}
        className="min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-12 text-sm text-gray-950 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
        onFocus={event => { setOpen(true); event.target.select() }} onClick={() => setOpen(true)} onKeyDown={navigate}
        onChange={event => { setSearch(event.target.value); setActiveValue(null); setOpen(true); onSearchChange?.(event.target.value) }} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={`${label} options`} title={`${label} options`}
        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-r-md text-gray-500 disabled:opacity-50"
        onMouseDown={event => event.preventDefault()} onClick={() => { if (expanded) close(); else { input.current?.focus(); setOpen(true) } }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
    {expanded && <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border border-gray-300 bg-white shadow-lg">
      <ul id={`${id}-choices`} role="listbox" aria-label={label} aria-busy={loading} className="max-h-60 overflow-y-auto overscroll-contain py-1">
        {filtered.map((option, index) => <li key={option.value} id={`${id}-option-${index}`} role="option" tabIndex={-1}
          aria-selected={option.value === (active?.value ?? value)} aria-disabled={option.disabled || undefined}
          className={`flex min-h-10 items-center gap-2 px-3 py-2 text-sm ${option.disabled ? "text-gray-400" : `cursor-pointer text-gray-950 ${option.value === activeValue ? "bg-blue-50" : "hover:bg-gray-50"}`}`}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActiveValue(option.value) }} onClick={() => choose(option)}>
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{option.label}</span>
          {option.value === value && <Check size={16} aria-hidden="true" className="shrink-0 text-blue-700" />}
        </li>)}
      </ul>
      {(loading || filtered.length === 0) && <p role="status" className="px-3 py-2 text-xs text-gray-600">{loading ? loadingLabel : emptyLabel}</p>}
      {footer && <div className="border-t border-gray-100 px-3 py-2" onMouseDown={event => event.preventDefault()} onClickCapture={() => input.current?.focus()}>{footer}</div>}
    </div>}
  </div>
}
