import type {
  AIAnalysis,
  DecisionCreatePayload,
} from "@/lib/api"
import {
  getAIAnalysisLearningContext,
  getAIAnalysisSourceLabel,
} from "@/features/ai/lib/analysis-copy"

export {
  getAIRecommendationSource,
} from "./ai-recommendation-source"
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
    recommendation_text: recommendation,
    recommendation_source: analysis.source,
    recommendation_context: metricContext,
    title: `Review ${metricContext} recommendation`,
    action: recommendation,
    description: [
      analysis.summary,
      `Recommendation: ${recommendation}`,
      `Decision target: ${metricContext}`,
      learningContext,
      `Decisionate AI source: ${sourceLabel}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    expected_outcome: `Measure whether ${metricContext} improves after applying this recommendation, then record the result and lesson learned.`,
    confidence_score: analysis.confidence,
  }
}
