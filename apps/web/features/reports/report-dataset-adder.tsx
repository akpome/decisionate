"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"
import type { CatalogDataset } from "@/features/relationships/types"
import { correlationRequest } from "@/lib/api"
import { isJoinedReportDataset, mergeReportCatalog, requestReportDatasetNames } from "./report-catalog-loading"

const command = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"

export function ReportDatasetAdder({ userId, workspaceId, addedIds, disabled, onAdd }: {
  userId: string; workspaceId?: string; addedIds: ReadonlySet<number>; disabled?: boolean; onAdd: (dataset: CatalogDataset) => void
}) {
  const { t } = useDecisionateText()
  const dialog = useRef<HTMLDialogElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [choices, setChoices] = useState<CatalogDataset[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const query = search.trim()

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const request = <T,>(path: string, init: RequestInit) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
      void requestReportDatasetNames(request, offset, controller.signal, "multi", query)
        .then(page => {
          if (controller.signal.aborted) return
          setChoices(current => mergeReportCatalog(offset ? current : [], page.datasets.filter(dataset => !isJoinedReportDataset(dataset))))
          setNextOffset(page.next_offset)
        })
        .catch(() => { if (!controller.signal.aborted) setFailed(true) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, query && !offset ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, userId, workspaceId, query, offset, revision])

  return <>
    <button type="button" className={command} disabled={disabled} aria-haspopup="dialog" onClick={() => {
      setSearch(""); setOffset(0); setChoices([]); setNextOffset(null); setFailed(false); setLoading(true)
      setOpen(true)
      dialog.current?.showModal()
      searchInput.current?.focus()
    }}><Plus size={16} aria-hidden="true" />{t("Add dataset")}</button>
    <dialog ref={dialog} aria-labelledby="add-report-dataset-title" onClose={() => setOpen(false)}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 text-gray-950 shadow-xl backdrop:bg-black/40 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 id="add-report-dataset-title" className="text-base font-semibold">{t("Add dataset")}</h3>
        <button type="button" aria-label={t("Close")} title={t("Close")} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200" onClick={() => dialog.current?.close()}><X size={16} aria-hidden="true" /></button>
      </div>
      <label className="block text-xs font-medium text-gray-600" htmlFor="add-report-dataset-search">{t("Search datasets")}</label>
      <div className="relative mt-1">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-gray-500" />
        <input id="add-report-dataset-search" ref={searchInput} type="search" autoComplete="off" maxLength={200} value={search}
          className="min-h-10 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-950"
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault() }} onChange={event => {
            const value = event.target.value
            setSearch(value)
            if (value.trim() === query) return
            setOffset(0); setChoices([]); setNextOffset(null); setFailed(false); setLoading(true)
          }} />
      </div>
      <ul className="mt-3 max-h-64 divide-y divide-gray-100 overflow-y-auto overscroll-contain" aria-label={t("Dataset choices")} aria-busy={loading}>
        {choices.map(dataset => {
          const added = addedIds.has(dataset.dataset_id)
          return <li key={dataset.dataset_id}><button type="button" disabled={added || disabled}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-gray-50 disabled:text-gray-500"
            onClick={() => { onAdd(dataset); dialog.current?.close() }}>
            <span className="min-w-0 break-words">{dataset.dataset_label}{dataset.connector && <span className="block text-xs text-gray-500">{dataset.connector}</span>}</span>
            {added ? <span className="shrink-0 text-xs">{t("Added")}</span> : <Plus size={16} aria-hidden="true" className="shrink-0" />}
          </button></li>
        })}
      </ul>
      {loading ? <p role="status" className="mt-3 flex items-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} aria-hidden="true" className="animate-spin" />{t("Loading datasets...")}</p>
        : failed ? <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><p role="alert" className="text-amber-800">{t("Dataset list could not be loaded. Your selections are unchanged.")}</p><button type="button" className={command} onClick={() => { setFailed(false); setLoading(true); setRevision(value => value + 1) }}><RefreshCw size={16} aria-hidden="true" />{t("Retry")}</button></div>
        : nextOffset !== null ? <button type="button" className={`${command} mt-3`} onClick={() => { setLoading(true); setOffset(nextOffset) }}>{t("Load more datasets")}</button>
        : !choices.length && <p role="status" className="mt-3 text-sm text-gray-600">{t(query ? "No matching datasets." : "No datasets available.")} {!query && <Link href="/datasets" className="ml-1 text-blue-700 underline">{t("Open datasets")}</Link>}</p>}
    </dialog>
  </>
}
