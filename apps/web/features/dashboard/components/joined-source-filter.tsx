"use client"

import { useEffect, useId, useRef, useState } from "react"
import { GitMerge, LoaderCircle } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { DatasetDimensionFilter } from "@/features/datasets/components/dimension-filter"
import { createFilteredJoinCopy, type DatasetJoinResult, type DatasetSummary, type DimensionFilter } from "@/lib/api"

type JoinSource = Pick<DatasetSummary, "id" | "file_name"> & { filter?: DimensionFilter }

export function getJoinedFilterSources(sourceConfig: string | null | undefined, datasets: DatasetSummary[]): JoinSource[] {
  try {
    const selections: unknown = JSON.parse(sourceConfig ?? "{}")?.join_definition?.selections
    if (!Array.isArray(selections) || selections.length < 2) return []
    const result: JoinSource[] = []
    for (const selection of selections) {
      const source = datasets.find(item => item.id === selection?.dataset_id)
      if (!source) return []
      const filter = selection.dimension_filter
      result.push({ id: source.id, file_name: source.file_name,
        filter: filter && typeof filter.column === "string" && Array.isArray(filter.values) ? filter : undefined })
    }
    return result
  } catch {
    return []
  }
}

export function JoinedSourceFilter({ datasetId, sources, userId, workspaceId, dashboardKey, onJoined }: {
  datasetId: number
  sources: JoinSource[]
  userId: string
  workspaceId?: string
  dashboardKey: string
  onJoined: (result: DatasetJoinResult) => void
}) {
  const { t } = useDecisionateText()
  const id = useId()
  const [sourceId, setSourceId] = useState(sources[0]?.id)
  const source = sources.find(item => item.id === sourceId) ?? sources[0]
  const [selection, setSelection] = useState<{ sourceId: number; filter?: DimensionFilter }>()
  const filter = selection?.sourceId === source?.id ? selection?.filter : source?.filter
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const mounted = useRef(false)
  const submitted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const changed = JSON.stringify(filter ?? null) !== JSON.stringify(source?.filter ?? null)
  const canApply = Boolean(source && changed && (!filter || filter.values.length))
  async function apply() {
    if (!source || !canApply || submitted.current) return
    submitted.current = true
    setSaving(true)
    setError("")
    try {
      const result = await createFilteredJoinCopy(datasetId, userId, workspaceId, {
        source_dataset_id: source.id, dimension_filter: filter ?? null, dashboard_key: dashboardKey,
      })
      if (mounted.current) onJoined(result)
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not create the filtered join.")
    } finally {
      submitted.current = false
      if (mounted.current) setSaving(false)
    }
  }

  if (!source) return null
  return <div className="space-y-3" aria-label={t("Filter an original dataset")}>
    <div className="@container grid min-w-0 items-start gap-3 @min-[28rem]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-xs font-medium text-gray-600">{t("Filter source dataset")}</label>
        <select id={id} value={source.id} disabled={saving}
          className="mt-1 min-h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          onChange={event => { setSourceId(Number(event.target.value)); setSelection(undefined); setError("") }}>
          {sources.map(item => <option key={item.id} value={item.id}>{item.file_name}</option>)}
        </select>
      </div>
      <DatasetDimensionFilter key={source.id} datasetId={source.id} userId={userId} workspaceId={workspaceId}
        embedded disabled={saving} value={filter}
        onChange={value => setSelection({ sourceId: source.id, filter: value })} />
    </div>
    {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
    <button type="button" disabled={!canApply || saving} onClick={() => void apply()}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 text-sm font-medium disabled:opacity-50">
      {saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <GitMerge size={16} aria-hidden="true" />}
      {t(saving ? "Creating joined dataset..." : source.filter && !filter ? "Create join without this filter" : "Create filtered join")}
    </button>
  </div>
}
