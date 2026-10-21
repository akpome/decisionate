"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, FileText, RefreshCw } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { RelationshipEvidence } from "@/features/relationships/relationship-detail"
import { RelationshipMatrix } from "@/features/relationships/relationship-matrix"
import type { CorrelationMatrix, CorrelationRun, RelationshipDetail } from "@/features/relationships/types"
import { historicalEvidenceHref } from "./legacy-relationship-destination"

export function HistoricalRelationshipEvidence({ userId, workspaceId }: { userId: string; workspaceId?: string }) {
  const [run, setRun] = useState<CorrelationRun | null>(null)
  const [matrix, setMatrix] = useState<CorrelationMatrix | null>(null)
  const [detail, setDetail] = useState<RelationshipDetail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const detailRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const request = <T,>(path: string) => correlationRequest<T>(userId, path, { signal: controller.signal }, workspaceId)
    async function load() {
      try {
        const params = new URLSearchParams(window.location.search)
        const selected = params.get("result") ? await request<RelationshipDetail>(`/correlation-results/${encodeURIComponent(params.get("result")!)}`) : null
        if (controller.signal.aborted) return
        const id = params.get("run") || selected?.run_id
        if (!id) throw new Error("No saved analysis was selected.")
        if (selected && selected.run_id !== id) throw new Error("The selected finding does not belong to this saved analysis.")
        const value = await request<CorrelationRun>(`/correlation-runs/${encodeURIComponent(id)}`)
        if (controller.signal.aborted) return
        const cells = value.status === "completed" ? await request<CorrelationMatrix>(`/correlation-runs/${encodeURIComponent(id)}/matrix`) : null
        if (!controller.signal.aborted) { setRun(value); setMatrix(cells); setDetail(selected) }
      } catch (value) {
        if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Saved evidence could not be loaded.")
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); detailRequest.current?.abort() }
  }, [userId, workspaceId, revision])

  async function selectResult(id: string) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setError("")
    try {
      const value = await correlationRequest<RelationshipDetail>(userId, `/correlation-results/${encodeURIComponent(id)}`, { signal: controller.signal }, workspaceId)
      if (controller.signal.aborted) return
      if (value.run_id !== run?.run_id) throw new Error("The selected finding does not belong to this saved analysis.")
      setDetail(value)
      window.history.replaceState(null, "", historicalEvidenceHref(value.run_id, value.result_id))
    } catch (value) {
      if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Saved finding could not be loaded.")
    }
  }

  return <div className="min-w-0 w-full space-y-6">
    <header className="space-y-4 border-b border-gray-200 pb-5">
      <Link href="/dashboard/reports" className="inline-flex min-h-10 items-center gap-2 text-sm text-blue-700 underline"><ArrowLeft size={16} />Reports</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="text-2xl font-semibold">Saved analysis evidence</h1><p className="mt-2 text-sm text-gray-600">Historical snapshot</p></div>{run?.status === "completed" && run.definition.metrics.length <= 25 && <Link href={`/dashboard/reports?run=${encodeURIComponent(run.run_id)}`} className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm"><FileText size={16} />Build report</Link>}</div>
    </header>
    {loading && <p role="status" className="py-8 text-sm text-gray-600">Loading saved evidence...</p>}
    {error && <div className="flex flex-wrap items-center gap-3 border-l-2 border-amber-500 pl-3 text-sm text-amber-900"><p role="alert" className="min-w-0 break-words">{error}</p><button type="button" disabled={loading} onClick={() => { setError(""); setLoading(true); setRevision(value => value + 1) }} title="Retry saved evidence" aria-label="Retry saved evidence" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border disabled:opacity-50"><RefreshCw size={16} /></button></div>}
    {run && <section className="min-w-0 space-y-3" aria-label="Saved analysis">
      <h2 className="break-words text-lg font-semibold">{run.definition.name}</h2>
      <p className="text-sm text-gray-600">{run.definition.date_range.start} to {run.definition.date_range.end} / {run.definition.method} / {run.definition.grain} / {run.definition.metrics.length} metrics</p>
      <p className="break-words text-xs text-gray-500">{run.engine_version}{run.computed_at ? ` / Computed ${new Date(run.computed_at).toLocaleString()}` : ""}</p>
      {run.status !== "completed" && <p role="status" className="text-sm text-amber-800">This historical analysis was not completed. Status: {run.status}. No saved results are available.</p>}
      {run.summary.warnings?.map(warning => <p key={warning} className="break-words text-xs text-amber-800">{warning}</p>)}
    </section>}
    {matrix && <RelationshipMatrix matrix={matrix} onSelect={id => void selectResult(id)} />}
    {detail && <RelationshipEvidence detail={detail} onClose={() => { detailRequest.current?.abort(); setDetail(null); window.history.replaceState(null, "", historicalEvidenceHref(detail.run_id)) }} />}
  </div>
}
