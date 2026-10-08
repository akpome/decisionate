import { Insight } from "../utils/generate-insights"
import { CreateDecisionButton } from "@/features/decisions/components/create-decision-action"

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
    <div className="flex h-full min-w-0 flex-col rounded-lg border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-1 flex-col gap-3">
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
          <div className="mt-auto pt-2">
            <CreateDecisionButton
              onClick={onCreateDecision}
              disabled={actionDisabled}
              creating={creatingDecision}
              title={`Create a decision from ${insight.title}`}
              className="w-full sm:w-auto"
            />
          </div>
        )}
      </div>
    </div>
  )
}
