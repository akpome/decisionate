export type CorrelationCapabilities = { api: boolean; ui: boolean; widgets: boolean; lag: boolean; ai: boolean }
export type MetricRef = { dataset_id: number; metric_key: string; date_column: string; aggregation: string }
export type CatalogMetric = { dataset_id: number; metric_key: string; label: string; aggregation: string; unit: string; currency: string | null; definition: string; components: string[]; missing_fraction: number; constant: boolean; currency_unresolved: boolean }
export type CatalogDataset = { dataset_id: number; dataset_label: string; connector: string; date_columns: string[]; metrics: CatalogMetric[]; availability: Record<string, { start: string; end: string }>; error_code?: string }
export type CorrelationDefinition = { name: string; metrics: MetricRef[]; method: "pearson" | "spearman"; grain: string; date_range: { start: string; end: string }; filters: { minimum_abs_coefficient: number; minimum_observations: number }; lag: { enabled: boolean; minimum: number; maximum: number; direction: string }; advanced: boolean }
export type CorrelationRun = { analysis_id: string; run_id: string; status: string; progress: { phase: string; completed_pairs: number; total_pairs: number; prepared_metrics: number }; error_code: string | null; computed_at: string | null; definition: CorrelationDefinition; summary: { warnings?: string[]; quality?: Record<string, unknown> } }
export type CorrelationMetric = MetricRef & { id: string; label: string; dataset_label: string; connector: string; unit: string; currency: string | null }
export type RelationshipCard = { result_id: string; run_id: string; analysis_id: string; metric_a: CorrelationMetric; metric_b: CorrelationMetric; coefficient: number | null; coefficient_change?: number | null; observations: number; reliability: string; method: string; grain: string; eligible: boolean; p_value: number | null; adjusted_p_value: number | null; warnings: string[]; lag: { periods: number; unit: string; lead_metric: string }; window: { start: string; end: string }; computed_at: string | null }
export type RelationshipDetail = RelationshipCard & { evidence: { period: string; a: number; b: number }[]; lag_profile: { lag: number; coefficient: number | null; n: number; eligible: boolean }[] }
export type CorrelationMatrix = { metrics: CorrelationMetric[]; cells: { a: string; b: string; result_id: string; coefficient: number | null; n: number; lag: number; lead_metric: string; reliability: string }[]; method: string; grain: string; window: { start: string; end: string } }
export type CorrelationWidget = { widget_id: string; widget_type: string; analysis_id: string; name: string; updating: boolean; last_refresh_status: string; stale: boolean; cards: RelationshipCard[] }

export const metricIdentity = (metric: Pick<MetricRef, "dataset_id" | "metric_key">) => `${metric.dataset_id}:${metric.metric_key}`
export const coefficientText = (value: number | null) => value === null ? "Not available" : value.toFixed(2)
export const isActiveRun = (run: CorrelationRun | null) => Boolean(run && ["queued", "running"].includes(run.status))
export function heatmapColor(value: number | null) {
  if (value === null) return "#e5e7eb"
  if (value <= -.7) return "#9f1239"
  if (value <= -.4) return "#fda4af"
  if (value < -.05) return "#ffe4e6"
  if (value < .05) return "#ffffff"
  if (value < .4) return "#d1fae5"
  if (value < .7) return "#6ee7b7"
  return "#047857"
}
