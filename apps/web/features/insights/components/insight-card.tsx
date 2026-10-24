interface InsightCardProps {
  insight: {
    title: string
    description: string
  }
  label?: string
}

export function InsightCard({
  insight,
  label = "Insight",
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

      </div>
    </div>
  )
}
