interface RecommendationCardProps {
    title: string
    message: string
    confidence: string
    reason: string
}

export function RecommendationCard({
    title,
    message,
    confidence,
    reason
}: RecommendationCardProps) {
    return (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">
                {title}
            </h2>

            <p className="mt-3 text-gray-600">
                {message}
            </p>

            <p className="mt-3 text-sm text-gray-500">
                {reason}
            </p>

            <div className="mt-4">
                <span className="rounded-full border px-3 py-1 text-sm">
                    Confidence:
                    {" "}
                    {confidence}
                </span>
            </div>
        </div>
    )
}