"use client"

import { useClerk } from "@clerk/nextjs"
import { useEffect, useRef, useState } from "react"
import { Check, Mail, Play, RefreshCw, Trash2, Unlink, X } from "lucide-react"

import {
  deleteOwnedWorkspace, getAgencyClientInvitations, inviteExistingAgencyClient,
  respondToAgencyClientInvitation, startIndependentWorkspaceTrial, unlinkOwnedWorkspaceAgency,
  type AgencyClientInvitation, type OrganizationWorkspaceRecord,
} from "@/lib/api"
import { clearActiveWorkspaceId, notifyWorkspaceAccessChanged } from "@/lib/workspace-context"

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const message = (error: unknown) => error instanceof Error ? error.message : "The workspace could not be updated. Please try again."

function refreshAccess() {
  notifyWorkspaceAccessChanged()
  window.dispatchEvent(new Event("decisionate:billing-updated"))
}

export function ExistingClientInvitation({ userId }: { userId: string }) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const pending = useRef(false)

  async function invite() {
    if (pending.current || !email.trim()) return
    pending.current = true; setBusy(true); setError(""); setNotice("")
    try {
      const result = await inviteExistingAgencyClient(email.trim(), userId)
      if (result.email_status === "sent") { setNotice("Invitation sent. The workspace owner must approve it before joining your agency."); setEmail("") }
      else setError(result.email_error || "The invitation was saved, but its email was not confirmed.")
    } catch (failure) { setError(message(failure)) }
    finally { pending.current = false; setBusy(false) }
  }

  return <form onSubmit={event => { event.preventDefault(); void invite() }} className="mt-5 border-t border-gray-100 pt-5">
    <h3 className="text-sm font-semibold">Add an existing client workspace</h3>
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-xs text-gray-600">Client owner email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} className="mt-1 h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm" /></label>
      <button type="submit" disabled={busy || !email.trim()} className={button}><Mail size={16} />{busy ? "Sending..." : "Invite workspace owner"}</button>
    </div>
    {notice && <p role="status" className="mt-3 text-sm text-green-700">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </form>
}

export function ClientWorkspaceOwnership({ userId, workspace, view = "settings" }: { userId: string; workspace: OrganizationWorkspaceRecord; view?: "settings" | "recovery" }) {
  const recovery = view === "recovery" && workspace.agency_removed === true
  const { signOut } = useClerk()
  const [invitations, setInvitations] = useState<AgencyClientInvitation[]>([])
  const [loadedInvitationKey, setLoadedInvitationKey] = useState("")
  const [retry, setRetry] = useState(0)
  const invitationKey = `${userId}:${workspace.owner_user_id}:${retry}`
  const loading = Boolean(recovery && loadedInvitationKey !== invitationKey)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const pending = useRef(false)

  useEffect(() => {
    if (!recovery) return
    let cancelled = false
    void getAgencyClientInvitations(userId, workspace.owner_user_id).then(items => {
      if (!cancelled) setInvitations(items)
    }).catch(failure => { if (!cancelled) setError(message(failure)) }).finally(() => { if (!cancelled) setLoadedInvitationKey(invitationKey) })
    return () => { cancelled = true }
  }, [userId, workspace.owner_user_id, recovery, invitationKey])

  async function act(action: string, invitation?: AgencyClientInvitation) {
    if (pending.current) return
    if ((action === "trial" || action === "delete") && !workspace.agency_removed) return
    if (action === "delete" && confirmation.trim() !== workspace.name) return
    pending.current = true; setBusy(action); setError(""); setNotice("")
    try {
      if (action === "leave") {
        await unlinkOwnedWorkspaceAgency(userId, workspace.owner_user_id)
        setLeaving(false)
        refreshAccess()
      } else if (action === "trial") {
        const result = await startIndependentWorkspaceTrial(userId, workspace.owner_user_id)
        setNotice(`Your ${result.trial_days}-day trial has started. Your existing workspace is ready.`)
        refreshAccess()
      } else if (action === "delete") {
        await deleteOwnedWorkspace(confirmation.trim(), userId, workspace.owner_user_id)
        setDeleted(true)
        clearActiveWorkspaceId(userId)
        await signOut({ redirectUrl: "/sign-in" })
      } else if (action === "sign-out") {
        await signOut({ redirectUrl: "/sign-in" })
      } else if (invitation) {
        await respondToAgencyClientInvitation(invitation.id, action === "accept", userId, workspace.owner_user_id)
        setInvitations(items => items.filter(item => item.id !== invitation.id))
        setNotice(action === "accept" ? `Your workspace has joined ${invitation.agency_name}. Agency data access remains off until you enable it.` : "Agency invitation declined.")
        refreshAccess()
      }
    } catch (failure) { setError(message(failure)) }
    finally { pending.current = false; setBusy("") }
  }

  if (deleted) return <section role="status" className="py-5">
    <h2 className="text-lg font-semibold">Workspace deleted</h2>
    <p className="mt-2 text-sm text-gray-600">Sign out to finish. Any other workspaces you belong to are unchanged.</p>
    <button type="button" disabled={Boolean(busy)} onClick={() => void act("sign-out")} className={`${button} mt-4`}>Sign out</button>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </section>

  return <section className="border-t border-gray-200 py-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{recovery ? "Continue with Decisionate" : workspace.agency_removed ? "Client account unlinked" : "Agency connection"}</h2>
        <p className="mt-2 text-sm text-gray-600">{recovery ? "Your data is preserved. Manage your subscription or join an agency." : workspace.agency_removed ? "Your agency is no longer linked. Your data is preserved." : "Unlink your agency to manage this workspace independently. Your workspace and data will be kept."}</p>
      </div>
      {view === "settings" && (workspace.agency_removed
        ? <button type="button" disabled={Boolean(busy)} onClick={() => { setDeleting(true); setConfirmation("") }} className={`${button} text-red-600`}><Trash2 size={16} />Delete workspace</button>
        : <button type="button" disabled={Boolean(busy)} onClick={() => setLeaving(true)} className={button}><Unlink size={16} />Unlink agency</button>)}
    </div>
    {recovery && <div className="mt-4 flex flex-wrap items-center gap-3">
      {!workspace.independent_trial_started && workspace.is_paused !== false && <button type="button" disabled={Boolean(busy)} onClick={() => void act("trial")} className={`${button} text-blue-700`}><Play size={16} />{busy === "trial" ? "Starting..." : "Start free trial"}</button>}
    </div>}
    {recovery && <div className="mt-5">
      <h3 className="text-sm font-semibold">Agency invitations</h3>
      {loading ? <p role="status" className="mt-2 text-sm text-gray-500">Loading invitations...</p> : invitations.length === 0 ? <p className="mt-2 text-sm text-gray-500">No pending agency invitations.</p> : invitations.map(invitation => <div key={invitation.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 py-3">
        <span className="min-w-0 break-words text-sm font-medium">{invitation.agency_name}</span>
        <div className="flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void act("accept", invitation)} className={button}><Check size={16} />Join agency</button><button type="button" disabled={Boolean(busy)} onClick={() => void act("decline", invitation)} className={button}><X size={16} />Decline</button></div>
      </div>)}
    </div>}
    {notice && <p role="status" className="mt-3 text-sm text-green-700">{notice}</p>}
    {error && <div role="alert" className="mt-3 flex items-start gap-3 text-sm text-red-600"><span className="min-w-0 flex-1">{error}</span>{recovery && <button type="button" disabled={Boolean(busy)} title="Retry invitations" aria-label="Retry invitations" onClick={() => { setError(""); setRetry(value => value + 1) }} className="shrink-0 rounded-md p-1"><RefreshCw size={16} /></button>}</div>}
    {leaving && !workspace.agency_removed && <div role="dialog" aria-modal="true" aria-labelledby="owned-workspace-unlink" className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/60 p-4">
      <form className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5" onSubmit={event => { event.preventDefault(); void act("leave") }}>
        <h2 id="owned-workspace-unlink" className="text-lg font-semibold">Unlink your agency?</h2>
        <p className="mt-3 text-sm text-gray-600">Your agency will lose access to {workspace.name} and will no longer pay for it. Your data will stay in this workspace.</p>
        <p className="mt-2 text-sm text-gray-600">After unlinking, use Billing to start a Decisionate trial or choose a plan. You can delete the workspace in Settings.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => setLeaving(false)} className={button}>Cancel</button><button type="submit" disabled={Boolean(busy)} className={button}><Unlink size={16} />{busy === "leave" ? "Unlinking..." : "Unlink agency"}</button></div>
      </form>
    </div>}
    {deleting && workspace.agency_removed && <div role="dialog" aria-modal="true" aria-labelledby="owned-workspace-delete" className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/60 p-4">
      <form className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5" onSubmit={event => { event.preventDefault(); void act("delete") }}>
        <h2 id="owned-workspace-delete" className="text-lg font-semibold">Delete your workspace?</h2>
        <p className="mt-3 text-sm text-gray-600">This permanently deletes {workspace.name}, its datasets, reports, connections and decisions.</p>
        <p className="mt-2 text-sm text-gray-600">You will be signed out. Your app account is removed if it has no other workspaces. Other members&apos; shared accounts and your sign-in provider account are not deleted.</p>
        <label className="mt-4 block text-sm">Type {workspace.name} to confirm<input autoFocus value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={Boolean(busy)} className="mt-2 h-10 w-full rounded-md border border-gray-200 px-3" /></label>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => setDeleting(false)} className={button}>Cancel</button><button type="submit" disabled={Boolean(busy) || confirmation.trim() !== workspace.name} className={`${button} text-red-600`}><Trash2 size={16} />{busy === "delete" ? "Deleting..." : "Permanently delete"}</button></div>
      </form>
    </div>}
  </section>
}
