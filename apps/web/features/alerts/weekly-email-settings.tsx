"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, LoaderCircle, RefreshCw, Save, Send } from "lucide-react"
import { correlationRequest, getWeeklyReportDeliveryConfig, getWeeklyReportDeliveryHistory, getWeeklyReportPreference,
  sendWeeklyReportTestEmail, updateWeeklyReportPreference, type WeeklyReportDeliveryConfig, type WeeklyReportDeliveryLog, type WeeklyReportPreference } from "@/lib/api"
import type { WeeklySettings } from "@/features/reports/weekly-settings"
import { deliveryChanges, deliveryStatus, deliveryValidation, recipientEmails } from "./weekly-email-state"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
const command = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const button = `${command} border-gray-300 bg-white`
const primary = `${command} border-transparent bg-[var(--decisionate-brand-primary,#1d4ed8)] text-[var(--decisionate-brand-primary-surface-text,#fff)]`
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const
const errorText = (error: unknown) => error instanceof Error ? error.message : "Email settings are temporarily unavailable. Please retry."

export function WeeklyEmailSettings({ userId, workspaceId }: { userId: string; workspaceId?: string }) {
  const [saved, setSaved] = useState<WeeklyReportPreference | null>(null)
  const [draft, setDraft] = useState<WeeklyReportPreference | null>(null)
  const [recipients, setRecipients] = useState("")
  const [settings, setSettings] = useState<WeeklySettings | null>(null)
  const [config, setConfig] = useState<WeeklyReportDeliveryConfig | null>(null)
  const [history, setHistory] = useState<WeeklyReportDeliveryLog[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState("")
  const [contextError, setContextError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState<"save" | "test" | null>(null)
  const [reload, setReload] = useState(0)
  const [contextReload, setContextReload] = useState(0)
  const mounted = useRef(false)
  const action = useRef(false)
  const historyRequest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let ignore = false
    getWeeklyReportPreference(userId, workspaceId).then(value => {
      if (ignore) return
      setSaved(value); setDraft(value); setRecipients(value.recipient_emails.join("\n")); setError("")
    }).catch(value => { if (!ignore) setError(errorText(value)) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [userId, workspaceId, reload])

  useEffect(() => {
    let ignore = false
    const controller = new AbortController()
    getWeeklyReportDeliveryConfig(userId, workspaceId, { notifyAvailability: false }).then(value => {
      if (!ignore) setConfig(value)
    }).catch(() => { if (!ignore) setContextError("Email readiness could not be checked. Your saved settings are unchanged.") })
    correlationRequest<WeeklySettings>(userId, "/business-reports/weekly-settings", { signal: controller.signal }, workspaceId).then(value => {
      if (!ignore) setSettings(value)
    }).catch(() => { if (!ignore) setContextError("Report details could not be loaded. Your saved settings are unchanged.") })
    return () => { ignore = true; controller.abort() }
  }, [userId, workspaceId, contextReload])

  useEffect(() => {
    let ignore = false
    const request = ++historyRequest.current
    getWeeklyReportDeliveryHistory(userId, workspaceId).then(value => { if (!ignore && request === historyRequest.current) setHistory(value) })
      .catch(value => { if (!ignore && request === historyRequest.current) setHistoryError(errorText(value)) })
      .finally(() => { if (!ignore && request === historyRequest.current) setHistoryLoading(false) })
    return () => { ignore = true }
  }, [userId, workspaceId])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function refreshHistory() {
    const request = ++historyRequest.current
    setHistoryLoading(true); setHistoryError("")
    try {
      const value = await getWeeklyReportDeliveryHistory(userId, workspaceId)
      if (mounted.current && request === historyRequest.current) setHistory(value)
    } catch (value) {
      if (mounted.current && request === historyRequest.current) setHistoryError(errorText(value))
    } finally { if (mounted.current && request === historyRequest.current) setHistoryLoading(false) }
  }

  function edit(patch: Partial<WeeklyReportPreference>) {
    setDraft(value => value ? { ...value, ...patch } : value)
    setNotice(""); setError("")
  }

  const dirty = Boolean(saved && draft && deliveryChanges(saved, draft, recipients))
  const validation = draft ? deliveryValidation(draft, recipients) : ""
  const canTest = Boolean(saved?.recipient_emails.length && config?.email_delivery_configured && !dirty && !busy)

  async function save() {
    if (!draft || !dirty || action.current) return
    if (validation) { setError(validation); return }
    action.current = true; setBusy("save"); setError(""); setNotice("")
    try {
      // Keep report selections and existing targets intact when changing delivery.
      const result = await updateWeeklyReportPreference({ ...draft, recipient_emails: recipientEmails(recipients) }, userId, workspaceId)
      if (!mounted.current) return
      setSaved(result); setDraft(result); setRecipients(result.recipient_emails.join("\n"))
      setNotice("Email settings saved. No email was sent.")
    } catch (value) { if (mounted.current) setError(errorText(value)) }
    finally { action.current = false; if (mounted.current) setBusy(null) }
  }

  async function sendTest() {
    if (!canTest || action.current) return
    action.current = true; setBusy("test"); setError(""); setNotice("")
    try {
      const result = await sendWeeklyReportTestEmail(userId, workspaceId)
      if (mounted.current) setNotice(`Test email sent to ${result.delivered_count} recipient${result.delivered_count === 1 ? "" : "s"}.`)
    } catch (value) { if (mounted.current) setError(errorText(value)) }
    finally {
      action.current = false
      if (mounted.current) { setBusy(null); void refreshHistory() }
    }
  }

  const retry = () => { setLoading(true); setError(""); setContextError(""); setReload(value => value + 1); setContextReload(value => value + 1) }
  if (loading) return <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} className="animate-spin" />Loading email settings...</p>
  if (!saved || !draft) return <div className="space-y-3"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" className={button} onClick={retry}><RefreshCw size={16} />Retry email settings</button></div>

  const hasReport = Boolean(saved.weekly_settings_configured || saved.business_report_id)
  const legacy = !hasReport && Boolean(saved.metric_focus.length || saved.relationship_focus.length)
  return <div className="min-w-0 space-y-6">
    <section id="weekly-delivery" aria-label="Saved email schedule" className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-5">
      <div className="space-y-1"><p className="text-sm font-semibold">{saved.enabled ? "Automatic email is on" : "Automatic email is off"}</p>
        <p className="text-sm text-gray-600">{saved.enabled ? `Every ${saved.delivery_day} / ${saved.recipient_emails.length} recipient${saved.recipient_emails.length === 1 ? "" : "s"}` : "No scheduled reports will be emailed."}</p>
      </div>
      <Link href="/dashboard/reports/weekly" className={button}>Weekly Reports<ArrowRight size={16} /></Link>
    </section>
    {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {contextError && <div className="flex flex-wrap items-center gap-3 text-sm text-amber-800"><p role="status">{contextError}</p><button type="button" className={button} onClick={() => { setContextError(""); setContextReload(value => value + 1) }}><RefreshCw size={16} />Retry delivery details</button></div>}
    {config && (!config.email_delivery_configured || !config.scheduler_configured) && <p role="status" className="border-l-2 border-amber-500 pl-3 text-sm text-amber-900">{!config.email_delivery_configured ? "Email sending is not configured. Contact support." : "Automatic delivery is not configured. Contact support; test emails are still available."}</p>}
    <section aria-label="Report content" className="space-y-2 border-b border-gray-200 pb-5">
      <h2 className="text-base font-semibold">Report content</h2>
      <p className="break-words text-sm">{hasReport ? settings?.definition?.name || "Saved weekly report" : legacy ? "Existing metric email" : "No weekly report saved"}</p>
      {hasReport ? <p className="text-sm text-gray-600">{saved.metric_focus.length} selected metrics{settings && ` / ${settings.reporting_timezone}`}</p>
        : <p className="text-sm text-gray-600">{legacy ? "Your earlier metric and relationship selections are preserved." : "Preview and save your report in Weekly Reports before turning on automatic email."}</p>}
    </section>
    <form onSubmit={event => { event.preventDefault(); void save() }} className="space-y-5">
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-5 disabled:opacity-60">
        <legend className="mb-4 text-base font-semibold">Email schedule</legend>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} />Send automatically each week</label>
        <div className="grid min-w-0 items-start gap-5 md:grid-cols-2">
          <div className="min-w-0"><label className="block text-sm" htmlFor="email-day">Delivery day</label>
            <select id="email-day" className={input} value={draft.delivery_day} onChange={event => edit({ delivery_day: event.target.value as WeeklyReportPreference["delivery_day"] })}>{days.map(day => <option key={day} value={day}>{day[0].toUpperCase() + day.slice(1)}</option>)}</select>
            <p className="mt-2 text-xs text-gray-600">{settings ? `Schedule timezone: ${settings.reporting_timezone}` : "Schedule timezone is set in Weekly Reports."}</p>
          </div>
          <div className="min-w-0"><label className="block text-sm" htmlFor="email-recipients">Recipients</label>
            <textarea id="email-recipients" aria-describedby="email-recipient-hint" className={`${input} min-h-24`} rows={3} value={recipients} onChange={event => { setRecipients(event.target.value); setNotice(""); setError("") }} placeholder="owner@example.com" />
            <p id="email-recipient-hint" className="mt-1 text-xs text-gray-600">One address per line, or separated by commas.</p>
          </div>
        </div>
        <details className="space-y-4 border-y border-gray-200 py-4"><summary className="cursor-pointer text-sm font-medium">Email content options</summary>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={draft.include_recommendations} onChange={event => edit({ include_recommendations: event.target.checked })} />Include recommendations and decision follow-ups</label>
          <label className="block max-w-lg text-sm">Subject prefix (optional)<input className={input} value={draft.subject_prefix} maxLength={100} onChange={event => edit({ subject_prefix: event.target.value })} /></label>
          {!hasReport && draft.metric_focus.length > 0 && <div className="space-y-3"><h3 className="text-sm font-medium">Existing metric targets (optional)</h3>
            <div className="grid gap-3 sm:grid-cols-2">{draft.metric_focus.map(metric => <label key={metric} className="min-w-0 break-words text-sm">{metric.replace(/^\d+:/, "").replaceAll("_", " ")}<input className={input} type="number" step="any" value={draft.metric_targets[metric] ?? ""} onChange={event => {
              const targets = { ...draft.metric_targets }
              if (!event.target.value) delete targets[metric]
              else targets[metric] = Number(event.target.value)
              edit({ metric_targets: targets })
            }} /></label>)}</div>
          </div>}
        </details>
      </fieldset>
      {dirty && <p role="status" className="text-sm text-amber-800">Unsaved email changes</p>}
      {dirty && validation && <p role="status" className="text-sm text-amber-800">{validation}</p>}
      <button className={primary} disabled={!dirty || Boolean(busy) || Boolean(validation)} type="submit">{busy === "save" ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{busy === "save" ? "Saving..." : "Save email settings"}</button>
    </form>
    <section aria-label="Test email" className="flex flex-wrap items-center justify-between gap-4 border-y border-gray-200 py-5">
      <div className="min-w-0 space-y-1"><h2 className="text-base font-semibold">Test email</h2><p className="text-sm text-gray-600">A delivery check sent to the saved recipients, without report results.</p>
        {dirty ? <p className="text-xs text-amber-800">Save your changes before sending a test.</p> : !saved.recipient_emails.length && <p className="text-xs text-gray-600">Add and save at least one recipient.</p>}
      </div>
      <button type="button" className={button} disabled={!canTest} onClick={() => void sendTest()}>{busy === "test" ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}{busy === "test" ? "Sending test..." : "Send test email"}</button>
    </section>
    <section id="delivery-history" aria-label="Delivery history" className="min-w-0 scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Delivery history</h2><button type="button" className={button} disabled={historyLoading} aria-label="Refresh delivery history" title="Refresh delivery history" onClick={() => void refreshHistory()}><RefreshCw size={16} className={historyLoading ? "animate-spin" : ""} /></button></div>
      {historyLoading && <p role="status" className="text-sm text-gray-600">Loading delivery history...</p>}
      {historyError && <p role="alert" className="text-sm text-red-700">{historyError}</p>}
      {!historyLoading && !historyError && !history.length && <p className="text-sm text-gray-600">No email attempts recorded.</p>}
      <ul className="divide-y divide-gray-200">{history.map(item => <li key={item.id} className="min-w-0 space-y-2 py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className={`font-medium ${item.status.includes("failed") ? "text-red-700" : "text-gray-900"}`}>{deliveryStatus(item.status)}</span><time className="text-xs text-gray-600" dateTime={item.attempted_at}>{item.attempted_at.slice(0, 19).replace("T", " ")} UTC</time></div>
        <p className="break-words">{item.subject}</p><p className="break-words text-xs text-gray-600">{item.recipients.join(", ")}</p>
        {item.error && <p className="break-words text-xs text-red-700">{item.error}</p>}
      </li>)}</ul>
    </section>
  </div>
}
