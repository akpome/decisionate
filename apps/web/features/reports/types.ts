import type { CorrelationDefinition, CorrelationMetric } from "@/features/relationships/types"
import type { AIAnalysis, DatasetDimensionFilter } from "@/lib/api"
import { reportExcludedPairs, reportPairDirections, type ReportMetricPair, type ReportPairDirection } from "./pair-directions"
import { RELATIONSHIP_DEFAULTS } from "@/features/relationships/defaults"

export type ReportScope = "single" | "multi"
export type ReportDefinition = CorrelationDefinition & { scope: ReportScope; dimension_filters?: DatasetDimensionFilter[]; business_question: string; seasonal_business: boolean; include_ai_analysis: boolean; included_findings: string[] | null; source_run_id?: string | null; pair_directions: ReportPairDirection[]; excluded_pairs: ReportMetricPair[] }
export type ReportAnomalyMetric = {
  metric_id: string; dataset_id: number; dataset_label: string; metric_key: string; label: string
  unit?: string | null; currency?: string | null; status: "ready" | "limited_history" | "insufficient_history" | "unavailable"
  aggregation?: string; grain?: string
  observations: number; evaluated_observations: number; missing_observations: number; anomaly_count: number
  seasonal_requested: boolean; seasonalities: string[]; method: string[]; warnings: string[]
  history_window: { start: string; end: string }
  baselines: { start: string; end: string; history_start: string; history_end: string; observations: number; calibration_observations: number; seasonalities: string[]; method: string; spread: number }[]
  anomalies: { period: string; value: number; expected: number; lower: number; upper: number; deviation: number; deviation_percent: number | null; score: number | null; direction: "high" | "low"; seasonalities: string[] }[]
}
export type ReportAnomalyAnalysis = {
  engine_version: string; lookback_years: number; seasonal_business: boolean; anchor_date: string | null
  window: { start: string; end: string }; anomaly_count: number; threshold: number
  metrics: ReportAnomalyMetric[]; limitations: string[]
}
export type ReportMetric = CorrelationMetric & {
  value: number | null; previous_value: number | null; change: number | null; change_percent: number | null
  observations: number; expected_periods: number; warnings: string[]; trend: { period: string; value: number | null }[]
}
export type ReportFinding = {
  id: string; metric_a: CorrelationMetric; metric_b: CorrelationMetric; coefficient: number | null
  lag: number; lag_unit: string; lead_metric: string; observations: number; eligible: boolean
  adjusted_p_value: number | null; reliability: string; warnings: string[]; interpretation: string
  history_window: { start: string; end: string }; evidence: { period: string; a: number; b: number }[]
}
export type ReportDecision = {
  report_id?: string | null; action?: string | null; evidence_dataset_ids?: number[]; is_draft?: boolean
  id: number; title: string; status: string; owner_user_id: string; expected_outcome: string | null
  actual_outcome: string | null; outcome_status: string | null; review_date: string | null
  baseline: number | null; measured_value: number | null; change_percent: number | null
}
export type BusinessReport = {
  analysis_job_id?: string
  report_id?: string; decision_report_id?: string | null; name: string; business_question: string; definition: ReportDefinition
  window: { start: string; end: string }; previous_window: { start: string; end: string }
  history_window: { start: string; end: string }; grain: string; dataset_count: number
  status: "ready" | "limited_coverage"; analysis_source: string; generated_at: string
  metrics: ReportMetric[]; findings: ReportFinding[]; included_findings: string[]
  observations: string[]; contrasts: string[]; recommendations: string[]; warnings: string[]; limitations: string[]
  decisions: ReportDecision[]; decision_drafts?: ReportDecision[]
  anomaly_analysis?: ReportAnomalyAnalysis
  ai_analysis?: AIAnalysis | null
  source_analysis?: { run_id: string; engine_version: string; computed_at: string | null; note: string }
}

export function formatReportValue(value: number | null, currency?: string | null) {
  if (value === null || !Number.isFinite(value)) return "Unavailable"
  const validCurrency = currency && /^[A-Z]{3}$/.test(currency)
  return new Intl.NumberFormat("en", { ...(validCurrency ? { style: "currency", currency } : {}), maximumFractionDigits: 2 }).format(value)
}

export function editableDefinition(value: Partial<ReportDefinition>): ReportDefinition {
  return { name: value.name ?? "", business_question: value.business_question || "", scope: value.scope ?? "multi",
    seasonal_business: value.seasonal_business ?? false,
    include_ai_analysis: true,
    metrics: value.metrics || [], method: value.method || RELATIONSHIP_DEFAULTS.method, grain: value.grain || RELATIONSHIP_DEFAULTS.period,
    dimension_filters: value.dimension_filters || [],
    date_range: value.date_range || { start: "", end: "" }, advanced: false,
    filters: { minimum_abs_coefficient: value.filters?.minimum_abs_coefficient ?? RELATIONSHIP_DEFAULTS.minimumAbsCoefficient, minimum_observations: Math.max(RELATIONSHIP_DEFAULTS.minimumObservations, value.filters?.minimum_observations ?? RELATIONSHIP_DEFAULTS.minimumObservations) },
    lag: value.lag ? { ...value.lag, enabled: value.scope !== "single", minimum: Math.min(RELATIONSHIP_DEFAULTS.maximumLag, value.lag.minimum), maximum: Math.min(RELATIONSHIP_DEFAULTS.maximumLag, value.lag.maximum) } : { enabled: value.scope !== "single", minimum: RELATIONSHIP_DEFAULTS.lagPeriods, maximum: RELATIONSHIP_DEFAULTS.maximumLag, direction: "a_leads_b" },
    included_findings: value.included_findings ?? null, source_run_id: value.source_run_id ?? null,
    excluded_pairs: reportExcludedPairs(value.metrics || [], value.excluded_pairs),
    pair_directions: reportPairDirections(value.metrics || [], value.pair_directions, value.pair_directions == null && value.lag ? value.lag.direction === "b_leads_a" ? "b_leads_a" : "a_leads_b" : undefined) }
}

export function selectedReportDimensionFilters(value: Pick<ReportDefinition, "metrics" | "dimension_filters">) {
  const selected = new Set(value.metrics.map(metric => metric.dataset_id))
  return (value.dimension_filters || []).filter(filter => selected.has(filter.dataset_id))
}
