import type { CatalogDataset } from "@/features/relationships/types"
import type { ImpactAnalysis, ImpactTimingEvidence } from "./impact-types"
import { newImpactStudy } from "./impact-types"
import { impactHistoryWindow } from "./impact-builder-state"
import { editableDefinition, type ReportDecision, type ReportDefinition } from "./types"

export type DecisionImpactReview = {
  review_id: string; decision_id: number; report_id: string | null; created_at: string
  definition: ReportDefinition; analysis: ImpactAnalysis; matches_current_decision: boolean
}
export type DecisionReviewContext = {
  decision: ReportDecision; outcome: { dataset_id: number; metric_key: string } | null
  decision_revision: string; latest_review: DecisionImpactReview | null
  decision_period?: { start: string; end: string } | null; outcome_date_column?: string | null
  decision_grain?: string | null; available_through?: string
  timing_evidence?: ImpactTimingEvidence | null
}

export function automaticImpactDefinition(definition: ReportDefinition, context: DecisionReviewContext, datasets: CatalogDataset[]): ReportDefinition {
  if (!definition.impact?.decision_id || definition.impact.decision_id !== context.decision.id) return definition
  const outcome = definition.metrics.find(metric => metric.dataset_id === definition.impact?.outcome?.dataset_id && metric.metric_key === definition.impact.outcome.metric_key)
  const availability = outcome && datasets.find(dataset => dataset.dataset_id === outcome.dataset_id)?.availability[outcome.date_column]
  const shared = definition.impact.comparison ? impactHistoryWindow(definition, datasets) : availability
  const previous = context.latest_review?.matches_current_decision ? context.latest_review.definition : null
  const start = context.decision_period?.start || previous?.date_range.start || availability?.start || definition.date_range.start
  const grain = context.decision_grain || context.timing_evidence?.grain || previous?.grain || "daily"
  let dateRange = { start, end: "" }
  if (shared) {
    const end = context.available_through && context.available_through < shared.end ? context.available_through : shared.end
    // Match the API's ten-year DateRange limit while retaining the latest results.
    const earliest = new Date(`${end}T00:00:00Z`)
    earliest.setUTCDate(earliest.getUTCDate() - 3653)
    dateRange = { start: [start, shared.start, earliest.toISOString().slice(0, 10)].sort().at(-1)!, end }
  }
  return { ...definition, grain: grain === "quarterly" ? "weekly" : grain, date_range: dateRange }
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
    date_range: { ...(previous?.date_range || context.decision_period || availability || { start: "", end: "" }) },
    impact: { ...newImpactStudy(), ...(previous?.impact || {}), decision_id: context.decision.id, decision_revision: context.decision_revision,
      change: context.decision.action || "", outcome, comparison_unaffected: false, other_changes: "not_sure",
      timing_evidence: context.timing_evidence || null,
      timing_finding_id: context.timing_evidence?.choices?.some(item => item.finding_id === previous?.impact?.timing_finding_id)
        ? previous!.impact!.timing_finding_id : context.timing_evidence?.finding_id || null },
  })
}
