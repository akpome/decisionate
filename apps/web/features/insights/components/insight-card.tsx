import { Insight } from "../utils/generate-insights"
import { ArrowRight } from "lucide-react"

interface InsightCardProps {
  insight: Insight
  label?: string
  onCreateDecision?: () => void
  creatingDecision?: boolean
  actionDisabled?: boolean
}

export function InsightCard({
  insight,
  label = "Insight",
  onCreateDecision,
  creatingDecision = false,
  actionDisabled = false,
}: InsightCardProps) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-gray-400">
            {label}
          </p>

          <h3 className="mt-2 break-words text-lg font-semibold">
            {insight.title}
          </h3>
        </div>

        <p className="break-words text-sm leading-6 text-gray-600">
          {insight.description}
        </p>

        {onCreateDecision && (
          <button
            type="button"
            onClick={onCreateDecision}
            disabled={
              actionDisabled ||
              creatingDecision
            }
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 print:hidden"
          >
            <ArrowRight size={15} />
            {creatingDecision
              ? "Creating..."
              : "Create decision"}
          </button>
        )}
      </div>
    </div>
  )
}
