import Link from "next/link"
import type { ImpactStudy } from "./impact-types"

export function ImpactTiming({ study, onChange }: { study: ImpactStudy; onChange: (patch: Partial<ImpactStudy>) => void }) {
  const evidence = study.timing_evidence
  const choices = evidence?.choices || []
  const chosen = choices.find(item => item.finding_id === study.timing_finding_id)
  const timing = chosen || (evidence?.status === "supported" && choices.length <= 1 ? evidence : null)
  const unit = timing?.grain && { daily: "day", weekly: "week", monthly: "month", quarterly: "quarter" }[timing.grain]
  const overlaps = evidence?.history_window && study.change_date && evidence.history_window.end >= study.change_date
  return <div className="min-w-0 space-y-2 border-l-2 border-gray-300 pl-3 text-sm leading-6" aria-label="Timing from earlier analysis">
    <h3 className="font-semibold">Timing from earlier analysis</h3>
    {choices.length > 1 && <label className="block min-w-0 font-medium">Which relationship informed this decision?<select
      aria-label="Which relationship informed this decision?"
      className="mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
      value={study.timing_finding_id !== undefined ? study.timing_finding_id || "" : evidence?.finding_id || ""} onChange={event => onChange({ timing_finding_id: event.target.value || null })}>
      <option value="">Choose an earlier relationship</option>{choices.map(item => <option key={item.finding_id} value={item.finding_id}>{item.driver_label}</option>)}
    </select></label>}
    {timing && timing.lag != null && unit ? <>
      <p className="break-words">{timing.lag ? <>Earlier records showed {timing.driver_label} moving {timing.lag} {unit}{timing.lag === 1 ? "" : "s"} ahead of the outcome.</>
        : <>{timing.driver_label} and the result moved together within the same grouped {unit}.</>}</p>
      <p className="text-gray-600">Historical timing may differ from this action&apos;s actual response. Both early and later results count.</p>
    </> : <p className="text-amber-900">{evidence?.message || "No verified timing is linked to this decision. A delay will not be assumed."}</p>}
    {overlaps && <p role="status" className="text-amber-900">Timing must come from history before implementation. This analysis includes later dates.</p>}
    {evidence?.report_id ? <Link className="inline-flex min-h-10 items-center text-blue-700 underline" href={`/dashboard/reports?report=${encodeURIComponent(evidence.report_id)}`}>Open the earlier analysis</Link>
      : <Link className="inline-flex min-h-10 items-center text-blue-700 underline" href="/dashboard/reports">Explore relationships</Link>}
  </div>
}
