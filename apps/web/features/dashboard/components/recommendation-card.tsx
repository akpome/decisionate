"use client"

import { CreateDecisionButton } from "@/features/decisions/components/create-decision-action"
import { useDecisionateText } from "@/app/use-decisionate-language"

interface RecommendationCardProps {
    title: string
    reason: string
    confidence: string
    decisionBrief: string
    source?: string
    learningContext?: string
    onCreateDecision?: () => void
    creatingDecision: boolean

}

function capitalize(
    value: string
) {
    return (
        value.charAt(0)
            .toUpperCase()
        + value.slice(1)
    )
}

export function RecommendationCard({
    title,
    confidence,
    decisionBrief,
    source,
    learningContext,
    onCreateDecision,
    reason,
    creatingDecision
}: RecommendationCardProps) {
    const { t } = useDecisionateText()

    return (
        <div className="h-full min-w-0 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-5 sm:p-6">
            <div className="flex h-full flex-col gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
                            {t("Recommended Action")}
                        </p>

                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                            {capitalize(t(confidence))} {t("confidence")}
                        </span>
                    </div>

                    <h2 className="mt-2 break-words text-xl font-semibold text-gray-950">
                        {title}
                    </h2>

                    <p className="mt-3 break-words text-base leading-7 text-gray-800">
                        {decisionBrief}
                    </p>

                    <p className="mt-3 break-words text-sm leading-6 text-gray-600">
                        <span className="font-semibold text-gray-800">
                            {t("Why:")}
                        </span>
                        {" "}
                        {reason}
                    </p>

                    {source && (
                        <p className="mt-2 break-words text-xs text-gray-500">
                            {t("Analysis basis:")} {source}
                        </p>
                    )}

                    {learningContext && (
                        <p className="mt-1 break-words text-xs text-gray-500">
                            {learningContext}
                        </p>
                    )}
                </div>

                {onCreateDecision && (
                    <div className="mt-auto">
                        <CreateDecisionButton
                            onClick={onCreateDecision}
                            creating={creatingDecision}
                            title="Create a decision from this recommendation"
                            className="w-full sm:w-auto"
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
