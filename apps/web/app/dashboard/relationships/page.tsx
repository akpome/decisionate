"use client"

import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { ChevronDown, GitCompare, RefreshCw, Save, Trash2 } from "lucide-react"

import {
  createDatasetRelationship,
  deleteDatasetRelationship,
  getDatasetJoinMetadata,
  getDatasetRelationships,
  getDatasets,
  previewDatasetRelationship,
  type DatasetJoinMetadata,
  type DatasetRelationship,
  type DatasetRelationshipPayload,
  type DatasetSummary,
  type DashboardAggregation,
  type DashboardValueAggregation,
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"

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

const periodOptions: Array<{
  value: DashboardAggregation
  label: string
}> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
]

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

function formatCorrelation(value?: number | null) {
  return value === null || value === undefined
    ? "Not available"
    : value.toFixed(2)
}

function relationshipTone(relationship: DatasetRelationship) {
  if (relationship.status !== "ready") {
    return "border-amber-200 bg-amber-50 text-amber-800"
  }
  if (relationship.direction === "positive") {
    return "border-green-200 bg-green-50 text-green-800"
  }
  if (relationship.direction === "negative") {
    return "border-red-200 bg-red-50 text-red-800"
  }
  return "border-blue-200 bg-blue-50 text-blue-800"
}

function formatPeriodUnit(period: string) {
  return {
    daily: "day",
    weekly: "week",
    monthly: "month",
    quarterly: "quarter",
  }[period] || "period"
}

export default function RelationshipsPage() {
  const { user } = useUser()
  const { activeWorkspaceId, workspaceVersion } = useActiveWorkspace(user?.id)
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [metadata, setMetadata] = useState<DatasetJoinMetadata[]>([])
  const [relationships, setRelationships] = useState<DatasetRelationship[]>([])
  const [leftDatasetId, setLeftDatasetId] = useState("")
  const [rightDatasetId, setRightDatasetId] = useState("")
  const [leftDateColumn, setLeftDateColumn] = useState("")
  const [rightDateColumn, setRightDateColumn] = useState("")
  const [leftMetric, setLeftMetric] = useState("")
  const [rightMetric, setRightMetric] = useState("")
  const [name, setName] = useState("Cross-source relationship")
  const [period, setPeriod] = useState<DashboardAggregation>("monthly")
  const [aggregation, setAggregation] = useState<DashboardValueAggregation>("sum")
  const [method, setMethod] = useState<"pearson" | "spearman">("pearson")
  const [lagMode, setLagMode] = useState<"automatic" | "manual">("automatic")
  const [lagPeriods, setLagPeriods] = useState("0")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [result, setResult] = useState<DatasetRelationship | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [statusMessage, setStatusMessage] = useState("")

  const metadataById = useMemo(
    () => new Map(metadata.map(item => [String(item.dataset_id), item])),
    [metadata]
  )
  const leftMetadata = metadataById.get(leftDatasetId)
  const rightMetadata = metadataById.get(rightDatasetId)
  const resolvedLeftDateColumn = leftMetadata
    ? leftMetadata.date_columns.includes(leftDateColumn)
      ? leftDateColumn
      : leftMetadata.default_date_column || leftMetadata.date_columns[0] || ""
    : leftDateColumn
  const resolvedRightDateColumn = rightMetadata
    ? rightMetadata.date_columns.includes(rightDateColumn)
      ? rightDateColumn
      : rightMetadata.default_date_column || rightMetadata.date_columns[0] || ""
    : rightDateColumn
  const resolvedLeftMetric = leftMetadata
    ? leftMetadata.numeric_columns.includes(leftMetric)
      ? leftMetric
      : leftMetadata.numeric_columns[0] || ""
    : leftMetric
  const resolvedRightMetric = rightMetadata
    ? rightMetadata.numeric_columns.includes(rightMetric)
      ? rightMetric
      : rightMetadata.numeric_columns[0] || ""
    : rightMetric

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id
    let current = true

    async function load() {
      setLoading(true)
      setError("")
      try {
        const [datasetResult, relationshipResult] = await Promise.all([
          getDatasets(
            userId,
            activeWorkspaceId,
            user?.primaryEmailAddress?.emailAddress
          ),
          getDatasetRelationships(userId, activeWorkspaceId),
        ])
        if (!current) return
        setDatasets(datasetResult)
        setRelationships(relationshipResult)
        setResult(null)
        setLeftDatasetId(String(datasetResult[0]?.id ?? ""))
        setRightDatasetId(String(datasetResult[1]?.id ?? ""))
      } catch (loadError) {
        if (current) {
          setError(getErrorMessage(loadError, "Unable to load relationship setup."))
        }
      } finally {
        if (current) setLoading(false)
      }
    }

    void load()
    return () => {
      current = false
    }
  }, [activeWorkspaceId, user?.id, workspaceVersion])

  useEffect(() => {
    const ids = [leftDatasetId, rightDatasetId]
      .filter(Boolean)
      .map(Number)
    if (!user?.id || ids.length === 0) return
    const userId = user.id

    let current = true

    async function loadMetadata() {
      setLoadingMetadata(true)
      try {
        const response = await getDatasetJoinMetadata(
          ids,
          userId,
          activeWorkspaceId
        )
        if (current) setMetadata(response.datasets)
      } catch (metadataError) {
        if (current) {
          setError(getErrorMessage(metadataError, "Unable to load dataset columns."))
        }
      } finally {
        if (current) setLoadingMetadata(false)
      }
    }

    void loadMetadata()

    return () => {
      current = false
    }
  }, [activeWorkspaceId, leftDatasetId, rightDatasetId, user?.id])

  function buildPayload(): DatasetRelationshipPayload | null {
    if (
      !leftDatasetId ||
      !rightDatasetId ||
      !resolvedLeftDateColumn ||
      !resolvedRightDateColumn ||
      !resolvedLeftMetric ||
      !resolvedRightMetric
    ) {
      setError("Choose two datasets, a date column, and a numeric metric for each side.")
      return null
    }
    if (leftDatasetId === rightDatasetId) {
      setError("Choose two different datasets.")
      return null
    }

    return {
      name: name.trim() || "Cross-source relationship",
      left: {
        dataset_id: Number(leftDatasetId),
        date_column: resolvedLeftDateColumn,
        metric_column: resolvedLeftMetric,
      },
      right: {
        dataset_id: Number(rightDatasetId),
        date_column: resolvedRightDateColumn,
        metric_column: resolvedRightMetric,
      },
      period,
      aggregation,
      method,
      lag_mode: lagMode,
      lag_periods: Math.max(0, Math.min(12, Number(lagPeriods) || 0)),
    }
  }

  async function handlePreview() {
    if (!user?.id) return
    const payload = buildPayload()
    if (!payload) return
    setBusy(true)
    setError("")
    setStatusMessage("")
    try {
      setResult(
        await previewDatasetRelationship(payload, user.id, activeWorkspaceId)
      )
    } catch (previewError) {
      setError(getErrorMessage(previewError, "Unable to calculate relationship."))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!user?.id) return
    const payload = buildPayload()
    if (!payload) return
    setBusy(true)
    setError("")
    setStatusMessage("")
    try {
      const saved = await createDatasetRelationship(
        payload,
        user.id,
        activeWorkspaceId
      )
      setResult(saved)
      setRelationships(current => [
        saved,
        ...current.filter(item => item.id !== saved.id),
      ])
      setStatusMessage("Relationship saved for this workspace.")
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Unable to save relationship."))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(relationshipId: number) {
    if (!user?.id) return
    setBusy(true)
    setError("")
    try {
      await deleteDatasetRelationship(
        relationshipId,
        user.id,
        activeWorkspaceId
      )
      setRelationships(current => current.filter(item => item.id !== relationshipId))
      if (result?.id === relationshipId) setResult(null)
      setStatusMessage("Relationship removed.")
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Unable to remove relationship."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        title="Cross-source relationships"
        description="Choose two datasets and confirm how their metrics relate over shared periods."
        actions={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Refresh relationships"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {statusMessage && (
        <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {statusMessage}
        </div>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-700">
            <GitCompare size={19} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Define a relationship</h2>
            <p className="mt-1 text-sm text-gray-500">
              Decisionate calculates the relationship from aligned data. It does not imply that one metric caused the other.
            </p>
          </div>
        </div>

        {loading ? (
          <p role="status" className="mt-6 text-sm text-gray-500">Loading datasets...</p>
        ) : datasets.length < 2 ? (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Add at least two datasets before defining a cross-source relationship.
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            <label className="block max-w-xl space-y-2">
              <span className="text-sm font-medium text-gray-700">Relationship name</span>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Marketing spend and revenue"
              />
            </label>

            <div className="grid gap-4 lg:grid-cols-2">
              <RelationshipSide
                label="Dataset A"
                datasets={datasets}
                datasetId={leftDatasetId}
                dateColumn={resolvedLeftDateColumn}
                metric={resolvedLeftMetric}
                metadata={leftMetadata}
                onDatasetChange={setLeftDatasetId}
                onDateChange={setLeftDateColumn}
                onMetricChange={setLeftMetric}
              />
              <RelationshipSide
                label="Dataset B"
                datasets={datasets}
                datasetId={rightDatasetId}
                dateColumn={resolvedRightDateColumn}
                metric={resolvedRightMetric}
                metadata={rightMetadata}
                onDatasetChange={setRightDatasetId}
                onDateChange={setRightDateColumn}
                onMetricChange={setRightMetric}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField label="Period" value={period} onChange={value => setPeriod(value as DashboardAggregation)} options={periodOptions} />
              <SelectField label="Aggregation" value={aggregation} onChange={value => setAggregation(value as DashboardValueAggregation)} options={aggregationOptions} />
              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">Timing</span>
                <select
                  value={lagMode}
                  onChange={event => setLagMode(event.target.value as "automatic" | "manual")}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="automatic">Automatic (recommended)</option>
                  <option value="manual">Advanced manual</option>
                </select>
                <span className="block text-xs text-gray-500">Decisionate checks a bounded timing window.</span>
              </label>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={() => setShowAdvanced(current => !current)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                <span>Advanced correlation options</span>
                <ChevronDown
                  size={17}
                  className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                />
              </button>
              {showAdvanced && (
                <div className="border-t border-gray-200 px-4 pb-4 pt-3">
                  <div className="max-w-sm">
                    <SelectField
                      label="Correlation method"
                      value={method}
                      onChange={value => setMethod(value as "pearson" | "spearman")}
                      options={[
                        { value: "pearson", label: "Pearson (default)" },
                        { value: "spearman", label: "Spearman (rank-based)" },
                      ]}
                    />
                    {lagMode === "manual" && (
                      <label className="mt-4 block space-y-2">
                        <span className="text-sm font-medium text-gray-700">Left metric leads by</span>
                        <select
                          value={lagPeriods}
                          onChange={event => setLagPeriods(event.target.value)}
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          {Array.from({ length: 13 }, (_, index) => (
                            <option key={index} value={String(index)}>
                              {index === 0 ? "Same period" : `${index} ${formatPeriodUnit(period)}${index === 1 ? "" : "s"} later`}
                            </option>
                          ))}
                        </select>
                        <span className="block text-xs text-gray-500">Manual timing is preserved for advanced analysis.</span>
                      </label>
                    )}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-gray-500">
                    Pearson is the default for measuring linear movement between metrics. Spearman is useful when metrics move consistently together but not in a straight line, or when outliers may distort the result.
                  </p>
                </div>
              )}
            </div>

            {loadingMetadata && <p className="text-xs text-gray-500">Loading dataset columns...</p>}

            <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={busy || loadingMetadata}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <GitCompare size={16} />
                {busy ? "Calculating..." : "Preview relationship"}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy || loadingMetadata}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={16} />
                Save relationship
              </button>
            </div>
          </div>
        )}
      </section>

      {result && <RelationshipResult relationship={result} />}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Saved relationships</h2>
          <p className="mt-1 text-sm text-gray-500">Saved definitions are recalculated from the latest dataset contents when opened.</p>
        </div>
        {relationships.length === 0 ? (
          <p className="mt-5 text-sm text-gray-500">No cross-source relationships saved yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {relationships.map(relationship => (
              <div key={relationship.id} className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setResult(relationship)}
                  className="min-w-0 text-left"
                >
                  <p className="truncate font-medium text-gray-900">{relationship.name}</p>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {relationship.left_dataset_name} · {relationship.left.metric_column} → {relationship.right_dataset_name} · {relationship.right.metric_column}
                  </p>
                </button>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${relationshipTone(relationship)}`}>
                    {relationship.correlation === null || relationship.correlation === undefined
                      ? relationship.status
                      : `${relationship.direction} ${formatCorrelation(relationship.correlation)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => relationship.id && void handleDelete(relationship.id)}
                    disabled={busy || !relationship.id}
                    className="rounded-lg p-2 text-gray-500 hover:bg-white hover:text-red-600 disabled:opacity-50"
                    title="Delete relationship"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function RelationshipSide({
  label,
  datasets,
  datasetId,
  dateColumn,
  metric,
  metadata,
  onDatasetChange,
  onDateChange,
  onMetricChange,
}: {
  label: string
  datasets: DatasetSummary[]
  datasetId: string
  dateColumn: string
  metric: string
  metadata?: DatasetJoinMetadata
  onDatasetChange: (value: string) => void
  onDateChange: (value: string) => void
  onMetricChange: (value: string) => void
}) {
  return (
    <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
      <SelectField
        label="Dataset"
        value={datasetId}
        onChange={onDatasetChange}
        options={datasets.map(dataset => ({ value: String(dataset.id), label: dataset.file_name }))}
      />
      <SelectField
        label="Date column"
        value={dateColumn}
        onChange={onDateChange}
        options={(metadata?.date_columns ?? []).map(column => ({ value: column, label: column }))}
      />
      <SelectField
        label="Numeric metric"
        value={metric}
        onChange={onMetricChange}
        options={(metadata?.numeric_columns ?? []).map(column => ({ value: column, label: column }))}
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <option value="">Choose {label.toLowerCase()}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function RelationshipResult({ relationship }: { relationship: DatasetRelationship }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Relationship evidence</p>
          <h2 className="mt-1 text-lg font-semibold">{relationship.name}</h2>
          <p className="mt-1 text-sm font-medium text-gray-800">
            {relationship.association_summary || relationship.decision_context}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            {relationship.causation_disclaimer || "Association does not establish causation."}
          </p>
        </div>
        <div className={`rounded-xl border px-4 py-3 text-center ${relationshipTone(relationship)}`}>
          <p className="text-2xl font-semibold">{formatCorrelation(relationship.correlation)}</p>
          <p className="text-xs font-medium capitalize">{relationship.relationship_strength} {relationship.direction}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricStat label="Shared periods" value={String(relationship.matched_period_count)} />
        <MetricStat label="Method" value={relationship.method} />
        <MetricStat label="Aggregation" value={`${relationship.aggregation} · ${relationship.period}`} />
        <MetricStat
          label={relationship.lag_mode === "manual" ? "Timing" : "Best observed delay"}
          value={relationship.delay_description || "Same period"}
        />
      </div>

      {relationship.lag_mode !== "manual" && relationship.lag_candidates && relationship.lag_candidates.length > 0 && (
        <details className="mt-5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            View timing evidence
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="px-2 py-2">Delay</th>
                  <th className="px-2 py-2">Correlation</th>
                  <th className="px-2 py-2">Periods</th>
                  <th className="px-2 py-2">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {relationship.lag_candidates.map(candidate => (
                  <tr key={candidate.lag_periods}>
                    <td className="px-2 py-2">{candidate.lag_periods === 0 ? "Same period" : `${candidate.lag_periods} ${formatPeriodUnit(relationship.period)}`}</td>
                    <td className="px-2 py-2">{formatCorrelation(candidate.correlation)}</td>
                    <td className="px-2 py-2">{candidate.matched_period_count}</td>
                    <td className="px-2 py-2">{candidate.credible ? "Credible" : "Limited"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {relationship.evidence.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-100">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">{relationship.left.metric_column}</th>
                <th className="px-3 py-2">{relationship.right.metric_column}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {relationship.evidence.slice(-8).map(row => (
                <tr key={row.period}>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{row.period}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{row.left_value ?? "—"}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{row.right_value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize text-gray-900">{value}</p>
    </div>
  )
}
