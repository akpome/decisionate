"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChartNoAxesCombined, RefreshCw } from "lucide-react"
import { correlationRequest, type DecisionRecord } from "@/lib/api"
import type { DecisionImpactReview } from "@/features/reports/decision-review"
import { ImpactResult } from "@/features/reports/impact-result"

export function DecisionImpactReviews({ decision, userId, workspaceId, canReview }: {
  decision: DecisionRecord; userId: string; workspaceId?: string; canReview: boolean
}) {
  const [reviews, setReviews] = useState<DecisionImpactReview[]>([])
  const [selected, setSelected] = useState("")
  const [offset, setOffset] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [restricted, setRestricted] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError("")
      try {
        const value = await correlationRequest<{ reviews: DecisionImpactReview[]; next_offset: number | null; restricted?: boolean }>(userId,
          `/business-reports/decision-reviews/${decision.id}?offset=${offset}`, { signal: controller.signal }, workspaceId)
        if (!controller.signal.aborted) {
          setReviews(current => offset ? [...new Map([...current, ...value.reviews].map(item => [item.review_id, item])).values()] : value.reviews)
          setNext(value.next_offset)
          setRestricted(current => offset ? current || Boolean(value.restricted) : Boolean(value.restricted))
        }
      } catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Impact assessments could not be loaded.") }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [decision.id, decision.updated_at, userId, workspaceId, offset, retry])
  const review = reviews.find(item => item.review_id === selected) || reviews[0]
  const ready = Boolean(decision.action?.trim() && decision.metric_column)
  return <section id="business-impact-review" aria-label="Business impact review" className="min-w-0 scroll-mt-20 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Business impact review</h2>
      {canReview && ready && <Link className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium" href={`/dashboard/reports?decision=${decision.id}`}><ChartNoAxesCombined size={16} />Assess business impact</Link>}
    </div>
    {canReview && !ready && <p className="text-sm text-gray-600">An action and an outcome metric are needed. <Link href="#decision-title" className="text-blue-700 underline">Open Decision Details</Link></p>}
    {error && <div role="alert" className="flex items-start gap-3 text-sm text-red-700"><p className="min-w-0 break-words">{error}</p><button type="button" disabled={loading} title="Retry impact assessments" aria-label="Retry impact assessments" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} /></button></div>}
    {loading && <p role="status" className="text-sm text-gray-600">Loading impact assessments...</p>}
    {restricted && <p className="text-sm text-amber-800">Some assessments are unavailable with your current data access.</p>}
    {!loading && !error && !restricted && reviews.length === 0 && <p className="text-sm text-gray-500">No impact assessment saved for this decision.</p>}
    {review && <>
      {reviews.length > 1 && <label className="block max-w-xl text-xs font-medium text-gray-600">Saved assessments<select className="mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" value={review.review_id} onChange={event => setSelected(event.target.value)}>{reviews.map(item => <option key={item.review_id} value={item.review_id}>{item.created_at.slice(0, 10)} / {item.analysis.window.start} to {item.analysis.window.end}</option>)}</select></label>}
      {!review.matches_current_decision && <p className="text-sm text-amber-800">The decision&apos;s action, outcome metric or expected result changed after this assessment. This is historical evidence.</p>}
      <ImpactResult analysis={review.analysis} />
      {review.report_id && <Link className="inline-flex min-h-10 items-center text-sm text-blue-700 underline" href={`/dashboard/reports?report=${encodeURIComponent(review.report_id)}`}>Open assessment report</Link>}
    </>}
    {next !== null && <button type="button" className="min-h-10 text-sm text-blue-700 underline" disabled={loading} onClick={() => setOffset(next)}>Earlier assessments</button>}
  </section>
}
