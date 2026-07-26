import {
  Lightbulb,
  PlusCircle,
} from "lucide-react"

import {
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import type { AIAnalysis } from "@/lib/api"
import {
  getAIAnalysisLearningContext,
  getAIAnalysisProvenance,
} from "@/features/ai/lib/analysis-copy"

type AIAnalysisPanelProps = {
  analysis: AIAnalysis
  title: string
  metric?: string
  metricContext?: string
  metrics?: string[]
  className?: string
  actionClassName?: string
  onCreateDecision?: () => void
  creatingDecision?: boolean
  onApplyRecommendation?: () => void
  applyRecommendationLabel?: string
}

export function AIAnalysisPanel({
  analysis,
  title,
  metric,
  metricContext,
  metrics = [],
  className = "",
  actionClassName = "",
  onCreateDecision,
  creatingDecision = false,
  onApplyRecommendation,
  applyRecommendationLabel = "Use recommendation",
}: AIAnalysisPanelProps) {
  const learningContextCopy =
    getAIAnalysisLearningContext(analysis)

  return (
    <div
      className={`rounded-2xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--decisionate-brand-primary-text)]">
          {title}
        </p>
        <span className="text-xs font-medium uppercase text-[var(--decisionate-brand-primary-text)]">
          {analysis.confidence} confidence
        </span>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        {getAIAnalysisProvenance(analysis)}
      </p>

      {metric && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          Focused metric: {formatMetricLabel(metric)}
        </p>
      )}

      {metricContext && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          Decision target: {metricContext}
        </p>
      )}

      {metrics.length > 0 && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          Focused metrics: {metrics.join(", ")}
        </p>
      )}

      {learningContextCopy && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          {learningContextCopy}
        </p>
      )}

      <p className="mt-2 text-sm leading-6 text-gray-700">
        {analysis.summary}
      </p>

      {analysis.recommendations.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recommendations
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {analysis.recommendations.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.risks.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Risks to review
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {analysis.risks.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {onCreateDecision && (
        <button
          type="button"
          onClick={onCreateDecision}
          disabled={creatingDecision}
          className={`mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${actionClassName}`}
        >
          <PlusCircle size={16} />
          {creatingDecision
            ? "Creating decision..."
            : "Create decision from analysis"}
        </button>
      )}

      {onApplyRecommendation && analysis.recommendations[0] && (
        <button
          type="button"
          onClick={onApplyRecommendation}
          className={`mt-3 inline-flex items-center gap-2 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] ${actionClassName}`}
        >
          <Lightbulb size={16} />
          {applyRecommendationLabel}
        </button>
      )}
    </div>
  )
}
