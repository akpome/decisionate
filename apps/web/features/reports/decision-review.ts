import type { CatalogDataset } from "@/features/relationships/types"
import type { ImpactAnalysis } from "./impact-types"
import { newImpactStudy } from "./impact-types"
import { editableDefinition, type ReportDecision, type ReportDefinition } from "./types"

export type DecisionImpactReview = {
  review_id: string; decision_id: number; report_id: string | null; created_at: string
  definition: ReportDefinition; analysis: ImpactAnalysis; matches_current_decision: boolean
}
export type DecisionReviewContext = {
  decision: ReportDecision; outcome: { dataset_id: number; metric_key: string } | null
  decision_revision: string; latest_review: DecisionImpactReview | null
}

export function decisionReviewDefinition(current: ReportDefinition, context: DecisionReviewContext, source?: CatalogDataset) {
  const previous = context.latest_review?.matches_current_decision ? context.latest_review.definition : null
  const base = previous || current
  const outcome = context.outcome
  const descriptor = source?.metrics.find(item => item.metric_key === outcome?.metric_key)
  const dateColumn = previous?.metrics.find(item => item.dataset_id === outcome?.dataset_id)?.date_column || source?.date_columns.find(column => source.availability[column]) || source?.date_columns[0]
  const reference = descriptor && dateColumn && outcome ? { ...outcome, date_column: dateColumn, aggregation: descriptor.aggregation } : null
  const metrics = reference ? [reference, ...base.metrics.filter(item => item.dataset_id !== reference.dataset_id || item.metric_key !== reference.metric_key)] : base.metrics
  const availability = dateColumn && source?.availability[dateColumn]
  return editableDefinition({ ...base, scope: "multi", name: current.name, included_findings: null, source_run_id: null,
    business_question: current.business_question || `Did this decision improve the result: ${context.decision.title}?`.slice(0, 1000),
    metrics, grain: base.grain === "quarterly" ? "weekly" : base.grain,
    date_range: availability ? { start: previous?.date_range.start || availability.start, end: availability.end } : base.date_range,
    impact: { ...newImpactStudy(), ...(previous?.impact || {}), decision_id: context.decision.id, decision_revision: context.decision_revision,
      change: context.decision.action || "", outcome, comparison_unaffected: false, other_changes: "not_sure" },
  })
}
