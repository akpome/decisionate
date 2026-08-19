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
  compact?: boolean
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
  compact = false,
}: AIAnalysisPanelProps) {
  const learningContextCopy =
    getAIAnalysisLearningContext(analysis)

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] ${compact ? "p-3" : "p-4"} shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--decisionate-brand-primary-text)]">
          {title}
        </p>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
          {analysis.confidence} confidence
        </span>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        {getAIAnalysisProvenance(analysis)}
      </p>

      {!compact && metric && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          Focused metric: {formatMetricLabel(metric)}
        </p>
      )}

      {metricContext && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          Decision target: {metricContext}
        </p>
      )}

      {!compact && metrics.length > 0 && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          Focused metrics: {metrics.join(", ")}
        </p>
      )}

      {learningContextCopy && (
        <p className="mt-1 text-xs font-medium text-gray-600">
          {learningContextCopy}
        </p>
      )}

      <p className={`mt-2 text-sm ${compact ? "leading-5" : "leading-6"} text-gray-700`}>
        {analysis.summary}
      </p>

      {compact ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {metric && (
            <div className="min-w-0 rounded-lg border border-[var(--decisionate-brand-primary-ring)]/70 bg-white/60 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Focused metric
              </p>
              <p className="mt-1 truncate text-xs font-medium text-gray-700">
                {formatMetricLabel(metric)}
              </p>
            </div>
          )}

          {analysis.recommendations.length > 0 && (
            <div className="min-w-0 rounded-lg border border-[var(--decisionate-brand-primary-ring)]/70 bg-white/60 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Recommendation
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">
                {analysis.recommendations.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        analysis.recommendations.length > 0 && (
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
        )
      )}

      {analysis.risks.length > 0 && (
        <div className={compact ? "mt-2" : "mt-3"}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Risks to review
          </p>
          <ul className={`mt-1 list-disc space-y-1 pl-5 ${compact ? "text-xs" : "text-sm"} text-gray-700`}>
            {analysis.risks.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {(onCreateDecision ||
        (onApplyRecommendation && analysis.recommendations[0])) && (
        <div className={`mt-auto flex flex-wrap items-center justify-start gap-2 ${compact ? "pt-3" : "pt-4"}`}>
          {onCreateDecision && (
            <button
              type="button"
              onClick={onCreateDecision}
              disabled={creatingDecision}
              className={`inline-flex items-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-3 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${actionClassName}`}
            >
              <PlusCircle size={16} />
              {creatingDecision
                ? "Creating decision..."
                : "Create decision"}
            </button>
          )}

          {onApplyRecommendation && analysis.recommendations[0] && (
            <button
              type="button"
              onClick={onApplyRecommendation}
              className={`inline-flex items-center gap-2 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] ${actionClassName}`}
            >
              <Lightbulb size={16} />
              {applyRecommendationLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
