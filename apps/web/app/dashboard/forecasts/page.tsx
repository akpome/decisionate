"use client"

import { ForecastChart } from "@/features/dashboard/components/forecast-chart"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import {
  getDatasets,
  getForecast,
  getDatasetPreference,
} from "@/lib/api"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { MetricSelector } from "@/features/dashboard/components/metric-selector"

export default function ForecastsPage() {
  const { user } = useUser()

  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()

  const [forecast, setForecast] =
    useState<any>(null)

  const [selectedMetric, setSelectedMetric] =
    useState<string>()

  const [loading, setLoading] =
    useState(false)

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    async function loadDefaultDataset() {
      try {
        const preference =
          await getDatasetPreference(
            userId
          )

        if (
          preference.selected_dataset_id
        ) {
          setSelectedDatasetId(
            preference.selected_dataset_id
          )

          return
        }

        const datasets =
          await getDatasets(
            userId
          )

        if (datasets.length > 0) {
          setSelectedDatasetId(
            datasets[0].id
          )
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadDefaultDataset()
  }, [user?.id])

  useEffect(() => {
    if (!selectedDatasetId) return
    const datasetId = selectedDatasetId

    if (!user?.id) return
    const userId = user.id

    async function loadForecast() {
      try {
        setLoading(true)

        const data =
          await getForecast(
            datasetId,
            userId,
            selectedMetric
          )

        setForecast(data)

        if (!selectedMetric) {
          setSelectedMetric(
            data.forecast.value_column
          )
        }
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    loadForecast()
  }, [
    selectedDatasetId,
    selectedMetric,
    user?.id,
  ])

  const chartData =
    forecast
      ? [
        ...forecast.historical.map(
          (row: any) => ({
            period:
              row[
              forecast.forecast
                .date_column
              ],
            value:
              row[
              forecast.forecast
                .value_column
              ],
          })
        ),

        ...forecast.forecast.forecast.map(
          (
            value: number,
            index: number
          ) => ({
            period: `F${index + 1}`,
            value,
          })
        ),
      ]
      : []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Forecasts
        </h1>

        <p className="mt-2 text-gray-500">
          Forecast future trends from your datasets.
        </p>

        <div className="mt-4">
          <DatasetSelector
            value={selectedDatasetId}
            onChange={setSelectedDatasetId}
          />
          <div className="mt-4">
            <MetricSelector
              metrics={
                forecast?.forecast
                  ?.available_metrics ?? []
              }
              value={selectedMetric}
              onChange={
                setSelectedMetric
              }
            />
          </div>
        </div>
      </div>

      {loading && !forecast && (
        <div className="rounded-xl border bg-white p-6">
          Loading forecast...
        </div>
      )}

      {forecast && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">
            Forecast Results
          </h2>

          <div className="space-y-2">
            <p>
              Dataset:
              {" "}
              {forecast.file_name}
            </p>

            <p>
              Time Column:
              {" "}
              {forecast.forecast.date_column}
            </p>

            <p>
              Metric:
              {" "}
              {forecast.forecast.value_column}
            </p>
          </div>

          <div className="mt-6">
            <ForecastChart
              data={chartData}
            />
          </div>
        </div>
      )}
    </div>
  )
}