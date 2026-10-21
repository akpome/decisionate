"use client"

import { X } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { coefficientText, type RelationshipDetail } from "./types"

export function RelationshipEvidence({ detail, onClose }: { detail: RelationshipDetail; onClose: () => void }) {
  const lead = detail.lag.lead_metric === detail.metric_a.id ? detail.metric_a : detail.metric_b
  return <section aria-label="Relationship evidence" className="min-w-0 border-y border-gray-200 py-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{detail.metric_a.label} / {detail.metric_b.label}</h2><p className="mt-1 break-words text-sm text-gray-500">{detail.metric_a.dataset_label} / {detail.metric_b.dataset_label}</p></div>
      <button type="button" onClick={onClose} title="Close evidence" aria-label="Close evidence" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border"><X size={18} /></button>
    </div>
    <dl className="my-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
      {[["Coefficient", coefficientText(detail.coefficient)], ["Observations", detail.observations], ["Method", detail.method], ["Reliability", detail.reliability], ["Window", `${detail.window.start} / ${detail.window.end}`], ["Raw p-value", detail.p_value?.toPrecision(3) ?? "Unavailable"], ["BH adjusted p-value", detail.adjusted_p_value?.toPrecision(3) ?? "Unavailable"], ["Computed", detail.computed_at ? new Date(detail.computed_at).toLocaleString() : "Unavailable"]].map(([name, value]) => <div key={name} className="min-w-0"><dt className="text-xs text-gray-500">{name}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
    </dl>
    <p className="text-sm text-gray-700">{detail.lag.periods ? `${lead.label} leads the other metric by ${detail.lag.periods} ${detail.lag.unit}.` : "Same-period association."} Association does not establish causation.</p>
    {detail.warnings.length > 0 && <ul className="my-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-amber-800">{detail.warnings.map(warning => <li key={warning}>{warning.replaceAll("_", " ")}</li>)}</ul>}
    <h3 className="mb-2 mt-5 text-sm font-medium">Aligned history (standard deviations from each metric&apos;s mean)</h3>
    <div className="h-60 min-w-0 w-full" aria-label="Normalized aligned time series">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={detail.evidence} margin={{ left: 0, right: 15 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={35} /><YAxis width={35} tick={{ fontSize: 10 }} /><Tooltip /><Line name={detail.metric_a.label} dataKey="a" stroke="#2563eb" dot={false} isAnimationActive={false} /><Line name={detail.metric_b.label} dataKey="b" stroke="#059669" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
    </div>
    {detail.lag_profile.length > 1 && <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><caption className="mb-2 text-left text-sm font-medium">Lag profile (shared periods)</caption><thead><tr>{["Lag", "Coefficient", "Observations", "Eligible"].map(value => <th key={value} className="whitespace-nowrap border-b px-3 py-2">{value}</th>)}</tr></thead><tbody>{detail.lag_profile.map(item => <tr key={item.lag}><td className="px-3 py-2">{item.lag}</td><td className="px-3 py-2">{coefficientText(item.coefficient)}</td><td className="px-3 py-2">{item.n}</td><td className="px-3 py-2">{item.eligible ? "Yes" : "No"}</td></tr>)}</tbody></table></div>}
  </section>
}
