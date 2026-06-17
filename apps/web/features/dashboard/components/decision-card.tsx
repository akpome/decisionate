interface DecisionCardProps {
  recommendation: string
}

export function DecisionCard({
  recommendation,
}: DecisionCardProps) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">
        Decision
      </h2>

      <p className="mt-4">
        {recommendation}
      </p>

      <div className="mt-6 flex gap-3">
        <button
          className="rounded-lg border px-4 py-2"
        >
          Accept
        </button>

        <button
          className="rounded-lg border px-4 py-2"
        >
          Reject
        </button>
      </div>
    </div>
  )
}