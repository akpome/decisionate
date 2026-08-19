"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, RefreshCw, Trash2 } from "lucide-react"

import { AIAnalysisPanel } from "@/features/ai/components/analysis-panel"
import {
  analyzeMultipleDatasetMetrics,
  getDatasetJoinMetadata,
  type DatasetJoinMetadata,
  type DatasetMultiMetricAnalysis,
  type DatasetSummary,
  type DashboardAggregation,
  type DashboardValueAggregation,
  type ForecastPeriodFilter,
} from "@/lib/api"

type MetricSelection = {
  id: number
  datasetId: number
  dateColumn: string
  metricColumn: string
  aggregation: DashboardValueAggregation
}

const aggregationOptions: Array<{
  value: DashboardValueAggregation
  label: string
}> = [
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
]

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unable to analyze the selected metrics."
}

export function MultiMetricAnalysisPanel({
  datasets,
  userId,
  workspaceId,
  startDate,
  periodFilter,
  grouping,
  defaultAggregation,
}: {
  datasets: DatasetSummary[]
  userId?: string
  workspaceId?: string
  startDate: string
  periodFilter: ForecastPeriodFilter | "all"
  grouping: DashboardAggregation
  defaultAggregation: DashboardValueAggregation
}) {
  const [metadata, setMetadata] = useState<DatasetJoinMetadata[]>([])
  const [selections, setSelections] = useState<MetricSelection[]>([])
  const [result, setResult] = useState<DatasetMultiMetricAnalysis | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const nextId = useRef(1)
  const datasetKey = datasets.map(dataset => dataset.id).join(",")

  const metadataById = useMemo(
    () => new Map(metadata.map(item => [item.dataset_id, item])),
    [metadata]
  )

  useEffect(() => {
    if (!userId || datasets.length === 0) {
      queueMicrotask(() => {
        setMetadata([])
        setSelections([])
      })
      return
    }

    let current = true
    const ids = datasets.map(dataset => dataset.id)
    const safeUserId = userId

    async function loadMetadata() {
      setLoadingMetadata(true)
      setError("")
      try {
        const responses = []
        for (let index = 0; index < ids.length; index += 5) {
          responses.push(
            await getDatasetJoinMetadata(
              ids.slice(index, index + 5),
              safeUserId,
              workspaceId
            )
          )
        }
        if (!current) return
        const nextMetadata = responses.flatMap(response => response.datasets)
        setMetadata(nextMetadata)
        setSelections(currentSelections => {
          if (currentSelections.length > 0) return currentSelections
          return nextMetadata
            .filter(item => item.numeric_columns.length > 0)
            .slice(0, 2)
            .map(item => ({
              id: nextId.current++,
              datasetId: item.dataset_id,
              dateColumn: item.default_date_column || item.date_columns[0] || "",
              metricColumn: item.numeric_columns[0] || "",
              aggregation: defaultAggregation,
            }))
        })
      } catch (loadError) {
        if (current) setError(errorMessage(loadError))
      } finally {
        if (current) setLoadingMetadata(false)
      }
    }

    void loadMetadata()
    return () => {
      current = false
    }
  }, [datasetKey, defaultAggregation, userId, workspaceId, datasets])

  function addMetric() {
    const existing = new Set(
      selections.map(selection => `${selection.datasetId}:${selection.metricColumn}`)
    )
    for (const item of metadata) {
      const metric = item.numeric_columns.find(
        column => !existing.has(`${item.dataset_id}:${column}`)
      )
      if (!metric) continue
      setSelections(current => [
        ...current,
        {
          id: nextId.current++,
          datasetId: item.dataset_id,
          dateColumn: item.default_date_column || item.date_columns[0] || "",
          metricColumn: metric,
          aggregation: defaultAggregation,
        },
      ])
      setResult(null)
      return
    }
    setError("All available numeric metrics are already selected.")
  }

  function updateSelection(id: number, changes: Partial<MetricSelection>) {
    setResult(null)
    setSelections(current => current.map(selection => {
      if (selection.id !== id) return selection
      if (!changes.datasetId) return { ...selection, ...changes }
      const nextMetadata = metadataById.get(changes.datasetId)
      return {
        ...selection,
        ...changes,
        dateColumn: nextMetadata?.default_date_column || nextMetadata?.date_columns[0] || "",
        metricColumn: nextMetadata?.numeric_columns[0] || "",
      }
    }))
  }

  async function runAnalysis() {
    if (!userId) return
    if (selections.length === 0) {
      setError("Select at least one metric to analyze.")
      return
    }
    if (new Set(selections.map(item => `${item.datasetId}:${item.metricColumn}`)).size !== selections.length) {
      setError("Select each dataset metric only once.")
      return
    }
    if (selections.some(item => !item.dateColumn || !item.metricColumn)) {
      setError("Choose a date column and numeric metric for every selection.")
      return
    }

    setBusy(true)
    setError("")
    try {
      const response = await analyzeMultipleDatasetMetrics(
        {
          metrics: selections.map(selection => ({
            dataset_id: selection.datasetId,
            date_column: selection.dateColumn,
            metric_column: selection.metricColumn,
            aggregation: selection.aggregation,
          })),
          start_date: startDate || undefined,
          period_filter: periodFilter,
          grouping,
        },
        userId,
        workspaceId
      )
      setResult(response)
    } catch (analysisError) {
      setError(errorMessage(analysisError))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Multi-dataset analysis</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Analyze up to 10 numeric metrics from different datasets over the same time window. Source tables are queried independently; they are not physically joined.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
          {selections.length}/10 metrics
        </span>
      </div>

      {loadingMetadata ? (
        <p className="mt-5 text-sm text-gray-500">Loading available metrics...</p>
      ) : metadata.length === 0 ? (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No numeric metrics are available across the workspace datasets.
        </p>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {selections.map(selection => {
              const item = metadataById.get(selection.datasetId)
              return (
                <div key={selection.id} className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1.1fr_1fr_auto] xl:items-end">
                  <SelectField
                    label="Dataset"
                    value={String(selection.datasetId)}
                    options={metadata.map(option => ({ value: String(option.dataset_id), label: option.file_name }))}
                    onChange={value => updateSelection(selection.id, { datasetId: Number(value) })}
                  />
                  <SelectField
                    label="Date column"
                    value={selection.dateColumn}
                    options={(item?.date_columns ?? []).map(column => ({ value: column, label: column }))}
                    onChange={value => updateSelection(selection.id, { dateColumn: value })}
                  />
                  <SelectField
                    label="Metric"
                    value={selection.metricColumn}
                    options={(item?.numeric_columns ?? []).map(column => ({ value: column, label: column }))}
                    onChange={value => updateSelection(selection.id, { metricColumn: value })}
                  />
                  <SelectField
                    label="Aggregation"
                    value={selection.aggregation}
                    options={aggregationOptions}
                    onChange={value => updateSelection(selection.id, { aggregation: value as DashboardValueAggregation })}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelections(current => current.filter(item => item.id !== selection.id))
                      setResult(null)
                    }}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-gray-500 hover:text-red-600"
                    title="Remove metric"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addMetric}
              disabled={selections.length >= 10}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              Add metric
            </button>
            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={busy || loadingMetadata}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
              {busy ? "Analyzing..." : "Analyze selected metrics"}
            </button>
            <span className="text-xs text-gray-500">
              Uses {grouping} grouping, {periodFilter === "all" ? "all available data" : periodFilter}, and the shared date controls above.
            </span>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
          <p className="text-sm text-gray-600">{result.decision_context}</p>
          <AIAnalysisPanel
            analysis={result.ai_analysis}
            title="Multi-dataset insight"
            metrics={result.metrics.map(metric => metric.label)}
            className="rounded-xl p-4"
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.metrics.map(metric => (
              <div key={`${metric.dataset_id}:${metric.metric}`} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="truncate text-xs font-medium text-gray-500">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {metric.last_value ?? "Not available"}
                  {metric.change_percent !== null && metric.change_percent !== undefined
                    ? ` (${metric.change_percent >= 0 ? "+" : ""}${metric.change_percent.toFixed(1)}%)`
                    : ""}
                </p>
                <p className="mt-1 text-xs capitalize text-gray-500">{metric.aggregation} over {metric.period_count} periods</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className="block text-xs font-medium text-gray-500">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full min-w-0 truncate rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <option value="">Choose {label.toLowerCase()}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
