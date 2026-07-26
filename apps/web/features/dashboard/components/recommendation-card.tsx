import {
    PlusCircle,
} from "lucide-react"

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
    return (
        <div className="rounded-2xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
                            Recommended Action
                        </p>

                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                            {capitalize(confidence)} confidence
                        </span>
                    </div>

                    <h2 className="mt-2 break-words text-2xl font-semibold text-gray-950">
                        {title}
                    </h2>

                    <p className="mt-3 break-words text-base leading-7 text-gray-800">
                        {decisionBrief}
                    </p>

                    <p className="mt-3 break-words text-sm leading-6 text-gray-600">
                        <span className="font-semibold text-gray-800">
                            Why:
                        </span>
                        {" "}
                        {reason}
                    </p>

                    {source && (
                        <p className="mt-2 break-words text-xs text-gray-500">
                            Analysis basis: {source}
                        </p>
                    )}

                    {learningContext && (
                        <p className="mt-1 break-words text-xs text-gray-500">
                            {learningContext}
                        </p>
                    )}
                </div>

                {onCreateDecision && (
                    <div className="lg:justify-self-end">
                        <button
                            type="button"
                            onClick={onCreateDecision}
                            disabled={creatingDecision}
                            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"
                        >
                            <PlusCircle size={16} />
                            {
                                creatingDecision
                                    ? "Creating..."
                                    : "Create Decision"
                            }
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
