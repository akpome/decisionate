"use client"

import { ForecastChart } from "@/features/dashboard/components/forecast-chart"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import { RecommendationCard }
  from "@/features/dashboard/components/recommendation-card"
import { ForecastSummaryCard }
  from "@/features/dashboard/components/forecast-summary-card"

import {
  type DatasetSummary,
  type ForecastResponse,
  getDatasets,
  getForecast,
  getDatasetPreference,
  updateDatasetPreference,
  createDecision,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { MetricSelector } from "@/features/dashboard/components/metric-selector"

// Forecast error helper: converts unknown failures into readable UI messages.
function getForecastPageErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error
    ? error.message
    : fallbackMessage
}

function getForecastUnavailableMessage(
  error: unknown
) {
  const message =
    getForecastPageErrorMessage(
      error,
      ""
    )

  if (message === "No date column found") {
    return "This dataset does not include a recognizable date column, so Decisionate cannot create a time-based forecast from it. Choose a dataset with a date, month, year, time, period, or quarter column."
  }

  if (message === "No numeric column found") {
    return "This dataset does not include a numeric metric column to forecast. Choose a dataset with at least one numeric measure."
  }

  if (message.includes("is not numeric")) {
    return "The selected metric is not numeric, so it cannot be forecasted. Choose a numeric metric from this dataset."
  }

  return ""
}

function toFiniteForecastNumber(
  value: unknown
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null
  }

  if (
    typeof value === "string" &&
    !value.trim()
  ) {
    return null
  }

  const numericValue = Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function formatForecastNumber(
  value: number | null
) {
  return (value ?? 0).toLocaleString()
}

function getInitialForecastDatasetId() {
  if (typeof window === "undefined") {
    return undefined
  }

  const params =
    new URLSearchParams(
      window.location.search
    )
  const value =
    params.get("dataset")

  if (!value) {
    return undefined
  }

  const datasetId = Number(value)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : undefined
}

export default function ForecastsPage() {
  // Auth and navigation: Clerk identifies ownership; router opens created decisions.
  const { user } = useUser()
  const router = useRouter()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)

  // Dataset and forecast state: controls which dataset metric is being forecasted.
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()
  const [initialDatasetId] =
    useState<number | undefined>(
      () => getInitialForecastDatasetId()
    )

  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])

  const [forecast, setForecast] =
    useState<ForecastResponse | null>(null)

  const [selectedMetric, setSelectedMetric] =
    useState<string>()

  const [loading, setLoading] =
    useState(false)

  const [creatingDecision,
    setCreatingDecision] =
    useState(false)

  const [pageError, setPageError] =
    useState("")
  const [
    forecastUnavailableMessage,
    setForecastUnavailableMessage,
  ] = useState("")

  const selectedDataset =
    datasets.find(
      (dataset) =>
        dataset.id === selectedDatasetId
    )
  const selectedDatasetSource =
    selectedDataset
      ? getDatasetSourceDetails(
          selectedDataset.source_type,
          selectedDataset.source_config,
          selectedDataset.source_label
        )
      : forecast
        ? getDatasetSourceDetails(
            forecast.source_type,
            forecast.source_config,
            forecast.source_label
          )
      : null

  // Display helpers: converts backend metric keys into user-facing labels.
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

  // Default dataset loading: restores the user's preferred dataset and metric.
  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    async function loadDefaultDataset() {
      try {
        setPageError("")

        const [
          preference,
          datasetsResult,
        ] = await Promise.all([
          getDatasetPreference(
              userId,
              activeWorkspaceId
          ),
          getDatasets(
              userId,
              activeWorkspaceId
          ),
        ])

        setDatasets(datasetsResult)

        const initialDataset =
          initialDatasetId
            ? datasetsResult.find(
                (dataset) =>
                  dataset.id ===
                  initialDatasetId
              )
            : undefined

        if (initialDataset) {
          setSelectedDatasetId(
            initialDataset.id
          )

          setSelectedMetric(
            preference.selected_dataset_id ===
              initialDataset.id
              ? preference.selected_metric ??
                  undefined
              : undefined
          )

          return
        }

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

        if (datasetsResult.length > 0) {
          setSelectedDatasetId(
            datasetsResult[0].id
          )
        }
      } catch (error) {
        console.error(error)

        setPageError(
          getForecastPageErrorMessage(
            error,
            "Unable to load your saved forecast preferences."
          )
        )
      }
    }

    loadDefaultDataset()
  }, [
    activeWorkspaceId,
    initialDatasetId,
    user?.id,
    workspaceVersion,
  ])

  // Forecast loading: refreshes the chart whenever dataset or metric changes.
  useEffect(() => {
    if (!selectedDatasetId) {
      return
    }
    const datasetId = selectedDatasetId

    if (!user?.id) return
    const userId = user.id

    async function loadForecast() {
      try {
        setLoading(true)
        setPageError("")
        setForecastUnavailableMessage("")

        const data =
          await getForecast(
            datasetId,
            userId,
            selectedMetric,
            activeWorkspaceId
          )

        setForecast(data)

        if (!selectedMetric) {
          setSelectedMetric(
            data.forecast.value_column
          )
        }
      } catch (error) {
        const unavailableMessage =
          getForecastUnavailableMessage(
            error
          )

        if (unavailableMessage) {
          setForecast(null)
          setForecastUnavailableMessage(
            unavailableMessage
          )
        } else {
          console.error(error)

          setPageError(
            getForecastPageErrorMessage(
              error,
              "Unable to load this forecast."
            )
          )
        }
      } finally {
        setLoading(false)
      }
    }

    loadForecast()
  }, [
    selectedDatasetId,
    selectedMetric,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  // Chart data preparation: combines historical values with forecasted periods.
  const chartData =
    (() => {
      if (!forecast) {
        return []
      }

      const historicalRows =
        forecast.historical
          .map((row) => {
            const value =
              toFiniteForecastNumber(
                row[
                  forecast.forecast
                    .value_column
                ]
              )

            if (value === null) {
              return null
            }

            return {
              period:
                String(
                  row[
                    forecast.forecast
                      .date_column
                  ]
                ),
              historicalValue: value,
              forecastValue: null,
            }
          })
          .filter(
            (row): row is {
              period: string
              historicalValue: number
              forecastValue: null
            } => row !== null
          )

      const forecastRows =
        forecast.forecast.forecast
          .map((value, index) => {
            const cleanValue =
              toFiniteForecastNumber(value)

            if (cleanValue === null) {
              return null
            }

            return {
              period:
                forecast.forecast
                  .forecast_periods?.[
                    index
                  ] ?? `F${index + 1}`,
              historicalValue: null,
              forecastValue: cleanValue,
            }
          })
          .filter(
            (row): row is {
              period: string
              historicalValue: null
              forecastValue: number
            } => row !== null
          )

      return [
        ...historicalRows.map(
          (row, index) => ({
            ...row,
            forecastValue:
              index ===
                historicalRows.length - 1
                ? row.historicalValue
                : null,
          })
        ),
        ...forecastRows,
      ]
    })()

  // Forecast summary metrics: derives current value, future value, and growth direction.
  const currentValue =
    forecast?.forecast.summary
      ? forecast.forecast.summary
          .current_value
      : forecast
        ? toFiniteForecastNumber(
          forecast.historical[
            forecast.historical.length -
              1
          ]?.[
            forecast.forecast
              .value_column
          ]
        )
        : null

  const forecastValue =
    forecast?.forecast.summary
      ? forecast.forecast.summary
          .forecast_value
      : forecast
        ? toFiniteForecastNumber(
          forecast.forecast.forecast[
            forecast.forecast.forecast
              .length - 1
          ]
        )
        : null
  const forecastPeriod =
    forecast?.forecast.summary
      ?.forecast_period ??
    (forecast
      ? forecast.forecast
          .forecast_periods?.[
            forecast.forecast
              .forecast_periods.length - 1
          ] ?? null
      : null)

  const currentValueForDisplay =
    currentValue ?? 0
  const forecastValueForDisplay =
    forecastValue ?? 0
  const absoluteChange =
    forecast?.forecast.summary
      ?.absolute_change ??
    (
      forecastValue === null ||
      currentValue === null
        ? 0
        : forecastValue - currentValue
    )

  const growth =
    forecast?.forecast.summary
      ?.percent_change ??
    (
      currentValue === null ||
      currentValue === 0 ||
      forecastValue === null
        ? 0
        : (
          (
            forecastValue
            - currentValue
          )
          / currentValue
        ) * 100
    )

  const direction =
    forecast?.forecast.summary
      ?.direction ??
    (
      growth > 0
        ? "increase"
        : growth < 0
          ? "decrease"
          : "stable"
    )
  const directionPhrase =
    direction === "stable"
      ? "remain stable"
      : direction === "increase"
        ? "show an increase"
        : "show a decrease"

  // Decision recommendation copy: reused when saving a forecast as a decision.
  const decisionBrief =
    forecast
      ? `${metricName} ${verb} projected to ${directionPhrase} from ${formatForecastNumber(currentValue)} to ${formatForecastNumber(forecastValue)} (${growth.toFixed(
        1
      )}%).`
      : ""

  // Decision creation flow: saves the forecast recommendation and opens its detail page.
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
      setPageError("")

      const createdDecision =
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

            confidence_score:
              forecast.forecast
                .recommendation
                .confidence,
          },

          user.id,
          activeWorkspaceId
        )

      router.push(
        `/dashboard/decisions/${createdDecision.id}`
      )
    } catch (error) {
      console.error(error)

      setPageError(
        getForecastPageErrorMessage(
          error,
          "Unable to create a decision from this forecast."
        )
      )
    } finally {
      setCreatingDecision(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Forecast controls section: dataset and metric selectors drive the forecast request. */}
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
              setPageError("")
              setForecastUnavailableMessage("")

              setForecast(null)

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
                setPageError("")
                setForecastUnavailableMessage("")

                setSelectedMetric(
                  metric
                )

                if (user?.id) {
                  try {
                    await updateDatasetPreference(
                      selectedDatasetId!,
                      user.id,
                      metric,
                      undefined,
                      undefined,
                      activeWorkspaceId
                    )
                  } catch (error) {
                    console.error(error)

                    setPageError(
                      getForecastPageErrorMessage(
                        error,
                        "Unable to save your selected metric."
                      )
                    )
                  }
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Error message section: surfaces forecast and decision creation failures. */}
      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {pageError}
        </div>
      )}

      {forecastUnavailableMessage &&
        !forecast &&
        !loading && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-medium">
              Forecast unavailable for this dataset
            </p>

            <p className="mt-1">
              {forecastUnavailableMessage}
            </p>
          </div>
        )}

      {/* Loading section: keeps the page stable while the first forecast is loading. */}
      {loading && !forecast && (
        <div className="rounded-xl border bg-white p-6">
          Loading forecast...
        </div>
      )}

      {/* Recommendation summary section: shows decision recommendation and forecast totals. */}
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
              currentValueForDisplay
            }
            forecastValue={
              forecastValueForDisplay
            }
            metricName={
              metricName
            }
            forecastPeriod={
              forecastPeriod
            }
            absoluteChange={
              absoluteChange
            }
            percentChange={
              growth
            }
          />
        </div>
      )}

      {/* Forecast chart section: visualizes historical values against projected periods. */}
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
              {selectedDataset
                ? selectedDataset.file_name
                : forecast.file_name}
            </span>

            {selectedDatasetSource && (
              <span className="rounded-full border px-3 py-1 text-sm">
                {selectedDatasetSource.label}
              </span>
            )}

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
