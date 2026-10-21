"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, RefreshCw, Trash2 } from "lucide-react"

import { AIAnalysisPanel } from "@/features/ai/components/analysis-panel"
import { useDecisionateText } from "@/app/use-decisionate-language"
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
  datasetsLoading = false,
  datasetsError = "",
  onRetryDatasets,
}: {
  datasets: DatasetSummary[]
  userId?: string
  workspaceId?: string
  datasetsLoading?: boolean
  datasetsError?: string
  onRetryDatasets?: () => void
}) {
  const { t } = useDecisionateText()
  const [startDate, setStartDate] = useState("")
  const [periodFilter, setPeriodFilter] = useState<ForecastPeriodFilter | "all">("all")
  const [grouping, setGrouping] = useState<DashboardAggregation>("monthly")
  const defaultAggregation: DashboardValueAggregation = "sum"
  const [metadata, setMetadata] = useState<DatasetJoinMetadata[]>([])
  const [selections, setSelections] = useState<MetricSelection[]>([])
  const [result, setResult] = useState<DatasetMultiMetricAnalysis | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [metadataRevision, setMetadataRevision] = useState(0)
  const nextId = useRef(1)
  const requestVersion = useRef(0)
  const datasetKey = datasets.map(dataset => dataset.id).join(",")

  const metadataById = useMemo(
    () => new Map(metadata.map(item => [item.dataset_id, item])),
    [metadata]
  )

  useEffect(() => {
    const pendingVersion = requestVersion
    pendingVersion.current++
    if (!userId || datasets.length === 0) {
      queueMicrotask(() => {
        setMetadata([])
        setSelections([])
        setResult(null)
        setBusy(false)
        setLoadingMetadata(false)
        setError("")
      })
      return
    }

    let current = true
    const ids = datasets.map(dataset => dataset.id)
    const safeUserId = userId

    async function loadMetadata() {
      setResult(null)
      setBusy(false)
      setMetadata([])
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
          const retained = currentSelections.filter(selection => nextMetadata.some(item => item.dataset_id === selection.datasetId && item.date_columns.includes(selection.dateColumn) && item.numeric_columns.includes(selection.metricColumn)))
          if (retained.length > 0) return retained
          return nextMetadata
            .filter(item => item.numeric_columns.length > 0 && item.date_columns.length > 0)
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
      pendingVersion.current++
    }
  }, [datasetKey, defaultAggregation, userId, workspaceId, datasets, metadataRevision])

  function invalidate() {
    requestVersion.current++
    setResult(null)
    setError("")
  }

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
      invalidate()
      return
    }
    setError("All available numeric metrics are already selected.")
  }

  function updateSelection(id: number, changes: Partial<MetricSelection>) {
    invalidate()
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
    if (new Set(selections.map(item => item.datasetId)).size < 2) {
      setError("Select metrics from at least two datasets for multi dataset insights.")
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

    const version = ++requestVersion.current
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
      if (version === requestVersion.current) setResult(response)
    } catch (analysisError) {
      if (version !== requestVersion.current) return
      setError(errorMessage(analysisError))
      setResult(null)
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("Multi dataset insight")}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3"><p className="text-xs text-gray-600">{selections.length}/10 {t("metrics")}</p><button type="button" onClick={() => setMetadataRevision(value => value + 1)} disabled={busy || loadingMetadata || datasetsLoading || !userId || datasets.length === 0} title={t("Refresh available metrics")} aria-label={t("Refresh available metrics")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white disabled:opacity-50"><RefreshCw size={16} className={loadingMetadata ? "animate-spin" : ""} /></button></div>
      </div>

      <fieldset disabled={busy || datasetsLoading || !userId} className="min-w-0 space-y-5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <label className="min-w-0 space-y-1"><span className="block text-xs font-medium text-gray-500">{t("Start date")}</span><input type="date" value={startDate} onChange={event => { setStartDate(event.target.value); invalidate() }} className="h-10 w-full min-w-0 rounded-md border border-gray-200 bg-white px-3 text-sm" /></label>
          <SelectField label="Period" value={periodFilter} options={[{ value: "all", label: "All data" }, { value: "1m", label: "1 month" }, { value: "1q", label: "1 quarter" }, { value: "6m", label: "6 months" }, { value: "1y", label: "1 year" }, { value: "2y", label: "2 years" }, { value: "3y", label: "3 years" }, { value: "5y", label: "5 years" }]} onChange={value => { setPeriodFilter(value as ForecastPeriodFilter | "all"); invalidate() }} />
          <SelectField label="Group by" value={grouping} options={["daily", "weekly", "monthly", "quarterly"].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={value => { setGrouping(value as DashboardAggregation); invalidate() }} />
        </div>

      {datasetsError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-700"><span>{datasetsError}</span>{onRetryDatasets && <button type="button" onClick={onRetryDatasets} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-200 px-3"><RefreshCw size={16} />{t("Retry")}</button>}</div> : datasetsLoading || loadingMetadata ? (
        <p role="status" className="mt-5 text-sm text-gray-500">{t("Loading available metrics...")}</p>
      ) : metadata.length === 0 ? (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t("No dated numeric metrics are available across the workspace datasets.")}
        </p>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {selections.map(selection => {
              const item = metadataById.get(selection.datasetId)
              return (
                <div key={selection.id} className="grid min-w-0 gap-3 rounded-md border border-gray-100 bg-gray-50 p-3 sm:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1.1fr_1fr_auto] xl:items-end">
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
                      invalidate()
                    }}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-gray-500 hover:text-red-600"
                    title={t("Remove metric")}
                    aria-label={t("Remove metric")}
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
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              {t("Add metric")}
            </button>
            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={busy || loadingMetadata}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
              {t(busy ? "Analyzing..." : "Analyze selected metrics")}
            </button>
          </div>
          {new Set(selections.map(item => item.datasetId)).size < 2 && <p role="status" className="text-sm text-amber-800">{t("Select metrics from at least two datasets for multi dataset insights.")}</p>}
        </>
      )}
      </fieldset>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t(error)}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
          <p className="text-xs text-gray-600">{result.start_date} / {result.end_date} / {result.period_count} {t("grouped periods")}</p>
          <p className="text-sm text-gray-600">{result.decision_context}</p>
          <AIAnalysisPanel
            analysis={result.ai_analysis}
            title={t("Multi dataset insight")}
            metrics={result.metrics.map(metric => metric.label)}
            className="rounded-md p-4"
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.metrics.map(metric => (
              <div key={`${metric.dataset_id}:${metric.metric}`} className="min-w-0 rounded-md border border-gray-100 bg-gray-50 p-3">
                <p className="break-words text-xs font-medium text-gray-500">{metric.label}</p>
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
  const { t } = useDecisionateText()
  return (
    <label className="min-w-0 space-y-1">
      <span className="block text-xs font-medium text-gray-500">{t(label)}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full min-w-0 truncate rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <option value="" disabled>{t("Choose {field}").replace("{field}", t(label).toLowerCase())}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{label === "Dataset" || label === "Date column" || label === "Metric" ? option.label : t(option.label)}</option>
        ))}
      </select>
    </label>
  )
}
