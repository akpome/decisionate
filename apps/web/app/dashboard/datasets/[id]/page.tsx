"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { InsightCard } from "@/features/insights/components/insight-card"
import { RevenueChart } from "@/features/dashboard/components/revenue-chart"

const API_URL =
  "http://localhost:8000"

export default function DatasetDetailsPage() {
  const params = useParams()

  const [dataset, setDataset] =
    useState<any>(null)

  const [loading, setLoading] =
    useState(true)

  useEffect(() => {
    async function loadDataset() {
      try {
        const response =
          await fetch(
            `${API_URL}/datasets/${params.id}/details`
          )

        const data =
          await response.json()
        setDataset(data)

        console.log(
        "PREVIEW",
        data.preview
        )

      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    loadDataset()
  }, [params.id])

  if (loading) {
    return (
      <div>
        Loading dataset...
      </div>
    )
  }

  if (!dataset) {
    return (
      <div>
        Dataset not found.
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}

      <div>
        <h1 className="text-3xl font-bold">
          {dataset.file_name}
        </h1>

        <p className="mt-2 text-gray-500">
          {dataset.row_count} rows •{" "}
          {dataset.column_count} columns
        </p>
      </div>

      {/* Metrics */}

        <div>
            <h2 className="mb-4 text-2xl font-bold">
                Metrics
            </h2>

            <div className="grid gap-6 md:grid-cols-3">
                {dataset.metrics?.map(
                (metric: any) => (
                    <MetricCard
                    key={metric.column}
                    title={metric.column}
                    value={metric.total}
                    description={`Average ${metric.average}`}
                    />
                )
                )}
            </div>
        </div>

      {/* Insights */}

        <div>
            <h2 className="mb-4 text-2xl font-bold">
                Insights
            </h2>

            <div className="grid gap-6 md:grid-cols-2">
                {dataset.insights?.map(
                (
                    insight: any,
                    index: number
                ) => (
                    <InsightCard
                    key={index}
                    insight={insight}
                    />
                )
                )}
            </div>
        </div>

      {/* Chart */}

        {dataset.chart && (
        <RevenueChart
            data={dataset.chart.data}
            xKey={dataset.chart.x_key}
            yKey={dataset.chart.y_key}
        />
        )}

      {/* Preview */}

      {/* Preview */}

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">
                Dataset Preview
            </h2>

            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                        {dataset.preview?.[0] &&
                            Object.keys(
                            dataset.preview[0]
                            ).map((column) => (
                            <th
                                key={column}
                                className="border-b px-4 py-3 text-left font-medium text-gray-600"
                            >
                                {column}
                            </th>
                            ))}
                        </tr>
                    </thead>

                <tbody>
                    {dataset.preview?.map(
                    (
                        row: any,
                        index: number
                    ) => (
                        <tr key={index}>
                        {Object.values(row).map(
                            (value: any, i) => (
                            <td
                                key={i}
                                className="border-b px-4 py-3 text-gray-700"
                            >
                                {String(value)}
                            </td>
                            )
                        )}
                        </tr>
                    )
                    )}
                </tbody>
                </table>
            </div>
        </div>
    </div>
  )
}