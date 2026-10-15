"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw, Trash2 } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { coefficientText, type CorrelationCapabilities, type CorrelationWidget, type RelationshipCard } from "./types"

function EvidenceLink({ card }: { card: RelationshipCard }) {
  return <Link href={`/dashboard/relationships/explorer?run=${card.run_id}&result=${card.result_id}`} className="block min-w-0 border-b border-gray-100 py-3 last:border-0 hover:bg-gray-50">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{card.metric_a.label} / {card.metric_b.label}</p><p className="mt-1 break-words text-xs text-gray-500">{card.metric_a.dataset_label} ({card.metric_a.currency ?? card.metric_a.unit}) / {card.metric_b.dataset_label} ({card.metric_b.currency ?? card.metric_b.unit})</p></div><strong className={`shrink-0 text-lg tabular-nums ${(card.coefficient ?? 0) < 0 ? "text-rose-800" : "text-emerald-800"}`}>{coefficientText(card.coefficient)}</strong></div>
    <p className="mt-2 break-words text-xs text-gray-600">{card.method} / n={card.observations} / {card.reliability} / {card.lag.periods ? `${card.lag.lead_metric === card.metric_a.id ? card.metric_a.label : card.metric_b.label} leads by ${card.lag.periods} ${card.lag.unit}` : "Same period"}</p><p className="mt-1 text-xs text-gray-500">{card.window.start} to {card.window.end}</p>
    {card.coefficient_change !== null && card.coefficient_change !== undefined && <p className="mt-1 text-xs text-gray-500">Coefficient change: {card.coefficient_change > 0 ? "+" : ""}{card.coefficient_change.toFixed(2)}</p>}
  </Link>
}

export function CorrelationWidgets({ userId, workspaceId, dashboardKey, canManage = false }: { userId?: string; workspaceId?: string; dashboardKey: string; canManage?: boolean }) {
  const [items, setItems] = useState<CorrelationWidget[]>([])
  const [canRefresh, setCanRefresh] = useState(false)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  useEffect(() => {
    let current = true, timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      if (!userId) return
      try {
        const capabilities = await correlationRequest<CorrelationCapabilities>(userId, "/correlation-capabilities", {}, workspaceId)
        const widgets = await correlationRequest<CorrelationWidget[]>(userId, `/correlation-widgets?dashboard_key=${encodeURIComponent(dashboardKey)}`, {}, workspaceId)
        if (!current) return
        setCanRefresh(capabilities.api); setItems(widgets); setError("")
        if (widgets.some(widget => widget.updating)) timer = setTimeout(() => void load(), 5000)
      } catch { if (current) setError("Relationship widgets could not be refreshed.") }
    }
    void load()
    return () => { current = false; clearTimeout(timer) }
  }, [userId, workspaceId, dashboardKey, revision])

  async function action(widget: CorrelationWidget, remove: boolean) {
    if (!userId) return
    setBusy(widget.widget_id)
    try {
      await correlationRequest(userId, remove ? `/correlation-widgets/${widget.widget_id}` : `/correlation-analyses/${widget.analysis_id}/runs`, { method: remove ? "DELETE" : "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }, workspaceId)
      setRevision(value => value + 1)
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to update relationship widget") }
    finally { setBusy("") }
  }
  if (!items.length) return null
  return <section aria-label="Saved relationship widgets" className="min-w-0 border-y border-gray-200 py-5 print:hidden">
    <h2 className="mb-4 text-base font-semibold">Observed relationships</h2>
    {error && <p role="alert" className="mb-3 text-sm text-amber-800">{error}</p>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-3">{items.map(widget => <article key={widget.widget_id} className="min-w-0">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{{ top_relationships: "Top Relationships", outcome_drivers: "Outcome Associations", saved_relationship: "Saved Relationship" }[widget.widget_type]}</h3><p className="mt-1 break-words text-xs text-gray-500">{widget.name}</p></div><div className="flex shrink-0 gap-1">{canRefresh && <button title="Refresh relationship analysis" aria-label="Refresh relationship analysis" type="button" disabled={widget.updating || busy === widget.widget_id} onClick={() => void action(widget, false)} className="flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-50"><RefreshCw size={15} /></button>}{canManage && <button title="Remove relationship widget" aria-label="Remove relationship widget" type="button" disabled={busy === widget.widget_id} onClick={() => void action(widget, true)} className="flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-50"><Trash2 size={15} /></button>}</div></div>
      {widget.updating && <p role="status" className="mt-2 text-xs text-blue-700">Updating. Previous results retained.</p>}
      {!widget.updating && (widget.stale || ["failed", "canceled"].includes(widget.last_refresh_status)) && <p role="status" className="mt-2 text-xs text-amber-800">{widget.last_refresh_status === "failed" ? "Refresh failed. Previous results retained." : widget.last_refresh_status === "canceled" ? "Refresh canceled. Previous results retained." : "Source data has changed."}</p>}
      {widget.cards.map(card => <EvidenceLink key={card.result_id} card={card} />)}
      {!widget.cards.length && <p className="py-3 text-xs text-gray-500">No eligible relationships.</p>}
      {widget.cards[0]?.computed_at && <p className="mt-2 text-xs text-gray-400">Computed {new Date(widget.cards[0].computed_at).toLocaleString()}</p>}
    </article>)}</div>
  </section>
}

export function CorrelationInsights({ userId, workspaceId }: { userId?: string; workspaceId?: string }) {
  const [items, setItems] = useState<{ insight_id: string; evidence: RelationshipCard }[]>([])
  useEffect(() => {
    let current = true
    if (userId) correlationRequest<{ insight_id: string; evidence: RelationshipCard }[]>(userId, "/correlation-insights", {}, workspaceId)
      .then(value => { if (current) setItems(value) }).catch(() => {})
    return () => { current = false }
  }, [userId, workspaceId])
  if (!items.length) return null
  return <section aria-label="Saved relationship insights" className="min-w-0 border-y border-gray-200 py-5"><h2 className="text-base font-semibold">Saved relationship insights</h2><div className="grid min-w-0 gap-x-6 md:grid-cols-2">{items.map(item => <EvidenceLink key={item.insight_id} card={item.evidence} />)}</div></section>
}
