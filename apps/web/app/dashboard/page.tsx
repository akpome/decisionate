"use client"

import { useEffect, useState } from "react"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { RevenueChart } from "@/features/dashboard/components/revenue-chart"
import { getDatasetDetails, getDatasets } from "@/lib/api"

export default function DashboardPage() {
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()

  const [dataset, setDataset] =
    useState<any>(null)

  const [loading, setLoading] =
    useState(false)

  useEffect(() => {
    if (!selectedDatasetId) return

    async function loadDataset() {
      try {
        setLoading(true)

        const data =
          await getDatasetDetails(
            selectedDatasetId!
          )

        setDataset(data)
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    loadDataset()
  }, [selectedDatasetId])

  useEffect(() => {
    async function loadDefaultDataset() {
      try {
        const datasets =
          await getDatasets()

        if (datasets.length > 0) {
          const latestDataset =
            datasets[0]

          setSelectedDatasetId(
            latestDataset.id
          )
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadDefaultDataset()
  }, [])

  return (
    <div className="space-y-8">
      {/* Header */}

      <div>
        <h1 className="text-3xl font-bold">
          Dashboard
        </h1>

        <div className="mt-4">
          <DatasetSelector
            value={selectedDatasetId}
            onChange={setSelectedDatasetId}
          />
        </div>

        <p className="mt-2 text-gray-500">
          {dataset
            ? `Analyzing ${dataset.file_name}`
            : "Select a dataset"}
        </p>
      </div>

      {/* Empty State */}

      {!selectedDatasetId && (
        <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
          <h2 className="text-xl font-semibold">
            No dataset selected
          </h2>

          <p className="mt-2 text-gray-500">
            Select a dataset to view
            metrics and insights.
          </p>
        </div>
      )}

      {/* Loading */}

      {loading && (
        <div className="rounded-xl border bg-white p-6">
          Loading dataset...
        </div>
      )}

      {/* Metrics */}

      {dataset?.metrics?.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {dataset.metrics
            .slice(0, 3)
            .map((metric: any) => (
              <MetricCard
                key={metric.column}
                title={metric.column}
                value={metric.total}
                description={`Average ${metric.average}`}
              />
            ))}
        </div>
      )}

      {/* Chart */}

      {dataset?.chart && (
        <RevenueChart
          data={dataset.chart.data}
          xKey={dataset.chart.x_key}
          yKey={dataset.chart.y_key}
        />
      )}
    </div>
  )
}