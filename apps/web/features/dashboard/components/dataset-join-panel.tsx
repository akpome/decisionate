"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  GitMerge,
  Play,
  RotateCcw,
  X,
} from "lucide-react"

import {
  createDecision,
  deleteDatasetJoinCache,
  getDatasetJoinMetadata,
  joinDatasets,
  type DatasetJoinMetadata,
  type DatasetJoinResult,
  type DatasetJoinSelection,
  type DatasetSummary,
  type DashboardAggregation,
  type DashboardValueAggregation,
  type ForecastPeriodFilter,
} from "@/lib/api"

type DatasetJoinPanelProps = {
  datasets: DatasetSummary[]
  selectedDatasetId?: number
  dashboardKey: string
  userId?: string
  workspaceId?: string
  startDate?: string
  periodFilter: ForecastPeriodFilter
  aggregation: DashboardAggregation
  aggregationType: DashboardValueAggregation
  canManageWorkspaceData?: boolean
  onJoinResult?: (
    result: DatasetJoinResult | null
  ) => void
  persistedResult?: DatasetJoinResult | null
}

type JoinConfiguration = DatasetJoinSelection

function getDefaultJoinMetricColumns(
  item: DatasetJoinMetadata,
  dateColumn: string
) {
  return (
    item.numeric_columns.length > 0
      ? item.numeric_columns
      : item.columns
  ).filter(column => column !== dateColumn)
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-"
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)
}

function formatJoinValue(
  value: string | number | null | undefined
) {
  if (typeof value === "number") {
    return formatNumber(value)
  }
  return value ?? "-"
}

export function DatasetJoinPanel({
  datasets,
  selectedDatasetId,
  dashboardKey,
  userId,
  workspaceId,
  startDate,
  periodFilter,
  aggregation,
  aggregationType,
  canManageWorkspaceData = false,
  onJoinResult,
  persistedResult,
}: DatasetJoinPanelProps) {
  const router = useRouter()
  const [selectedDatasetIds, setSelectedDatasetIds] =
    useState<number[]>(() =>
      selectedDatasetId ? [selectedDatasetId] : []
    )
  const [metadata, setMetadata] =
    useState<DatasetJoinMetadata[]>([])
  const [configurations, setConfigurations] =
    useState<Record<number, JoinConfiguration>>({})
  const [result, setResult] =
    useState<DatasetJoinResult | null>(null)
  const [loadingMetadata, setLoadingMetadata] =
    useState(false)
  const [joining, setJoining] =
    useState(false)
  const [creatingDecision, setCreatingDecision] =
    useState(false)
  const [error, setError] = useState("")
  const activeResult = result ?? persistedResult ?? null

  function updateJoinResult(
    nextResult: DatasetJoinResult | null
  ) {
    setResult(nextResult)
    onJoinResult?.(nextResult)
  }

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      if (!persistedResult) {
        setResult(null)
        return
      }

      setResult(persistedResult)
      setSelectedDatasetIds(persistedResult.dataset_ids)
      setConfigurations(current => {
        const next: Record<number, JoinConfiguration> = {}
        const metricColumnsByDataset = new Map<number, string[]>()

        persistedResult.datasets.forEach(item => {
          if (!item.metric_column) {
            return
          }

          const columns = metricColumnsByDataset.get(item.dataset_id) ?? []
          if (!columns.includes(item.metric_column)) {
            columns.push(item.metric_column)
          }
          metricColumnsByDataset.set(item.dataset_id, columns)
        })

        persistedResult.datasets.forEach(item => {
          if (next[item.dataset_id]) {
            return
          }

          next[item.dataset_id] = {
            dataset_id: item.dataset_id,
            date_column: item.date_column,
            metric_columns: metricColumnsByDataset.get(item.dataset_id) ?? [],
          }
        })

        return {
          ...current,
          ...next,
        }
      })
    })

    return () => {
      cancelled = true
    }
  }, [persistedResult])

  useEffect(() => {
    if (!userId || selectedDatasetIds.length === 0) {
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setLoadingMetadata(true)
        setError("")
      }
    })

    void getDatasetJoinMetadata(
      selectedDatasetIds,
      userId,
      workspaceId
    )
      .then(response => {
        if (cancelled) return

        setMetadata(response.datasets)
        setConfigurations(current => {
          const next: Record<number, JoinConfiguration> = {}

          response.datasets.forEach(item => {
            const existing = current[item.dataset_id]
            const dateColumn = existing?.date_column &&
              item.date_columns.includes(
                existing.date_column
              )
              ? existing.date_column
              : item.default_date_column ?? ""
            const defaultMetricColumns = getDefaultJoinMetricColumns(
              item,
              dateColumn
            )
            const metricColumns = existing?.metric_columns?.length
              ? existing.metric_columns.filter(
                  column =>
                    item.columns.includes(column) &&
                    column !== dateColumn
                )
              : defaultMetricColumns

            next[item.dataset_id] = {
              dataset_id: item.dataset_id,
              date_column: dateColumn,
              metric_columns: metricColumns,
            }
          })

          return next
        })
      })
      .catch(loadError => {
        if (!cancelled) {
          setMetadata([])
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load joinable dataset fields."
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMetadata(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedDatasetIds, userId, workspaceId])

  const selectedMetadata = useMemo(
    () =>
      selectedDatasetIds
        .map(datasetId =>
          metadata.find(
            item => item.dataset_id === datasetId
          )
        )
        .filter(
          (item): item is DatasetJoinMetadata =>
            Boolean(item)
        ),
    [metadata, selectedDatasetIds]
  )

  function toggleDataset(datasetId: number) {
    if (datasetId === selectedDatasetId) return

    setSelectedDatasetIds(current => {
      if (current.includes(datasetId)) {
        return current.filter(id => id !== datasetId)
      }

      if (current.length >= 5) {
        return current
      }

      return [...current, datasetId]
    })
    updateJoinResult(null)
  }

  function updateConfiguration(
    datasetId: number,
    field: "date_column",
    value: string
  ) {
    setConfigurations(current => ({
      ...current,
      [datasetId]: {
        ...(current[datasetId] ?? {
          dataset_id: datasetId,
          date_column: "",
          metric_columns: [],
        }),
        [field]: value,
        ...(field === "date_column"
          ? {
              metric_columns: (
                current[datasetId]?.metric_columns ?? []
              ).filter(column => column !== value),
            }
          : {}),
      },
    }))
    updateJoinResult(null)
  }

  function toggleMetricColumn(datasetId: number, column: string) {
    setConfigurations(current => {
      const configuration = current[datasetId] ?? {
        dataset_id: datasetId,
        date_column: "",
        metric_columns: [],
      }
      const selectedColumns = configuration.metric_columns ?? []
      const metricColumns = selectedColumns.includes(column)
        ? selectedColumns.filter(item => item !== column)
        : [...selectedColumns, column]

      return {
        ...current,
        [datasetId]: {
          ...configuration,
          metric_columns: metricColumns,
        },
      }
    })
    updateJoinResult(null)
  }

  function clearMetricColumns(datasetId: number) {
    setConfigurations(current => ({
      ...current,
      [datasetId]: {
        ...(current[datasetId] ?? {
          dataset_id: datasetId,
          date_column: "",
        }),
        metric_columns: [],
      },
    }))
    updateJoinResult(null)
  }

  function resetMetricColumns(datasetId: number) {
    const item = metadata.find(
      metadataItem => metadataItem.dataset_id === datasetId
    )
    if (!item) return

    const dateColumn =
      configurations[datasetId]?.date_column ??
      item.default_date_column ??
      ""
    setConfigurations(current => ({
      ...current,
      [datasetId]: {
        ...(current[datasetId] ?? {
          dataset_id: datasetId,
          date_column: dateColumn,
        }),
        metric_columns: getDefaultJoinMetricColumns(
          item,
          dateColumn
        ),
      },
    }))
    updateJoinResult(null)
  }

  async function resetJoinedDataset() {
    setError("")

    if (userId && selectedDatasetId) {
      try {
        await deleteDatasetJoinCache(
          selectedDatasetId,
          dashboardKey,
          userId,
          workspaceId
        )
      } catch (resetError) {
        setError(
          resetError instanceof Error
            ? resetError.message
            : "Unable to reset the joined dataset cache."
        )
        return
      }
    }

    updateJoinResult(null)
    setSelectedDatasetIds(
      selectedDatasetId ? [selectedDatasetId] : []
    )
    setConfigurations(current => {
      if (!selectedDatasetId) {
        return {}
      }

      return {
        [selectedDatasetId]: current[selectedDatasetId] ?? {
          dataset_id: selectedDatasetId,
          date_column: "",
          metric_columns: [],
        },
      }
    })
    setMetadata([])
  }

  async function handleJoin() {
    if (!userId || selectedDatasetIds.length < 2) {
      setError("Select at least two datasets to compare.")
      return
    }

    const selections = selectedDatasetIds.map(
      datasetId => configurations[datasetId]
    )
    if (selections.some(item => !item?.date_column)) {
      setError(
        "Choose a date column for each dataset."
      )
      return
    }

    if (selectedMetadata.length !== selectedDatasetIds.length) {
      setError("Wait for the selected dataset columns to finish loading.")
      return
    }

    const hasMetricColumns = selectedMetadata.every(item =>
      Boolean(configurations[item.dataset_id]?.metric_columns?.length)
    )
    if (!hasMetricColumns) {
      setError(
        "Select at least one metric or column for each dataset."
      )
      return
    }

    setJoining(true)
    setError("")

    try {
      const joined = await joinDatasets(
        {
          selections: selections.filter(
            (item): item is DatasetJoinSelection =>
              Boolean(item)
          ),
          start_date: startDate || undefined,
          period_filter: periodFilter,
          aggregation: "monthly",
          aggregation_type: aggregationType,
          dashboard_key: dashboardKey,
        },
        userId,
        workspaceId
      )
      updateJoinResult(joined)
    } catch (joinError) {
      updateJoinResult(null)
      setError(
        joinError instanceof Error
          ? joinError.message
          : "Unable to join the selected datasets."
      )
    } finally {
      setJoining(false)
    }
  }

  async function handleCreateDecision() {
    if (
      !userId ||
      !selectedDatasetId ||
      !activeResult ||
      creatingDecision
    ) {
      return
    }

    const availableDatasetIds = new Set(
      datasets.map(dataset => dataset.id)
    )
    const decisionDatasetId =
      (activeResult.derived_dataset_id &&
        activeResult.derived_dataset
        ? activeResult.derived_dataset_id
        : availableDatasetIds.has(activeResult.primary_dataset_id)
        ? activeResult.primary_dataset_id
        : availableDatasetIds.has(selectedDatasetId)
        ? selectedDatasetId
        : undefined)

    if (!decisionDatasetId) {
      setError(
        "The joined evidence uses a dataset that is no longer available. Reset and recreate the join."
      )
      return
    }

    setCreatingDecision(true)
    setError("")

    try {
      const latestRow = activeResult.rows[activeResult.rows.length - 1]
      const latestEvidence = activeResult.datasets
        .map(item =>
          `${item.label}: ${formatJoinValue(
            latestRow?.[item.label] as
              | string
              | number
              | null
              | undefined
          )}`
        )
        .join("; ")
      const joinedSourceNames = Array.from(
        new Set(
          activeResult.datasets
            .map(item => item.file_name.trim())
            .filter(Boolean)
        )
      )
      const generatedDecisionTitle =
        `Review joined evidence: ${joinedSourceNames.join(" + ")}`
      const decisionTitle =
        generatedDecisionTitle.length > 120
          ? `${generatedDecisionTitle.slice(0, 117)}...`
          : generatedDecisionTitle
      const decision = await createDecision(
        {
          dataset_id: decisionDatasetId,
          evidence_dataset_ids: activeResult.dataset_ids,
          evidence_metrics: activeResult.datasets.map(item => ({
            dataset_id: item.dataset_id,
            file_name: item.file_name,
            metric_column: item.metric_column,
            label: item.label,
            column_type: item.column_type,
          })),
          recommendation_text:
            "Review the joined metrics and agree on the next action.",
          recommendation_source: "rules",
          recommendation_context: activeResult.decision_context,
          title: decisionTitle,
          description: [
            activeResult.decision_context,
            `Latest shared period: ${latestRow?.period ?? "-"}.`,
            `Latest evidence: ${latestEvidence}.`,
            "Select an outcome metric in Decision Details only if this decision needs numeric outcome measurement.",
          ].join("\n\n"),
          expected_outcome:
            "Agree on an action based on the joined evidence and measure the result by the review date.",
          priority: "medium",
          category: "general",
        },
        userId,
        workspaceId
      )
      router.push(`/dashboard/decisions/${decision.id}`)
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Unable to create a decision from the joined evidence."
      )
    } finally {
      setCreatingDecision(false)
    }
  }

  if (
    !selectedDatasetId ||
    (datasets.length < 2 && !activeResult)
  ) {
    return null
  }

  return (
    <section className="print:hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitMerge
              size={18}
              className="text-[var(--decisionate-brand-primary)]"
            />
            <h2 className="text-sm font-semibold text-gray-950">
              Join data for a decision
            </h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Normalize every selected date to a month-year period before joining. Choose the metrics or columns to carry forward; numeric columns use the selected {aggregationType} aggregation.
          </p>
        </div>

        <span className="shrink-0 text-xs text-gray-500">
          {selectedDatasetIds.length}/5 selected
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {datasets.map(dataset => {
          const selected = selectedDatasetIds.includes(
            dataset.id
          )
          const primary = dataset.id === selectedDatasetId

          return (
            <label
              key={dataset.id}
              className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                selected
                  ? "border-[var(--decisionate-brand-primary)] bg-[var(--decisionate-brand-primary-soft)]"
                  : "border-gray-200 bg-gray-50 hover:bg-white"
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={primary}
                onChange={() => toggleDataset(dataset.id)}
                className="mt-0.5 accent-[var(--decisionate-brand-primary)]"
              />
              <span className="min-w-0 truncate font-medium text-gray-700">
                {dataset.file_name}
                {primary && (
                  <span className="ml-1 font-normal text-gray-500">
                    (primary)
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      {selectedMetadata.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {selectedMetadata.map(item => {
            const configuration = configurations[item.dataset_id]

            return (
              <div
                key={item.dataset_id}
                className="grid min-w-0 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-700">
                    {item.file_name}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {item.date_range.start ?? "Unknown start"} to {item.date_range.end ?? "unknown end"}
                  </p>
                </div>

                <label className="min-w-0 text-xs font-medium text-gray-500">
                  <span className="mb-1 block">Date column</span>
                  <select
                    value={configuration?.date_column ?? ""}
                    onChange={event =>
                      updateConfiguration(
                        item.dataset_id,
                        "date_column",
                        event.target.value
                      )
                    }
                    className="h-9 w-full min-w-0 truncate rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700"
                  >
                    <option value="">Choose date</option>
                    {item.date_columns.map(column => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="min-w-0 text-xs font-medium text-gray-500">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span>Metrics or columns to include</span>
                    <span className="flex items-center gap-2 font-normal">
                      <button
                        type="button"
                        onClick={() => clearMetricColumns(item.dataset_id)}
                        disabled={!configuration?.metric_columns?.length}
                        className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Unselect all metrics or columns"
                      >
                        <X size={12} aria-hidden="true" />
                        Unselect all
                      </button>
                      <button
                        type="button"
                        onClick={() => resetMetricColumns(item.dataset_id)}
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"
                        title="Reset metrics or columns to the default selection"
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        Reset to default
                      </button>
                    </span>
                  </div>
                  <div className="max-h-28 overflow-y-auto rounded-md border border-gray-200 bg-white p-2">
                    <div className="grid gap-1 sm:grid-cols-2">
                      {item.columns
                        .filter(column => column !== configuration?.date_column)
                        .map(column => (
                          <label
                            key={column}
                            className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-[11px] font-normal text-gray-700 hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={configuration?.metric_columns?.includes(column) ?? false}
                              onChange={() => toggleMetricColumn(item.dataset_id, column)}
                              className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                            />
                            <span className="min-w-0 truncate" title={column}>
                              {column}
                            </span>
                          </label>
                        ))}
                    </div>
                  </div>
                </div>

              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-500">
          {loadingMetadata
            ? "Inspecting dataset columns..."
            : selectedDatasetIds.length < 2
              ? "Select one or more additional datasets to continue."
              : `Inner join on shared month-year periods using ${aggregationType}. Dashboard grouping is ${aggregation}.`}
        </p>
        <button
          type="button"
          onClick={() => void handleJoin()}
          disabled={
            joining ||
            loadingMetadata ||
            selectedDatasetIds.length < 2
          }
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--decisionate-brand-primary)] px-3 text-xs font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={14} />
          {joining ? "Joining data..." : "Join selected data"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      )}

      {activeResult && (
        <div className="mt-4 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-800">
                Joined evidence ready
              </p>
              <p className="mt-1 text-xs text-gray-600">
                {activeResult.matched_period_count} shared periods from {activeResult.dataset_ids.length} datasets and {activeResult.datasets.length} joined columns, with {activeResult.coverage_percent}% period coverage.
              </p>
            </div>
            {canManageWorkspaceData && (
              <button
                type="button"
                onClick={() => void handleCreateDecision()}
                disabled={creatingDecision}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--decisionate-brand-primary)] px-3 text-xs font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={14} />
                {creatingDecision
                  ? "Creating decision..."
                  : "Create decision from evidence"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void resetJoinedDataset()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              title="Remove the joined view and return to the original dataset"
            >
              <RotateCcw size={14} />
              Reset joined data
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-md border border-gray-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">
                    Period
                  </th>
                  {activeResult.datasets.map(item => (
                    <th
                      key={item.label}
                      className="whitespace-nowrap px-3 py-2 font-medium"
                    >
                      {item.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeResult.rows.slice(-8).map(row => (
                  <tr
                    key={row.period}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-700">
                      {row.period}
                    </td>
                    {activeResult.datasets.map(item => (
                      <td
                        key={`${row.period}-${item.label}`}
                        className="whitespace-nowrap px-3 py-2 text-gray-600"
                      >
                        {formatJoinValue(
                          row[item.label] as
                            | string
                            | number
                            | null
                            | undefined
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
