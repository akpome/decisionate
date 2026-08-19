import type {
  DecisionCreatePayload,
} from "@/lib/api"

type InsightDecisionSource = {
  column?: string
  title: string
  description: string
}

export function buildInsightDecisionPayload(
  datasetId: number,
  insight: InsightDecisionSource,
  selectedMetric?: string,
  datasetName?: string,
): DecisionCreatePayload {
  const title =
    insight.title.trim() ||
    "Review generated insight"
  const description =
    insight.description.trim()
  const metricColumn =
    insight.column?.trim() || selectedMetric
  const decisionTarget = datasetName
    ? `${metricColumn || "dataset insight"} (${datasetName})`
    : metricColumn
      ? metricColumn
      : "dataset insight"
  const targetContext = datasetName
    ? `Decision target: ${decisionTarget}`
    : ""

  return {
    dataset_id: datasetId,
    metric_column: metricColumn,
    recommendation_text: description || undefined,
    recommendation_source: description
      ? "rules"
      : undefined,
    recommendation_context: decisionTarget,
    title,
    action: description || title,
    description: [
      description,
      targetContext,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined,
    expected_outcome: `Measure whether ${decisionTarget} changes after acting on this insight, then record the result and lesson learned.`,
  }
}
