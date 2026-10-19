import type { DecisionEvidenceMetric } from "@/lib/api"
import { formatMetricLabel } from "@/features/dashboard/components/metric-selector"

export function DecisionEvidenceContext({ context, metrics, loading, unavailable }: {
  context: string; metrics: DecisionEvidenceMetric[]; loading: boolean; unavailable: boolean
}) {
  return <div className="mt-3 min-w-0 space-y-3 text-sm">
    <div>
      <h3 className="font-medium text-gray-700">Selected evidence metrics</h3>
      {loading ? <p role="status" className="mt-1 text-gray-500">Loading selected metrics...</p>
        : unavailable ? <p className="mt-1 text-amber-800">Selected evidence metrics are unavailable.</p>
          : metrics.length === 0 ? <p className="mt-1 text-gray-500">No selected evidence metrics.</p>
            : <ul className="mt-2 space-y-1 text-gray-600">{metrics.map(metric => <li key={JSON.stringify([metric.dataset_id, metric.metric_column])} className="break-words">{metric.file_name} / {formatMetricLabel(metric.metric_column)}</li>)}</ul>}
    </div>
    <details className="min-w-0 border-t border-gray-200 pt-3 text-xs text-gray-500">
      <summary className="cursor-pointer font-medium">Original evidence record</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{context}</pre>
    </details>
  </div>
}
