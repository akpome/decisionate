import {
    PlusCircle,
} from "lucide-react"

interface RecommendationCardProps {
    title: string
    reason: string
    confidence: string
    decisionBrief: string
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
    onCreateDecision,
    reason,
    creatingDecision
}: RecommendationCardProps) {
    return (
        <div className="rounded-lg border bg-white p-6 shadow-sm">
            <p className="text-sm uppercase tracking-wide text-gray-500">
                Recommended Action
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
                {title}
            </h2>

            <p className="mt-5 text-base leading-7 text-gray-800">
                {decisionBrief}
            </p>

            <div className="mt-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Reason
                </p>

                <p className="mt-2 text-gray-600">
                    {reason}
                </p>
            </div>

            <div className="mt-6 text-sm text-gray-600">
                <span className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Confidence:
                </span>
                {" "}
                {capitalize(confidence)}
            </div>

            <div className="mt-6">
                <button
                    onClick={onCreateDecision}
                    disabled={creatingDecision}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <PlusCircle size={16} />
                    {
                        creatingDecision
                            ? "Creating..."
                            : "Create Decision"
                    }
                </button>
            </div>
        </div>
    )
}
