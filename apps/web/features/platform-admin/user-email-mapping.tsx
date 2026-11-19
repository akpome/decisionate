"use client"

import { useEffect, useId, useRef, useState } from "react"
import { LoaderCircle, MailPlus, X } from "lucide-react"
import { mapPlatformUserEmail } from "@/lib/api"

export function UserEmailMapping({ userId, targetUserId, onMapped, disabled = false, unmapped = true }: {
  userId: string; targetUserId: string; onMapped: (email: string) => Promise<void>; disabled?: boolean; unmapped?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <>
    {unmapped && <button type="button" disabled={disabled} title="Map this internal account to its owner's email" aria-label={`Map email for ${targetUserId}`} onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 disabled:opacity-50"><MailPlus size={14} />Map email</button>}
    {open && <MappingDialog userId={userId} targetUserId={targetUserId} onMapped={onMapped} onClose={() => setOpen(false)} />}
  </>
}

function MappingDialog({ userId, targetUserId, onMapped, onClose }: {
  userId: string; targetUserId: string; onMapped: (email: string) => Promise<void>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const running = useRef(false)
  const mappedResult = useRef<{ user_id: string; email: string; mapped: boolean } | null>(null)
  const id = useId()
  const [email, setEmail] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { opener?.focus() }
  }, [])

  async function save() {
    if (running.current || saved || !confirmed || !email.trim()) return
    running.current = true; setBusy(true); setError("")
    try {
      const result = await mapPlatformUserEmail(userId, targetUserId, email.trim())
      mappedResult.current = result
      setSaved(true)
      try { await onMapped(result.email) }
      catch { setError("The email mapping is saved, but the page could not refresh. Reload this page.") }
    } catch (value) { setError(value instanceof Error ? value.message : "The email could not be mapped. No change was confirmed.") }
    finally { running.current = false; setBusy(false) }
  }

  function close() {
    if (busy) return
    if (mappedResult.current) window.dispatchEvent(new CustomEvent("decisionate:user-email-mapped", { detail: mappedResult.current }))
    onClose()
  }

  return <dialog ref={dialog} aria-labelledby={id + "-title"} onCancel={event => { if (busy) event.preventDefault(); else close() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-gray-950 shadow-xl backdrop:bg-black/40">
    <div className="flex items-start justify-between gap-3"><h2 id={id + "-title"} className="text-lg font-semibold">Map account email</h2><button type="button" title="Close email mapping" aria-label="Close email mapping" disabled={busy} onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 disabled:opacity-50"><X size={16} /></button></div>
    <p className="mt-4 text-xs text-gray-500">Internal account</p><p className="mt-1 break-all font-mono text-xs">{targetUserId}</p>
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      {saved ? <p role="status" className="text-sm text-green-800">Email mapped. The account ID and workspace data are unchanged.</p> : <>
        <label htmlFor={id + "-email"} className="block text-sm font-medium">Account owner&apos;s email</label>
        <input id={id + "-email"} type="email" autoComplete="email" autoFocus required maxLength={254} disabled={busy} value={email} onChange={event => { setEmail(event.target.value); setError("") }} className="h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-base sm:text-sm" />
        <p className="text-sm leading-6 text-gray-600">The verified owner of this email may be able to access this account. Existing sign-in identities must match; other accounts will not be merged.</p>
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>I confirm this email belongs to the person who owns this account.</span></label>
      </>}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4"><button type="button" disabled={busy} onClick={close} className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">{saved ? "Done" : "Cancel"}</button>
        {!saved && <button type="submit" disabled={busy || !confirmed || !email.trim()} className="inline-flex min-h-10 w-36 items-center justify-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <MailPlus size={16} />}{busy ? "Mapping..." : "Map email"}</button>}
      </div>
    </form>
  </dialog>
}
