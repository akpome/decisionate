"use client"

import { ForecastChart } from "@/features/dashboard/components/forecast-chart"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  RefreshCw,
} from "lucide-react"
import { RecommendationCard }
  from "@/features/dashboard/components/recommendation-card"
import { ForecastSummaryCard }
  from "@/features/dashboard/components/forecast-summary-card"

import {
  type DatasetSummary,
  type DecisionConfidenceScore,
  type ForecastResponse,
  getDatasets,
  getDatasetMetrics,
  getForecast,
  getDatasetPreference,
  updateDatasetPreference,
  createDecision,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  WorkspaceAccessNotice,
} from "@/features/dashboard/components/workspace-access-notice"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  MetricSelector,
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import {
  getAIAnalysisLearningContext,
  getAIAnalysisSourceLabel,
} from "@/features/ai/lib/analysis-copy"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"

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
    return "This dataset does not include a recognizable date column, so a time-based forecast cannot be created from it. Choose a dataset with a date, month, year, time, period, or quarter column."
  }

  if (message === "No numeric column found") {
    return "This dataset does not include a numeric metric column to forecast. Choose a dataset with at least one numeric measure."
  }

  if (message.includes("is not numeric")) {
    return "The selected metric is not numeric, so it cannot be forecasted. Choose a numeric metric from this dataset."
  }

  if (message.includes("not found")) {
    return "The selected metric is not available in this dataset anymore. Choose another metric from this dataset."
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

function getConservativeConfidence(
  first: DecisionConfidenceScore,
  second: DecisionConfidenceScore,
): DecisionConfidenceScore {
  const confidenceRank: Record<
    DecisionConfidenceScore,
    number
  > = {
    low: 0,
    medium: 1,
    high: 2,
  }

  return confidenceRank[first] <= confidenceRank[second]
    ? first
    : second
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

function getForecastModelQualityStatus(
  modelQuality: NonNullable<
    ForecastResponse["forecast"]["model_quality"]
  >
) {
  const reliability =
    modelQuality.reliability ?? "limited"

  if (reliability === "limited") {
    return {
      label: "Limited reliability: no holdout validation",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    }
  }

  if (reliability === "low") {
    return {
      label: "Low reliability: high forecast error",
      className: "border-red-200 bg-red-50 text-red-800",
    }
  }

  if (reliability === "moderate") {
    return {
      label: "Review before acting: moderate forecast error",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    }
  }

  return {
    label: "Good validation signal",
    className: "border-green-200 bg-green-50 text-green-800",
  }
}

export default function ForecastsPage() {
  // Auth and navigation: user identity sets ownership; router opens created decisions.
  const { user } = useUser()
  const router = useRouter()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)

  // Dataset and forecast state: controls which dataset metric is being forecasted.
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()
  const [initialDatasetId] =
    useState<number | undefined>(
      () => getInitialForecastDatasetId()
    )

  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [
    datasetMetricColumns,
    setDatasetMetricColumns,
  ] = useState<string[]>([])
  const [
    metricsDatasetId,
    setMetricsDatasetId,
  ] = useState<number>()
  const [
    metricsLoadFailedDatasetId,
    setMetricsLoadFailedDatasetId,
  ] = useState<number>()

  const [forecast, setForecast] =
    useState<ForecastResponse | null>(null)

  const [selectedMetric, setSelectedMetric] =
    useState<string>()

  const [loading, setLoading] =
    useState(false)
  const [
    forecastRefreshVersion,
    setForecastRefreshVersion,
  ] = useState(0)
  const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
    useState(0)
  const [
    datasetsLoading,
    setDatasetsLoading,
  ] = useState(false)
  const [
    metricsLoading,
    setMetricsLoading,
  ] = useState(false)
  const [metricsLoadError, setMetricsLoadError] =
    useState("")
  const [metricLoadRetryKey, setMetricLoadRetryKey] =
    useState(0)

  const [creatingDecision,
    setCreatingDecision] =
    useState(false)

  const [pageError, setPageError] =
    useState("")
  const [preferenceWarning, setPreferenceWarning] =
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
  const forecastMetricColumns =
    forecast?.forecast
      ?.available_metrics ?? []
  const metricsReadyForSelectedDataset =
    metricsDatasetId === selectedDatasetId
  const availableForecastMetrics =
    metricsReadyForSelectedDataset
      ? datasetMetricColumns
      : forecastMetricColumns
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

  const metricName =
    forecast
      ? formatMetricLabel(
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
    let ignoreResult = false

    async function loadDefaultDataset() {
      try {
        setPageError("")
        setPreferenceWarning("")
        setDatasets([])
        setSelectedDatasetId(undefined)
        setSelectedMetric(undefined)
        setDatasetMetricColumns([])
        setMetricsDatasetId(undefined)
        setMetricsLoadFailedDatasetId(
          undefined
        )
        setMetricsLoadError("")
        setMetricsLoading(false)
        setForecast(null)
        setDatasetsLoading(true)

        const preferencePromise =
          Promise.allSettled([
            getDatasetPreference(
              userId,
              activeWorkspaceId
            ),
          ])
        const [datasetsResult] =
          await Promise.allSettled([
            getDatasets(
              userId,
              activeWorkspaceId
            ),
          ])

        if (ignoreResult) {
          return
        }

        if (datasetsResult.status === "rejected") {
          throw datasetsResult.reason
        }

        const datasetSummaries =
          datasetsResult.value

        setDatasets(datasetSummaries)
        setDatasetsLoading(false)

        const initialDataset =
          initialDatasetId
            ? datasetSummaries.find(
                (dataset) =>
                  dataset.id ===
                  initialDatasetId
              )
            : undefined

        if (initialDataset) {
          setSelectedDatasetId(
            initialDataset.id
          )
        } else if (datasetSummaries.length > 0) {
          setSelectedDatasetId(
            datasetSummaries[0].id
          )
        }

        const [preferenceResult] =
          await preferencePromise
        if (!ignoreResult) {
          const preference =
            preferenceResult.status === "fulfilled"
              ? preferenceResult.value
              : undefined

          if (preferenceResult.status === "rejected") {
            setPreferenceWarning(
              `${getForecastPageErrorMessage(
                preferenceResult.reason,
                "Dataset preference service is unavailable."
              )} Using the first available dataset.`
            )
          } else {
            setPreferenceWarning("")
          }

          const preferredDataset =
            preference?.selected_dataset_id
              ? datasetSummaries.find(
                  (dataset) =>
                    dataset.id ===
                    preference.selected_dataset_id
                )
              : undefined

          if (!initialDataset && preferredDataset) {
            setSelectedDatasetId(
              preferredDataset.id
            )
            setSelectedMetric(
              preference?.selected_metric ??
                undefined
            )
          }
        }
      } catch (error) {
        if (ignoreResult) {
          return
        }

        console.error(error)
        setPreferenceWarning("")
        setPageError(
          getForecastPageErrorMessage(
            error,
            "Unable to load your saved forecast preferences."
          )
        )
      } finally {
        if (!ignoreResult) {
          setDatasetsLoading(false)
        }
      }
    }

    loadDefaultDataset()

    return () => {
      ignoreResult = true
      setDatasetsLoading(false)
    }
  }, [
    activeWorkspaceId,
    datasetLoadRetryKey,
    initialDatasetId,
    user?.id,
    workspaceVersion,
  ])

  // Dataset metrics loading: validates saved metric choices before forecasting.
  useEffect(() => {
    if (!selectedDatasetId) {
      return
    }

    if (!user?.id) return

    const datasetId = selectedDatasetId
    const userId = user.id
    let ignore = false

    async function loadDatasetMetrics() {
      try {
        setMetricsLoading(true)
        setMetricsLoadError("")
        setDatasetMetricColumns([])
        setMetricsDatasetId(undefined)
        setMetricsLoadFailedDatasetId(
          undefined
        )

        const data =
          await getDatasetMetrics(
            datasetId,
            userId,
            activeWorkspaceId
          )

        if (ignore) {
          return
        }

        const metricColumns =
          Array.from(
            new Set(
              data.metrics
                .map((metric) =>
                  metric.column.trim()
                )
                .filter(Boolean)
            )
          )

        setDatasetMetricColumns(
          metricColumns
        )
        setSelectedMetric(currentMetric =>
          currentMetric &&
          !metricColumns.includes(currentMetric)
            ? undefined
            : currentMetric
        )
        setMetricsDatasetId(datasetId)
        setMetricsLoadError("")
      } catch (error) {
        if (ignore) {
          return
        }

        setDatasetMetricColumns([])
        setMetricsDatasetId(undefined)
        setMetricsLoadFailedDatasetId(
          datasetId
        )
        setMetricsLoadError(
          getForecastPageErrorMessage(
            error,
            "Could not load metrics for this dataset."
          )
        )
      } finally {
        if (!ignore) {
          setMetricsLoading(false)
        }
      }
    }

    loadDatasetMetrics()

    return () => {
      ignore = true
    }
  }, [
    activeWorkspaceId,
    metricLoadRetryKey,
    selectedDatasetId,
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
    let ignoreResult = false
    const metricsKnownForDataset =
      metricsDatasetId === datasetId
    const metricsLoadFailedForDataset =
      metricsLoadFailedDatasetId ===
      datasetId

    if (
      !metricsKnownForDataset &&
      !metricsLoadFailedForDataset
    ) {
      return
    }

    if (
      selectedMetric &&
      metricsKnownForDataset &&
      !datasetMetricColumns.includes(
        selectedMetric
      )
    ) {
      async function clearStaleSelectedMetric() {
        setSelectedMetric(undefined)
        setForecast(null)
        setForecastUnavailableMessage("")

        try {
          await updateDatasetPreference(
            datasetId,
            userId,
            "",
            undefined,
            undefined,
            activeWorkspaceId
          )
        } catch {
          // A stale saved metric should not block the user from forecasting.
        }
      }

      void clearStaleSelectedMetric()

      return
    }

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

        if (ignoreResult) {
          return
        }

        setForecast(data)

        if (!selectedMetric) {
          const defaultMetric =
            data.forecast.value_column

          setSelectedMetric(defaultMetric)

          void updateDatasetPreference(
            datasetId,
            userId,
            defaultMetric,
            undefined,
            undefined,
            activeWorkspaceId
          ).catch(error => {
            if (!ignoreResult) {
              setPreferenceWarning(
                getForecastPageErrorMessage(
                  error,
                  "Forecast metric preference could not be saved."
                )
              )
            }
          })
        }
      } catch (error) {
        const errorMessage =
          getForecastPageErrorMessage(
            error,
            ""
          )
        const unavailableMessage =
          getForecastUnavailableMessage(
            error
          )

        if (ignoreResult) {
          return
        }

        if (unavailableMessage) {
          setForecast(null)
          setForecastUnavailableMessage(
            unavailableMessage
          )

          if (
            errorMessage.includes(
              "not found"
            )
          ) {
            setSelectedMetric(undefined)

            void updateDatasetPreference(
              datasetId,
              userId,
              "",
              undefined,
              undefined,
              activeWorkspaceId
            ).catch(() => {
              // Clearing a stale metric preference should not block recovery.
            })
          }
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
        if (!ignoreResult) {
          setLoading(false)
        }
      }
    }

    loadForecast()

    return () => {
      ignoreResult = true
    }
  }, [
    selectedDatasetId,
    selectedMetric,
    datasetMetricColumns,
    metricsDatasetId,
    metricsLoadFailedDatasetId,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
    forecastRefreshVersion,
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

  const forecastRecommendation =
    forecast?.forecast.recommendation
  const aiRecommendation =
    forecast?.forecast.ai_analysis?.source === "openai"
      ? forecast.forecast.ai_analysis.recommendations[0]
      : undefined
  const recommendationTitle =
    aiRecommendation
      ? "AI recommended follow-up"
      : forecastRecommendation?.title ?? ""
  const recommendationReason =
    aiRecommendation ||
    forecastRecommendation?.reason ||
    ""
  const recommendationConfidence =
    forecast?.forecast.ai_analysis?.source === "openai"
      ? getConservativeConfidence(
        forecastRecommendation?.confidence ?? "low",
        forecast.forecast.ai_analysis.confidence,
      )
      : forecastRecommendation?.confidence ?? "low"
  const recommendationSource =
    forecast?.forecast.ai_analysis
      ? getAIAnalysisSourceLabel(
        forecast.forecast.ai_analysis
      )
      : "deterministic forecast rules"
  const learningContextCopy =
    forecast?.forecast.ai_analysis
      ? getAIAnalysisLearningContext(
        forecast.forecast.ai_analysis
      )
      : ""
  const learningContext =
    learningContextCopy
      ? `Decisionate learning context: ${learningContextCopy}`
      : ""
  const decisionDatasetName =
    selectedDataset?.file_name ??
    forecast?.file_name ??
    "selected dataset"

  // Decision creation flow: saves the forecast recommendation and opens its detail page.
  async function handleCreateDecision() {
    if (
      creatingDecision ||
      !canManageWorkspaceData
    ) {
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

            metric_column:
              selectedMetric ||
              forecast.forecast.value_column,

            title: recommendationTitle,

                description:
              [
                decisionBrief,
                `Recommendation: ${recommendationTitle}`,
                `Decision target: ${metricName || selectedMetric || "selected metric"} (${decisionDatasetName})`,
                learningContext,
                `Decisionate AI source: ${recommendationSource}`,
              ]
                .filter(Boolean)
                .join("\n\n"),

            expected_outcome:
              decisionBrief ||
              `Evaluate whether ${metricName || "the selected metric"} in ${decisionDatasetName} follows the forecast recommendation.`,

            confidence_score: recommendationConfidence,
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

  async function handleDatasetChange(
    datasetId: number | undefined
  ) {
    const previousDatasetId = selectedDatasetId
    const previousMetric = selectedMetric
    setPageError("")
    setForecastUnavailableMessage("")
    setForecast(null)
    setSelectedMetric(undefined)
    setDatasetMetricColumns([])
    setMetricsDatasetId(undefined)
    setMetricsLoadFailedDatasetId(undefined)
    setMetricsLoadError("")
    setMetricsLoading(false)
    setSelectedDatasetId(datasetId)

    if (typeof window !== "undefined") {
      const url =
        new URL(window.location.href)

      if (datasetId) {
        url.searchParams.set(
          "dataset",
          String(datasetId)
        )
      } else {
        url.searchParams.delete("dataset")
      }

      window.history.replaceState(
        null,
        "",
        url.toString()
      )
    }

    if (datasetId && user?.id) {
      try {
        await updateDatasetPreference(
          datasetId,
          user.id,
          "",
          undefined,
          undefined,
          activeWorkspaceId
        )
        setPreferenceWarning("")
      } catch (error) {
        console.error(error)
        setSelectedDatasetId(previousDatasetId)
        setSelectedMetric(previousMetric)
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href)

          if (previousDatasetId) {
            url.searchParams.set(
              "dataset",
              String(previousDatasetId)
            )
          } else {
            url.searchParams.delete("dataset")
          }

          window.history.replaceState(
            null,
            "",
            url.toString()
          )
        }

        setPageError(
          getForecastPageErrorMessage(
            error,
            "Unable to save your selected forecast dataset."
          )
        )
      }
    }
  }

  function refreshForecast() {
    if (
      !selectedDatasetId ||
      datasetsLoading ||
      loading ||
      metricsLoading
    ) {
      return
    }

    setForecastRefreshVersion(
      version => version + 1
    )
  }

  const refreshButtonLabel =
    datasetsLoading
      ? "Loading..."
      : loading || metricsLoading
      ? forecast
        ? "Refreshing..."
        : "Loading..."
      : "Refresh"

  return (
    <div className="space-y-8">
      {/* Forecast controls section: dataset and metric selectors drive the forecast request. */}
      <div>
        <DashboardPageHeader
          title="Forecasts"
          description="Forecast future trends from your datasets so decision reviews can include a clear outlook and confidence signal."
          actions={
            <button
            type="button"
            onClick={refreshForecast}
            disabled={
              !selectedDatasetId ||
              datasetsLoading ||
              loading ||
              metricsLoading
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 sm:w-auto"
          >
            <RefreshCw size={16} />
            {refreshButtonLabel}
            </button>
          }
        />

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Forecast setup
              </h2>

              <p className="text-sm text-gray-500">
                Choose the dataset and numeric metric to forecast.
              </p>
            </div>

            {loading && (
              <p
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-[var(--decisionate-brand-primary-text)]"
              >
                {forecast
                  ? "Refreshing forecast..."
                  : "Loading forecast..."}
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="min-w-0 space-y-2">
              <span className="text-sm font-medium text-gray-700">
                Dataset
              </span>

              <DatasetSelector
                ariaLabel="Select forecast dataset"
                datasets={datasets}
                emptyMessage={
                  canManageWorkspaceData
                    ? undefined
                    : "Ask the workspace team to share a dataset before creating a forecast."
                }
                loading={
                  !user?.id ||
                  datasetsLoading
                }
                loadError={
                  Boolean(pageError) &&
                  datasets.length === 0
                }
                value={selectedDatasetId}
                onChange={(id) => {
                  void handleDatasetChange(id)
                }}
              />
            </label>

            <label className="min-w-0 space-y-2">
              <span className="text-sm font-medium text-gray-700">
                Metric
              </span>

              <MetricSelector
                ariaLabel="Select forecast metric"
                metrics={
                  availableForecastMetrics
                }
                value={selectedMetric}
                loadError={Boolean(metricsLoadError)}
                disabled={
                  !selectedDatasetId ||
                  loading ||
                  metricsLoading ||
                  !availableForecastMetrics.length
                }
                placeholder={
                  !selectedDatasetId
                    ? "Choose dataset first"
                    : metricsLoading
                      ? "Loading metrics..."
                      : !availableForecastMetrics.length
                        ? "No numeric metrics"
                      : "Select Metric"
                }
                onChange={async (metric) => {
                  const previousMetric =
                    selectedMetric
                  setPageError("")
                  setForecastUnavailableMessage("")

                  setSelectedMetric(
                    metric
                  )

                  if (
                    user?.id &&
                    selectedDatasetId
                  ) {
                    try {
                      await updateDatasetPreference(
                        selectedDatasetId,
                        user.id,
                        metric ?? "",
                        undefined,
                        undefined,
                        activeWorkspaceId
                      )
                      setPreferenceWarning("")
                    } catch (error) {
                      console.error(error)
                      setSelectedMetric(
                        previousMetric
                      )

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

              {metricsLoadError && (
                <div
                  role="alert"
                  className="mt-2 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>{metricsLoadError}</span>

                  <button
                    type="button"
                    onClick={() =>
                      setMetricLoadRetryKey(currentKey => currentKey + 1)
                    }
                    className="w-fit rounded-md border border-red-200 bg-white px-2 py-1 font-medium text-red-700 transition hover:bg-red-100"
                  >
                    Retry metrics
                  </button>
                </div>
              )}
            </label>
          </div>

          <p className="mt-3 max-w-full break-words text-sm text-gray-500">
            {selectedDataset ? (
              <>
                Forecasting from{" "}
                <span className="font-medium text-gray-700">
                  {selectedDataset.file_name}
                </span>
                {selectedDatasetSource?.label
                  ? ` • ${selectedDatasetSource.label}`
                  : ""}
                {selectedMetric
                  ? ` • Focused on ${formatMetricLabel(selectedMetric)}`
                  : " • Auto metric"}
                {selectedDatasetId && (
                  <Link
                    href={`/dashboard/datasets/${selectedDatasetId}`}
                    className="ml-2 font-medium text-[var(--decisionate-brand-primary-text)] hover:underline"
                  >
                    Open dataset details
                  </Link>
                )}
              </>
            ) : (
              "Select a dataset"
            )}
          </p>
        </section>
      </div>

      {/* Error message section: surfaces forecast and decision creation failures. */}
      {pageError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{pageError}</span>

          {!selectedDatasetId && (
            <button
              type="button"
              onClick={() =>
                setDatasetLoadRetryKey(
                  currentKey => currentKey + 1
                )
              }
              className="w-fit rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50"
            >
              Retry dataset load
            </button>
          )}
        </div>
      )}

      {preferenceWarning && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{preferenceWarning}</span>

          <button
            type="button"
            onClick={() =>
              setDatasetLoadRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
          >
            Retry preference
          </button>
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Analysis and metric selection are available in this shared workspace. Workspace managers handle decision creation and data changes."
      />

      {user?.id &&
        !datasetsLoading &&
        !selectedDatasetId &&
        !pageError && (
          <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
            <h2 className="text-xl font-semibold">
              {datasets.length === 0
                ? "No datasets available"
                : "No dataset selected"}
            </h2>

            <p className="mt-2 text-gray-500">
              {datasets.length === 0
                ? canManageWorkspaceData
                  ? "Upload or pull a dataset first to create a forecast."
                  : "Ask the workspace team to share a dataset before creating a forecast."
                : "Select a dataset to create a forecast."}
            </p>

            <Link
              href="/dashboard/datasets"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
            >
              {canManageWorkspaceData
                ? "Open datasets"
                : "View datasets"}
            </Link>
          </div>
        )}

      {forecastUnavailableMessage &&
        !forecast &&
        !loading && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          >
            <p className="font-medium">
              Forecast unavailable for this dataset
            </p>

            <p className="mt-1">
              {forecastUnavailableMessage}
            </p>
          </div>
        )}

      {/* Recommendation summary section: shows decision recommendation and forecast totals. */}
      {forecast && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
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

          {forecast.forecast.model_quality && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span
                className={`rounded-full border px-2.5 py-1 font-medium ${getForecastModelQualityStatus(
                  forecast.forecast.model_quality
                ).className}`}
              >
                {getForecastModelQualityStatus(
                  forecast.forecast.model_quality
                ).label}
              </span>
              <span>
                {forecast.forecast.model_quality.candidate_count && forecast.forecast.model_quality.candidate_count > 1
                  ? `Compared ${forecast.forecast.model_quality.candidate_count} models · `
                  : ""}
                Selected model: {forecast.forecast.model_quality.method.replaceAll("_", " ")} · {forecast.forecast.model_quality.validation_periods > 0
                  ? `${forecast.forecast.model_quality.validation_periods}-period holdout`
                  : "No holdout validation"}
                {forecast.forecast.model_quality.mae !== null
                  ? ` · MAE ${forecast.forecast.model_quality.mae.toLocaleString()}`
                  : ""}
                {forecast.forecast.model_quality.mape !== null
                  ? ` · MAPE ${forecast.forecast.model_quality.mape.toLocaleString()}%`
                  : ""}
              </span>
            </div>
          )}

          {forecast?.forecast?.recommendation && (
            <div className="mt-5 border-t pt-5">
              <RecommendationCard
                title={recommendationTitle}
                decisionBrief={
                  decisionBrief
                }
                reason={recommendationReason}
                confidence={recommendationConfidence}
                source={recommendationSource}
                learningContext={learningContextCopy}
                onCreateDecision={
                  canManageWorkspaceData
                    ? handleCreateDecision
                    : undefined
                }
                creatingDecision={
                  creatingDecision
                }
              />
            </div>
          )}

          {forecast.forecast.ai_analysis && (
            <AIAnalysisPanel
              analysis={forecast.forecast.ai_analysis}
              title="Forecast analysis"
              metric={selectedMetric}
              className="mt-5 p-4"
            />
          )}
        </section>
      )}

      {/* Forecast chart section: visualizes historical values against projected periods. */}
      {forecast && (
        <div className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-6 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">
                Forecast Trend
              </h2>

              <p className="text-sm text-gray-500">
                Historical values and projected future performance.
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
              <span
                className="inline-block max-w-full truncate rounded-full border px-3 py-1 text-sm"
                title={
                  selectedDataset
                    ? selectedDataset.file_name
                    : forecast.file_name
                }
              >
                {selectedDataset
                  ? selectedDataset.file_name
                  : forecast.file_name}
              </span>

              {selectedDatasetSource && (
                <span
                  className="inline-block max-w-full truncate rounded-full border px-3 py-1 text-sm"
                  title={selectedDatasetSource.label}
                >
                  {selectedDatasetSource.label}
                </span>
              )}

              <span
                className="inline-block max-w-full truncate rounded-full border px-3 py-1 text-sm"
                title={metricName}
              >
                {metricName}
              </span>
            </div>
          </div>

          <ForecastChart data={chartData} />
        </div>
      )}
    </div>
  )
}
