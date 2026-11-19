"use client"

import { useEffect, useId, useRef, useState } from "react"
import { LoaderCircle, MailPlus, X } from "lucide-react"
import { previewPlatformUserEmailReassignment, reassignPlatformUserEmail, type UserEmailReassignmentPreview } from "@/lib/api"

export function UserEmailMapping({ userId, targetUserId, onMapped, disabled = false, currentEmail = null, paused = false }: {
  userId: string; targetUserId: string; onMapped: (email: string) => Promise<void>; disabled?: boolean; currentEmail?: string | null; paused?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" disabled={disabled} title={disabled ? "Administrator and protected accounts cannot be reassigned" : "Reassign this account to a replacement user"} aria-label={`Reassign email for ${targetUserId}`} onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 disabled:opacity-50"><MailPlus size={14} />Reassign email</button>
    {open && <MappingDialog userId={userId} targetUserId={targetUserId} currentEmail={currentEmail} paused={paused} onMapped={onMapped} onClose={() => setOpen(false)} />}
  </>
}

function MappingDialog({ userId, targetUserId, currentEmail, paused, onMapped, onClose }: {
  userId: string; targetUserId: string; currentEmail: string | null; paused: boolean; onMapped: (email: string) => Promise<void>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const running = useRef(false)
  const mappedResult = useRef<{ user_id: string; email: string; mapped: boolean; paused_user_id?: string | null } | null>(null)
  const [previousEmail] = useState(currentEmail)
  const [savedEmail, setSavedEmail] = useState("")
  const id = useId()
  const [email, setEmail] = useState("")
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [review, setReview] = useState<UserEmailReassignmentPreview | null>(null)
  const [pausedUserId, setPausedUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { opener?.focus() }
  }, [])

  async function reviewChange() {
    if (running.current || saved || !email.trim() || reason.trim().length < 3 || (!paused && email.trim().toLowerCase() === previousEmail?.trim().toLowerCase())) return
    running.current = true; setBusy(true); setError("")
    try {
      setReview(await previewPlatformUserEmailReassignment(userId, targetUserId, email.trim(), previousEmail))
      setConfirmed(false)
    } catch (value) { setError(value instanceof Error ? value.message : "The reassignment could not be reviewed.") }
    finally { running.current = false; setBusy(false) }
  }

  async function save() {
    if (running.current || saved || !review || !confirmed || email.trim().toLowerCase() !== review.email || reason.trim().length < 3) return
    running.current = true; setBusy(true); setError("")
    try {
      const result = await reassignPlatformUserEmail(userId, targetUserId, review.email, previousEmail, reason.trim(), review.source_user_id)
      mappedResult.current = result
      setSavedEmail(result.email)
      setPausedUserId(result.paused_user_id || null)
      setSaved(true)
      try { await onMapped(result.email) }
      catch { setError("The reassignment is saved, but the page could not refresh. Reload this page.") }
    } catch (value) {
      setError(value instanceof Error ? value.message : "The account could not be reassigned. No change was confirmed.")
      setReview(null); setConfirmed(false)
    }
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
    <p className="mt-3 text-xs text-gray-500">{paused ? "Previous email (account paused)" : "Current email"}</p><p className="mt-1 break-all text-sm">{previousEmail || "Legacy account recovery"}</p>
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); if (review) void save(); else void reviewChange() }}>
      {saved ? <div role="status" className="space-y-2 break-words text-sm text-green-800"><p>Account reassigned to {savedEmail}. The ID and workspace data are unchanged. Previous sign-ins no longer have access.</p>{pausedUserId && <p>Previous account <span className="break-all font-mono text-xs">{pausedUserId}</span> is paused. Its data is preserved and it can be reassigned to another email.</p>}</div> : <>
        <label htmlFor={id + "-email"} className="block text-sm font-medium">New email</label>
        <input id={id + "-email"} type="email" autoComplete="off" autoFocus required maxLength={254} disabled={busy || Boolean(review)} value={email} onChange={event => { setEmail(event.target.value); setError("") }} className="h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-base sm:text-sm" />
        <label htmlFor={id + "-reason"} className="block text-sm font-medium">Reason for reassignment</label>
        <textarea id={id + "-reason"} required minLength={3} maxLength={500} rows={2} disabled={busy || Boolean(review)} value={reason} onChange={event => setReason(event.target.value)} className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm" />
        {review ? <div className="space-y-3 border-y border-gray-200 py-4">
          {review.source_user_id ? <><p className="text-sm leading-6">This email currently belongs to <span className="break-all font-mono text-xs">{review.source_user_id}</span>. That account will be paused and its matching sign-in will move here.</p><p className="text-sm leading-6 text-gray-600">Each account keeps its own workspace data and subscription. The paused account can be assigned another email later. Existing accounts will not be merged.</p></> : <p className="text-sm leading-6 text-gray-600">This gives the new email access to this account and blocks its previous sign-ins. The replacement must verify the new email.</p>}
          {review.target_paused && <p className="text-sm">This paused account will become active again.</p>}
          <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>I authorize transferring this account and its workspace access to the new email{review.source_user_id ? " and pausing the previous account" : ""}.</span></label>
          <button type="button" disabled={busy} onClick={() => { setReview(null); setConfirmed(false) }} className="text-sm text-blue-700 underline">Edit reassignment</button>
        </div> : <p className="text-sm leading-6 text-gray-600">Review the change before confirming. If the email belongs to another account, you can move it here and pause that account without moving its data.</p>}
      </>}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4"><button type="button" disabled={busy} onClick={close} className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">{saved ? "Done" : "Cancel"}</button>
        {!saved && <button type="submit" disabled={busy || (Boolean(review) && !confirmed) || !email.trim() || reason.trim().length < 3 || (!paused && email.trim().toLowerCase() === previousEmail?.trim().toLowerCase())} className="inline-flex min-h-10 w-48 items-center justify-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <MailPlus size={16} />}{busy ? (review ? "Reassigning..." : "Reviewing...") : (review ? "Reassign email" : "Review reassignment")}</button>}
      </div>
    </form>
  </dialog>
}
