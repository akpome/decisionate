import { MAXIMUM_RELATIONSHIP_OBSERVATIONS, MINIMUM_RELATIONSHIP_OBSERVATIONS, RELATIONSHIP_DEFAULTS } from "@/features/relationships/defaults"
import type { BusinessReport, ReportDefinition } from "./types"

export function defaultReportQuestion(definition: ReportDefinition, weekly: boolean) {
  if (weekly) return "What changed last week, and what needs attention next?"
  return definition.scope !== "single" && definition.include_relationships !== false
    ? "How do the selected metrics move together, and what is worth investigating?"
    : "What changed in the selected metrics, and what needs attention?"
}

export function reportMetadataIssue(definition: ReportDefinition) {
  if (!definition.name.trim()) return "Enter a report name in Report details."
  const question = definition.business_question.trim()
  if (question && question.length < 8) return "Add a little more detail to the business question, or leave it blank."
  return ""
}

export function reportSetupIssue(definition: ReportDefinition, weekly: boolean, taskCount: number) {
  if (definition.impact) return ""
  if (!definition.metrics.length) return "Choose at least one metric to report on."
  const datasets = new Set(definition.metrics.map(metric => metric.dataset_id))
  if (definition.scope !== "single" && datasets.size < 2) return "Choose metrics from at least two datasets."
  if (definition.metrics.length > 25) return "Keep up to 25 metrics in this report."
  if (definition.metrics.some(metric => !metric.date_column)) return "Choose a date column for each selected dataset."
  if (definition.dimension_filters?.some(filter => datasets.has(filter.dataset_id) && !filter.values.length)) return "Choose a value for each selected dimension column."
  if (!weekly) {
    const { start, end } = definition.date_range
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    if (!validDate(start) || !validDate(end)) return "Choose valid start and end dates."
    if (start > end) return "The end date must be on or after the start date."
  }
  if (definition.scope !== "single" && definition.include_relationships !== false) {
    const minimum = definition.filters.minimum_observations
    if (!Number.isInteger(minimum) || minimum < MINIMUM_RELATIONSHIP_OBSERVATIONS || minimum > MAXIMUM_RELATIONSHIP_OBSERVATIONS) return `Minimum historical observations must be a whole number from ${MINIMUM_RELATIONSHIP_OBSERVATIONS} to ${MAXIMUM_RELATIONSHIP_OBSERVATIONS}.`
    if (!Number.isInteger(definition.lag.maximum) || definition.lag.maximum < definition.lag.minimum || definition.lag.maximum > RELATIONSHIP_DEFAULTS.maximumLag) return `Maximum delay must be a whole number from ${definition.lag.minimum} to ${RELATIONSHIP_DEFAULTS.maximumLag}.`
    if (taskCount > 1000) return "Remove some relationship pairs or reduce the maximum delay to stay within 1,000 checks."
  }
  return reportMetadataIssue(definition)
}

export function reportNextSteps(report: BusinessReport) {
  const seen = new Set<string>()
  return [...(report.ai_analysis?.recommendations || []), ...report.recommendations].filter(value => {
    const key = value.trim().replace(/\s+/g, " ").toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
