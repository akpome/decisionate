"use client"

import { useEffect, useId, useRef, useState } from "react"
import { LoaderCircle, MailPlus, X } from "lucide-react"
import { reassignPlatformUserEmail } from "@/lib/api"

export function UserEmailMapping({ userId, targetUserId, onMapped, disabled = false, currentEmail = null }: {
  userId: string; targetUserId: string; onMapped: (email: string) => Promise<void>; disabled?: boolean; currentEmail?: string | null
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" disabled={disabled} title={disabled ? "Administrator and protected accounts cannot be reassigned" : "Reassign this account to a replacement user"} aria-label={`Reassign email for ${targetUserId}`} onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 disabled:opacity-50"><MailPlus size={14} />Reassign email</button>
    {open && <MappingDialog userId={userId} targetUserId={targetUserId} currentEmail={currentEmail} onMapped={onMapped} onClose={() => setOpen(false)} />}
  </>
}

function MappingDialog({ userId, targetUserId, currentEmail, onMapped, onClose }: {
  userId: string; targetUserId: string; currentEmail: string | null; onMapped: (email: string) => Promise<void>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const running = useRef(false)
  const mappedResult = useRef<{ user_id: string; email: string; mapped: boolean } | null>(null)
  const [previousEmail] = useState(currentEmail)
  const [savedEmail, setSavedEmail] = useState("")
  const id = useId()
  const [email, setEmail] = useState("")
  const [reason, setReason] = useState("")
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
    if (running.current || saved || !confirmed || !email.trim() || reason.trim().length < 3 || email.trim().toLowerCase() === previousEmail?.trim().toLowerCase()) return
    running.current = true; setBusy(true); setError("")
    try {
      const result = await reassignPlatformUserEmail(userId, targetUserId, email.trim(), previousEmail, reason.trim())
      mappedResult.current = result
      setSavedEmail(result.email)
      setSaved(true)
      try { await onMapped(result.email) }
      catch { setError("The reassignment is saved, but the page could not refresh. Reload this page.") }
    } catch (value) { setError(value instanceof Error ? value.message : "The account could not be reassigned. No change was confirmed.") }
    finally { running.current = false; setBusy(false) }
  }

  function close() {
    if (busy) return
    if (mappedResult.current) window.dispatchEvent(new CustomEvent("decisionate:user-email-mapped", { detail: mappedResult.current }))
    onClose()
  }

  return <dialog ref={dialog} aria-labelledby={id + "-title"} onCancel={event => { if (busy) event.preventDefault(); else close() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-gray-950 shadow-xl backdrop:bg-black/40">
    <div className="flex items-start justify-between gap-3"><h2 id={id + "-title"} className="text-lg font-semibold">Reassign account</h2><button type="button" title="Close reassignment" aria-label="Close reassignment" disabled={busy} onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 disabled:opacity-50"><X size={16} /></button></div>
    <p className="mt-4 text-xs text-gray-500">Internal account</p><p className="mt-1 break-all font-mono text-xs">{targetUserId}</p>
    <p className="mt-3 text-xs text-gray-500">Current email</p><p className="mt-1 break-all text-sm">{previousEmail || "Legacy account recovery"}</p>
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      {saved ? <p role="status" className="break-words text-sm text-green-800">Account reassigned to {savedEmail}. The ID and workspace data are unchanged. Previous sign-ins no longer have access.</p> : <>
        <label htmlFor={id + "-email"} className="block text-sm font-medium">New email</label>
        <input id={id + "-email"} type="email" autoComplete="off" autoFocus required maxLength={254} disabled={busy} value={email} onChange={event => { setEmail(event.target.value); setError("") }} className="h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-base sm:text-sm" />
        <label htmlFor={id + "-reason"} className="block text-sm font-medium">Reason for reassignment</label>
        <textarea id={id + "-reason"} required minLength={3} maxLength={500} rows={2} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm" />
        <p className="text-sm leading-6 text-gray-600">This transfers all workspace access on this account and blocks its previous sign-ins. The replacement must use a separate sign-in and verify the new email. Existing accounts will not be merged.</p>
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>I authorize transferring this account and its workspace access to the new email.</span></label>
      </>}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4"><button type="button" disabled={busy} onClick={close} className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">{saved ? "Done" : "Cancel"}</button>
        {!saved && <button type="submit" disabled={busy || !confirmed || !email.trim() || reason.trim().length < 3 || email.trim().toLowerCase() === previousEmail?.trim().toLowerCase()} className="inline-flex min-h-10 w-40 items-center justify-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <MailPlus size={16} />}{busy ? "Reassigning..." : "Reassign email"}</button>}
      </div>
    </form>
  </dialog>
}
