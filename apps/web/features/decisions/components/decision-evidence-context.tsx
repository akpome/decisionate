import type { DecisionEvidenceMetric } from "@/lib/api"
import { formatMetricLabel } from "@/features/dashboard/components/metric-selector"
import { decisionNarrativeText } from "../lib/decision-evidence-text"

export function DecisionEvidenceContext({ context, recommendationText, description, metrics, loading, unavailable }: {
  context?: string | null; recommendationText?: string | null; description?: string | null
  metrics: DecisionEvidenceMetric[]; loading: boolean; unavailable: boolean
}) {
  const recommendation = decisionNarrativeText(recommendationText)
  const originals = [
    { label: "Recommendation", value: recommendationText },
    { label: "Description", value: description && decisionNarrativeText(description) !== description ? description : null },
    { label: "Context", value: context },
  ].filter(item => item.value)
  return <div className="mt-3 min-w-0 space-y-3 text-sm">
    {recommendation && <p className="whitespace-pre-wrap break-words leading-6 text-gray-800">{recommendation}</p>}
    <div>
      <h3 className="font-medium text-gray-700">Selected evidence metrics</h3>
      {loading ? <p role="status" className="mt-1 text-gray-500">Loading selected metrics...</p>
        : unavailable ? <p className="mt-1 text-amber-800">Selected evidence metrics are unavailable.</p>
          : metrics.length === 0 ? <p className="mt-1 text-gray-500">No selected evidence metrics.</p>
            : <ul className="mt-2 space-y-1 text-gray-600">{metrics.map(metric => <li key={JSON.stringify([metric.dataset_id, metric.metric_column])} className="break-words">{metric.file_name} / {formatMetricLabel(metric.metric_column)}</li>)}</ul>}
    </div>
    {originals.length > 0 && <details className="min-w-0 border-t border-gray-200 pt-3 text-xs text-gray-500">
      <summary className="cursor-pointer font-medium">Original evidence record</summary>
      <dl className="mt-2 space-y-3">{originals.map(item => <div key={item.label}>
        <dt className="font-medium">{item.label}</dt>
        <dd><pre className="mt-1 whitespace-pre-wrap break-words font-sans">{item.value}</pre></dd>
      </div>)}</dl>
    </details>}
  </div>
}
