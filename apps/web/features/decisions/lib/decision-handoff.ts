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
    title,
    description: [
      description,
      targetContext,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined,
    expected_outcome:
      description ||
      `Review whether ${title.toLowerCase()} for ${decisionTarget} requires action.`,
  }
}
