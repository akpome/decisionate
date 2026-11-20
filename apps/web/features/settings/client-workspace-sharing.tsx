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
  members: OrganizationMemberRecord[]
  invites: OrganizationInviteRecord[]
  error?: string
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
        setAccess({
          key,
          members: members.filter(member => member.role === "client_user" || member.role === "member"),
          invites: invites.filter(invite => invite.role === "client_user" || invite.role === "member"),
        })
      }).catch(failure => {
        if (!ignore) setAccess({ key, members: [], invites: [], error: errorText(failure) })
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
      setRevision(value => value + 1)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function deliveryMessage(invite: OrganizationInviteRecord) {
    if (invite.email_status === "sent") return "Invitation sent."
    setError(invite.email_error || "The invitation was saved, but email delivery was not confirmed.")
    return ""
  }

  return <section aria-labelledby="client-sharing-title" className="space-y-4 border-t border-gray-200 py-5">
    <h2 id="client-sharing-title" className="text-lg font-semibold">Share workspace</h2>
    {!current ? <p role="status" className="text-sm text-gray-600">Loading workspace access...</p> : current.error ? (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-red-600">{current.error}</p>
        <button type="button" className={button} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />Retry</button>
      </div>
    ) : <>
      {current.members.length === 0 && current.invites.length === 0 && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault()
          const address = email.trim()
          if (!address) return
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
      {current.members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-all text-sm">{member.email || "Email unavailable"} <span className="text-gray-600">· Collaborator</span></p>
        <button type="button" disabled={busy} className={`${button} text-red-700`} onClick={() => void change(async () => {
          await removeOrganizationMember(member.id, userId, workspaceId)
          return "Collaborator access removed."
        })}><UserMinus size={16} />Remove access</button>
      </div>)}
      {current.invites.map(invite => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-all text-sm">{invite.email} <span className="text-gray-600">· {invite.email_status === "sent" ? "Invitation pending" : "Email not confirmed"}</span></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={button} onClick={() => void change(async () =>
            deliveryMessage(await sendOrganizationInvite(invite.id, userId, workspaceId))
          )}><Mail size={16} />{invite.email_status === "sent" ? "Resend invitation" : "Send invitation"}</button>
          <button type="button" disabled={busy} className={button} onClick={() => void change(async () => {
            await removeOrganizationInvite(invite.id, userId, workspaceId)
            return "Invitation revoked."
          })}><X size={16} />Revoke invitation</button>
        </div>
      </div>)}
    </>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>
}
