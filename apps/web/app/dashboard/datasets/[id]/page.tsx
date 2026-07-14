"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  LineChart,
} from "lucide-react"
import { MetricCard } from "@/features/dashboard/components/metric-card"
import { InsightCard } from "@/features/insights/components/insight-card"
import { RevenueChart } from "@/features/dashboard/components/revenue-chart"

import {
  getDatasetDetails,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  formatSourceValue,
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

type DatasetCellValue =
  | string
  | number
  | boolean
  | null
  | undefined

type DatasetRow =
  Record<string, DatasetCellValue>

type DatasetMetric = {
  column: string
  total: number
  average: number
}

type DatasetInsight = {
  title: string
  description: string
}

type DatasetDetails = {
  file_name: string
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  row_count: number
  column_count: number
  metrics?: DatasetMetric[]
  insights?: DatasetInsight[]
  chart?: {
    data: DatasetRow[]
    x_key: string
    y_key: string
  }
  preview?: DatasetRow[]
}

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

function getDatasetRouteId(
  routeId: string | string[] | undefined
) {
  const rawRouteId =
    Array.isArray(routeId)
      ? routeId[0]
      : routeId

  if (!rawRouteId) {
    return null
  }

  const datasetId = Number(rawRouteId)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : null
}

function formatPreviewValue(
  value: DatasetCellValue
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—"
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False"
  }

  return String(value)
}

export default function DatasetDetailsPage() {
  const params = useParams()

  const [dataset, setDataset] =
    useState<DatasetDetails | null>(null)

  const [loading, setLoading] =
    useState(true)
  const [errorMessage, setErrorMessage] =
    useState("")

  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(user?.id)

  useEffect(() => {
    if (!user?.id) return

    const userId = user.id
    const datasetId =
      getDatasetRouteId(params.id)

    async function loadDataset() {
      if (datasetId === null) {
        setDataset(null)
        setErrorMessage("Dataset not found.")
        setLoading(false)
        return
      }

      try {
        setLoading(true)

        const data =
          await getDatasetDetails(
            datasetId,
            userId,
            activeWorkspaceId
          )
        setDataset(data)
        setErrorMessage("")
      } catch (error) {
        console.error(error)
        setDataset(null)
        setErrorMessage(
          getErrorMessage(
            error,
            "Could not load dataset."
          )
        )
      } finally {
        setLoading(false)
      }
    }

    loadDataset()
  }, [
    params.id,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  if (loading) {
    return (
      <div>
        Loading dataset...
      </div>
    )
  }

  if (!dataset) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {errorMessage ||
          "Dataset not found."}
      </div>
    )
  }

  const sourceDetails =
    getDatasetSourceDetails(
      dataset.source_type,
      dataset.source_config,
      dataset.source_label
    )
  const datasetId =
    getDatasetRouteId(params.id)

  return (
    <div className="space-y-8">
      {/* Header */}

      <div>
        <Link
          href="/dashboard/datasets"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={16} />
          Back to Datasets
        </Link>

        <h1 className="text-3xl font-bold">
          {dataset.file_name}
        </h1>

        <p className="mt-2 text-gray-500">
          {dataset.row_count} rows •{" "}
          {dataset.column_count} columns •{" "}
          {sourceDetails.label}
        </p>

        {sourceDetails.originalFileName && (
          <p className="mt-1 text-sm text-gray-400">
            Original file:{" "}
            {sourceDetails.originalFileName}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/dashboard/forecasts?dataset=${datasetId ?? ""}`}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <LineChart size={16} />
          Forecast
        </Link>

        <Link
          href={`/dashboard?dataset=${datasetId ?? ""}`}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <BarChart3 size={16} />
          Dashboard
        </Link>

        <Link
          href={`/dashboard/decisions/new?dataset=${datasetId ?? ""}&returnTo=${encodeURIComponent(`/dashboard/datasets/${datasetId ?? ""}`)}`}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ClipboardList size={16} />
          New Decision
        </Link>
      </div>

      {sourceDetails.config && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">
            Source
          </h2>

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <AnalyticsField
              label="Ingestion"
              value={
                sourceDetails.ingestionMode ||
                "Unknown"
              }
            />
            <AnalyticsField
              label="Format"
              value={formatSourceValue(
                sourceDetails.format
              )}
            />
            <AnalyticsField
              label="Original file"
              value={
                sourceDetails.originalFileName ||
                dataset.file_name
              }
            />
            <AnalyticsField
              label="Extension"
              value={
                sourceDetails.fileExtension ||
                "Unknown"
              }
            />
          </div>
        </div>
      )}

      {/* Metrics */}

      <div>
        <h2 className="mb-4 text-2xl font-bold">
          Metrics
        </h2>

        <div className="grid gap-6 md:grid-cols-3">
          {dataset.metrics?.map(
            (metric) => (
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
              insight,
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
              {dataset.preview?.length ? (
                dataset.preview.map(
                  (
                    row,
                    index: number
                  ) => (
                    <tr key={index}>
                      {Object.values(row).map(
                        (value, i) => (
                          <td
                            key={i}
                            className="border-b px-4 py-3 text-gray-700"
                          >
                            {formatPreviewValue(
                              value
                            )}
                          </td>
                        )
                      )}
                    </tr>
                  )
                )
              ) : (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500">
                    No preview rows available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AnalyticsField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase text-gray-500">
        {label}
      </p>

      <p className="mt-2 break-words text-gray-800">
        {value}
      </p>
    </div>
  )
}
