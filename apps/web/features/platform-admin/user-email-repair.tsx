"use client"

import { useEffect, useRef, useState } from "react"
import { LoaderCircle, Square, Wrench } from "lucide-react"
import { repairPlatformUserEmails, type UserEmailRepairResult } from "@/lib/api"
import { UserEmailMapping } from "./user-email-mapping"

type Summary = Pick<UserEmailRepairResult, "checked" | "emails_updated" | "users_deleted" | "unresolved" | "remaining_unmapped">
const empty = (): Summary => ({ checked: 0, emails_updated: 0, users_deleted: 0, unresolved: [] })

export function UserEmailRepair({ userId, onRepaired }: { userId: string; onRepaired: () => Promise<void> }) {
  const running = useRef(false)
  const cancelled = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState("")
  const [paused, setPaused] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelled.current = true } }, [])
  useEffect(() => {
    const mapped = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.mapped || !detail.user_id) return
      setSummary(current => current?.unresolved.some(item => item.user_id === detail.user_id) ? { ...current,
        unresolved: current.unresolved.filter(item => item.user_id !== detail.user_id), emails_updated: current.emails_updated + 1,
        remaining_unmapped: current.remaining_unmapped === undefined ? undefined : Math.max(0, current.remaining_unmapped - 1),
      } : current)
    }
    window.addEventListener("decisionate:user-email-mapped", mapped)
    return () => window.removeEventListener("decisionate:user-email-mapped", mapped)
  }, [])

  async function repair() {
    if (running.current || !window.confirm("Sync missing emails and remove unused user records? Accounts with workspace data, permissions or an active login will be preserved.")) return
    running.current = true; cancelled.current = false; setBusy(true); setError(""); setPaused(false)
    const total = empty()
    setSummary(total)
    let cursor: string | null = null
    try {
      do {
        const result = await repairPlatformUserEmails(userId, cursor)
        total.checked += result.checked; total.emails_updated += result.emails_updated; total.users_deleted += result.users_deleted
        total.unresolved = [...total.unresolved, ...result.unresolved]
        total.remaining_unmapped = result.remaining_unmapped
        if (!mounted.current) return
        setSummary({ ...total })
        if (result.provider_unavailable) throw new Error("The email provider could not be checked. Remaining records were preserved. Try again later.")
        if (result.next_user_id && cursor && result.next_user_id <= cursor) throw new Error("Repair stopped because its progress could not be confirmed.")
        cursor = result.next_user_id
      } while (cursor && mounted.current && !cancelled.current)
      if (cancelled.current && mounted.current) setPaused(true)
    } catch (value) {
      if (mounted.current) setError(value instanceof Error ? value.message : "Repair could not be completed. Completed changes are saved; retry to check remaining records.")
    } finally {
      try { if (mounted.current) await onRepaired() }
      catch { if (mounted.current) setError(current => current || "Repair changes are saved, but the user list could not refresh. Reload this page.") }
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void repair()} title="Sync missing emails and remove unused user records" className="inline-flex min-h-10 w-52 max-w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50">
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Wrench size={16} />}{busy ? "Repairing accounts..." : "Repair user records"}
      </button>
      {busy && <button type="button" title="Stop after the current batch" onClick={() => { cancelled.current = true }} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm"><Square size={14} />Stop</button>}
    </div>
    {summary && <p role="status" className="text-xs text-gray-600">{busy ? "Checking accounts." : error ? "Repair incomplete." : paused ? "Repair stopped." : summary.unresolved.length || summary.remaining_unmapped ? "Email mapping required." : "Repair finished."} Checked: {summary.checked}. Emails recovered: {summary.emails_updated}. Unused records removed: {summary.users_deleted}.{summary.remaining_unmapped !== undefined && <> Unmapped accounts: {summary.remaining_unmapped}.</>}</p>}
    {error && <p role="alert" className="max-w-lg text-sm text-red-700">{error}</p>}
    {!!summary?.unresolved.length && <details className="max-w-lg text-xs text-amber-800"><summary className="cursor-pointer">{summary.unresolved.length} {summary.unresolved.length === 1 ? "account" : "accounts"} preserved for review</summary>
      <ul className="mt-2 max-h-48 space-y-3 overflow-y-auto">{summary.unresolved.map(item => <li key={item.user_id} className="space-y-2 break-words"><p><span className="font-mono">{item.user_id}</span>: {item.reason}</p>
        {!item.user_id.includes(":client:") && <UserEmailMapping userId={userId} targetUserId={item.user_id} disabled={busy} onMapped={onRepaired} />}
      </li>)}</ul>
    </details>}
  </div>
}
