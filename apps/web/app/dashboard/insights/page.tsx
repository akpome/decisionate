"use client"

import { InsightCard } from "@/features/insights/components/insight-card"
import { generateInsights } from "@/features/insights/utils/generate-insights"
import { useDatasetStore } from "@/features/datasets/store/dataset-store"

export default function InsightsPage() {
  const rows = useDatasetStore(
    (state) => state.rows
  )

  const fileName = useDatasetStore(
    (state) => state.fileName
  )

  const insights =
    generateInsights(rows)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Insights
        </h1>

        <p className="mt-2 text-gray-500">
          {fileName
            ? `Insights generated from ${fileName}`
            : "Upload a dataset to generate insights"}
        </p>
      </div>

      {!rows.length && (
        <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
          <h2 className="text-xl font-semibold">
            No dataset uploaded
          </h2>

          <p className="mt-2 text-gray-500">
            Upload a CSV file to begin generating insights.
          </p>
        </div>
      )}

      {insights.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {insights.map((insight, index) => (
            <InsightCard
              key={index}
              insight={insight}
            />
          ))}
        </div>
      )}
    </div>
  )
}