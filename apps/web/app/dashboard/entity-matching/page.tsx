"use client"

import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"
import {
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  UsersRound,
  X,
} from "lucide-react"

import {
  getEntityMatchingMetadata,
  getDatasets,
  previewEntityMatching,
  runEntityMatching,
  type DatasetSummary,
  type EntityMatchingDatasetMetadata,
  type EntityMatchingPreview,
  type EntityMatchingRun,
  type EntityType,
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import { WorkspaceAccessNotice } from "@/features/dashboard/components/workspace-access-notice"
import { useDecisionateText } from "@/app/use-decisionate-language"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function EntityMatchingPage() {
  const { user } = useUser()
  const { activeWorkspaceId, workspaceVersion } = useActiveWorkspace(user?.id)
  return <EntityMatchingWorkspace key={`${user?.id}:${activeWorkspaceId}:${workspaceVersion}`} />
}

function EntityMatchingWorkspace() {
  const { t } = useDecisionateText()
  const { user } = useUser()
  const { activeWorkspaceId, workspaceVersion } = useActiveWorkspace(user?.id)
  const { canManageWorkspaceData, loadingWorkspaceAccess } = useWorkspaceAccess(user?.id)
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [columnMetadata, setColumnMetadata] = useState<EntityMatchingDatasetMetadata[]>([])
  const [selectedKeyColumns, setSelectedKeyColumns] = useState<Record<string, string[]>>({})
  const [selectedMetricColumns, setSelectedMetricColumns] = useState<Record<string, string[]>>({})
  const [dateColumns, setDateColumns] = useState<Record<string, string>>({})
  const [approvedMatches, setApprovedMatches] = useState<string[]>([])
  const [includeSummary, setIncludeSummary] = useState(false)
  const [entityType, setEntityType] = useState<EntityType>("customer")
  const [preview, setPreview] = useState<EntityMatchingPreview | null>(null)
  const [result, setResult] = useState<EntityMatchingRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [statusMessage, setStatusMessage] = useState("")

  useEffect(() => {
    if (!user?.id) return
    let current = true
    void getDatasets(
      user.id,
      activeWorkspaceId,
      user.primaryEmailAddress?.emailAddress
    )
      .then(data => {
        if (!current) return
        setError("")
        const sourceDatasets = data.filter(
          dataset => dataset.source_type !== "entity_matching"
        )
        setDatasets(sourceDatasets)
        setSelectedIds(sourceDatasets.slice(0, 2).map(dataset => dataset.id))
      })
      .catch(loadError => {
        if (current) setError(getErrorMessage(loadError, "Unable to load datasets."))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [activeWorkspaceId, user?.id, user?.primaryEmailAddress?.emailAddress, workspaceVersion])

  useEffect(() => {
    if (!user?.id || selectedIds.length === 0) {
      return
    }

    let current = true
    void getEntityMatchingMetadata(
      selectedIds,
      entityType,
      user.id,
      activeWorkspaceId
    )
      .then(metadata => {
        if (!current) return
        metadata.datasets = metadata.datasets.map(dataset => ({ ...dataset, date_columns: dataset.date_columns ?? [] }))
        setColumnMetadata(metadata.datasets)
        setDateColumns(existing => Object.fromEntries(metadata.datasets.map(dataset => [
          String(dataset.dataset_id), dataset.date_columns.includes(existing[String(dataset.dataset_id)])
            ? existing[String(dataset.dataset_id)] : dataset.default_date_column ?? "",
        ])))
        setSelectedKeyColumns(existing => {
          const next: Record<string, string[]> = {}
          metadata.datasets.forEach(dataset => {
            const datasetKey = String(dataset.dataset_id)
            const existingColumns = existing[datasetKey]?.filter(
              column => dataset.columns.includes(column)
            )
            next[datasetKey] = existingColumns?.length
              ? existingColumns
              : dataset.default_key_columns
          })
          return next
        })
        setSelectedMetricColumns(existing => {
          const next: Record<string, string[]> = {}
          metadata.datasets.forEach(dataset => {
            const datasetKey = String(dataset.dataset_id)
            const existingColumns = existing[datasetKey]?.filter(
              column => dataset.metric_columns.includes(column)
            )
            next[datasetKey] = existingColumns?.length
              ? existingColumns
              : dataset.default_metric_columns
          })
          return next
        })
      })
      .catch(metadataError => {
        if (current) {
          setColumnMetadata([])
          setError(getErrorMessage(metadataError, "Unable to load dataset columns."))
        }
      })

    return () => {
      current = false
    }
  }, [activeWorkspaceId, entityType, selectedIds, user?.id])

  const selectedDatasets = useMemo(
    () => datasets.filter(dataset => selectedIds.includes(dataset.id)),
    [datasets, selectedIds]
  )
  const columnMetadataLoading = selectedIds.some(id => !columnMetadata.some(dataset => dataset.dataset_id === id))

  function toggleDataset(datasetId: number) {
    setPreview(null)
    setResult(null)
    setSelectedIds(current =>
      current.includes(datasetId)
        ? current.filter(id => id !== datasetId)
        : current.length >= 10
          ? current
          : [...current, datasetId]
    )
  }

  function toggleKeyColumn(datasetId: number, column: string) {
    setPreview(null)
    setResult(null)
    const datasetKey = String(datasetId)
    setSelectedKeyColumns(existing => {
      const current = existing[datasetKey] ?? []
      const next = current.includes(column)
        ? current.filter(selected => selected !== column)
        : [...current, column]
      return {
        ...existing,
        [datasetKey]: next,
      }
    })
    setSelectedMetricColumns(existing => ({
      ...existing,
      [datasetKey]: (existing[datasetKey] ?? []).filter(
        selected => selected !== column
      ),
    }))
  }

  function toggleMetricColumn(datasetId: number, column: string) {
    setPreview(null)
    setResult(null)
    const datasetKey = String(datasetId)
    setSelectedMetricColumns(existing => {
      const current = existing[datasetKey] ?? []
      const next = current.includes(column)
        ? current.filter(selected => selected !== column)
        : [...current, column]
      return {
        ...existing,
        [datasetKey]: next,
      }
    })
  }

  function clearMetricColumns(datasetId: number) {
    setPreview(null)
    setResult(null)
    const datasetKey = String(datasetId)
    setSelectedMetricColumns(existing => ({
      ...existing,
      [datasetKey]: [],
    }))
  }

  function resetMetricColumns(datasetId: number) {
    const metadata = columnMetadata.find(
      item => item.dataset_id === datasetId
    )
    if (!metadata) return

    setPreview(null)
    setResult(null)
    const datasetKey = String(datasetId)
    const selectedKeys = selectedKeyColumns[datasetKey] ?? []
    setSelectedMetricColumns(existing => ({
      ...existing,
      [datasetKey]: metadata.default_metric_columns.filter(
        column => !selectedKeys.includes(column)
      ),
    }))
  }

  function getMatchingKeyColumns() {
    return Object.fromEntries(
      selectedIds.map(datasetId => [
        String(datasetId),
        selectedKeyColumns[String(datasetId)] ?? [],
      ])
    )
  }

  function hasMissingKeyColumns() {
    return selectedIds.some(
      datasetId => !(selectedKeyColumns[String(datasetId)] ?? []).length
    )
  }

  function hasMissingMetricColumns() {
    return selectedIds.some(datasetId => {
      const metadata = columnMetadata.find(
        item => item.dataset_id === datasetId
      )
      return Boolean(
        metadata?.metric_columns.length &&
        !(selectedMetricColumns[String(datasetId)] ?? []).length
      )
    })
  }

  async function handlePreview() {
    if (!user?.id || selectedIds.length < 2) {
      setError("Select at least two datasets to compare.")
      return
    }
    if (hasMissingKeyColumns()) {
      setError("Choose at least one identity column for each selected dataset.")
      return
    }
    if (hasMissingMetricColumns()) {
      setError("Choose at least one metric or column for each selected dataset.")
      return
    }
    setBusy(true)
    setError("")
    setStatusMessage("")
    setApprovedMatches([])
    setResult(null)
    setPreview(null)
    try {
      const nextPreview = await previewEntityMatching({
        dataset_ids: selectedIds,
        entity_type: entityType,
        key_columns: getMatchingKeyColumns(),
        metric_columns: selectedMetricColumns,
        date_columns: dateColumns,
      }, user.id, activeWorkspaceId)
      if (nextPreview.output_format !== "linked_history") {
        throw new Error("Linked history is not available from this API version yet. Refresh after the API deployment finishes.")
      }
      setPreview(nextPreview)
    } catch (previewError) {
      setError(getErrorMessage(previewError, "Unable to preview entity matches."))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!preview) return
    if (!user?.id || selectedIds.length < 2) {
      setError("Select at least two datasets to match.")
      return
    }
    if (hasMissingKeyColumns()) {
      setError("Choose at least one identity column for each selected dataset.")
      return
    }
    if (hasMissingMetricColumns()) {
      setError("Choose at least one metric or column for each selected dataset.")
      return
    }
    setBusy(true)
    setError("")
    setStatusMessage("")
    try {
      const saved = await runEntityMatching({
        dataset_ids: selectedIds,
        entity_type: entityType,
        key_columns: getMatchingKeyColumns(),
        metric_columns: selectedMetricColumns,
        date_columns: dateColumns,
        approved_match_keys: approvedMatches,
        include_summary: includeSummary,
        replace_existing: true,
      }, user.id, activeWorkspaceId)
      setResult(saved)
      setStatusMessage(
        `${t("Saved")} ${saved.unified_dataset_row_count ?? saved.source_row_count} ${t("source records in")} ${saved.unified_dataset_name ?? t("linked history")}.`
      )
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Unable to save entity matches."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        title="Cross-source entity matching"
        actions={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Refresh datasets"
          >
            <RefreshCw size={16} />
            {t("Refresh")}
          </button>
        }
      />

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Only workspace owners can run entity matching. You can still review existing analysis in this workspace."
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {statusMessage && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{statusMessage}</div>}

      <fieldset disabled={busy || !canManageWorkspaceData} className="min-w-0 border-y border-gray-200 py-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><UsersRound size={19} /></div>
          <div>
        <h2 className="text-lg font-semibold text-gray-950">{t("Choose source datasets")}</h2>
          </div>
        </div>

        <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">{t("Entity type")}</span>
            <select
              value={entityType}
              onChange={event => {
                setEntityType(event.target.value as EntityType)
                setPreview(null)
                setResult(null)
                setSelectedKeyColumns({})
                setSelectedMetricColumns({})
              }}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="customer">{t("Customers")}</option>
              <option value="product">{t("Products")}</option>
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {loading ? <p role="status" className="text-sm text-gray-500">{t("Loading datasets...")}</p> : datasets.map(dataset => (
              <label key={dataset.id} className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-3 ${selectedIds.includes(dataset.id) ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(dataset.id)}
                  onChange={() => toggleDataset(dataset.id)}
                  disabled={!canManageWorkspaceData || (!selectedIds.includes(dataset.id) && selectedIds.length >= 10)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-800">{dataset.file_name}</span>
                  <span className="block text-xs text-gray-500">{dataset.row_count.toLocaleString()} {t("rows")}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {selectedDatasets.length > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{t("Identity columns by dataset")}</h3>
              </div>
              {columnMetadataLoading && <span className="text-xs text-gray-500">{t("Loading columns...")}</span>}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {selectedDatasets.map(dataset => {
                const metadata = columnMetadata.find(
                  item => item.dataset_id === dataset.id
                )
                const selectedColumns = selectedKeyColumns[String(dataset.id)] ?? []
                const selectedMetrics = selectedMetricColumns[String(dataset.id)] ?? []
                return (
                  <fieldset key={dataset.id} className="min-w-0 border-t border-gray-200 py-3">
                    <legend className="max-w-full px-1 text-sm font-medium text-gray-800">
                      <span className="block break-words">{dataset.file_name}</span>
                    </legend>
                    {!metadata ? (
                      <p className="text-xs text-gray-500">{columnMetadataLoading ? t("Loading available columns...") : t("No columns available.")}</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto py-2">
                        <div className="grid gap-1 sm:grid-cols-2">
                          {metadata.columns.map(column => {
                            const isDefault = metadata.default_key_columns.includes(column)
                            return (
                              <label key={column} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                                <input
                                  type="checkbox"
                                  checked={selectedColumns.includes(column)}
                                  onChange={() => toggleKeyColumn(dataset.id, column)}
                                  disabled={!canManageWorkspaceData}
                                  className="h-4 w-4 shrink-0 accent-blue-600"
                                />
                                <span className="min-w-0 truncate" title={column}>{column}</span>
                                {isDefault && <span className="shrink-0 text-[10px] uppercase tracking-wide text-blue-600">{t("Suggested")}</span>}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {!selectedColumns.length && metadata && (
                      <p className="mt-2 text-xs text-amber-700">{t("Select at least one column before previewing or saving.")}</p>
                    )}
                    {metadata && (
                      <label className="mt-3 block text-sm text-gray-700">
                        {t("Record date column")}
                        <select aria-label={`${dataset.file_name} record date column`}
                          value={dateColumns[String(dataset.id)] ?? ""}
                          onChange={event => {
                            setDateColumns(existing => ({ ...existing, [String(dataset.id)]: event.target.value }))
                            setPreview(null)
                            setResult(null)
                          }}
                          className="mt-1 h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3">
                          {!metadata.date_columns.length && <option value="">{t("No date column available")}</option>}
                          {metadata.date_columns.map(column => <option key={column} value={column}>{column}</option>)}
                        </select>
                      </label>
                    )}
                    {metadata && (
                      <div className="mt-3 border-t border-gray-200 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-700">{t("Metrics for analysis")}</p>
                          <span className="flex flex-wrap items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => clearMetricColumns(dataset.id)}
                              disabled={!selectedMetrics.length || !canManageWorkspaceData}
                              className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                              title={t("Unselect all metrics or columns")}
                            >
                              <X size={12} aria-hidden="true" />
                              {t("Unselect all")}
                            </button>
                            <button
                              type="button"
                              onClick={() => resetMetricColumns(dataset.id)}
                              disabled={!canManageWorkspaceData}
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
                              title={t("Reset metrics or columns to the default selection")}
                            >
                              <RotateCcw size={12} aria-hidden="true" />
                              {t("Reset to default")}
                            </button>
                          </span>
                        </div>
                        {metadata.metric_columns.length > 0 ? (
                          <div className="mt-2 max-h-36 overflow-y-auto py-2">
                            <div className="grid gap-1 sm:grid-cols-2">
                              {metadata.metric_columns
                                .filter(column => !selectedColumns.includes(column))
                                .map(column => (
                                <label key={column} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                                  <input
                                    type="checkbox"
                                    checked={selectedMetrics.includes(column)}
                                    onChange={() => toggleMetricColumn(dataset.id, column)}
                                    disabled={!canManageWorkspaceData}
                                    className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                                  />
                                  <span className="min-w-0 truncate" title={column}>{column}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">{t("No non-identity columns are available.")}</p>
                        )}
                        {!selectedMetrics.length && metadata.metric_columns.length > 0 && (
                          <p className="mt-2 text-xs text-amber-700">{t("Select at least one field to include.")}</p>
                        )}
                      </div>
                    )}
                  </fieldset>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void handlePreview()} disabled={busy || columnMetadataLoading || !canManageWorkspaceData || selectedIds.length < 2} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><ScanSearch size={16} />{t(busy ? "Working..." : "Preview matches")}</button>
          <span className="text-xs text-gray-500">{selectedDatasets.length} {t("selected")}</span>
        </div>
      </fieldset>

      {preview && (
        <section className="min-w-0 border-b border-gray-200 pb-5">
          <h2 className="text-lg font-semibold text-gray-950">{t("Match preview")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Summary label={t("Source rows")} value={(preview.matched_row_count + preview.unmatched_row_count).toLocaleString()} />
            <Summary label={t("Proposed groups")} value={preview.matched_group_count.toLocaleString()} />
            <Summary label={t("Proposed linked rows")} value={preview.matched_row_count.toLocaleString()} />
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[32rem] w-full text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-2">Dataset</th><th className="px-2 py-2">Selected identity columns</th><th className="px-2 py-2">Rows</th><th className="px-2 py-2">Unmatched</th></tr></thead>
              <tbody>{preview.datasets.map(dataset => <tr key={dataset.dataset_id} className="border-b last:border-0"><td className="px-2 py-3 font-medium text-gray-800">{dataset.file_name}</td><td className="px-2 py-3 text-gray-600">{dataset.key_columns.join(", ") || "No supported key"}</td><td className="px-2 py-3 text-gray-600">{dataset.candidate_row_count.toLocaleString()}</td><td className="px-2 py-3 text-gray-600">{dataset.unmatched_row_count.toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
          {preview.review_group_count > 0 && (
            <div className="mt-5">
              <h3 className="font-semibold">{t("Matches needing confirmation")}</h3>
              <p className="mt-1 text-sm text-amber-800">{t("Unconfirmed matches stay separate. Source records are retained.")}</p>
              <div className="mt-3 max-h-80 overflow-y-auto divide-y border-y border-gray-200">
                {preview.review_groups.map(group => (
                  <label key={group.canonical_key} className="flex items-start gap-3 py-3 text-sm">
                    <input type="checkbox" className="mt-1 shrink-0 accent-blue-600" disabled={busy || !canManageWorkspaceData || group.match_count > group.sources.length}
                      checked={approvedMatches.includes(group.review_key)}
                      onChange={event => setApprovedMatches(existing => event.target.checked
                        ? [...existing, group.review_key] : existing.filter(key => key !== group.review_key))} />
                    <span className="min-w-0 break-words">
                      <span className="block font-medium">{t("Confirm same")} {t(entityType)}: {group.display_name}</span>
                      {group.match_count > group.sources.length && <span className="block text-amber-800">{t("Too many records for individual review. This group will remain separate; use stronger identity columns.")}</span>}
                      {group.sources.map(source => <span key={`${source.dataset_id}:${source.row}`} className="block text-xs text-gray-600">
                        {source.file_name} / {t("row")} {source.row}: {source.keys.join(", ")}
                      </span>)}
                    </span>
                  </label>
                ))}
              </div>
              {preview.review_group_count > preview.review_groups.length && <p className="mt-2 text-sm text-amber-800">{t("More matches need review. Additional matches will remain separate.")}</p>}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSummary} disabled={busy}
              onChange={event => setIncludeSummary(event.target.checked)} />{t("Include entity summary by source")}</label>
            <button type="button" onClick={() => void handleSave()} disabled={busy || !canManageWorkspaceData}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              <Save size={16} />{t(busy ? "Saving..." : "Save linked history")}
            </button>
          </div>
        </section>
      )}

      {result && (
        <section className="min-w-0 border-b border-gray-200 pb-5">
          {result.warnings?.map(warning => <p key={warning} className="mb-2 text-sm text-amber-800">{warning}</p>)}
          <h2 className="text-lg font-semibold text-gray-950">{t("Saved linked history")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><Summary label={t("Identities")} value={result.canonical_entity_count.toLocaleString()} /><Summary label={t("Rows matched across sources")} value={result.matched_row_count.toLocaleString()} /><Summary label={t("Unlinked source rows")} value={result.unmatched_row_count.toLocaleString()} /></div>
          {result.unified_dataset_id && (
            <Link
              href={`/dashboard/datasets/${result.unified_dataset_id}`}
              className="mt-4 inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              {t("Open")} {result.unified_dataset_name ?? t("unified dataset")}
            </Link>
          )}
          <div className="mt-5 overflow-x-auto"><table className="min-w-[32rem] w-full text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-2">Canonical name</th><th className="px-2 py-2">Sources</th><th className="px-2 py-2">Rows</th><th className="px-2 py-2">Match evidence</th></tr></thead><tbody>{result.entities.map(entity => <tr key={entity.id} className="border-b last:border-0"><td className="px-2 py-3 font-medium text-gray-800">{entity.display_name || entity.canonical_key}</td><td className="px-2 py-3 text-gray-600">{entity.source_count}</td><td className="px-2 py-3 text-gray-600">{entity.match_count}</td><td className="px-2 py-3 text-gray-600">{t(entity.confirmed ? "Confirmed" : entity.source_count > 1 ? "Exact shared key" : "One source")}</td></tr>)}</tbody></table></div>
          {result.summary?.length > 0 && <details className="mt-5 border-t pt-4">
            <summary className="cursor-pointer font-semibold">{t("Entity summary by source (first 100 entities)")}</summary>
            <div className="overflow-x-auto"><table className="mt-3 min-w-[32rem] w-full text-left text-sm">
              <thead><tr><th className="p-2">Entity</th><th className="p-2">Source / metric</th><th className="p-2">Aggregation</th><th className="p-2">Value</th></tr></thead>
              <tbody>{result.summary.flatMap(entity => entity.metrics.map(metric => <tr key={`${entity.canonical_key}:${metric.label}`} className="border-t">
                <td className="p-2">{entity.name}</td><td className="p-2">{metric.label}</td><td className="p-2">{metric.aggregation}</td>
                <td className="p-2">{metric.currency ?? metric.unit} {metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              </tr>))}</tbody>
            </table></div>
          </details>}
        </section>
      )}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"><p className="text-xs uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-xl font-semibold text-gray-950">{value}</p></div>
}
