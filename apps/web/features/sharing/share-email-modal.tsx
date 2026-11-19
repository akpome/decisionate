"use client"

import { useEffect, useRef, useState } from "react"
import { LoaderCircle, Send, X } from "lucide-react"

export type ShareEmailResult = { status: "sent" | "partial" | "unknown" | "sending"; sent_count: number; recipient_count: number; message: string; share_enabled: boolean }

export function shareRecipients(value: string): string[] {
  return [...new Set(value.split(/[\n,;]+/).map(address => address.trim().toLowerCase()).filter(Boolean))]
}

export function ShareEmailModal({ title, kind, unsaved = false, onSend, onClose }: {
  title: string; kind: "dashboard" | "report"; unsaved?: boolean
  onSend: (recipients: string[], requestKey: string) => Promise<ShareEmailResult>; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const requestKey = useRef("")
  const action = useRef(false)
  const [addresses, setAddresses] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ShareEmailResult | null>(null)
  const recipients = shareRecipients(addresses)
  const invalid = recipients.some(address => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
  const validation = invalid ? "Enter a complete email address for each recipient." : recipients.length > 10 ? "Share with up to 10 recipients at a time." : ""

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { opener?.focus() }
  }, [])

  async function send() {
    if (action.current || result) return
    if (!recipients.length || invalid || recipients.length > 10) {
      setError("Enter 1 to 10 complete email addresses."); return
    }
    action.current = true; setBusy(true); setError("")
    requestKey.current ||= crypto.randomUUID()
    try { setResult(await onSend(recipients, requestKey.current)) }
    catch (value) { setError(value instanceof Error ? value.message : "Email could not be confirmed. Please try again with the same recipients.") }
    finally { action.current = false; setBusy(false) }
  }

  return <dialog ref={dialog} aria-labelledby="share-email-title" aria-describedby="share-email-access" onCancel={event => {
    if (busy) event.preventDefault(); else onClose()
  }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 text-gray-950 shadow-xl backdrop:bg-black/40 print:hidden">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="share-email-title" className="text-lg font-semibold">Email {kind} link</h2><p className="mt-1 break-words text-sm text-gray-600">{title}</p></div>
      <button type="button" aria-label="Close sharing" title="Close sharing" disabled={busy} onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 disabled:opacity-50"><X size={18} /></button>
    </div>
    <p id="share-email-access" className="mt-4 text-sm leading-6 text-gray-600">Anyone with this link can view the shared {kind}, without access to your workspace. You can stop sharing at any time.</p>
    {unsaved && <p className="mt-3 text-sm text-gray-600">A saved copy of this preview will be shared.</p>}
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void send() }}>
      <label className="block text-sm font-medium" htmlFor="share-email-addresses">Recipients</label>
      <textarea id="share-email-addresses" autoFocus inputMode="email" autoComplete="email" rows={3} value={addresses} disabled={busy || Boolean(result)} aria-invalid={invalid || recipients.length > 10} aria-describedby="share-email-hint" onChange={event => {
        setAddresses(event.target.value); setError(""); requestKey.current = ""
      }} placeholder="alex@example.com, sam@example.com" className="min-h-24 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-base disabled:bg-gray-50 sm:text-sm" />
      <p id="share-email-hint" className="text-xs text-gray-600">Up to 10 addresses, separated by commas or new lines.</p>
      {validation && <p role="status" className="text-sm text-red-700">{validation}</p>}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      {result && <p role="status" className={`break-words text-sm ${result.status === "sent" ? "text-green-800" : "text-amber-800"}`}>{result.message}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4">
        <button type="button" disabled={busy} onClick={onClose} className="inline-flex min-h-10 items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">{result ? "Done" : "Cancel"}</button>
        {!result && <button type="submit" disabled={busy || !recipients.length || invalid || recipients.length > 10} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}{busy ? "Sending..." : "Send email"}</button>}
      </div>
    </form>
  </dialog>
}
