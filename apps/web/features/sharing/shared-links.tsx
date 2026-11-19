"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, RefreshCw, Trash2, X } from "lucide-react"
import { correlationRequest } from "@/lib/api"

export type SharedLinkTarget = { kind: "dashboard" | "report"; dataset_id?: number; report_id?: string; dashboard?: string }
export type SharedLinkRecord = SharedLinkTarget & { id: string; title: string; recipient: string | null; legacy: boolean; created_at: string | null }
type SharedLinksPage = { items: SharedLinkRecord[]; next_offset: number | null }

export function SharedLinks({ userId, workspaceId, target, refreshKey = 0, disabled = false, onBusyChange, onChanged }: {
  userId: string; workspaceId?: string; target: SharedLinkTarget; refreshKey?: number; disabled?: boolean
  onBusyChange?: (busy: boolean) => void; onChanged?: (active: boolean) => void
}) {
  const query = new URLSearchParams(Object.entries(target).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const action = useRef(false)
  const alive = useRef(true)
  const callbacks = useRef({ onBusyChange, onChanged })
  useEffect(() => { callbacks.current = { onBusyChange, onChanged } }, [onBusyChange, onChanged])
  const [items, setItems] = useState<SharedLinkRecord[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [confirmId, setConfirmId] = useState("")
  const [stoppingId, setStoppingId] = useState("")
  const load = useCallback(async (offset = 0) => {
    const current = ++sequence.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setLoading(true); setError("")
    try {
      const response = await correlationRequest<SharedLinksPage>(userId, `/share-emails/links?${query}&offset=${offset}`, { signal: abort.signal }, workspaceId)
      if (current !== sequence.current || abort.signal.aborted || !alive.current) return
      setItems(previous => offset ? [...previous, ...response.items] : response.items)
      setNextOffset(response.next_offset)
      if (!offset) callbacks.current.onChanged?.(response.items.length > 0)
    } catch (value) {
      if (current === sequence.current && !abort.signal.aborted) setError(value instanceof Error ? value.message : "Shared links could not be loaded.")
    } finally { if (current === sequence.current && !abort.signal.aborted && alive.current) setLoading(false) }
  }, [query, userId, workspaceId])

  useEffect(() => {
    let current = true
    const pendingRequest = controller
    alive.current = true
    queueMicrotask(() => { if (current) void load() })
    return () => { current = false; alive.current = false; pendingRequest.current?.abort() }
  }, [load, refreshKey])

  async function stopLink(item: SharedLinkRecord) {
    if (action.current || disabled) return
    action.current = true; setStoppingId(item.id); setError(""); setMessage("")
    callbacks.current.onBusyChange?.(true)
    try {
      await correlationRequest(userId, `/share-emails/links/${encodeURIComponent(item.id)}`, { method: "DELETE" }, workspaceId)
      if (!alive.current) return
      setItems(previous => previous.filter(link => link.id !== item.id))
      setConfirmId("")
      setMessage(item.recipient ? `Link to ${item.recipient} stopped. Other links are unchanged.` : "Legacy link stopped. Other links are unchanged.")
      window.dispatchEvent(new Event("decisionate:dashboard-sharing-changed"))
      await load()
    } catch (value) { setError(value instanceof Error ? value.message : "This link could not be stopped. Please try again.") }
    finally { action.current = false; if (alive.current) { setStoppingId(""); callbacks.current.onBusyChange?.(false) } }
  }

  return <section aria-label="Shared links" className="mt-5 space-y-3 border-t border-gray-200 pt-4">
    <h3 className="text-sm font-semibold">Shared links</h3>
    {message && <p role="status" className="break-words text-sm text-green-800">{message}</p>}
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><LoaderCircle size={15} className="animate-spin" />Loading shared links...</p>}
    {!loading && !error && items.length === 0 && <p className="text-sm text-gray-500">No active shared links.</p>}
    {items.length > 0 && <ul className="max-h-72 divide-y divide-gray-200 overflow-y-auto pr-1">
      {items.map(item => <li key={item.id} className="min-w-0 space-y-2 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 space-y-1"><p className="break-all text-sm font-medium">{item.recipient || "Legacy shared link"}</p>
            <p className="break-words text-xs text-gray-600">{item.title}{item.dashboard ? ` / ${item.dashboard.replaceAll("-", " ")}` : ""}</p>
            {item.created_at && <p className="text-xs text-gray-500">Created {new Date(item.created_at).toLocaleString()}</p>}
            {item.legacy && <p className="text-xs leading-5 text-amber-800">Earlier emails may use this same link. Stopping it affects those copies, not new links.</p>}
          </div>
          <button type="button" title={`Stop link for ${item.recipient || item.title}`} aria-label={`Stop link for ${item.recipient || item.id}`} disabled={disabled || Boolean(stoppingId) || loading} onClick={() => { setConfirmId(item.id); setError("") }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-red-200 text-red-700 disabled:opacity-50"><Trash2 size={16} /></button>
        </div>
        {confirmId === item.id && <div className="space-y-2 border-l-2 border-red-300 pl-3"><p className="text-sm">Stop this link? Other links stay active.</p><div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={Boolean(stoppingId)} onClick={() => setConfirmId("")} className="min-h-10 rounded-md border border-gray-300 px-3 text-sm disabled:opacity-50">Cancel</button>
          <button type="button" disabled={disabled || Boolean(stoppingId)} onClick={() => void stopLink(item)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 text-sm font-medium text-white disabled:opacity-50">{stoppingId === item.id ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />}{stoppingId === item.id ? "Stopping..." : "Stop this link"}</button>
        </div></div>}
      </li>)}
    </ul>}
    {error && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="break-words text-sm text-red-700">{error}</p><button type="button" disabled={loading || Boolean(stoppingId)} onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm disabled:opacity-50"><RefreshCw size={15} />Retry links</button></div>}
    {nextOffset !== null && <button type="button" disabled={loading || Boolean(stoppingId)} onClick={() => void load(nextOffset)} className="min-h-10 rounded-md border border-gray-300 px-3 text-sm disabled:opacity-50">More links</button>}
  </section>
}

export function SharedLinksDialog({ userId, workspaceId, target, onClose }: {
  userId: string; workspaceId?: string; target: SharedLinkTarget; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { opener?.focus() }
  }, [])
  return <dialog ref={dialog} aria-label="Manage shared links" onCancel={event => { if (busy) event.preventDefault(); else onClose() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-gray-950 shadow-xl backdrop:bg-black/40 print:hidden">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Manage shared links</h2><button type="button" title="Close shared links" aria-label="Close shared links" disabled={busy} onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 disabled:opacity-50"><X size={18} /></button></div>
    <SharedLinks key={JSON.stringify([userId, workspaceId, target])} userId={userId} workspaceId={workspaceId} target={target} onBusyChange={setBusy} />
  </dialog>
}
