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
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="text-sm uppercase tracking-wide text-gray-500">
                Recommended Action
            </p>

            <h2 className="mt-2 text-4xl font-bold">
                {title}
            </h2>

            <p className="mt-6 text-lg">
                {decisionBrief}
            </p>

            <div className="mt-6">
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
                    className="rounded-lg border px-4 py-2 cursor-pointer hover:bg-gray-50 transition"
                >
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