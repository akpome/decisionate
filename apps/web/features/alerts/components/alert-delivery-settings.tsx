"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarDays, Mail, Save, Send } from "lucide-react"

import {
  getWeeklyReportDeliveryConfig,
  getWeeklyReportDeliveryHistory,
  getWeeklyReportPreference,
  sendWeeklyReportNow,
  sendWeeklyReportTestEmail,
  updateWeeklyReportPreference,
  type WeeklyReportDeliveryConfig,
  type WeeklyReportDeliveryLog,
  type WeeklyReportPreference,
} from "@/lib/api"
import { useActiveWorkspace } from "@/lib/use-active-workspace"

const defaultPreference: WeeklyReportPreference = {
  enabled: false,
  cadence: "weekly",
  delivery_day: "monday",
  recipient_emails: [],
  metric_focus: [],
  metric_targets: {},
  relationship_focus: [],
  include_recommendations: true,
  sender_name: "",
  sender_email: "",
  reply_to_email: "",
  subject_prefix: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_clear_password: false,
  smtp_password_set: false,
  smtp_use_tls: true,
  smtp_use_ssl: false,
  last_sent_at: null,
  last_send_status: null,
  last_send_error: null,
}

const deliveryDays: WeeklyReportPreference["delivery_day"][] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
]

function normalizePreference(
  preference: WeeklyReportPreference
): WeeklyReportPreference {
  return {
    ...defaultPreference,
    ...preference,
    cadence: "weekly",
    metric_focus: preference.metric_focus ?? [],
    metric_targets: preference.metric_targets ?? {},
    relationship_focus: preference.relationship_focus ?? [],
  }
}

function parseRecipients(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDeliveryDay(day: string) {
  return day.replace(/\b\w/g, letter => letter.toUpperCase())
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function AlertDeliverySettings({ userId }: { userId: string }) {
  const { activeWorkspaceId, workspaceVersion } = useActiveWorkspace(userId)
  const [preference, setPreference] = useState(defaultPreference)
  const [recipientText, setRecipientText] = useState("")
  const [config, setConfig] = useState<WeeklyReportDeliveryConfig | null>(null)
  const [history, setHistory] = useState<WeeklyReportDeliveryLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const recipientEmails = useMemo(
    () => parseRecipients(recipientText),
    [recipientText]
  )
  const recipientsChanged =
    preference.recipient_emails.join("\n") !== recipientEmails.join("\n")
  const emailConfigured = Boolean(config?.email_delivery_configured)
  const hasRecipients = preference.recipient_emails.length > 0
  const senderReady =
    Boolean(preference.sender_email.trim()) &&
    Boolean(preference.smtp_host.trim())

  useEffect(() => {
    let current = true

    async function load() {
      setLoading(true)
      setError("")
      try {
        const [preferenceResult, configResult, historyResult] =
          await Promise.allSettled([
            getWeeklyReportPreference(userId, activeWorkspaceId),
            getWeeklyReportDeliveryConfig(userId, activeWorkspaceId),
            getWeeklyReportDeliveryHistory(userId, activeWorkspaceId),
          ])

        if (!current) return
        if (preferenceResult.status === "rejected") {
          throw preferenceResult.reason
        }

        const nextPreference = normalizePreference(preferenceResult.value)
        setPreference(nextPreference)
        setRecipientText(nextPreference.recipient_emails.join("\n"))
        setConfig(
          configResult.status === "fulfilled" ? configResult.value : null
        )
        setHistory(
          historyResult.status === "fulfilled" ? historyResult.value : []
        )
        if (
          configResult.status === "rejected" ||
          historyResult.status === "rejected"
        ) {
          setError("Delivery settings loaded, but status data is temporarily unavailable.")
        }
        setDirty(false)
      } catch (loadError) {
        if (current) {
          setError(getErrorMessage(loadError, "Alert delivery settings could not be loaded."))
        }
      } finally {
        if (current) setLoading(false)
      }
    }

    void load()
    return () => {
      current = false
    }
  }, [activeWorkspaceId, userId, workspaceVersion])

  function updateDraft(patch: Partial<WeeklyReportPreference>) {
    setPreference(current => normalizePreference({ ...current, ...patch }))
    setDirty(true)
    setError("")
    setNotice("")
  }

  async function handleSave() {
    if (saving) return
    if (preference.enabled && recipientEmails.length === 0) {
      setError("Add at least one recipient before enabling alert emails.")
      return
    }
    if (
      preference.enabled &&
      preference.metric_focus.length === 0 &&
      preference.relationship_focus.length === 0
    ) {
      setError("Select KPI or relationship focus on the Alerts page before enabling alert emails.")
      return
    }

    setSaving(true)
    setError("")
    setNotice("")
    try {
      const saved = normalizePreference(
        await updateWeeklyReportPreference(
          { ...preference, recipient_emails: recipientEmails },
          userId,
          activeWorkspaceId
        )
      )
      setPreference(saved)
      setRecipientText(saved.recipient_emails.join("\n"))
      setDirty(false)
      await refreshStatus()
      setNotice("Alert delivery settings saved.")
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Alert delivery settings could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  async function refreshStatus() {
    const [configResult, historyResult] = await Promise.allSettled([
      getWeeklyReportDeliveryConfig(userId, activeWorkspaceId),
      getWeeklyReportDeliveryHistory(userId, activeWorkspaceId),
    ])
    if (configResult.status === "fulfilled") setConfig(configResult.value)
    if (historyResult.status === "fulfilled") setHistory(historyResult.value)
  }

  async function handleSendNow() {
    if (
      sending ||
      dirty ||
      recipientsChanged ||
      !preference.enabled ||
      !hasRecipients ||
      !emailConfigured
    ) return

    setSending(true)
    setError("")
    try {
      const result = await sendWeeklyReportNow(userId, activeWorkspaceId)
      setNotice(`Alert digest sent to ${result.delivered_count} recipient${result.delivered_count === 1 ? "" : "s"}.`)
      await refreshStatus()
    } catch (sendError) {
      setError(getErrorMessage(sendError, "Alert digest could not be sent."))
    } finally {
      setSending(false)
    }
  }

  async function handleSendTest() {
    if (
      sendingTest ||
      saving ||
      dirty ||
      recipientsChanged ||
      !hasRecipients ||
      !emailConfigured
    ) return

    setSendingTest(true)
    setError("")
    try {
      const result = await sendWeeklyReportTestEmail(userId, activeWorkspaceId)
      setNotice(`Test email sent at ${formatDateTime(result.sent_at)}.`)
      await refreshStatus()
    } catch (sendError) {
      setError(getErrorMessage(sendError, "Test email could not be sent."))
    } finally {
      setSendingTest(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold">Alert delivery</h2>
        <p role="status" className="mt-3 text-sm text-gray-500">
          Loading alert delivery settings...
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Alert delivery</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure email delivery, schedule, recipients, and delivery tests for workspace alerts.
          </p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-medium ${
          preference.enabled
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-gray-200 bg-gray-50 text-gray-600"
        }`}>
          {preference.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <input
              type="checkbox"
              checked={preference.enabled}
              onChange={event => updateDraft({ enabled: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[var(--decisionate-brand-primary)]"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Enable alert emails</span>
              <span className="mt-1 block text-xs text-gray-500">Send the saved KPI and relationship digest on the selected day.</span>
            </span>
          </label>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-800">Sender details</p>
            <div className="mt-3 space-y-3">
              <TextField label="Sender name" value={preference.sender_name} placeholder="Your workspace" onChange={value => updateDraft({ sender_name: value })} />
              <TextField label="Sender email" type="email" value={preference.sender_email} placeholder="reports@example.com" onChange={value => updateDraft({ sender_email: value })} />
              <TextField label="Reply-to email" type="email" value={preference.reply_to_email} placeholder="owner@example.com" onChange={value => updateDraft({ reply_to_email: value })} />
              <TextField label="Subject prefix" value={preference.subject_prefix} placeholder="Weekly decision intelligence" onChange={value => updateDraft({ subject_prefix: value })} />
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-800">Workspace SMTP override</p>
            <p className="mt-1 text-xs text-gray-500">Optional. Leave blank to use Decisionate&apos;s managed email delivery.</p>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <TextField label="SMTP host" value={preference.smtp_host} placeholder="smtp.example.com" onChange={value => updateDraft({ smtp_host: value })} />
                <TextField label="Port" type="number" value={preference.smtp_port ? String(preference.smtp_port) : ""} placeholder="587" onChange={value => updateDraft({ smtp_port: value ? Number(value) : null })} />
              </div>
              <TextField label="SMTP username" value={preference.smtp_username} placeholder="apikey or user@example.com" onChange={value => updateDraft({ smtp_username: value })} />
              <TextField label="SMTP password" type="password" value={preference.smtp_password ?? ""} placeholder={preference.smtp_password_set ? "Password saved - enter a new one to replace it" : "SMTP password or API key"} onChange={value => updateDraft({ smtp_password: value, smtp_clear_password: false })} />
              {preference.smtp_password_set && (
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={Boolean(preference.smtp_clear_password)} onChange={event => updateDraft({ smtp_clear_password: event.target.checked, smtp_password: event.target.checked ? "" : preference.smtp_password })} className="mt-0.5 h-4 w-4 accent-[var(--decisionate-brand-primary)]" />
                  Clear saved SMTP password on next save
                </label>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <ToggleField label="Use TLS / STARTTLS" checked={preference.smtp_use_tls} onChange={checked => updateDraft({ smtp_use_tls: checked, smtp_use_ssl: checked ? false : preference.smtp_use_ssl })} />
                <ToggleField label="Use SSL" checked={preference.smtp_use_ssl} onChange={checked => updateDraft({ smtp_use_ssl: checked, smtp_use_tls: checked ? false : preference.smtp_use_tls })} />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="alert-delivery-day" className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700"><CalendarDays size={16} />Scheduled sending</label>
            <select id="alert-delivery-day" value={preference.delivery_day} onChange={event => updateDraft({ delivery_day: event.target.value as WeeklyReportPreference["delivery_day"] })} className="h-11 w-full rounded-xl border px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]">
              {deliveryDays.map(day => <option key={day} value={day}>{formatDeliveryDay(day)}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500">Runs weekly on the selected day when alert emails are enabled.</p>
          </div>

          <div>
            <label htmlFor="alert-recipients" className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700"><Mail size={16} />Recipient emails</label>
            <textarea id="alert-recipients" value={recipientText} onChange={event => { setRecipientText(event.target.value); setDirty(true); setError(""); setNotice("") }} rows={5} placeholder="owner@example.com\nclient@example.com" className="w-full rounded-xl border px-3 py-2 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]" />
            <p className="mt-1 text-xs text-gray-500">Add one email per line or separate addresses with commas.</p>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-800">Delivery readiness</p>
            <div className="mt-3 space-y-2 text-sm">
              <StatusRow label="Email sender" ready={emailConfigured || senderReady} value={emailConfigured ? (config?.email_delivery_source === "workspace" ? "Workspace SMTP" : "Decisionate managed") : "Ready after save"} />
              <StatusRow label="Schedule runner" ready={Boolean(config?.scheduler_configured)} value="Ready" />
              <StatusRow label="AI analysis" ready={Boolean(config?.ai_provider_configured)} value={config?.ai_model ? `Ready (${config.ai_model})` : "Ready"} />
            </div>
            {preference.last_send_error && <p className="mt-3 text-xs text-red-600">Last error: {preference.last_send_error}</p>}
            {history.length > 0 && (
              <details className="mt-4 border-t border-gray-100 pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-gray-700">Recent delivery history</summary>
                <div className="mt-2 space-y-2">
                  {history.slice(0, 5).map(log => (
                    <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-gray-500">{formatDateTime(log.attempted_at)} · {log.recipients.length} recipient{log.recipients.length === 1 ? "" : "s"}</span>
                      <span className={log.status.includes("failed") ? "font-medium text-red-600" : "font-medium text-green-700"}>{log.status.replaceAll("_", " ")}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"><Save size={16} />{saving ? "Saving..." : "Save delivery settings"}</button>
            <button type="button" onClick={() => void handleSendNow()} disabled={sending || sendingTest || saving || dirty || recipientsChanged || !hasRecipients || !preference.enabled || !emailConfigured} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 sm:w-auto"><Send size={16} />{sending ? "Sending..." : "Send digest now"}</button>
            <button type="button" onClick={() => void handleSendTest()} disabled={sendingTest || sending || saving || dirty || recipientsChanged || !hasRecipients || !emailConfigured} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-white px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:text-gray-400 sm:w-auto"><Send size={16} />{sendingTest ? "Sending test..." : "Send test email"}</button>
          </div>
          {dirty && <p className="text-xs text-gray-500">Save your changes before sending or testing an email.</p>}
        </div>
      </div>
    </section>
  )
}

function TextField({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  type?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-600">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-lg border bg-white px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]" />
    </label>
  )
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-600">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--decisionate-brand-primary)]" />
      {label}
    </label>
  )
}

function StatusRow({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5">
      <span className="font-medium text-gray-700">{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ready ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{ready ? value : "Needs setup"}</span>
    </div>
  )
}
