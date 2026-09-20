"use client"

import { useEffect, useMemo, useState } from "react"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"
import { RefreshCw, Save, UsersRound } from "lucide-react"

import {
  getDatasets,
  previewEntityMatching,
  runEntityMatching,
  type DatasetSummary,
  type EntityMatchingPreview,
  type EntityMatchingRun,
  type EntityType,
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import { WorkspaceAccessNotice } from "@/features/dashboard/components/workspace-access-notice"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function EntityMatchingPage() {
  const { user } = useUser()
  const { activeWorkspaceId, workspaceVersion } = useActiveWorkspace(user?.id)
  const { canManageWorkspaceData, loadingWorkspaceAccess } = useWorkspaceAccess(user?.id)
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
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

  const selectedDatasets = useMemo(
    () => datasets.filter(dataset => selectedIds.includes(dataset.id)),
    [datasets, selectedIds]
  )

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

  async function handlePreview() {
    if (!user?.id || selectedIds.length < 2) {
      setError("Select at least two datasets to compare.")
      return
    }
    setBusy(true)
    setError("")
    setStatusMessage("")
    try {
      setPreview(await previewEntityMatching({
        dataset_ids: selectedIds,
        entity_type: entityType,
      }, user.id, activeWorkspaceId))
    } catch (previewError) {
      setError(getErrorMessage(previewError, "Unable to preview entity matches."))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!user?.id || selectedIds.length < 2) {
      setError("Select at least two datasets to match.")
      return
    }
    setBusy(true)
    setError("")
    setStatusMessage("")
    try {
      const saved = await runEntityMatching({
        dataset_ids: selectedIds,
        entity_type: entityType,
        replace_existing: true,
      }, user.id, activeWorkspaceId)
      setResult(saved)
      setStatusMessage(
        `Saved ${saved.canonical_entity_count} canonical ${entityType} records and created ${saved.unified_dataset_name ?? "a unified dataset"}.`
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
        description="Resolve the same customers or products across selected datasets so metrics can be compared on a shared identity. Matching uses exact normalized identifiers, emails, phones, SKUs, and names."
        actions={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Refresh datasets"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="Only workspace owners can run entity matching. You can still review existing analysis in this workspace."
      />

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {statusMessage && <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{statusMessage}</div>}

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><UsersRound size={19} /></div>
          <div>
            <h2 className="text-lg font-semibold text-gray-950">Choose source datasets</h2>
            <p className="mt-1 text-sm text-gray-500">Select 2 to 10 datasets. Decisionate will auto-detect the strongest identity field available in each source and show the match coverage before saving.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[220px_1fr]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-700">Entity type</span>
            <select
              value={entityType}
              onChange={event => {
                setEntityType(event.target.value as EntityType)
                setPreview(null)
                setResult(null)
              }}
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="customer">Customers</option>
              <option value="product">Products</option>
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {loading ? <p role="status" className="text-sm text-gray-500">Loading datasets...</p> : datasets.map(dataset => (
              <label key={dataset.id} className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 ${selectedIds.includes(dataset.id) ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(dataset.id)}
                  onChange={() => toggleDataset(dataset.id)}
                  disabled={!canManageWorkspaceData || (!selectedIds.includes(dataset.id) && selectedIds.length >= 10)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-800">{dataset.file_name}</span>
                  <span className="block text-xs text-gray-500">{dataset.row_count.toLocaleString()} rows</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void handlePreview()} disabled={busy || !canManageWorkspaceData || selectedIds.length < 2} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Preview matches</button>
          <button type="button" onClick={() => void handleSave()} disabled={busy || !canManageWorkspaceData || selectedIds.length < 2} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><Save size={16} /> Save matches</button>
          <span className="text-xs text-gray-500">{selectedDatasets.length} selected</span>
        </div>
      </section>

      {preview && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-gray-950">Match preview</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Summary label="Source rows" value={preview.candidate_row_count.toLocaleString()} />
            <Summary label="Canonical groups" value={preview.matched_group_count.toLocaleString()} />
            <Summary label="Rows matched across sources" value={preview.matched_row_count.toLocaleString()} />
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-2">Dataset</th><th className="px-2 py-2">Detected keys</th><th className="px-2 py-2">Rows</th><th className="px-2 py-2">Unmatched</th></tr></thead>
              <tbody>{preview.datasets.map(dataset => <tr key={dataset.dataset_id} className="border-b last:border-0"><td className="px-2 py-3 font-medium text-gray-800">{dataset.file_name}</td><td className="px-2 py-3 text-gray-600">{dataset.key_columns.join(", ") || "No supported key"}</td><td className="px-2 py-3 text-gray-600">{dataset.candidate_row_count.toLocaleString()}</td><td className="px-2 py-3 text-gray-600">{dataset.unmatched_row_count.toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-gray-950">Saved canonical records</h2><span className="text-sm text-gray-500">{result.confidence_breakdown.high} high confidence, {result.confidence_breakdown.medium} medium, {result.confidence_breakdown.review} review</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><Summary label="Canonical records" value={result.canonical_entity_count.toLocaleString()} /><Summary label="Rows matched across sources" value={result.matched_row_count.toLocaleString()} /><Summary label="Rows needing review" value={result.unmatched_row_count.toLocaleString()} /></div>
          {result.unified_dataset_id && (
            <Link
              href={`/dashboard/datasets/${result.unified_dataset_id}`}
              className="mt-4 inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              Open {result.unified_dataset_name ?? "unified dataset"}
            </Link>
          )}
          <div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-2 py-2">Canonical name</th><th className="px-2 py-2">Sources</th><th className="px-2 py-2">Rows</th><th className="px-2 py-2">Confidence</th></tr></thead><tbody>{result.entities.map(entity => <tr key={entity.id} className="border-b last:border-0"><td className="px-2 py-3 font-medium text-gray-800">{entity.display_name || entity.canonical_key}</td><td className="px-2 py-3 text-gray-600">{entity.source_count}</td><td className="px-2 py-3 text-gray-600">{entity.match_count}</td><td className="px-2 py-3 text-gray-600">{Math.round(entity.confidence * 100)}%</td></tr>)}</tbody></table></div>
        </section>
      )}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"><p className="text-xs uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-xl font-semibold text-gray-950">{value}</p></div>
}
