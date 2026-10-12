"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Eye, ExternalLink, RefreshCw, Save, Send, X } from "lucide-react"
import { getMarketingPreview, marketingRequest, type MarketingSender, type MarketingSupport } from "@/lib/api"

const emptySender: MarketingSender = { sender_identity: "", mailing_address: "", reply_to: "support@decisionate.ca", from_email: "", from_name: "Decisionate" }
const preferenceLabels: Record<string, string> = { unknown: "Not opted in", pending_confirmation: "Awaiting verification", subscribed: "Subscribed", unsubscribed: "Unsubscribed" }

export function MarketingAdmin({ userId }: { userId: string }) {
  const [data, setData] = useState<MarketingSupport | null>(null)
  const [form, setForm] = useState(emptySender)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [preview, setPreview] = useState<string | null>(null)
  const previewTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (preview === null) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = overflow; previewTrigger.current?.focus() }
  }, [preview])
  const load = useCallback(async (after = 0) => {
    const result = await marketingRequest<MarketingSupport>(userId, `/admin?after=${after}`)
    setData(result)
    if (!after) setForm({ sender_identity: result.configuration.sender_identity, mailing_address: result.configuration.mailing_address, reply_to: result.configuration.reply_to, from_email: result.configuration.from_email, from_name: result.configuration.from_name })
  }, [userId])
  useEffect(() => {
    let cancelled = false
    void marketingRequest<MarketingSupport>(userId, "/admin").then(result => {
      if (cancelled) return
      setData(result)
      setForm({ sender_identity: result.configuration.sender_identity, mailing_address: result.configuration.mailing_address, reply_to: result.configuration.reply_to, from_email: result.configuration.from_email, from_name: result.configuration.from_name })
    }).catch(error => { if (!cancelled) setStatus(error instanceof Error ? error.message : "Marketing support is unavailable") })
    return () => { cancelled = true }
  }, [userId])
  async function action(task: () => Promise<unknown>, success: string) {
    setBusy(true); setStatus("")
    try { await task(); setStatus(success); await load() }
    catch (error) { setStatus(error instanceof Error ? error.message : "The request failed") }
    finally { setBusy(false) }
  }
  return <section className="mt-8 min-w-0 border-y border-gray-200 py-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Customer email marketing</h2>
      <div className="flex items-center gap-3">
        <a href="https://resend.com/broadcasts" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-blue-700">Broadcasts<ExternalLink size={15} /></a>
        <button title="Refresh marketing status" aria-label="Refresh marketing status" disabled={busy} type="button" onClick={() => void action(() => load(), "Status refreshed.")} className="rounded-md border p-2"><RefreshCw size={16} /></button>
      </div>
    </header>
    {data && <p className="mt-3 text-sm text-gray-600">Contact sync: {data.configuration.enabled ? "enabled" : "disabled"}. Automated sends: {data.configuration.sending ? "enabled" : "disabled"}.</p>}
    <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void action(() => marketingRequest(userId, "/admin/settings", { method: "PUT", body: JSON.stringify(form) }), "Sender details saved.") }}>
      <label className="text-sm font-medium">Legal sender identity<input required maxLength={200} value={form.sender_identity} onChange={event => setForm({ ...form, sender_identity: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
      <label className="text-sm font-medium">Sender display name<input required maxLength={200} value={form.from_name} onChange={event => setForm({ ...form, from_name: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
      <label className="text-sm font-medium sm:col-span-2">Mailing address<textarea required maxLength={1000} rows={2} value={form.mailing_address} onChange={event => setForm({ ...form, mailing_address: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
      <label className="text-sm font-medium">Verified sender email<input required type="email" maxLength={254} value={form.from_email} onChange={event => setForm({ ...form, from_email: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
      <label className="text-sm font-medium">Monitored reply-to<input required type="email" maxLength={254} value={form.reply_to} onChange={event => setForm({ ...form, reply_to: event.target.value })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
      <div><button disabled={busy} type="submit" className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />Save sender details</button></div>
    </form>
    {status && <p role="status" className="mt-4 text-sm">{status}</p>}
    {data && <>
      <div className="mt-6 overflow-x-auto" role="region" aria-label="Marketing contacts" tabIndex={0}>
        <table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-gray-500"><th className="py-2 pr-4">Contact</th><th className="pr-4">Preference</th><th className="pr-4">Lifecycle</th><th className="pr-4">Sync</th><th>Test</th></tr></thead><tbody>
          {data.contacts.map(contact => <tr key={contact.id} className="border-b align-top"><td className="max-w-64 break-all py-3 pr-4">{contact.email}</td><td className="whitespace-nowrap pr-4 pt-3">{preferenceLabels[contact.marketing_status] ?? contact.marketing_status}{contact.suppression_reason && <p className="text-rose-700">Suppressed</p>}</td><td className="pr-4 pt-3">{contact.lifecycle ? `${contact.lifecycle.subscription_status.replaceAll("_", " ")} · ${contact.lifecycle.setup_status.replaceAll("_", " ")} · ${contact.lifecycle.engagement_status}` : "No primary workspace"}</td><td className="pr-4 pt-3">{contact.sync_error ?? (contact.marketing_status !== "subscribed" ? "Not eligible" : contact.last_successful_sync_at ? "Synced" : "Pending")}</td><td className="pt-2"><button title="Queue internal test welcome" aria-label={`Queue internal test welcome for ${contact.email}`} disabled={busy || contact.marketing_status !== "subscribed" || !contact.email_verified || !!contact.suppression_reason} type="button" onClick={() => void action(() => marketingRequest(userId, `/admin/contacts/${contact.id}/test`, { method: "POST" }), "Internal test queued.")} className="rounded-md border p-2 disabled:opacity-40"><Send size={16} /></button></td></tr>)}
          {!data.contacts.length && <tr><td colSpan={5} className="py-4 text-gray-500">No contacts recorded.</td></tr>}
        </tbody></table>
      </div>
      {data.next_contact_id && <button type="button" disabled={busy} onClick={() => void load(data.next_contact_id ?? 0).catch(error => setStatus(String(error)))} className="mt-3 text-sm text-blue-700">Next contacts</button>}
      <h3 className="mt-6 text-base font-semibold">Recent lifecycle emails</h3>
      <ul className="mt-3 divide-y text-sm">{data.emails.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><span className="font-medium">{entry.message_type}</span> · contact {entry.contact_id} · {entry.status}<p className="mt-1 text-xs text-gray-500">{new Date(entry.due_at + (entry.due_at.endsWith("Z") ? "" : "Z")).toLocaleString()} · {entry.reason ?? ""}</p></div><button type="button" title="Preview email" aria-label="Preview email" onClick={event => { previewTrigger.current = event.currentTarget; void getMarketingPreview(userId, entry.id).then(setPreview).catch(error => setStatus(String(error))) }} className="rounded-md border p-2"><Eye size={16} /></button></li>)}</ul>
      <h3 className="mt-6 text-base font-semibold">Failed contact and webhook jobs</h3>
      <ul className="mt-3 divide-y text-sm">{data.failed_jobs.map(job => <li key={job.id} className="flex items-center justify-between gap-4 py-3"><div>{job.job_type} · {job.error}<p className="text-xs text-gray-500">{job.attempts} attempts</p></div><button title="Retry failed job" aria-label="Retry failed job" type="button" disabled={busy} onClick={() => void action(() => marketingRequest(userId, `/admin/jobs/${job.id}/retry`, { method: "POST" }), "Retry queued.")} className="rounded-md border p-2"><RefreshCw size={16} /></button></li>)}</ul>
    </>}
    {preview !== null && <div role="dialog" aria-modal="true" aria-label="Marketing email preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={event => { if (event.target === event.currentTarget) setPreview(null) }} onKeyDown={event => {
      if (event.key === "Escape") setPreview(null)
      if (event.key === "Tab") { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus() }
    }}>
      <div className="flex h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-md bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3"><h3 className="font-semibold">Email preview</h3><button type="button" autoFocus title="Close preview" aria-label="Close preview" onClick={() => setPreview(null)} className="rounded-md p-2"><X size={18} /></button></div>
        <iframe title="Email content" tabIndex={-1} sandbox="" srcDoc={preview} className="min-h-0 flex-1 border-0" />
      </div>
    </div>}
  </section>
}
