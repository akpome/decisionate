import type { CorrelationMetric, MetricRef } from "@/features/relationships/types"

type MetricKey = { dataset_id: number; metric_key: string }
export type ImpactStudy = {
  decision_id?: number | null; decision_revision?: string | null
  change: string; change_date: string; outcome: MetricKey | null; comparison: MetricKey | null
  comparison_reason: string; comparison_unaffected: boolean; other_changes: "none_known" | "yes" | "not_sure"
  desired_direction: "increase" | "decrease"; worthwhile_change: number | null
}
export type ImpactAnalysis = {
  engine_version: string; method: string; status: "estimated" | "not_ready"; evidence_grade: "model_estimated" | "not_established"
  change: string; change_date: string; window: { start: string; end: string }; grain: string
  outcome: CorrelationMetric | null; comparison: CorrelationMetric | null; comparison_reason: string
  headline: string; summary: string; next_steps: string[]; assumptions: string[]; limitations: string[]
  before_periods: number | null; after_periods: number | null
  baseline?: { kind: "comparison" | "comparison_with_yearly_adjustment"; annual_adjustment: boolean; annual_history_available: boolean; message: string } | null
  checks: { key: string; passed: boolean; message: string; details: Record<string, unknown> }[]
  estimate: { effect: number; lower: number; upper: number; confidence_level: number; verdict: "helped" | "hurt" | "unclear"
    per_period_effect: number; actual: number; expected_without_change: number; relative_percent: number | null
    is_total: boolean; worthwhile_change: number | null; worthwhile_result: "likely" | "unlikely" | "unclear" | null } | null
  trend: { period: string; actual: number; without_change: number; after_change: boolean }[]
}

export function newImpactStudy(): ImpactStudy {
  return { change: "", change_date: "", outcome: null, comparison: null, comparison_reason: "", comparison_unaffected: false,
    other_changes: "not_sure", desired_direction: "increase", worthwhile_change: null }
}

export function retainedImpactStudy(study: ImpactStudy | null | undefined, metrics: MetricRef[], resetComparison = false) {
  if (!study) return null
  const contains = (key: MetricKey | null) => key && metrics.some(item => item.dataset_id === key.dataset_id && item.metric_key === key.metric_key)
  return { ...study, outcome: contains(study.outcome) ? study.outcome : null, comparison: contains(study.comparison) ? study.comparison : null,
    comparison_unaffected: resetComparison ? false : study.comparison_unaffected }
}

export function impactReady(study: ImpactStudy | null | undefined, metrics: MetricRef[]) {
  if (!study) return true
  const selected = (key: MetricKey | null) => key && metrics.some(item => item.dataset_id === key.dataset_id && item.metric_key === key.metric_key)
  return Boolean(study.decision_id && study.change.trim() && study.change_date && study.comparison_reason.trim().length >= 10 &&
    selected(study.outcome) && selected(study.comparison) && study.outcome!.dataset_id !== study.comparison!.dataset_id)
}

export function impactEvidenceSummary(context?: string | null): { headline: string; summary: string } | null {
  try {
    const value = JSON.parse(context || "null")
    if (value?.evidence_kind !== "business_report") return null
    const analysis = value.impact_analysis
    if (!["estimated", "not_ready"].includes(analysis?.status) || typeof analysis.headline !== "string" || typeof analysis.summary !== "string") return null
    return { headline: analysis.headline, summary: analysis.summary }
  } catch { return null }
}
