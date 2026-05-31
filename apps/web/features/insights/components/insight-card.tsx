import { Insight } from "../utils/generate-insights"

interface InsightCardProps {
  insight: Insight
}

export function InsightCard({
  insight,
}: InsightCardProps) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Insight
          </p>

          <h3 className="mt-2 text-lg font-semibold">
            {insight.title}
          </h3>
        </div>

        <p className="text-sm leading-6 text-gray-600">
          {insight.description}
        </p>
      </div>
    </div>
  )
}