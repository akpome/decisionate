import type { CatalogDataset } from "@/features/relationships/types"
import type { ImpactAnalysis, ImpactTimingEvidence } from "./impact-types"
import { newImpactStudy } from "./impact-types"
import { editableDefinition, type ReportDecision, type ReportDefinition } from "./types"

export type DecisionImpactReview = {
  review_id: string; decision_id: number; report_id: string | null; created_at: string
  definition: ReportDefinition; analysis: ImpactAnalysis; matches_current_decision: boolean
}
export type DecisionReviewContext = {
  decision: ReportDecision; outcome: { dataset_id: number; metric_key: string } | null
  decision_revision: string; latest_review: DecisionImpactReview | null
  decision_period?: { start: string; end: string } | null; outcome_date_column?: string | null
  timing_evidence?: ImpactTimingEvidence | null
}

export function decisionReviewDetails(decision: Pick<ReportDecision, "id" | "title">) {
  const title = decision.title.trim() || "Untitled decision"
  const prefix = "Business impact: ", suffix = ` (#${decision.id})`
  return {
    name: `${prefix}${title.slice(0, 120 - prefix.length - suffix.length)}${suffix}`,
    business_question: `Did the action in "${title.slice(0, 900)}" improve its recorded outcome?`,
  }
}

export function decisionReviewDefinition(current: ReportDefinition, context: DecisionReviewContext, source?: CatalogDataset) {
  const previous = context.latest_review?.matches_current_decision ? context.latest_review.definition : null
  const base = previous || current
  const outcome = context.outcome
  const descriptor = source?.metrics.find(item => item.metric_key === outcome?.metric_key)
  const dateColumn = previous?.metrics.find(item => item.dataset_id === outcome?.dataset_id)?.date_column || context.outcome_date_column || source?.date_columns.find(column => source.availability[column]) || source?.date_columns[0]
  const reference = descriptor && dateColumn && outcome ? { ...outcome, date_column: dateColumn, aggregation: descriptor.aggregation } : null
  const metrics = reference ? [reference, ...(previous?.metrics || []).filter(item => item.dataset_id !== reference.dataset_id || item.metric_key !== reference.metric_key)] : []
  const availability = dateColumn && source?.availability[dateColumn]
  return editableDefinition({ ...base, ...decisionReviewDetails(context.decision), scope: "multi", included_findings: null, source_run_id: null,
    metrics, grain: base.grain === "quarterly" ? "weekly" : base.grain,
    date_range: previous?.date_range || context.decision_period || availability || { start: "", end: "" },
    impact: { ...newImpactStudy(), ...(previous?.impact || {}), decision_id: context.decision.id, decision_revision: context.decision_revision,
      change: context.decision.action || "", outcome, comparison_unaffected: false, other_changes: "not_sure",
      timing_evidence: context.timing_evidence || null,
      timing_finding_id: context.timing_evidence?.choices?.some(item => item.finding_id === previous?.impact?.timing_finding_id)
        ? previous!.impact!.timing_finding_id : context.timing_evidence?.finding_id || null },
  })
}
