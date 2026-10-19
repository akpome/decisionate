import type { BusinessReport } from "@/features/reports/types"

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
