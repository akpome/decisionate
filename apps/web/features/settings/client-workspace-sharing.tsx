"use client"

import { Mail, RefreshCw, UserMinus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  addOrganizationInvite, getOrganizationInvites, getOrganizationMembers, removeOrganizationInvite,
  removeOrganizationMember, sendOrganizationInvite, type OrganizationInviteRecord, type OrganizationMemberRecord,
} from "@/lib/api"

const button = "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const errorText = (failure: unknown) => failure instanceof Error ? failure.message : "Workspace sharing could not be updated."

type ShareAccess = {
  key: string
  entries: SharingEntry[]
  error?: string
}

type SharingEntry = {
  key: string
  email: string
  members: OrganizationMemberRecord[]
  invites: OrganizationInviteRecord[]
}

function groupSharingEntries(members: OrganizationMemberRecord[], invites: OrganizationInviteRecord[]) {
  const entries = new Map<string, SharingEntry>()
  function entry(email: string, fallback: string) {
    const key = email ? `email:${email.toLowerCase()}` : fallback
    const existing = entries.get(key)
    if (existing) return existing
    const added: SharingEntry = { key, email, members: [], invites: [] }
    entries.set(key, added)
    return added
  }
  for (const member of members) {
    if (member.role !== "client_user" && member.role !== "member") continue
    const match = entry(member.email?.trim() || "", `member:${member.clerk_user_id}`)
    if (!match.members.some(item => item.id === member.id)) match.members.push(member)
  }
  for (const invite of invites) {
    if (invite.status !== "pending" || (invite.role !== "client_user" && invite.role !== "member")) continue
    const match = entry(invite.email.trim(), `invitation:${invite.id}`)
    if (!match.invites.some(item => item.id === invite.id)) match.invites.push(invite)
  }
  return [...entries.values()]
}

export function ClientWorkspaceSharing({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const [email, setEmail] = useState("")
  const [revision, setRevision] = useState(0)
  const [access, setAccess] = useState<ShareAccess | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const pending = useRef(false)
  const key = JSON.stringify([userId, workspaceId, revision])
  const current = access?.key === key ? access : null

  useEffect(() => {
    let ignore = false
    void Promise.all([getOrganizationMembers(userId, workspaceId), getOrganizationInvites(userId, workspaceId)])
      .then(([members, invites]) => {
        if (ignore) return
        setAccess({ key, entries: groupSharingEntries(members, invites) })
      }).catch(failure => {
        if (!ignore) setAccess({ key, entries: [], error: errorText(failure) })
      })
    return () => { ignore = true }
  }, [key, userId, workspaceId])

  async function change(action: () => Promise<string>) {
    if (pending.current || !current || current.error) return
    pending.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      setNotice(await action())
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setRevision(value => value + 1)
      pending.current = false
      setBusy(false)
    }
  }

  function deliveryMessage(invite: OrganizationInviteRecord) {
    if (invite.email_status === "sent") return "Invitation sent."
    setError(invite.email_error || "The invitation was saved, but email delivery was not confirmed.")
    return ""
  }

  function removeSharingEntry(entry: SharingEntry) {
    void change(async () => {
      for (const invite of entry.invites) await removeOrganizationInvite(invite.id, userId, workspaceId)
      for (const member of entry.members) await removeOrganizationMember(member.id, userId, workspaceId)
      return entry.members.length ? "Collaborator access removed." : "Invitation revoked."
    })
  }

  return <section aria-labelledby="client-sharing-title" className="space-y-4 border-t border-gray-200 py-5">
    <h2 id="client-sharing-title" className="text-lg font-semibold">Share workspace</h2>
    {!current ? <p role="status" className="text-sm text-gray-600">Loading workspace access...</p> : current.error ? (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-red-600">{current.error}</p>
        <button type="button" className={button} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />Retry</button>
      </div>
    ) : <>
      {current.entries.length === 0 && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault()
          const address = email.trim()
          if (!address || current.entries.length) return
          void change(async () => {
            const invite = await addOrganizationInvite({ email: address, role: "client_user" }, userId, workspaceId)
            setEmail("")
            return deliveryMessage(invite)
          })
        }}>
          <label className="min-w-0 flex-1 basis-52 text-sm text-gray-600">Collaborator email
            <input type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"
              placeholder="teammate@example.com" disabled={busy} className="mt-1 min-h-10 w-full rounded-md border px-3 text-base sm:text-sm" />
          </label>
          <button type="submit" disabled={busy || !email.trim()} className={button}><Mail size={16} />{busy ? "Sending..." : "Invite collaborator"}</button>
        </form>
      )}
      {current.entries.length > 1 && <p className="text-sm text-gray-600">Only one collaborator is allowed. Remove extra access before inviting someone else.</p>}
      {current.entries.length > 0 && <ul className="divide-y divide-gray-100">
        {current.entries.map(entry => {
          const accepted = entry.members.length > 0
          const invite = entry.invites[0]
          const sent = invite?.email_status === "sent"
          return <li key={entry.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <p className="min-w-0 break-all text-sm">{entry.email || "Email unavailable"} <span className="text-gray-600">· {accepted ? "Collaborator" : sent ? "Invitation pending" : "Email not confirmed"}</span></p>
            <div className="flex flex-wrap gap-2">
              {!accepted && invite && current.entries.length === 1 && entry.invites.length === 1 && (
                <button type="button" disabled={busy} className={button} onClick={() => void change(async () =>
                  deliveryMessage(await sendOrganizationInvite(invite.id, userId, workspaceId))
                )}><Mail size={16} />{sent ? "Resend invitation" : "Send invitation"}</button>
              )}
              <button type="button" disabled={busy} className={accepted ? `${button} text-red-700` : button} onClick={() => removeSharingEntry(entry)}>
                {accepted ? <UserMinus size={16} /> : <X size={16} />}{accepted ? "Remove access" : "Revoke invitation"}
              </button>
            </div>
          </li>
        })}
      </ul>}
    </>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>
}
