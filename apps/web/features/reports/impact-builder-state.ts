import type { CatalogDataset, MetricRef } from "@/features/relationships/types"
import type { ReportDefinition } from "./types"

const matches = (left: { dataset_id: number; metric_key: string }, right?: { dataset_id: number; metric_key: string } | null) =>
  left.dataset_id === right?.dataset_id && left.metric_key === right?.metric_key

export function impactHistoryWindow(definition: ReportDefinition, datasets: CatalogDataset[]) {
  const study = definition.impact
  if (!study?.outcome || !study.comparison) return null
  const windows = [study.outcome, study.comparison].map(role => {
    const reference = definition.metrics.find(metric => matches(metric, role))
    return reference && datasets.find(dataset => dataset.dataset_id === role.dataset_id)?.availability[reference.date_column]
  })
  if (windows.some(window => !window)) return null
  return { start: windows.map(window => window!.start).sort().at(-1)!, end: windows.map(window => window!.end).sort()[0] }
}

export function changeImpactComparison(definition: ReportDefinition, comparison: MetricRef | null): Partial<ReportDefinition> {
  const study = definition.impact
  if (!study || comparison?.dataset_id === study.outcome?.dataset_id) return {}
  const metrics = definition.metrics.filter(metric => !matches(metric, study.comparison) || matches(metric, study.outcome))
  if (comparison && !metrics.some(metric => matches(metric, comparison))) metrics.push(comparison)
  const impact = { ...study, comparison: comparison ? { dataset_id: comparison.dataset_id, metric_key: comparison.metric_key } : null,
    comparison_reason: comparison && matches(comparison, study.comparison) ? study.comparison_reason : "",
    comparison_unaffected: false }
  return { metrics, impact }
}

export function impactSetupIssue(definition: ReportDefinition, datasets?: CatalogDataset[]): string {
  const study = definition.impact
  if (!study) return ""
  if (!study.decision_id) return "Choose the decision you want to check."
  if (!study.change.trim()) return "Record what you changed in Decision Details."
  if (!study.outcome || !definition.metrics.some(metric => matches(metric, study.outcome))) return "Choose the result to measure in Decision Details."
  if (!study.change_date) return "Add the date you started making the change."
  if (!study.comparison || !definition.metrics.some(metric => matches(metric, study.comparison))) return "Choose a comparison dataset and result."
  if (study.comparison.dataset_id === study.outcome.dataset_id) return "The comparison must come from another dataset."
  if (datasets) for (const role of [study.outcome, study.comparison]) {
    const source = datasets.find(dataset => dataset.dataset_id === role.dataset_id)
    const reference = definition.metrics.find(metric => matches(metric, role))
    if (!source || source.catalog_status === "pending") return "Waiting for the selected dataset's results and dates."
    if (source.error_code || !source.metrics.some(metric => metric.metric_key === role.metric_key && metric.aggregation === reference?.aggregation) || !reference || !source.availability[reference.date_column]) return "A selected result or date column is unavailable. Review its dataset or choose another comparison."
  }
  const shared = datasets && impactHistoryWindow(definition, datasets)
  if (shared && shared.start > shared.end) return "These datasets have no overlapping dates. Choose another comparison dataset."
  if (shared && definition.date_range.start && definition.date_range.end && (definition.date_range.end < shared.start || definition.date_range.start > shared.end)) return "The comparison has no data in the decision's analysis period. Choose another comparison or adjust the analysis period explicitly."
  if (study.comparison_reason.trim().length < 10) return "Add a short explanation of why the comparison was not affected."
  if (!definition.date_range.start || !definition.date_range.end) return "Choose the history start and end dates."
  if (definition.date_range.start >= study.change_date || definition.date_range.end < study.change_date) return "Include dates both before and after the change."
  if (definition.dimension_filters?.some(filter => definition.metrics.some(metric => metric.dataset_id === filter.dataset_id) && !filter.values.length)) return "Choose at least one value for each active dimension filter."
  if (definition.dimension_filters?.some(filter => filter.dataset_id === study.comparison?.dataset_id && filter.values.length > 1)) return "Choose one unique value for the comparison."
  if (!definition.name.trim() || definition.business_question.trim().length < 8) return "Complete the report name and business question under Report details."
  return ""
}
