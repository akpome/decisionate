import type { MetricRef, CorrelationDefinition } from "@/features/relationships/types"

export type PairDirection = "a_leads_b" | "b_leads_a" | "same_period"
export type ReportMetricKey = Pick<MetricRef, "dataset_id" | "metric_key">
export type ReportPairDirection = { metric_a: ReportMetricKey; metric_b: ReportMetricKey; direction: PairDirection }
type StoredPairDirection = Omit<ReportPairDirection, "direction"> & { direction: PairDirection | "both" }

const matches = (left: ReportMetricKey, right: ReportMetricKey) => left.dataset_id === right.dataset_id && left.metric_key === right.metric_key
const reverse = (mode: PairDirection): PairDirection => mode === "a_leads_b" ? "b_leads_a" : mode === "b_leads_a" ? "a_leads_b" : mode
const key = (metric: ReportMetricKey): ReportMetricKey => ({ dataset_id: metric.dataset_id, metric_key: metric.metric_key })
export const reportPairKey = (pair: Pick<ReportPairDirection, "metric_a" | "metric_b">) => JSON.stringify([pair.metric_a.dataset_id, pair.metric_a.metric_key, pair.metric_b.dataset_id, pair.metric_b.metric_key])

export function reportPairDirections(metrics: MetricRef[], configured: StoredPairDirection[] | null | undefined, legacyDirection?: "a_leads_b" | "b_leads_a"): ReportPairDirection[] {
  const sorted = [...metrics].sort((left, right) => left.dataset_id - right.dataset_id || (left.metric_key < right.metric_key ? -1 : left.metric_key > right.metric_key ? 1 : 0))
  return sorted.flatMap((left, index) => sorted.slice(index + 1).filter(right => left.dataset_id !== right.dataset_id).map(right => {
    const existing = configured?.find(pair => matches(pair.metric_a, left) && matches(pair.metric_b, right) || matches(pair.metric_a, right) && matches(pair.metric_b, left))
    let direction: PairDirection = "same_period"
    if (existing) {
      const mode = existing.direction === "both" ? "same_period" : existing.direction
      direction = matches(existing.metric_a, left) ? mode : reverse(mode)
    }
    else if (legacyDirection) direction = metrics.indexOf(left) < metrics.indexOf(right) ? legacyDirection : reverse(legacyDirection)
    return { metric_a: key(left), metric_b: key(right), direction }
  }))
}

export function reportTestCount(metrics: MetricRef[], configured: StoredPairDirection[] | null | undefined, lag: CorrelationDefinition["lag"]) {
  const positive = lag.enabled ? Math.max(0, lag.maximum - Math.max(1, lag.minimum) + 1) : 0
  return reportPairDirections(metrics, configured, configured == null ? lag.direction === "b_leads_a" ? "b_leads_a" : "a_leads_b" : undefined).reduce((total, pair) => total + 1 + (pair.direction === "same_period" ? 0 : positive), 0)
}
