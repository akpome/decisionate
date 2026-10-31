"use client"

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { GitCompare, RefreshCw, Save, Trash2 } from "lucide-react"

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
  type DimensionFilter,
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { DatasetDimensionFilter, dimensionFilterLabel } from "@/features/datasets/components/dimension-filter"
import { MAXIMUM_RELATIONSHIP_OBSERVATIONS, MINIMUM_RELATIONSHIP_OBSERVATIONS, RELATIONSHIP_DEFAULTS } from "@/features/relationships/defaults"

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
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Not calculated"
    : value.toFixed(2)
}

function hasCorrelationScore(relationship: DatasetRelationship) {
  return relationship.status === "ready" && typeof relationship.correlation === "number"
    && Number.isFinite(relationship.correlation)
}

function unavailableCorrelationLabel(relationship: DatasetRelationship) {
  if (relationship.status === "unavailable") return "Analysis unavailable"
  return relationship.minimum_observations !== undefined
    && relationship.matched_period_count < relationship.minimum_observations
    ? "More history needed"
    : "Correlation unavailable"
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

function relationshipPairLabel(relationship: DatasetRelationship) {
  const left = `${relationship.left_dataset_name} · ${relationship.left.metric_column}`
  const right = `${relationship.right_dataset_name} · ${relationship.right.metric_column}`
  if (relationship.lag_mode !== "automatic" && relationship.lag_periods === 0) return `${left} / ${right}`
  return relationship.lag_direction === "b_leads_a" ? `${right} → ${left}` : `${left} → ${right}`
}

export default function RelationshipsPage() {
  const { t } = useDecisionateText()
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
  const [dimensionFilters, setDimensionFilters] = useState<Record<string, DimensionFilter | undefined>>({})
  const [name, setName] = useState("Cross-source relationship")
  const [period, setPeriod] = useState<DashboardAggregation>(RELATIONSHIP_DEFAULTS.period)
  const [aggregation, setAggregation] = useState<DashboardValueAggregation>(RELATIONSHIP_DEFAULTS.aggregation)
  const [method, setMethod] = useState<"pearson" | "spearman">(RELATIONSHIP_DEFAULTS.method)
  const [lagMode, setLagMode] = useState<"automatic" | "manual">(RELATIONSHIP_DEFAULTS.lagMode)
  const [lagPeriods, setLagPeriods] = useState(String(RELATIONSHIP_DEFAULTS.lagPeriods))
  const [lagDirection, setLagDirection] = useState<"a_leads_b" | "b_leads_a">(RELATIONSHIP_DEFAULTS.lagDirection)
  const [minimumObservations, setMinimumObservations] = useState(String(RELATIONSHIP_DEFAULTS.minimumObservations))
  const [maximumLag, setMaximumLag] = useState(String(RELATIONSHIP_DEFAULTS.maximumLag))
  const [result, setResult] = useState<DatasetRelationship | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deletingRelationshipId, setDeletingRelationshipId] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [statusMessage, setStatusMessage] = useState("")
  const filterKey = (identity: string) => JSON.stringify([user?.id, activeWorkspaceId, workspaceVersion, identity])
  const leftFilter = dimensionFilters[filterKey(leftDatasetId)]
  const rightFilter = dimensionFilters[filterKey(rightDatasetId)]
  const incompleteFilter = [leftFilter, rightFilter].some(filter => filter && !filter.values.length)

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

  const setupScope = JSON.stringify([user?.id, activeWorkspaceId, workspaceVersion, leftDatasetId, rightDatasetId,
    resolvedLeftDateColumn, resolvedRightDateColumn, resolvedLeftMetric, resolvedRightMetric, leftFilter, rightFilter,
    name, period, aggregation, method, lagMode, lagPeriods, lagDirection, minimumObservations, maximumLag])
  const currentSetup = useRef(setupScope)
  useLayoutEffect(() => {
    currentSetup.current = setupScope
    return () => { currentSetup.current = "" }
  }, [setupScope])

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
  }, [
    activeWorkspaceId,
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    workspaceVersion,
  ])

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
    const minimum = Number(minimumObservations), maximum = Number(maximumLag), fixedLag = lagMode === "automatic" ? 0 : Number(lagPeriods)
    if (!Number.isInteger(minimum) || minimum < MINIMUM_RELATIONSHIP_OBSERVATIONS || minimum > MAXIMUM_RELATIONSHIP_OBSERVATIONS) {
      setError("Choose between 24 and 3653 minimum historical observations.")
      return null
    }
    if (!Number.isInteger(maximum) || maximum < 0 || maximum > RELATIONSHIP_DEFAULTS.maximumLag || !Number.isInteger(fixedLag) || fixedLag < 0 || fixedLag > RELATIONSHIP_DEFAULTS.maximumLag || lagMode === "manual" && fixedLag > maximum) {
      setError("Choose a maximum lag from 0 to 12. If saved timing is outside this limit, choose a relationship direction again.")
      return null
    }
    if (incompleteFilter) {
      setError("Choose at least one unique value for each selected dimension column.")
      return null
    }
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
        ...(leftFilter ? { dimension_filter: leftFilter } : {}),
      },
      right: {
        dataset_id: Number(rightDatasetId),
        date_column: resolvedRightDateColumn,
        metric_column: resolvedRightMetric,
        ...(rightFilter ? { dimension_filter: rightFilter } : {}),
      },
      period,
      aggregation,
      method,
      minimum_observations: minimum,
      maximum_lag: maximum,
      lag_direction: lagDirection,
      lag_mode: lagMode,
      lag_periods: fixedLag,
    }
  }

  async function handlePreview() {
    if (!user?.id) return
    const payload = buildPayload()
    if (!payload) return
    setBusy(true)
    setError("")
    setStatusMessage("")
    const scope = setupScope
    try {
      const calculated = await previewDatasetRelationship(payload, user.id, activeWorkspaceId)
      if (currentSetup.current === scope) setResult(calculated)
    } catch (previewError) {
      if (currentSetup.current === scope) setError(getErrorMessage(previewError, "Unable to calculate relationship."))
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
    const scope = setupScope
    try {
      const saved = await createDatasetRelationship(
        payload,
        user.id,
        activeWorkspaceId
      )
      if (currentSetup.current !== scope) return
      setResult(saved)
      setRelationships(current => [
        saved,
        ...current.filter(item => item.id !== saved.id),
      ])
      setStatusMessage("Relationship saved for this workspace.")
    } catch (saveError) {
      if (currentSetup.current === scope) setError(getErrorMessage(saveError, "Unable to save relationship."))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(relationship: DatasetRelationship) {
    if (!user?.id) return
    if (!relationship.id || deletingRelationshipId !== null) return

    const confirmed = window.confirm(
      `Delete ${relationship.name}? This saved relationship will be removed from this workspace and any alert that monitors it.`
    )
    if (!confirmed) return

    const relationshipId = relationship.id
    setDeletingRelationshipId(relationshipId)
    setError("")
    setStatusMessage("")
    try {
      await deleteDatasetRelationship(
        relationshipId,
        user.id,
        activeWorkspaceId
      )
      setRelationships(current => current.filter(item => item.id !== relationshipId))
      if (result?.id === relationshipId) setResult(null)
      setStatusMessage(t("Relationship removed."))
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t("Unable to remove relationship.")))
    } finally {
      setDeletingRelationshipId(null)
    }
  }

  function changeDimensionFilter(identity: string, filter: DimensionFilter | undefined) {
    setDimensionFilters(current => ({ ...current, [filterKey(identity)]: filter }))
    setResult(null); setStatusMessage(""); setError("")
  }

  function changeAnalysisSetting(update: () => void) {
    update()
    setResult(null); setStatusMessage(""); setError("")
  }

  function changeRelationshipDirection(direction: string) {
    if (direction === "legacy_fixed") return
    changeAnalysisSetting(() => {
      setLagMode(direction === "same_period" ? "manual" : "automatic")
      setLagDirection(direction === "b_leads_a" ? "b_leads_a" : "a_leads_b")
      setLagPeriods("0")
    })
  }

  function openSavedRelationship(relationship: DatasetRelationship) {
    setLeftDatasetId(String(relationship.left.dataset_id)); setRightDatasetId(String(relationship.right.dataset_id))
    setLeftDateColumn(relationship.left.date_column); setRightDateColumn(relationship.right.date_column)
    setLeftMetric(relationship.left.metric_column); setRightMetric(relationship.right.metric_column)
    setName(relationship.name); setPeriod(relationship.period); setAggregation(relationship.aggregation)
    setMethod(relationship.method); setLagMode(relationship.lag_mode || "manual"); setLagPeriods(String(relationship.lag_periods))
    setLagDirection(relationship.lag_direction ?? RELATIONSHIP_DEFAULTS.lagDirection)
    setMinimumObservations(String(relationship.minimum_observations ?? RELATIONSHIP_DEFAULTS.minimumObservations))
    setMaximumLag(String(relationship.maximum_lag ?? RELATIONSHIP_DEFAULTS.maximumLag))
    setDimensionFilters(current => ({ ...current,
      [filterKey(String(relationship.left.dataset_id))]: relationship.left.dimension_filter || undefined,
      [filterKey(String(relationship.right.dataset_id))]: relationship.right.dimension_filter || undefined,
    }))
    setResult(relationship); setStatusMessage(""); setError("")
  }

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        title="Relationships"
        actions={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Refresh relationships"
          >
            <RefreshCw size={16} />
            {t("Refresh")}
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
            <h2 className="text-lg font-semibold">{t("Compare two metrics")}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t("Decisionate calculates the relationship from aligned data. It does not imply that one metric caused the other.")}
            </p>
          </div>
        </div>

        {loading ? (
          <p role="status" className="mt-6 text-sm text-gray-500">{t("Loading datasets...")}</p>
        ) : datasets.length < 2 ? (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t("Add at least two datasets before defining a cross-source relationship.")}
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            <label className="block max-w-xl space-y-2">
              <span className="text-sm font-medium text-gray-700">{t("Relationship name")}</span>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder={t("Marketing spend and revenue")}
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
                userId={user?.id} workspaceId={activeWorkspaceId} filterContext={filterKey(leftDatasetId)}
                dimensionFilter={leftFilter} onDimensionFilterChange={value => changeDimensionFilter(leftDatasetId, value)} disabled={busy || loadingMetadata}
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
                userId={user?.id} workspaceId={activeWorkspaceId} filterContext={filterKey(rightDatasetId)}
                dimensionFilter={rightFilter} onDimensionFilterChange={value => changeDimensionFilter(rightDatasetId, value)} disabled={busy || loadingMetadata}
              />
            </div>

            <section aria-label={t("Relationship analysis")} className="space-y-4 border-y border-gray-100 py-4">
              <h3 className="text-sm font-semibold">{t("Relationship analysis")}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={t("Group by")} value={period} onChange={value => changeAnalysisSetting(() => setPeriod(value as DashboardAggregation))} options={periodOptions} />
                <SelectField label={t("Aggregation")} value={aggregation} onChange={value => changeAnalysisSetting(() => setAggregation(value as DashboardValueAggregation))} options={aggregationOptions} />
                <SelectField label={t("Correlation method")} value={method} onChange={value => changeAnalysisSetting(() => setMethod(value as "pearson" | "spearman"))} options={[{ value: "spearman", label: t("Spearman") }, { value: "pearson", label: t("Pearson") }]} />
                <label className="space-y-2"><span className="text-sm font-medium text-gray-700">{t("Minimum historical observations")}</span><input type="number" min={MINIMUM_RELATIONSHIP_OBSERVATIONS} max={MAXIMUM_RELATIONSHIP_OBSERVATIONS} required value={minimumObservations} onChange={event => changeAnalysisSetting(() => setMinimumObservations(event.target.value))} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm" /></label>
              </div>
              <h4 className="text-sm font-medium">{t("Evaluate timing")}</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">{t("Relationship direction")}</span>
                  <select
                    aria-label={t("Relationship direction")}
                    value={lagMode === "automatic" ? lagDirection : Number(lagPeriods) > 0 ? "legacy_fixed" : "same_period"}
                    onChange={event => changeRelationshipDirection(event.target.value)}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="same_period">{t("Same-period comparison only")}</option>
                    <option value="a_leads_b">{t("{metric} leads").replace("{metric}", `${datasets.find(item => String(item.id) === leftDatasetId)?.file_name || t("Dataset A")} / ${resolvedLeftMetric}`)}</option>
                    <option value="b_leads_a">{t("{metric} leads").replace("{metric}", `${datasets.find(item => String(item.id) === rightDatasetId)?.file_name || t("Dataset B")} / ${resolvedRightMetric}`)}</option>
                    {lagMode === "manual" && Number(lagPeriods) > 0 && <option value="legacy_fixed">{t("Saved fixed lag")}: {lagPeriods} {t(formatPeriodUnit(period))}{Number(lagPeriods) === 1 ? "" : "s"}</option>}
                  </select>
                </label>
                {lagMode === "automatic" && <label className="space-y-2"><span className="text-sm font-medium text-gray-700">{t("Maximum lag")}</span><input type="number" min={0} max={RELATIONSHIP_DEFAULTS.maximumLag} required value={maximumLag} onChange={event => changeAnalysisSetting(() => setMaximumLag(event.target.value))} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm" /></label>}
              </div>
            </section>

            {loadingMetadata && <p className="text-xs text-gray-500">{t("Loading dataset columns...")}</p>}

            <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={busy || loadingMetadata || incompleteFilter}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <GitCompare size={16} />
                {busy ? t("Calculating...") : t("Preview relationship")}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy || loadingMetadata || incompleteFilter}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={16} />
                {t("Save relationship")}
              </button>
            </div>
          </div>
        )}
      </section>

      {result && (
        <RelationshipResult relationship={result} />
      )}

      <section id="saved-relationships" className="scroll-mt-24 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">{t("Saved relationships")}</h2>
          <p className="mt-1 text-sm text-gray-500">{t("Saved definitions are recalculated from the latest dataset contents when opened.")}</p>
        </div>
        {relationships.length === 0 ? (
          <p className="mt-5 text-sm text-gray-500">{t("No cross-source relationships saved yet.")}</p>
        ) : (
          <div className="mt-5 space-y-3">
            {relationships.map(relationship => (
              <div key={relationship.id} className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => openSavedRelationship(relationship)}
                  className="min-w-0 text-left"
                >
                  <p className="truncate font-medium text-gray-900">{relationship.name}</p>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {relationshipPairLabel(relationship)}
                  </p>
                  {[relationship.left, relationship.right].map((side, index) => side.dimension_filter && <p key={index} className="mt-1 break-words text-xs text-gray-600">{index === 0 ? "A" : "B"} / {dimensionFilterLabel(side.dimension_filter)}</p>)}
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${relationshipTone(relationship)}`}>
                    {!hasCorrelationScore(relationship)
                      ? t(unavailableCorrelationLabel(relationship))
                      : `${relationship.direction} ${formatCorrelation(relationship.correlation)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(relationship)}
                    disabled={busy || deletingRelationshipId !== null || !relationship.id}
                    className="rounded-lg p-2 text-gray-500 hover:bg-white hover:text-red-600 disabled:opacity-50"
                    aria-label={`Delete ${relationship.name}`}
                    title={t("Delete relationship")}
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
  userId, workspaceId, filterContext, dimensionFilter, onDimensionFilterChange, disabled,
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
  userId?: string; workspaceId?: string; filterContext: string; dimensionFilter?: DimensionFilter
  onDimensionFilterChange: (value: DimensionFilter | undefined) => void; disabled: boolean
}) {
  const { t } = useDecisionateText()

  return (
    <fieldset disabled={disabled} aria-label={label} className="min-w-0 space-y-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
      <SelectField
        label={t("Dataset")}
        value={datasetId}
        onChange={onDatasetChange}
        options={datasets.map(dataset => ({ value: String(dataset.id), label: dataset.file_name }))}
      />
      <SelectField
        label={t("Date column")}
        value={dateColumn}
        onChange={onDateChange}
        options={(metadata?.date_columns ?? []).map(column => ({ value: column, label: column }))}
      />
      <SelectField
        label={t("Numeric metric")}
        value={metric}
        onChange={onMetricChange}
        options={(metadata?.numeric_columns ?? []).map(column => ({ value: column, label: column }))}
      />
      {userId && datasetId && <DatasetDimensionFilter key={filterContext} datasetId={Number(datasetId)} userId={userId} workspaceId={workspaceId}
        value={dimensionFilter} onChange={onDimensionFilterChange} disabled={disabled} />}
    </fieldset>
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
  const { t } = useDecisionateText()
  const id = useId()

  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
      <select
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <option value="">{t("Choose")} {label.toLowerCase()}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

function RelationshipResult({
  relationship,
}: {
  relationship: DatasetRelationship
}) {
  const { t } = useDecisionateText()
  const hasScore = hasCorrelationScore(relationship)
  const hasLag = hasScore && Number.isInteger(relationship.lag_periods) && relationship.lag_periods >= 0
  const lagUnit = `${formatPeriodUnit(relationship.period)}${relationship.lag_periods === 1 ? "" : "s"}`
  const missingHistory = relationship.status !== "unavailable" && !hasScore
    && relationship.minimum_observations !== undefined
    && relationship.matched_period_count < relationship.minimum_observations

  return (
    <section aria-label={t("Relationship evidence")} className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 break-words">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">{t("Relationship evidence")}</p>
          <h2 className="mt-1 text-lg font-semibold">{relationship.name}</h2>
          <p className="mt-1 text-sm font-medium text-gray-800">
            {relationship.association_summary || relationship.decision_context}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            {relationship.causation_disclaimer || t("Association does not establish causation.")}
          </p>
        </div>
        <aside aria-label={t("Correlation coefficient")} className={`min-w-0 rounded-lg border px-4 py-3 ${relationshipTone(relationship)}`}>
          <p className="text-xs font-medium">{t("Correlation coefficient")}</p>
          <p className={`mt-1 font-semibold ${hasScore ? "text-2xl tabular-nums" : "text-base"}`}>
            {hasScore ? formatCorrelation(relationship.correlation) : t(unavailableCorrelationLabel(relationship))}
          </p>
          {hasScore ? (
            <p className="mt-1 text-xs capitalize">{relationship.relationship_strength} {relationship.direction}</p>
          ) : (
            <p className="mt-1 text-xs">
              {missingHistory
                ? t("{matched} of {required} matching periods.")
                    .replace("{matched}", String(relationship.matched_period_count))
                    .replace("{required}", String(relationship.minimum_observations))
                : relationship.status === "unavailable"
                  ? t("Check the source data and saved filters.")
                  : t("A score could not be calculated from these values.")}
            </p>
          )}
        </aside>
      </div>

      {[relationship.left, relationship.right].map((side, index) => side.dimension_filter && <p key={index} className="mt-3 break-words text-sm text-gray-600">
        <span className="font-medium">{index === 0 ? relationship.left_dataset_name : relationship.right_dataset_name}</span> / {dimensionFilterLabel(side.dimension_filter)}
      </p>)}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricStat label={t("Shared periods")} value={String(relationship.matched_period_count)} />
        <MetricStat label={t("Method")} value={relationship.method} />
        <MetricStat label={t("Aggregation")} value={`${relationship.aggregation} · ${relationship.period}`} />
        <MetricStat
          label={relationship.lag_mode === "manual" ? t("Lag (selected comparison)") : t("Lag (observed)")}
          value={!hasLag ? t("Not established") : relationship.lag_periods === 0
            ? t("0 (same period)") : `${relationship.lag_periods} ${t(lagUnit)}`}
          detail={hasLag && relationship.lag_periods > 0 ? relationshipPairLabel(relationship) : undefined}
        />
      </div>
      {hasLag && relationship.lag_mode === "manual" && <p className="mt-3 text-xs text-gray-600">{t("Selected comparison, not an estimated delay.")}</p>}
      {hasLag && relationship.lag_mode !== "manual" && relationship.lag_credibility !== "credible" && <p className="mt-3 text-xs text-amber-800">{t("Tentative lag; the timing evidence is not yet dependable.")}</p>}

      {relationship.lag_mode !== "manual" && relationship.lag_candidates && relationship.lag_candidates.length > 0 && (
        <details className="mt-5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            {t("View timing evidence")}
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="px-2 py-2">{t("Delay")}</th>
                  <th className="px-2 py-2">{t("Correlation")}</th>
                  <th className="px-2 py-2">{t("Periods")}</th>
                  <th className="px-2 py-2">{t("Evidence")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {relationship.lag_candidates.map(candidate => (
                  <tr key={candidate.lag_periods}>
                    <td className="px-2 py-2">{candidate.lag_periods === 0 ? t("Same period") : `${candidate.lag_periods} ${t(formatPeriodUnit(relationship.period))}`}</td>
                    <td className="px-2 py-2">{t(formatCorrelation(candidate.correlation))}</td>
                    <td className="px-2 py-2">{candidate.matched_period_count}</td>
                    <td className="px-2 py-2">{candidate.credible ? t("Credible") : t("Limited")}</td>
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
                <th className="px-3 py-2">{t("Period")}</th>
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

function MetricStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-gray-900">{value}</p>
      {detail && <p className="mt-1 break-words text-xs text-gray-600">{detail}</p>}
    </div>
  )
}
