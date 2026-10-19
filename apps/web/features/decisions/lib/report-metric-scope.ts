import type { BusinessReport } from "@/features/reports/types"
import type { DecisionEvidenceMetric } from "@/lib/api"

export function selectedReportMetrics(report: Pick<BusinessReport, "definition" | "metrics">) {
  const available = new Map(report.metrics.map(metric => [JSON.stringify([metric.dataset_id, metric.metric_key]), metric]))
  const seen = new Set<string>()
  return (report.definition?.metrics || []).flatMap(reference => {
    const key = JSON.stringify([reference.dataset_id, reference.metric_key])
    const metric = available.get(key)
    if (!metric || seen.has(key)) return []
    seen.add(key)
    return [metric]
  })
}

export function decisionEvidenceHref(decisionId: number, references: BusinessReport["definition"]["metrics"]) {
  const selected = references.map(metric => [metric.dataset_id, metric.metric_key])
  const query = new URLSearchParams({ evidence_metrics: JSON.stringify(selected) })
  return `/dashboard/decisions/${decisionId}?${query}`
}

export function selectedDecisionEvidence(metrics: DecisionEvidenceMetric[], selection: string | null) {
  if (selection === null) return metrics
  try {
    if (selection.length > 32768) return []
    const references: unknown = JSON.parse(selection)
    if (!Array.isArray(references) || references.length > 25 || references.some(reference =>
      !Array.isArray(reference) || reference.length !== 2 || !Number.isSafeInteger(reference[0]) ||
      reference[0] < 1 || typeof reference[1] !== "string" || !reference[1]
    )) return []
    const selected = new Set(references.map(reference => JSON.stringify(reference)))
    return metrics.filter(metric => selected.has(JSON.stringify([metric.dataset_id, metric.metric_column])))
  } catch {
    return []
  }
}
