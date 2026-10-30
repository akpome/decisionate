"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import { Check, ChevronDown, RefreshCw } from "lucide-react"
import { correlationRequest } from "@/lib/api"

type Choice = { id: number; title: string }
const label = (choice: Choice) => `${choice.title} (#${choice.id})`

export function ImpactDecisionPicker({ userId, workspaceId, decisionId, disabled, onChoose }: {
  userId: string; workspaceId?: string; decisionId?: number | null; disabled: boolean; onChoose: (id: number) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Choice | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])
  const [offset, setOffset] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [resultSearch, setResultSearch] = useState("")
  const query = (search || "").trim()
  const selectedChoice = choices.find(choice => choice.id === decisionId) || (selected?.id === decisionId ? selected : null)
  const selectedLabel = selectedChoice ? label(selectedChoice) : decisionId ? `Decision #${decisionId}` : ""
  const visibleChoices = choices.filter(choice => choice.title.toLowerCase().includes(query.toLowerCase()))
  const expanded = open && !disabled
  const activeChoice = expanded ? visibleChoices.find(choice => choice.id === activeId) : undefined

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true); setFailed(false)
      void correlationRequest<{ decisions: Choice[]; next_offset: number | null }>(userId,
        `/business-reports/review-decisions?search=${encodeURIComponent(query)}&offset=${offset}`, { signal: controller.signal }, workspaceId)
        .then(value => {
          if (controller.signal.aborted) return
          setChoices(current => offset ? [...new Map([...current, ...value.decisions].map(choice => [choice.id, choice])).values()] : value.decisions)
          const chosen = value.decisions.find(choice => choice.id === decisionId)
          if (chosen) setSelected(chosen)
          setNext(value.next_offset); setResultSearch(query)
        })
        .catch(() => { if (!controller.signal.aborted) setFailed(true) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [userId, workspaceId, query, offset, retry, decisionId])

  useEffect(() => {
    if (activeChoice) document.getElementById(`${id}-option-${activeChoice.id}`)?.scrollIntoView({ block: "nearest" })
  }, [id, activeChoice])

  function changeSearch(value: string | null) {
    if ((value || "").trim() !== query) { setLoading(true); setFailed(false) }
    setSearch(value); setOffset(0); setActiveId(null)
  }

  function close() {
    setOpen(false)
    changeSearch(null)
  }

  function choose(choice: Choice) {
    setSelected(choice)
    input.current?.focus()
    close()
    if (choice.id !== decisionId) onChoose(choice.id)
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return
    if (event.key === "Escape") {
      if (expanded) { event.preventDefault(); event.stopPropagation(); close() }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true)
      const index = visibleChoices.findIndex(choice => choice.id === activeId)
      const nextIndex = event.key === "ArrowDown" ? Math.min(index + 1, visibleChoices.length - 1) : index <= 0 ? visibleChoices.length - 1 : index - 1
      setActiveId(visibleChoices[nextIndex]?.id ?? null)
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault()
      if (activeChoice) choose(activeChoice)
    }
  }

  return <section aria-label="Decision to review" className="relative min-w-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close()
  }}>
    <label htmlFor={id} className="text-xs font-medium text-gray-700">Decision to review</label>
    <div className="relative mt-1">
      <input ref={input} id={id} type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
        aria-controls={expanded ? `${id}-choices` : undefined} aria-activedescendant={activeChoice ? `${id}-option-${activeChoice.id}` : undefined}
        aria-required="true" autoComplete="off" maxLength={200} placeholder="Choose or search decisions" value={search ?? selectedLabel} disabled={disabled}
        className="min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-12 text-sm text-gray-950 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
        onFocus={event => { setOpen(true); event.target.select() }} onClick={() => setOpen(true)} onKeyDown={navigate}
        onChange={event => { changeSearch(event.target.value); setOpen(true) }} />
      <button type="button" tabIndex={-1} title={expanded ? "Close decisions" : "Show decisions"} aria-label={expanded ? "Close decisions" : "Show decisions"}
        disabled={disabled} className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-r-md text-gray-500 disabled:opacity-50"
        onMouseDown={event => event.preventDefault()} onClick={() => { if (expanded) close(); else { input.current?.focus(); setOpen(true) } }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
    {expanded && <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border border-gray-300 bg-white shadow-lg">
      <ul id={`${id}-choices`} role="listbox" aria-label="Decisions" aria-busy={loading} className="max-h-60 overflow-y-auto overscroll-contain py-1">
        {visibleChoices.map(choice => <li key={choice.id} id={`${id}-option-${choice.id}`} role="option" tabIndex={-1}
          aria-selected={choice.id === (activeChoice?.id ?? decisionId)}
          className={`flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 text-sm text-gray-950 ${choice.id === activeId ? "bg-blue-50" : "hover:bg-gray-50"}`}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveId(choice.id)} onClick={() => choose(choice)}>
          <span className="min-w-0 flex-1 break-words">{label(choice)}</span>
          {choice.id === decisionId && <Check size={16} aria-hidden="true" className="shrink-0 text-blue-700" />}
        </li>)}
      </ul>
      <div role="status" className="px-3 py-2 text-xs text-gray-600">{loading ? "Loading decisions..." : failed ? "Decisions could not be loaded." : `${visibleChoices.length} matching ${visibleChoices.length === 1 ? "decision" : "decisions"}`}</div>
      {failed && <button type="button" aria-label="Retry decisions" title="Retry decisions" disabled={loading} className="mx-3 mb-2 flex h-10 w-10 items-center justify-center rounded-md border border-gray-300" onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); setLoading(true); setRetry(value => value + 1) }}><RefreshCw size={16} aria-hidden="true" /></button>}
      {!loading && !failed && visibleChoices.length === 0 && <p className="px-3 pb-3 text-sm text-gray-600">No matching active decisions. <Link className="text-blue-700 underline" href="/dashboard/decisions">Open decisions</Link></p>}
      {!failed && resultSearch === query && next !== null && <button type="button" disabled={loading} className="min-h-10 w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-blue-700 disabled:opacity-50" onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); setLoading(true); setOffset(next) }}>Load more decisions</button>}
    </div>}
  </section>
}
