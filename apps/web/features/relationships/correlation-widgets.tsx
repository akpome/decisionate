"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw, Trash2 } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { historicalEvidenceHref } from "@/features/reports/legacy-relationship-destination"
import { coefficientText, type CorrelationWidget, type RelationshipCard } from "./types"

function EvidenceLink({ card }: { card: RelationshipCard }) {
  return <Link href={historicalEvidenceHref(card.run_id, card.result_id)} className="block min-w-0 border-b border-gray-100 py-3 last:border-0 hover:bg-gray-50">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{card.metric_a.label} / {card.metric_b.label}</p><p className="mt-1 break-words text-xs text-gray-500">{card.metric_a.dataset_label} ({card.metric_a.currency ?? card.metric_a.unit}) / {card.metric_b.dataset_label} ({card.metric_b.currency ?? card.metric_b.unit})</p></div><strong className={`shrink-0 text-lg tabular-nums ${(card.coefficient ?? 0) < 0 ? "text-rose-800" : "text-emerald-800"}`}>{coefficientText(card.coefficient)}</strong></div>
    <p className="mt-2 break-words text-xs text-gray-600">{card.method} / n={card.observations} / {card.reliability} / {card.lag.periods ? `${card.lag.lead_metric === card.metric_a.id ? card.metric_a.label : card.metric_b.label} leads by ${card.lag.periods} ${card.lag.unit}` : "Same period"}</p><p className="mt-1 text-xs text-gray-500">{card.window.start} to {card.window.end}</p>
    {card.coefficient_change !== null && card.coefficient_change !== undefined && <p className="mt-1 text-xs text-gray-500">Coefficient change: {card.coefficient_change > 0 ? "+" : ""}{card.coefficient_change.toFixed(2)}</p>}
  </Link>
}

export function CorrelationWidgets({ userId, workspaceId, dashboardKey, canManage = false }: { userId?: string; workspaceId?: string; dashboardKey: string; canManage?: boolean }) {
  const [items, setItems] = useState<CorrelationWidget[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      if (!userId) return
      try {
        const widgets = await correlationRequest<CorrelationWidget[]>(userId, `/correlation-widgets?dashboard_key=${encodeURIComponent(dashboardKey)}`, { signal: controller.signal }, workspaceId)
        if (controller.signal.aborted) return
        setItems(widgets); setError("")
      } catch { if (!controller.signal.aborted) setError("Saved relationship evidence could not be loaded.") }
    }
    void load()
    return () => controller.abort()
  }, [userId, workspaceId, dashboardKey, revision])

  async function remove(widget: CorrelationWidget) {
    if (!userId) return
    setBusy(widget.widget_id)
    try {
      await correlationRequest(userId, `/correlation-widgets/${widget.widget_id}`, { method: "DELETE" }, workspaceId)
      setRevision(value => value + 1)
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to update relationship widget") }
    finally { setBusy("") }
  }
  if (!items.length) return null
  return <section aria-label="Saved relationship widgets" className="min-w-0 border-y border-gray-200 py-5 print:hidden">
    <h2 className="mb-4 text-base font-semibold">Saved relationship evidence</h2>
    {error && <p role="alert" className="mb-3 text-sm text-amber-800">{error}</p>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-3">{items.map(widget => <article key={widget.widget_id} className="min-w-0">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{{ top_relationships: "Top Relationships", outcome_drivers: "Outcome Associations", saved_relationship: "Saved Relationship" }[widget.widget_type]}</h3><p className="mt-1 break-words text-xs text-gray-500">{widget.name}</p></div><div className="flex shrink-0 gap-1">{canManage && <button title="Remove relationship widget" aria-label="Remove relationship widget" type="button" disabled={busy === widget.widget_id} onClick={() => void remove(widget)} className="flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-50"><Trash2 size={15} /></button>}</div></div>
      <p className="mt-2 text-xs text-gray-500">Historical snapshot</p>
      {widget.stale && <p role="status" className="mt-2 text-xs text-amber-800">Source data has changed. Previous results retained.</p>}
      {widget.cards.map(card => <EvidenceLink key={card.result_id} card={card} />)}
      {!widget.cards.length && <p className="py-3 text-xs text-gray-500">No eligible relationships.</p>}
      {widget.cards[0]?.computed_at && <p className="mt-2 text-xs text-gray-400">Computed {new Date(widget.cards[0].computed_at).toLocaleString()}</p>}
    </article>)}</div>
  </section>
}

export function CorrelationInsights({ userId, workspaceId }: { userId?: string; workspaceId?: string }) {
  return <ScopedCorrelationInsights key={`${userId}:${workspaceId}`} userId={userId} workspaceId={workspaceId} />
}

function ScopedCorrelationInsights({ userId, workspaceId }: { userId?: string; workspaceId?: string }) {
  const [items, setItems] = useState<{ insight_id: string; evidence: RelationshipCard }[]>([])
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    if (userId) correlationRequest<{ insight_id: string; evidence: RelationshipCard }[]>(userId, "/correlation-insights", { signal: controller.signal }, workspaceId)
      .then(value => { if (!controller.signal.aborted) { setItems(value); setError(false) } })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [userId, workspaceId, revision])
  if (!items.length && !error) return null
  return <section id="saved-relationship-insights" aria-label="Saved relationship insights" className="min-w-0 border-y border-gray-200 py-5"><h2 className="text-base font-semibold">Saved relationship insights</h2>{error && <div className="mt-3 flex items-center gap-3 text-sm text-amber-800"><p role="alert">Saved findings could not be loaded.</p><button type="button" title="Retry saved findings" aria-label="Retry saved findings" onClick={() => setRevision(value => value + 1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"><RefreshCw size={16} /></button></div>}<div className="grid min-w-0 gap-x-6 md:grid-cols-2">{items.map(item => <EvidenceLink key={item.insight_id} card={item.evidence} />)}</div></section>
}
