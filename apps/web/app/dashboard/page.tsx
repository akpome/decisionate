"use client"

import { MetricCard } from "@/features/dashboard/components/metric-card"
import { RevenueChart } from "@/features/dashboard/components/revenue-chart"
import { useDatasetStore } from "@/features/datasets/store/dataset-store"

import {
  formatMetricValue,
  generateDatasetMetrics,
  getNumericColumns,
  getTextColumns,
} from "@/features/datasets/utils/dataset-analytics"

import { generateInsights } from "@/features/insights/utils/generate-insights"

export default function DashboardPage() {
  const rows = useDatasetStore(
    (state) => state.rows
  )

  const fileName = useDatasetStore(
    (state) => state.fileName
  )

  const metrics =
    generateDatasetMetrics(rows)

  const numericColumns =
    getNumericColumns(rows)

  const textColumns =
    getTextColumns(rows)

  /**
   * Auto-detect chart axes
   */

  const xKey =
    textColumns[0] ||
    Object.keys(rows[0] || {})[0]

  const yKey = numericColumns[0]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

        <p className="mt-2 text-gray-500">
          {fileName
            ? `Analyzing ${fileName}`
            : "Upload a dataset to begin"}
        </p>
      </div>

      {/* Empty State */}
      {!rows.length && (
        <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
          <h2 className="text-xl font-semibold">
            No dataset uploaded
          </h2>

          <p className="mt-2 text-gray-500">
            Upload a CSV file to generate
            automatic insights and charts.
          </p>
        </div>
      )}

      {/* Metrics */}
      {metrics.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {metrics.slice(0, 3).map((metric) => (
            <MetricCard
              key={metric.column}
              title={metric.column}
              value={formatMetricValue(
                metric.total
              )}
              description={`Average ${formatMetricValue(
                metric.average
              )}`}
            />
          ))}
        </div>
      )}

      {/* Chart */}
      {rows.length > 0 &&
        xKey &&
        yKey && (
          <RevenueChart
            data={rows}
            xKey={xKey}
            yKey={yKey}
          />
        )}
    </div>
  )
}