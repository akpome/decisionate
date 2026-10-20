import type { CorrelationDefinition, CorrelationMetric } from "@/features/relationships/types"

export type ReportDefinition = CorrelationDefinition & { business_question: string; included_findings: string[] | null; source_run_id?: string | null }
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
  report_id?: string; decision_report_id?: string | null; name: string; business_question: string; definition: ReportDefinition
  window: { start: string; end: string }; previous_window: { start: string; end: string }
  history_window: { start: string; end: string }; grain: string; dataset_count: number
  status: "ready" | "limited_coverage"; analysis_source: string; generated_at: string
  metrics: ReportMetric[]; findings: ReportFinding[]; included_findings: string[]
  observations: string[]; contrasts: string[]; recommendations: string[]; warnings: string[]; limitations: string[]
  decisions: ReportDecision[]; decision_drafts?: ReportDecision[]
  source_analysis?: { run_id: string; engine_version: string; computed_at: string | null; note: string }
}

export function formatReportValue(value: number | null, currency?: string | null) {
  if (value === null || !Number.isFinite(value)) return "Unavailable"
  const validCurrency = currency && /^[A-Z]{3}$/.test(currency)
  return new Intl.NumberFormat("en", { ...(validCurrency ? { style: "currency", currency } : {}), maximumFractionDigits: 2 }).format(value)
}

export function editableDefinition(value: Partial<ReportDefinition>): ReportDefinition {
  return { name: value.name || "Cross-dataset business review", business_question: value.business_question || "",
    metrics: value.metrics || [], method: value.method || "spearman", grain: value.grain || "daily",
    date_range: value.date_range || { start: "", end: "" }, advanced: false,
    filters: { minimum_abs_coefficient: value.filters?.minimum_abs_coefficient ?? .3, minimum_observations: Math.max(30, value.filters?.minimum_observations ?? 30) },
    lag: value.lag ? { ...value.lag, minimum: Math.min(12, value.lag.minimum), maximum: Math.min(12, value.lag.maximum) } : { enabled: false, minimum: 0, maximum: 12, direction: "a_leads_b" },
    included_findings: value.included_findings ?? null, source_run_id: value.source_run_id ?? null }
}
