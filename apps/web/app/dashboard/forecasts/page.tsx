"use client"

import { ForecastChart } from "@/features/dashboard/components/forecast-chart"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { RecommendationCard }
  from "@/features/dashboard/components/recommendation-card"
import { ForecastSummaryCard }
  from "@/features/dashboard/components/forecast-summary-card"

import {
  getDatasets,
  getForecast,
  getDatasetPreference,
  updateDatasetPreference,
  createDecision,
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

  const [creatingDecision,
    setCreatingDecision] =
    useState(false)

  function formatMetricName(
    metric: string
  ) {
    return metric
      .split("_")
      .map(
        word =>
          word.charAt(0)
            .toUpperCase()
          + word.slice(1)
      )
      .join(" ")
  }

  const metricName =
    forecast
      ? formatMetricName(
        forecast.forecast
          .value_column
      )
      : ""

  const verb =
    metricName.endsWith("s")
      ? "are"
      : "is"

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

          if (
            preference.selected_metric
          ) {
            setSelectedMetric(
              preference.selected_metric
            )
          }

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
    if (!selectedDatasetId) {
      setForecast(null)

      return
    }
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

  const currentValue =
    forecast
      ? forecast.historical[
      forecast.historical.length
      - 1
      ][
      forecast.forecast
        .value_column
      ]
      : 0

  const forecastValue =
    forecast
      ? forecast.forecast
        .forecast[
      forecast.forecast
        .forecast.length
      - 1
      ]
      : 0

  const growth =
    currentValue === 0
      ? 0
      : (
        (
          forecastValue
          - currentValue
        )
        / currentValue
      ) * 100

  const direction =
    growth >= 0
      ? "increase"
      : "decrease"

  const decisionBrief =
    forecast
      ? `${metricName} ${verb} projected to ${direction} from ${currentValue.toLocaleString()} to ${forecastValue.toLocaleString()} (${growth.toFixed(
        1
      )}%).`
      : ""

  async function handleCreateDecision() {
    if (creatingDecision) {
      return
    }

    if (
      !forecast ||
      !user?.id ||
      !selectedDatasetId
    ) {
      return
    }

    try {
      setCreatingDecision(true)

      await createDecision(
        {
          dataset_id:
            selectedDatasetId,

          title:
            forecast.forecast
              .recommendation
              .title,

          description:
            decisionBrief,
        },

        user.id
      )

      alert(
        "Decision created"
      )
    } catch (error) {
      console.error(error)
    } finally {
      setCreatingDecision(false)
    }
  }

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
            onChange={(id) => {
              setSelectedMetric(
                undefined
              )

              setSelectedDatasetId(
                id
              )
            }}
          />
          <div className="mt-4">
            <MetricSelector
              metrics={
                forecast?.forecast
                  ?.available_metrics ?? []
              }
              value={selectedMetric}
              onChange={async (metric) => {
                setSelectedMetric(
                  metric
                )

                if (user?.id) {
                  try {
                    await updateDatasetPreference(
                      selectedDatasetId!,
                      user.id,
                      metric
                    )
                  } catch (error) {
                    console.error(error)
                  }
                }
              }}
            />          </div>
        </div>
      </div>

      {loading && !forecast && (
        <div className="rounded-xl border bg-white p-6">
          Loading forecast...
        </div>
      )}

      {forecast && (
        <div className="grid gap-6 lg:grid-cols-2">
          {forecast?.forecast?.recommendation && (
            <RecommendationCard
              title={
                forecast.forecast
                  .recommendation.title
              }
              decisionBrief={
                decisionBrief
              }
              reason={
                forecast.forecast
                  .recommendation.reason
              }
              confidence={
                forecast.forecast
                  .recommendation.confidence
              }
              onCreateDecision={
                handleCreateDecision
              }
              creatingDecision={
                creatingDecision
              }
            />
          )}

          <ForecastSummaryCard
            currentValue={
              currentValue
            }
            forecastValue={
              forecastValue
            }
          />
        </div>
      )}

      {forecast && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">
              Forecast Trend
            </h2>

            <p className="text-sm text-gray-500">
              Historical values and projected future performance.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border px-3 py-1 text-sm">
              {forecast.file_name}
            </span>

            <span className="rounded-full border px-3 py-1 text-sm">
              {forecast.forecast.value_column}
            </span>
          </div>

          <div className="mt-6">
            <div className="mb-6 rounded-xl bg-gray-50 p-4">
              <p className="font-medium">
                Forecast Insight
              </p>

              <p className="mt-2 text-sm text-gray-600">
                Expected change:
                {" "}
                {growth.toFixed(1)}%
                {" "}
                over the forecast period.
              </p>
            </div>
            <ForecastChart
              data={chartData}
            />
          </div>
        </div>
      )}
    </div>
  )
}