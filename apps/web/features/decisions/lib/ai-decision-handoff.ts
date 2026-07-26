import type {
  AIAnalysis,
  DecisionCreatePayload,
} from "@/lib/api"
import {
  getAIAnalysisLearningContext,
  getAIAnalysisSourceLabel,
} from "@/features/ai/lib/analysis-copy"
function formatMetricLabel(
  column: string
) {
  return column
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, character => character.toUpperCase())
}

export function buildAIRecommendationDecisionPayload(
  datasetId: number,
  metricColumn: string | undefined,
  analysis: AIAnalysis,
  datasetName?: string,
): DecisionCreatePayload | undefined {
  const recommendation =
    analysis.recommendations[0]

  if (!recommendation) {
    return undefined
  }

  const metricLabel = metricColumn
    ? formatMetricLabel(metricColumn)
    : "decision portfolio"
  const metricContext = datasetName
    ? `${metricLabel} (${datasetName})`
    : metricLabel
  const sourceLabel =
    getAIAnalysisSourceLabel(analysis)
  const learningContextCopy =
    getAIAnalysisLearningContext(analysis)
  const learningContext =
    learningContextCopy
      ? `Decisionate learning context: ${learningContextCopy}`
      : ""

  return {
    dataset_id: datasetId,
    metric_column: metricColumn || undefined,
    title: `Review ${metricContext} recommendation`,
    description: [
      analysis.summary,
      `Recommendation: ${recommendation}`,
      `Decision target: ${metricContext}`,
      learningContext,
      `Decisionate AI source: ${sourceLabel}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    expected_outcome: `Review and act on the ${metricContext} recommendation.`,
    confidence_score: analysis.confidence,
  }
}
