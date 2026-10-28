"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { correlationRequest } from "@/lib/api"

type Choice = { id: number; title: string }
const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"

export function ImpactDecisionPicker({ userId, workspaceId, decisionId, disabled, onChoose }: {
  userId: string; workspaceId?: string; decisionId?: number | null; disabled: boolean; onChoose: (id: number) => void
}) {
  const [search, setSearch] = useState("")
  const [choices, setChoices] = useState<Choice[]>([])
  const [offset, setOffset] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true); setFailed(false)
      void correlationRequest<{ decisions: Choice[]; next_offset: number | null }>(userId,
        `/business-reports/review-decisions?search=${encodeURIComponent(search)}&offset=${offset}`, { signal: controller.signal }, workspaceId)
        .then(value => { if (!controller.signal.aborted) { setChoices(current => offset ? [...current, ...value.decisions] : value.decisions); setNext(value.next_offset) } })
        .catch(() => { if (!controller.signal.aborted) setFailed(true) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [userId, workspaceId, search, offset, retry])
  return <section aria-label="Decision to review" className="space-y-3 border-y border-gray-200 py-4">
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-xs font-medium text-gray-700">Search decisions<input type="search" className={input} value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setOffset(0) }} /></label>
      <label className="min-w-0 text-xs font-medium text-gray-700">Decision to review<select className={input} required value={decisionId || ""} disabled={disabled || loading} onChange={event => { if (event.target.value) onChoose(Number(event.target.value)) }}>
        <option value="">{loading ? "Loading decisions..." : "Choose an existing decision"}</option>
        {decisionId && !choices.some(choice => choice.id === decisionId) && <option value={decisionId}>Decision #{decisionId}</option>}
        {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.title} (#{choice.id})</option>)}
      </select></label>
    </div>
    {failed && <div role="alert" className="flex items-center gap-3 text-sm text-red-700"><span>Decisions could not be loaded.</span><button type="button" aria-label="Retry decisions" title="Retry decisions" disabled={disabled || loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} /></button></div>}
    {!loading && !failed && choices.length === 0 && <p className="text-sm text-gray-600">No matching active decisions. <Link className="text-blue-700 underline" href="/dashboard/decisions">Open decisions</Link></p>}
    {next !== null && <button type="button" disabled={disabled || loading} className="min-h-10 text-sm text-blue-700 underline" onClick={() => setOffset(next)}>Load more decisions</button>}
  </section>
}
